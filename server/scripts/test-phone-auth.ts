/**
 * Phone verification, end to end, with no network and no Google.
 *
 * A local RSA key stands in for Firebase's signing key, and a local HTTP server
 * serves the matching JWKS (FIREBASE_JWKS_URL). Tokens are minted with the same
 * claims Firebase uses for phone sign-in, then sent to the real app over HTTP.
 * Everything the server does with them — signature, claims, freshness, replay,
 * the number match, the money gates, the login second factor — is the production
 * code path.
 *
 * Run: npm run test:phone-auth
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { createApp } from "../src/app.js";
import { applicationFor } from "./fixtures.js";
import { resetFederatedConfig } from "../src/federated.js";
import { maskPhone, normalizePhone, resetPhoneReplayMemory } from "../src/phoneAuth.js";
import { encryptTotpSecret, generateTotpSecret, totpCode } from "../src/totp.js";

const PROJECT = "veyra-phone-test";
const KID = "phone-test-key";

process.env.NODE_ENV = "development";
process.env.MAIL_PROVIDER = "off";
process.env.ADMIN_EMAIL = "phone-admin@veyra.test"; process.env.ADMIN_PASSWORD = "phone-admin-pass";
process.env.RECAPTCHA_SITE_KEY = "";
process.env.FIREBASE_PROJECT_ID = PROJECT;
process.env.FIREBASE_API_KEY = "test-public-web-key";
process.env.FIREBASE_AUTH_DOMAIN = `${PROJECT}.firebaseapp.com`;
process.env.FEDERATED_PROVIDERS = "google";
process.env.FIREBASE_LEEWAY_SEC = "60";

// ---- local JWKS -------------------------------------------------------------
const signing = generateKeyPairSync("rsa", { modulusLength: 2048 });
const rogue = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = { ...(signing.publicKey.export({ format: "jwk" }) as Record<string, unknown>), kid: KID, alg: "RS256", use: "sig" };
const jwksServer: Server = createServer((req, res) => {
  if (req.url === "/jwks") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: [publicJwk] }));
  } else { res.writeHead(404).end(); }
});
await new Promise<void>(r => jwksServer.listen(0, "127.0.0.1", r));
process.env.FIREBASE_JWKS_URL = `http://127.0.0.1:${(jwksServer.address() as { port: number }).port}/jwks`;
resetFederatedConfig();

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
type Claims = Record<string, unknown>;
/** Mints a token shaped like a Firebase ID token. `nonce` keeps every token unique. */
function mint(claims: Claims, opts: { key?: KeyObject; kid?: string; tamper?: boolean } = {}): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, iat: nowSec, exp: nowSec + 3600,
    auth_time: nowSec, nonce: randomUUID(), ...claims,
  };
  const header = { alg: "RS256", kid: opts.kid ?? KID, typ: "JWT" };
  const input = `${b64(header)}.${b64(payload)}`;
  const signature = sign("sha256", Buffer.from(input), opts.key ?? signing.privateKey).toString("base64url");
  if (opts.tamper) {
    // Same header and signature, different body: the signature must no longer verify.
    return `${b64(header)}.${b64({ ...payload, phone_number: "+15550000000" })}.${signature}`;
  }
  return `${input}.${signature}`;
}
const phoneToken = (uid: string, e164: string, extra: Claims = {}, opts = {}) =>
  mint({ sub: uid, phone_number: e164, firebase: { sign_in_provider: "phone" }, ...extra }, opts);

// ---- app --------------------------------------------------------------------
const { app, db } = createApp(":memory:");
const server = createServer(app);
await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const api = async (method: string, path: string, token?: string, body?: unknown) => {
  const r = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: any = {}; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: r.status, json };
};

let checks = 0;
const check = (name: string, value: unknown) => { assert.ok(value, name); checks++; console.log(`✓ ${name}`); };

const setEnforced = (on: boolean) => {
  if (on) process.env.FIREBASE_PROJECT_ID = PROJECT; else delete process.env.FIREBASE_PROJECT_ID;
  resetFederatedConfig();
};

try {
  // ---- pure helpers ---------------------------------------------------------
  check("US numbers normalise to E.164 whatever their punctuation", normalizePhone("(415) 555-0101") === "+14155550101" && normalizePhone("1 212 555 0199") === "+12125550199");
  check("international numbers keep their country code", normalizePhone("+44 20 7946 0958") === "+442079460958");
  check("numbers that can't receive a text are refused", normalizePhone("555-0101") === null && normalizePhone("") === null && normalizePhone("+0123") === null);
  check("the displayed number keeps only the country code and last four digits", maskPhone("+14155550101") === "+1 •••• 0101");

  // ---- accounts -------------------------------------------------------------
  const admin = (await api("POST", "/api/auth/login", undefined, { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).json.token as string;
  const register = async (name: string, phone: string, type: "personal" | "business" = "personal") => {
    const email = `${name.toLowerCase()}@veyra.test`;
    const profile = { ...applicationFor(type, name, email), phone };
    const r = await api("POST", "/api/auth/register", undefined, { name, email, password: "phone-member-pass", accountType: type, business: type === "business" ? `${name} Ltd` : "", phone, profile });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    await api("POST", `/api/admin/kyc/${r.json.user.id}/decision`, admin, { decision: "approved" });
    return { token: r.json.token as string, id: r.json.user.id as string, email, uid: `firebase-${name.toLowerCase()}` };
  };
  const ana = await register("Ana", "(415) 555-0101");
  const ben = await register("Ben", "+1 212 555 0199");
  const cora = await register("Cora", "(312) 555-0166");
  const dev = await register("Dev", "+1 312 555 0177");
  const eli = await register("Eli", "+1 646 555 0123");
  db.prepare("UPDATE accounts SET balance_cents = 500000 WHERE user_id IN (?, ?)").run(ana.id, cora.id);

  const config = await api("GET", "/api/auth/config");
  check("the public config says phone verification is enforced", config.json.phone?.enforced === true);

  const anaStatus = await api("GET", "/api/me/phone", ana.token);
  check("an unverified member's status shows the stored number, masked, and not verified",
    anaStatus.status === 200 && anaStatus.json.enforced === true && anaStatus.json.verified === false && anaStatus.json.phone === "+14155550101" && anaStatus.json.maskedPhone === "+1 •••• 0101");

  // ---- money is locked until the phone is proved ----------------------------
  const gated = (r: { status: number; json: any }) => r.status === 403 && r.json.code === "phone_verification_required";
  check("deposits are refused until the phone is verified",
    gated(await api("POST", "/api/me/deposits", ana.token, { amount: "10.00" })));
  check("transfers are refused until the phone is verified",
    gated(await api("POST", "/api/me/transfers", ana.token, { recipient: ben.email, amount: "5.00" })));
  check("Veyra-to-Veyra transfers are refused until the phone is verified",
    gated(await api("POST", "/api/me/veyra-transfers", ana.token, { identifier: ben.email, amount: "5.00", requestKey: randomUUID() })));
  check("crypto quotes are refused until the phone is verified",
    gated(await api("POST", "/api/me/crypto/quote", ana.token, { asset: "BTC", side: "buy", amount: "10" })));
  check("crypto confirmations are refused until the phone is verified",
    gated(await api("POST", "/api/me/crypto/confirm", ana.token, { quoteId: randomUUID() })));
  check("crypto trades are refused until the phone is verified",
    gated(await api("POST", "/api/me/holdings/trade", ana.token, { asset: "BTC", side: "buy", amount: "10" })));
  check("crypto withdrawals are refused until the phone is verified",
    gated(await api("POST", "/api/me/crypto-withdrawals", ana.token, { asset: "BTC", amount: "0.001", address: "bc1qexample" })));
  check("reads are not gated: the account state still loads",
    (await api("GET", "/api/me/state", ana.token)).status === 200);

  // ---- proving the number ---------------------------------------------------
  const noProof = await api("POST", "/api/me/phone/verify", eli.token, {});
  check("verifying with no proof is a 400, not a silent pass", noProof.status === 400 && noProof.json.code === "phone_token_missing");

  const emailToken = mint({ sub: eli.uid, email: eli.email, email_verified: true, firebase: { sign_in_provider: "google.com" } });
  const wrongProvider = await api("POST", "/api/me/phone/verify", eli.token, { idToken: emailToken });
  check("a Google token proves an email, not a phone, and is refused", wrongProvider.status === 403 && wrongProvider.json.code === "phone_provider_required");

  const wrongNumber = await api("POST", "/api/me/phone/verify", eli.token, { idToken: phoneToken(eli.uid, "+12125550199") });
  check("a code sent to a different number is refused", wrongNumber.status === 403 && wrongNumber.json.code === "phone_mismatch");

  const stale = await api("POST", "/api/me/phone/verify", eli.token, { idToken: phoneToken(eli.uid, "+16465550123", { auth_time: Math.floor(Date.now() / 1000) - 400 }) });
  check("a proof older than 300 seconds is refused", stale.status === 401 && stale.json.code === "phone_auth_stale");

  const futureAuth = await api("POST", "/api/me/phone/verify", eli.token, { idToken: phoneToken(eli.uid, "+16465550123", { auth_time: Math.floor(Date.now() / 1000) + 3600 }) });
  check("a proof dated in the future is refused", futureAuth.status === 401);

  const wrongAudience = await api("POST", "/api/me/phone/verify", eli.token, { idToken: phoneToken(eli.uid, "+16465550123", { aud: "some-other-project" }) });
  check("a proof issued for another Firebase project is refused", wrongAudience.status === 401 && wrongAudience.json.code === "phone_token_rejected");

  const rogueKey = await api("POST", "/api/me/phone/verify", eli.token, { idToken: mint({ sub: eli.uid, phone_number: "+16465550123", firebase: { sign_in_provider: "phone" } }, { key: rogue.privateKey, kid: "rogue-key" }) });
  check("a proof signed by a key Google doesn't publish is refused", rogueKey.status === 401);

  const tampered = await api("POST", "/api/me/phone/verify", eli.token, { idToken: phoneToken(eli.uid, "+16465550123", {}, { tamper: true }) });
  check("a proof whose number was edited after signing is refused", tampered.status === 401);

  const expired = await api("POST", "/api/me/phone/verify", eli.token, { idToken: phoneToken(eli.uid, "+16465550123", { exp: Math.floor(Date.now() / 1000) - 3600 }) });
  check("an expired proof is refused", expired.status === 401);

  // Ana, not Eli: the rejection probes above used up Eli's per-minute verify budget.
  const goodToken = phoneToken(ana.uid, "+14155550101");
  const proved = await api("POST", "/api/me/phone/verify", ana.token, { idToken: goodToken });
  check("a current proof for the stored number verifies the member", proved.status === 200 && proved.json.verified === true && typeof proved.json.verifiedAt === "number");

  const replay = await api("POST", "/api/me/phone/verify", ana.token, { idToken: goodToken });
  check("the same proof cannot be used twice", replay.status === 401 && replay.json.code === "phone_token_reused");

  const anaDeposit = await api("POST", "/api/me/deposits", ana.token, { amount: "10.00" });
  check("a verified member gets past the phone gate", anaDeposit.json.code !== "phone_verification_required");

  // ---- changing the number un-verifies it ----------------------------------
  const changed = await api("PATCH", "/api/me/profile", ana.token, { phone: "(415) 555-0199" });
  check("changing the profile number clears the verification", changed.status === 200 && (await api("GET", "/api/me/phone", ana.token)).json.verified === false);
  check("a changed number is gated again", gated(await api("POST", "/api/me/transfers", ana.token, { recipient: ben.email, amount: "5.00" })));

  const reproved = await api("POST", "/api/me/phone/verify", ana.token, { idToken: phoneToken(ana.uid, "+14155550199") });
  check("the new number verifies on its own", reproved.status === 200 && reproved.json.verified === true);
  await api("PATCH", "/api/me/profile", ana.token, { phone: "+1 415-555-0199" });
  check("retyping the same number in another format keeps the proof", (await api("GET", "/api/me/phone", ana.token)).json.verified === true);

  // ---- sign-in: password, then a text ----------------------------------------
  // Ben has a verified number and no authenticator, so sign-in asks for a text.
  const benProof = await api("POST", "/api/me/phone/verify", ben.token, { idToken: phoneToken(ben.uid, "+12125550199") });
  check("Ben verifies his number", benProof.status === 200);

  const benLogin = await api("POST", "/api/auth/login", undefined, { email: ben.email, password: "phone-member-pass" });
  check("a verified member with no authenticator is sent a text at sign-in",
    benLogin.json.twoFactorRequired === true && benLogin.json.method === "sms" && benLogin.json.phone === "+12125550199" && !benLogin.json.token);

  const codeOnTextChallenge = await api("POST", "/api/auth/login/verify", undefined, { challengeId: benLogin.json.challengeId, code: "123456" });
  check("a text-message challenge can't be completed with a typed code", codeOnTextChallenge.status === 400);

  const benSession = await api("POST", "/api/auth/login/verify", undefined, { challengeId: benLogin.json.challengeId, idToken: phoneToken(ben.uid, "+12125550199") });
  check("a texted code completes sign-in and issues a session", benSession.status === 200 && typeof benSession.json.token === "string");

  // Cora never verified her number: sign-in is not held up by the phone rule.
  const coraLogin = await api("POST", "/api/auth/login", undefined, { email: cora.email, password: "phone-member-pass" });
  check("an unverified member signs in straight away (verification happens after sign-up)", typeof coraLogin.json.token === "string");

  // Dev has an authenticator app and a verified number as backup.
  const devProof = await api("POST", "/api/me/phone/verify", dev.token, { idToken: phoneToken(dev.uid, "+13125550177") });
  check("Dev verifies a backup number", devProof.status === 200);
  const devSecret = generateTotpSecret();
  db.prepare("UPDATE users SET totp_secret_encrypted = ? WHERE id = ?").run(encryptTotpSecret(devSecret), dev.id);
  db.prepare("UPDATE preferences SET two_factor = 1 WHERE user_id = ?").run(dev.id);

  const devLogin = await api("POST", "/api/auth/login", undefined, { email: dev.email, password: "phone-member-pass" });
  check("an authenticator user still gets the authenticator prompt first, with text as a backup",
    devLogin.json.method === "totp" && devLogin.json.smsFallbackAvailable === true);

  const fallback = await api("POST", "/api/auth/login/sms-fallback", undefined, { challengeId: devLogin.json.challengeId });
  check("an authenticator user can switch the same challenge to a text", fallback.status === 200 && fallback.json.method === "sms" && fallback.json.phone === "+13125550177");

  const devSession = await api("POST", "/api/auth/login/verify", undefined, { challengeId: devLogin.json.challengeId, idToken: phoneToken(dev.uid, "+13125550177") });
  check("the switched challenge signs in with the texted proof", devSession.status === 200 && typeof devSession.json.token === "string");

  const devTotp = await api("POST", "/api/auth/login", undefined, { email: dev.email, password: "phone-member-pass" });
  const totpSession = await api("POST", "/api/auth/login/verify", undefined, { challengeId: devTotp.json.challengeId, code: totpCode(devSecret) });
  check("the authenticator code still signs in when the member uses it", totpSession.status === 200 && typeof totpSession.json.token === "string");

  // ---- with FIREBASE_PROJECT_ID unset, nothing is gated ----------------------
  setEnforced(false);
  check("without FIREBASE_PROJECT_ID the config says enforcement is off",
    (await api("GET", "/api/auth/config")).json.phone?.enforced === false);
  check("without FIREBASE_PROJECT_ID, an unverified member can still deposit",
    !gated(await api("POST", "/api/me/deposits", cora.token, { amount: "10.00" })));
  const benPlain = await api("POST", "/api/auth/login", undefined, { email: ben.email, password: "phone-member-pass" });
  check("without FIREBASE_PROJECT_ID a verified member signs in with just a password", typeof benPlain.json.token === "string");
  setEnforced(true);

  resetPhoneReplayMemory();
  console.log(`\nALL PHONE AUTH CHECKS PASSED (${checks} checks)`);
} finally {
  server.close();
  jwksServer.close();
}
