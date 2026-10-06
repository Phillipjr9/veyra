import { randomUUID } from "node:crypto";
import { ASSETS } from "../../shared/catalog.js";
/**
 * API integration tests — boots the real server on an ephemeral port with a
 * fresh database and exercises the full surface over HTTP:
 *
 * auth (login/logout), unauthorized access, role restrictions, staff
 * provisioning, customer/account management, deposits & withdrawals,
 * transfers, KYC workflow, risk/fraud workflow, staff & role management,
 * audit logging & immutability, broadcasts, reports/exports, settings,
 * emergency halt, concurrent financial operations, privilege escalation,
 * data integrity, password reset.
 *
 * Nothing is seeded: the only pre-existing account is the Super Admin
 * bootstrapped from ADMIN_* env vars below. Every member and staff account,
 * and every dollar of balance, is created through the public API — exactly
 * like production traffic.
 *
 * Run: npm run test:api   (or: npx tsx server/scripts/test-api.ts)
 */
import { createApp } from "../src/app.js";
import { applicationFor } from "./fixtures.js";
import { decryptTotpSecret, encryptTotpSecret, generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, normalizeRecoveryCode, totpCode, verifyTotp } from "../src/totp.js";
import { resetRateLimits } from "../src/security.js";
import { resetRecaptchaConfig } from "../src/recaptcha.js";
import { resetFederatedConfig } from "../src/federated.js";
import { resetWebauthnConfig } from "../src/webauthn.js";
import { resetPrices } from "../src/prices.js";
import { recentMail, mailConfig, mailDelivers } from "../src/mail.js";
import {
  dollarsToCentsExact, centsToDecimalExact, parseUnits, formatUnitsTrimmed, valueInCents, unitsForCents,
} from "../src/money.js";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failures = 0;
let checks = 0;
const expect = (label: string, cond: boolean, extra?: string) => {
  checks++;
  console.log(`${cond ? "✓" : "✗ FAIL:"} ${label}${extra && !cond ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
};

/** Parses one CSV line into cells (handles the exports' quoted fields). */
const csvCells = (line: string): string[] => {
  const cells: string[] = [];
  let cell = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (line[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { cells.push(cell); cell = ""; }
    else cell += ch;
  }
  cells.push(cell);
  return cells;
};
const csvRowFor = (csv: string, needle: string): string[] | null => {
  const line = csv.split("\n").find(l => l.includes(needle));
  return line ? csvCells(line) : null;
};

const tmp = mkdtempSync(join(tmpdir(), "veyra-api-test-"));
// Clean production instance — env-bootstrapped admin, no other identities.
process.env.ADMIN_EMAIL = "ops@veyra.test";
process.env.ADMIN_PASSWORD = "admin-pass-123";
process.env.ADMIN_NAME = "Ops Admin";
const { app, db } = createApp(join(tmp, "test.db"));
const server = await new Promise<{ port: number }>(resolve => {
  const s = app.listen(0, "127.0.0.1", () => resolve({ port: (s.address() as { port: number }).port }));
});
const base = `http://127.0.0.1:${server.port}`;

const api = async (method: string, path: string, token?: string, body?: unknown, deviceId?: string) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(deviceId ? { "X-Veyra-Device": deviceId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* csv or empty */ }
  return { status: res.status, json, text, headers: res.headers };
};

async function fund(token: string, amount: number, source: string, admin: string) {
  const user = (await api("GET", "/api/auth/me", token)).json.user;
  const setup = await api("PUT", `/api/admin/members/${user.id}/funding`, admin, { methods: [{ label: source, kind: "bank", instructions: "Synthetic test settlement instructions", enabled: true }] });
  const submitted = await api("POST", "/api/me/deposits", token, { amount, methodId: setup.json.methods[0].id, requestKey: randomUUID() });
  if(submitted.status !== 201) throw new Error(JSON.stringify(submitted.json));
  const confirmed = await api("POST", `/api/admin/members/${user.id}/funding/${submitted.json.request.id}/review`, admin, { decision: "confirmed", evidence: "Synthetic test receipt verified" });
  if(confirmed.status !== 200) throw new Error(JSON.stringify(confirmed.json));
  return submitted;
}

const register = async (name: string, email: string, password: string, extra: Record<string, unknown> = {}) => {
  const accountType = extra.accountType === "personal" ? "personal" : "business";
  const profile = (extra.profile as Record<string, unknown> | undefined)
    ?? applicationFor(accountType, name, typeof extra.business === "string" && extra.business.trim() ? extra.business : undefined);
  return api("POST", "/api/auth/register", undefined, { name, email, password, ...extra, profile });
};

/**
 * Sign-up parks every account in the review queue and the money routes refuse to
 * move until a human clears it. This is how the suite clears the members it is
 * about to move money with — the same decision a reviewer makes.
 */
let decideFor: (userId: string) => Promise<{ status: number }> = async () => ({ status: 0 });

try {
  /* ---------- health & auth ---------- */
  const health = await api("GET", "/api/health");
  expect("health check", health.status === 200 && health.json.ok === true);

  const totpAt = 1_700_000_000_000;
  const knownSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const secret = generateTotpSecret();
  const encryptedSecret = encryptTotpSecret(secret);
  expect("TOTP uses the RFC 6238 six-digit code", totpCode(knownSecret, 59_000) === "287082");
  expect("TOTP accepts clock-skew window and rejects malformed codes",
    verifyTotp(secret, totpCode(secret, totpAt), totpAt) &&
    verifyTotp(secret, totpCode(secret, totpAt - 30_000), totpAt) && !verifyTotp(secret, "abc123", totpAt));
  expect("TOTP secrets encrypt at rest and round-trip", encryptedSecret !== secret && decryptTotpSecret(encryptedSecret) === secret);
  const helperRecoveryCodes = generateRecoveryCodes();
  expect("recovery codes are ten unique, formatted one-time secrets",
    helperRecoveryCodes.length === 10 && new Set(helperRecoveryCodes).size === 10 && helperRecoveryCodes.every(code => /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}(?:-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}){2}$/.test(code)));
  expect("recovery code normalization is case/spacing tolerant and stores only a hash",
    normalizeRecoveryCode(` ${helperRecoveryCodes[0].toLowerCase().replaceAll("-", " ")} `) === helperRecoveryCodes[0].replaceAll("-", "") &&
    hashRecoveryCode(helperRecoveryCodes[0]) === hashRecoveryCode(helperRecoveryCodes[0].toLowerCase().replaceAll("-", " ")) &&
    hashRecoveryCode("invalid") === null);

  const bootCount = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  expect("clean database contains only the bootstrap admin", bootCount === 1);

  const ghostLogin = await api("POST", "/api/auth/login", undefined, { email: "demo@veyra.com", password: "veyra123" });
  expect("no pre-seeded identities exist (login 401)", ghostLogin.status === 401);

  const badLogin = await api("POST", "/api/auth/login", undefined, { email: "ops@veyra.test", password: "wrong" });
  expect("login rejects wrong password (401)", badLogin.status === 401);

  const noToken = await api("GET", "/api/admin/overview");
  expect("unauthenticated admin access rejected (401)", noToken.status === 401);

  const badToken = await api("GET", "/api/admin/overview", "forged.token.here");
  expect("forged token rejected (401)", badToken.status === 401);

  const adminLogin = await api("POST", "/api/auth/login", undefined, { email: "ops@veyra.test", password: "admin-pass-123" });
  expect("env-bootstrapped superadmin login", adminLogin.status === 200 && adminLogin.json.token && adminLogin.json.user.role === "superadmin");
  const admin = adminLogin.json.token;
  const adminId = adminLogin.json.user.id;
  decideFor = (userId: string) => api("POST", `/api/admin/kyc/${userId}/decision`, admin, { decision: "approved", note: "" });

  const hashRow = db.prepare("SELECT password_hash FROM users WHERE email = 'ops@veyra.test'").get() as { password_hash: string };
  expect("passwords stored as scrypt digests, never plaintext", hashRow.password_hash.startsWith("s2$") && !hashRow.password_hash.includes("admin-pass-123"));

  /* ---------- every account is created through the API ---------- */
  const raeReg = await register("Rae Kim", "rae@member.test", "member-pass-1", { accountType: "business", business: "Rae & Co Studio" });
  await decideFor(raeReg.json.user.id); // rae is the suite's working account
  const alexReg = await register("Alex Stone", "alex@member.test", "member-pass-2", { accountType: "personal" });
  const adaReg = await register("Ada Mensah", "ada@staff.test", "staff-pass-1", { accountType: "business", business: "Veyra Financial HQ" });
  const leoReg = await register("Leo Frost", "leo@staff.test", "staff-pass-2", { accountType: "business", business: "Veyra Financial HQ" });
  expect("members register through the API", [raeReg, alexReg, adaReg, leoReg].every(r => r.status === 201));
  const raeId = raeReg.json.user.id, alexId = alexReg.json.user.id;
  const signupQueue = (await api("GET", "/api/admin/kyc/queue", admin)).json.queue;
  expect("signup review submissions contain an empty documents array", signupQueue.some((q: any) =>
    q.userId === alexId && Array.isArray(q.submission.documents) && q.submission.documents.length === 0));
  const signupAggregate = (await api("GET", "/api/admin/state", admin)).json.kycQueue;
  expect("the admin aggregate preserves the signup documents contract", signupAggregate.some((q: any) =>
    q.userId === alexId && Array.isArray(q.kyc.submission.documents) && q.kyc.submission.documents.length === 0));

  const promoteCompliance = await api("POST", `/api/admin/staff/${adaReg.json.user.id}/role`, admin, { role: "compliance" });
  const promoteSupport = await api("POST", `/api/admin/staff/${leoReg.json.user.id}/role`, admin, { role: "support" });
  expect("admin provisions compliance + support staff", promoteCompliance.status === 200 && promoteSupport.status === 200);

  const raeLogin = await api("POST", "/api/auth/login", undefined, { email: "rae@member.test", password: "member-pass-1" });
  const alexLogin = await api("POST", "/api/auth/login", undefined, { email: "alex@member.test", password: "member-pass-2" });
  const complianceLogin = await api("POST", "/api/auth/login", undefined, { email: "ada@staff.test", password: "staff-pass-1" });
  const supportLogin = await api("POST", "/api/auth/login", undefined, { email: "leo@staff.test", password: "staff-pass-2" });
  const rae = raeLogin.json.token, alex = alexLogin.json.token;
  const compliance = complianceLogin.json.token, support = supportLogin.json.token;
  expect("staff + member logins", rae && alex && compliance && support);

  /* ---------- authenticator-backed two-step sign-in ---------- */
  const initialSecurityState = await api("GET", "/api/me/state", rae);
  expect("new accounts do not claim two-factor is enabled before enrollment",
    initialSecurityState.status === 200 && initialSecurityState.json.account.preferences.twoFactor === false);
  const initialAlertCount = (db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'security'").get(raeId) as { n: number }).n;
  await api("PUT", "/api/me/preferences", rae, { key: "loginAlerts", value: false });
  await api("POST", "/api/auth/login", undefined, { email: "rae@member.test", password: "member-pass-1" }, "device-rae-silent-alert-check-01");
  const alertCountWhileOff = (db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'security'").get(raeId) as { n: number }).n;
  await api("PUT", "/api/me/preferences", rae, { key: "loginAlerts", value: true });
  await api("POST", "/api/auth/login", undefined, { email: "rae@member.test", password: "member-pass-1" }, "device-rae-alert-check-on-01");
  const alertCountWhileOn = (db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'security'").get(raeId) as { n: number }).n;
  expect("login-alert preference suppresses and enables in-app new-device notifications",
    alertCountWhileOff === initialAlertCount && alertCountWhileOn === alertCountWhileOff + 1);
  const setup2fa = await api("POST", "/api/me/security/two-factor/setup", rae, { password: "member-pass-1" });
  const totpSecret = setup2fa.json.secret as string;
  expect("authenticator setup requires the account password and returns one-time enrollment data",
    setup2fa.status === 200 && /^[A-Z2-7]{32}$/.test(totpSecret) && setup2fa.json.otpauthUrl.startsWith("otpauth://totp/"));
  const storedPendingSecret = db.prepare("SELECT totp_pending_secret_encrypted FROM users WHERE id = ?").get(raeId) as { totp_pending_secret_encrypted: string };
  expect("pending authenticator secret is encrypted in the database",
    Boolean(storedPendingSecret.totp_pending_secret_encrypted) && !storedPendingSecret.totp_pending_secret_encrypted.includes(totpSecret));
  const badSetupConfirmation = await api("POST", "/api/me/security/two-factor/confirm", rae, { password: "member-pass-1", code: "bad-code" });
  expect("authenticator enrollment cannot be enabled without a valid code", badSetupConfirmation.status === 400 &&
    (await api("GET", "/api/me/state", rae)).json.account.preferences.twoFactor === false);
  const confirm2fa = await api("POST", "/api/me/security/two-factor/confirm", rae, { password: "member-pass-1", code: totpCode(totpSecret) });
  const enrolledRecoveryCodes = Array.isArray(confirm2fa.json?.recoveryCodes) ? confirm2fa.json.recoveryCodes as string[] : [];
  const enrolledRecoveryHashes = (db.prepare("SELECT code_hash FROM totp_recovery_codes WHERE user_id = ?").all(raeId) as Array<{ code_hash: string }>).map(row => row.code_hash);
  const stateAfterEnrollment = (await api("GET", "/api/me/state", rae)).json.account;
  expect("valid authenticator enrollment enables MFA and returns ten one-time recovery codes",
    confirm2fa.status === 200 && stateAfterEnrollment.preferences.twoFactor === true &&
    stateAfterEnrollment.recoveryCodesRemaining === 10 && enrolledRecoveryCodes.length === 10);
  expect("recovery codes are stored only as account-scoped hashes",
    enrolledRecoveryHashes.length === 10 && enrolledRecoveryCodes.every(code => enrolledRecoveryHashes.includes(hashRecoveryCode(code) ?? "")) &&
    enrolledRecoveryHashes.every(digest => !enrolledRecoveryCodes.includes(digest)));
  const loginChallenge = await api("POST", "/api/auth/login", undefined, { email: "rae@member.test", password: "member-pass-1" }, "device-rae-second-browser-0001");
  expect("password login for an enrolled account returns a code challenge without a token",
    loginChallenge.status === 200 && loginChallenge.json.twoFactorRequired === true && Boolean(loginChallenge.json.challengeId) && !loginChallenge.json.token);
  const badMfaCode = await api("POST", "/api/auth/login/verify", undefined, { challengeId: loginChallenge.json.challengeId, code: "bad-code" });
  expect("invalid authenticator or recovery code does not issue a session", badMfaCode.status === 401 && !badMfaCode.json.token);
  const verifiedLogin = await api("POST", "/api/auth/login/verify", undefined, { challengeId: loginChallenge.json.challengeId, code: totpCode(totpSecret) }, "device-rae-second-browser-0001");
  expect("valid authenticator code completes login and records a live session", verifiedLogin.status === 200 && Boolean(verifiedLogin.json.token) &&
    (await api("GET", "/api/auth/me", verifiedLogin.json.token, undefined, "device-rae-second-browser-0001")).status === 200);

  const firstRecoveryCode = enrolledRecoveryCodes[0] ?? "INVALID-CODE";
  const recoveryLoginChallenge = await api("POST", "/api/auth/login", undefined, { email: "rae@member.test", password: "member-pass-1" }, "device-rae-recovery-browser-0001");
  const recoveryLogin = await api("POST", "/api/auth/login/verify", undefined, {
    challengeId: recoveryLoginChallenge.json.challengeId,
    code: firstRecoveryCode.toLowerCase().replaceAll("-", " "),
  }, "device-rae-recovery-browser-0001");
  const stateAfterRecoveryLogin = (await api("GET", "/api/me/state", rae)).json.account;
  expect("a formatted, case-insensitive recovery code completes MFA login once",
    recoveryLogin.status === 200 && Boolean(recoveryLogin.json.token) && stateAfterRecoveryLogin.recoveryCodesRemaining === 9);
  const reusedCodeChallenge = await api("POST", "/api/auth/login", undefined, { email: "rae@member.test", password: "member-pass-1" });
  const reusedRecoveryLogin = await api("POST", "/api/auth/login/verify", undefined, {
    challengeId: reusedCodeChallenge.json.challengeId, code: firstRecoveryCode,
  });
  expect("a consumed recovery code cannot be reused for another sign-in",
    reusedRecoveryLogin.status === 401 && !reusedRecoveryLogin.json.token &&
    (await api("GET", "/api/me/state", rae)).json.account.recoveryCodesRemaining === 9);

  const rejectedRegeneration = await api("POST", "/api/me/security/two-factor/recovery-codes/regenerate", rae, {
    password: "member-pass-1", code: "bad-code",
  });
  expect("recovery-code regeneration requires the current authenticator and preserves codes on failure",
    rejectedRegeneration.status === 400 && (await api("GET", "/api/me/state", rae)).json.account.recoveryCodesRemaining === 9);
  const rejectedPasswordRegeneration = await api("POST", "/api/me/security/two-factor/recovery-codes/regenerate", rae, {
    password: "wrong-password", code: totpCode(totpSecret),
  });
  expect("recovery-code regeneration also verifies the current password",
    rejectedPasswordRegeneration.status === 400 && (await api("GET", "/api/me/state", rae)).json.account.recoveryCodesRemaining === 9);
  const regeneration = await api("POST", "/api/me/security/two-factor/recovery-codes/regenerate", rae, {
    password: "member-pass-1", code: totpCode(totpSecret),
  });
  const regeneratedRecoveryCodes = Array.isArray(regeneration.json?.recoveryCodes) ? regeneration.json.recoveryCodes as string[] : [];
  const regeneratedHashes = (db.prepare("SELECT code_hash FROM totp_recovery_codes WHERE user_id = ?").all(raeId) as Array<{ code_hash: string }>).map(row => row.code_hash);
  expect("password plus authenticator regenerates ten codes and replaces the prior set",
    regeneration.status === 200 && regeneratedRecoveryCodes.length === 10 &&
    (await api("GET", "/api/me/state", rae)).json.account.recoveryCodesRemaining === 10 &&
    regeneratedHashes.length === 10 && regeneratedRecoveryCodes.every(code => regeneratedHashes.includes(hashRecoveryCode(code) ?? "")));

  const staleCode = enrolledRecoveryCodes[1] ?? "INVALID-CODE";
  const regeneratedLoginChallenge = await api("POST", "/api/auth/login", undefined, { email: "rae@member.test", password: "member-pass-1" });
  const staleRecoveryLogin = await api("POST", "/api/auth/login/verify", undefined, {
    challengeId: regeneratedLoginChallenge.json.challengeId, code: staleCode,
  });
  const regeneratedRecoveryLogin = await api("POST", "/api/auth/login/verify", undefined, {
    challengeId: regeneratedLoginChallenge.json.challengeId, code: regeneratedRecoveryCodes[0] ?? "INVALID-CODE",
  });
  expect("regeneration invalidates old codes while a new recovery code can finish login",
    staleRecoveryLogin.status === 401 && regeneratedRecoveryLogin.status === 200 && Boolean(regeneratedRecoveryLogin.json.token) &&
    (await api("GET", "/api/me/state", rae)).json.account.recoveryCodesRemaining === 9);

  const disableWithRecovery = await api("POST", "/api/me/security/two-factor/disable", rae, {
    password: "member-pass-1", code: (regeneratedRecoveryCodes[1] ?? "INVALID-CODE").toLowerCase().replaceAll("-", " "),
  });
  const stateAfterRecoveryDisable = (await api("GET", "/api/me/state", rae)).json.account;
  expect("a one-time recovery code can disable two-step sign-in with the password",
    disableWithRecovery.status === 200 && stateAfterRecoveryDisable.preferences.twoFactor === false &&
    stateAfterRecoveryDisable.recoveryCodesRemaining === 0 &&
    (db.prepare("SELECT COUNT(*) AS n FROM totp_recovery_codes WHERE user_id = ?").get(raeId) as { n: number }).n === 0);

  const secondSetup = await api("POST", "/api/me/security/two-factor/setup", rae, { password: "member-pass-1" });
  const secondTotpSecret = secondSetup.json.secret as string;
  const secondConfirm = await api("POST", "/api/me/security/two-factor/confirm", rae, {
    password: "member-pass-1", code: totpCode(secondTotpSecret),
  });
  const disable2fa = await api("POST", "/api/me/security/two-factor/disable", rae, {
    password: "member-pass-1", code: totpCode(secondTotpSecret),
  });
  expect("turning off two-step sign-in also accepts the current authenticator and clears recovery codes",
    secondSetup.status === 200 && secondConfirm.status === 200 && disable2fa.status === 200 &&
    (await api("GET", "/api/me/state", rae)).json.account.preferences.twoFactor === false &&
    (await api("GET", "/api/me/state", rae)).json.account.recoveryCodesRemaining === 0);
  const loginAfterDisable = await api("POST", "/api/auth/login", undefined, { email: "rae@member.test", password: "member-pass-1" });
  expect("login returns to the normal flow after authenticator is disabled", loginAfterDisable.status === 200 && Boolean(loginAfterDisable.json.token));
  const fakeTwoFactorPreference = await api("PUT", "/api/me/preferences", rae, { key: "twoFactor", value: true });
  expect("two-factor enrollment cannot be bypassed with a preference edit", fakeTwoFactorPreference.status === 400 &&
    (await api("GET", "/api/me/state", rae)).json.account.preferences.twoFactor === false);

  /* ---------- live sessions, device trust and real revocation ---------- */
  const tokenSessionId = (token: string) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).jti as string;
  const trustedDeviceId = "device-rae-second-browser-0001";
  const verifiedSessionId = tokenSessionId(verifiedLogin.json.token);
  const trustVerifiedDevice = await api("PATCH", `/api/me/sessions/${verifiedSessionId}`, rae, { trusted: true });
  const repeatDeviceLogin = await api("POST", "/api/auth/login", undefined, { email: "rae@member.test", password: "member-pass-1" }, trustedDeviceId);
  const repeatDeviceTokenId = tokenSessionId(repeatDeviceLogin.json.token);
  const repeatDeviceState = await api("GET", "/api/me/state", repeatDeviceLogin.json.token, undefined, trustedDeviceId);
  const repeatedSessionIsTrusted = repeatDeviceState.json.account.sessions.some((session: any) => session.id === repeatDeviceTokenId && session.trusted);
  expect("persistent device id carries trust to a later sign-in on that browser",
    trustVerifiedDevice.status === 200 && repeatDeviceLogin.status === 200 && repeatedSessionIsTrusted,
    `trust=${trustVerifiedDevice.status}, login=${repeatDeviceLogin.status}, trusted=${repeatedSessionIsTrusted}, session=${repeatDeviceTokenId}`);
  const registeredSessionId = tokenSessionId(raeReg.json.token);
  const currentSessionId = tokenSessionId(rae);
  const sessionsBefore = (await api("GET", "/api/me/state", rae)).json.account.sessions as Array<{ id: string; current: boolean; trusted: boolean }>;
  expect("session projection contains only live sessions and marks the current token exactly once",
    sessionsBefore.some(session => session.id === registeredSessionId) &&
    sessionsBefore.filter(session => session.current).length === 1 &&
    sessionsBefore.find(session => session.id === currentSessionId)?.current === true);
  const selfRevoke = await api("POST", `/api/me/sessions/${currentSessionId}/revoke`, rae);
  expect("server refuses to revoke the session making the request", selfRevoke.status === 400 && (await api("GET", "/api/auth/me", rae)).status === 200);
  const trustSession = await api("PATCH", `/api/me/sessions/${registeredSessionId}`, rae, { trusted: true });
  expect("device trust updates only a live session", trustSession.status === 200 &&
    (await api("GET", "/api/me/state", rae)).json.account.sessions.some((session: any) => session.id === registeredSessionId && session.trusted));
  const revokeSession = await api("POST", `/api/me/sessions/${registeredSessionId}/revoke`, rae);
  expect("revoking a device session invalidates its actual bearer token", revokeSession.status === 200 &&
    (await api("GET", "/api/auth/me", raeReg.json.token)).status === 401 &&
    !(await api("GET", "/api/me/state", rae)).json.account.sessions.some((session: any) => session.id === registeredSessionId));
  const revokeOthers = await api("POST", "/api/me/sessions/revoke-others", rae);
  expect("sign out other devices revokes every other token while preserving this session",
    revokeOthers.status === 200 && revokeOthers.json.revokedCount >= 1 &&
    (await api("GET", "/api/auth/me", verifiedLogin.json.token)).status === 401 &&
    (await api("GET", "/api/auth/me", rae)).status === 200);

  /* ---------- unauthorized & role restrictions ---------- */
  const memberOnAdmin = await api("GET", "/api/admin/overview", rae);
  expect("member blocked from admin routes (403)", memberOnAdmin.status === 403);

  const supportAdjust = await api("POST", `/api/admin/members/${raeId}/adjust`, support, { direction: "credit", amount: 100, memo: "nope" });
  expect("support cannot adjust balances (403)", supportAdjust.status === 403);

  const supportStaff = await api("GET", "/api/admin/staff", support);
  expect("support cannot manage staff (403)", supportStaff.status === 403);

  const complianceAdjust = await api("POST", `/api/admin/members/${raeId}/adjust`, compliance, { direction: "credit", amount: 100, memo: "nope" });
  expect("compliance cannot adjust balances (403)", complianceAdjust.status === 403);

  const complianceKyc = await api("GET", "/api/admin/kyc/queue", compliance);
  expect("compliance CAN view KYC queue (RBAC grant)", complianceKyc.status === 200 && Array.isArray(complianceKyc.json.queue));

  /* ---------- dashboard overview ---------- */
  const overview = await api("GET", "/api/admin/overview", admin);
  expect("overview KPIs present", overview.status === 200 &&
    typeof overview.json.totals.customers === "number" &&
    typeof overview.json.totals.totalBalanceCents === "number" &&
    Array.isArray(overview.json.recentAudit));

  /* ---------- customers & accounts ---------- */
  const members = await api("GET", "/api/admin/members?q=rae", admin);
  expect("member search finds the API-registered member", members.status === 200 && members.json.members.length === 1 && members.json.members[0].name === "Rae Kim");

  await api("PUT", "/api/me/preferences", rae, { key: "scoutAuto", value: false }); // deterministic balances
  await fund(rae, 5000, "Opening deposit", admin);

  const memberDetail = await api("GET", `/api/admin/members/${raeId}`, admin);
  expect("member detail with account + transactions", memberDetail.status === 200 && memberDetail.json.member.balance.cents > 0 && memberDetail.json.transactions.length > 0);

  /* ---------- deposits & withdrawals (admin treasury) ---------- */
  const before = memberDetail.json.member.balance.cents as number;
  const credit = await api("POST", `/api/admin/members/${raeId}/adjust`, admin, { direction: "credit", amount: 500, memo: "Wire deposit confirmation" });
  expect("admin credit adjusts member balance (+$500)", credit.status === 200 && credit.json.after.cents === before + 50000);

  const noMemo = await api("POST", `/api/admin/members/${raeId}/adjust`, admin, { direction: "credit", amount: 100 });
  expect("adjustment without audit reason rejected (400)", noMemo.status === 400);

  const debit = await api("POST", `/api/admin/members/${raeId}/adjust`, admin, { direction: "debit", amount: 200, memo: "Fee reversal" });
  expect("admin withdrawal adjusts balance (−$200)", debit.status === 200 && debit.json.after.cents === before + 30000);

  const overdraft = await api("POST", `/api/admin/members/${raeId}/adjust`, admin, { direction: "debit", amount: 99_999_999, memo: "should fail" });
  expect("overdraft withdrawal rejected, balance unchanged", overdraft.status === 400 &&
    (await api("GET", `/api/admin/members/${raeId}`, admin)).json.member.balance.cents === before + 30000);

  /* ---------- concurrent financial operations stay consistent ---------- */
  const concurrentStart = (await api("GET", `/api/admin/members/${raeId}`, admin)).json.member.balance.cents as number;
  await Promise.all(
    Array.from({ length: 5 }, () => api("POST", `/api/admin/members/${raeId}/adjust`, admin, { direction: "credit", amount: 10, memo: "concurrent" })),
  );
  const concurrentEnd = (await api("GET", `/api/admin/members/${raeId}`, admin)).json.member.balance.cents as number;
  expect("5 concurrent credits apply exactly once each (atomicity)", concurrentEnd === concurrentStart + 5 * 1000);

  /* ---------- member transfers & restrictions ---------- */
  const transfer = await api("POST", "/api/me/transfers", rae, { counterparty: "Harbor Studio", amount: 100, category: "Operations", method: "ACH" });
  expect("member transfer succeeds and debits balance (+rewards)", transfer.status === 201 && transfer.json.balance.amount === ((concurrentEnd - 10000) / 100).toFixed(2) && transfer.json.result.reward === 2.5);

  const overdraftTransfer = await api("POST", "/api/me/transfers", rae, { counterparty: "X", amount: 99_999_999 });
  expect("transfer beyond balance rejected", overdraftTransfer.status === 400);

  const reasonCatalogue = await api("GET", "/api/admin/members/status-reasons", admin);
  const suspensionReasons = reasonCatalogue.json?.reasons ?? [];
  expect("admin reason picker has 15 complete presets", reasonCatalogue.status === 200 && suspensionReasons.length === 15 &&
    suspensionReasons.every((r: any) => r.code && r.label && r.note && r.memberText));
  const memberReasonCatalogue = await api("GET", "/api/admin/members/status-reasons", rae);
  expect("members cannot read the admin-only reason catalogue (403)", memberReasonCatalogue.status === 403);

  const unknownReason = await api("POST", `/api/admin/members/${raeId}/status`, admin, { status: "restricted", reasonCode: "not-a-preset" });
  expect("unknown suspension reason code rejected (400)", unknownReason.status === 400);
  const shortCustomReason = await api("POST", `/api/admin/members/${raeId}/status`, admin, { status: "restricted", reasonCode: "other", reason: "tiny" });
  expect("short custom suspension reason rejected (400)", shortCustomReason.status === 400);

  const presetReason = suspensionReasons.find((r: any) => r.code === "suspicious_activity");
  const restrict = await api("POST", `/api/admin/members/${raeId}/status`, admin, { status: "restricted", reasonCode: presetReason.code });
  expect("account restriction stores the preset's member-facing sentence", restrict.status === 200 &&
    restrict.json.status === "restricted" && restrict.json.reason === presetReason.memberText && restrict.json.reasonCode === presetReason.code);
  const restrictedState = (await api("GET", "/api/me/state", rae)).json.account;
  expect("member state exposes the exact suspension reason and operator", restrictedState.statusReason === presetReason.memberText &&
    restrictedState.statusChangedBy === "Ops Admin" && typeof restrictedState.statusChangedAt === "number");
  const blockedTransfer = await api("POST", "/api/me/transfers", rae, { counterparty: "Y", amount: 5 });
  expect("restricted member's transfers blocked server-side (403)", blockedTransfer.status === 403);
  const depositStillWorks = await fund(rae, 25, "Incoming ACH", admin);
  expect("deposits still land while restricted", depositStillWorks.status === 201);
  const restore = await api("POST", `/api/admin/members/${raeId}/status`, admin, { status: "active" });
  const restoredState = (await api("GET", "/api/me/state", rae)).json.account;
  expect("restoring clears the member-facing suspension reason", restore.status === 200 && restore.json.status === "active" &&
    restoredState.accountStatus === "active" && !restoredState.statusReason);

  const customText = "We paused this account while we review a reported scam payment.";
  const customRestrict = await api("POST", `/api/admin/members/${raeId}/status`, admin, { status: "restricted", reasonCode: "other", reason: customText });
  const customState = (await api("GET", "/api/me/state", rae)).json.account;
  expect("Other stores the exact custom sentence for the member", customRestrict.status === 200 &&
    customRestrict.json.reason === customText && customState.statusReason === customText);
  const customRestore = await api("POST", `/api/admin/members/${raeId}/status`, admin, { status: "active" });
  expect("custom suspension can also be restored", customRestore.status === 200 &&
    !(await api("GET", "/api/me/state", rae)).json.account.statusReason);

  const restrictNoReason = await api("POST", `/api/admin/members/${raeId}/status`, admin, { status: "restricted" });
  expect("restriction without a reason rejected", restrictNoReason.status === 400);

  /* ---------- KYC workflow (request → submit → approve) ---------- */
  const kycRequest = await api("POST", "/api/admin/kyc/request", admin, { userId: alexId, requirements: ["identity", "address"], reason: "Annual compliance review" });
  expect("admin KYC request sets 'requested'", kycRequest.status === 200 && kycRequest.json.status === "requested");

  const alexNotifs = await api("GET", "/api/me/notifications", alex);
  expect("member notified of verification request", alexNotifs.json.notifications.some((n: any) => n.title === "Identity verification requested"));

  const kycSubmit = await api("POST", "/api/me/kyc/submit", alex, {
    legalName: "Alex Stone", dob: "1992-09-21", country: "United States", documentType: "Drivers License",
    source: "Salary income", taxId: "7710", documents: [{ key: "idFront", label: "License", name: "license.jpg" }],
  });
  expect("member submission enters review", kycSubmit.status === 201 && kycSubmit.json.status === "in_review");

  const queue = await api("GET", "/api/admin/kyc/queue", admin);
  expect("submission appears in admin queue with payload", queue.json.queue.some((q: any) => q.userId === alexId && q.submission.legalName === "Alex Stone"));

  const decisionNoNote = await api("POST", `/api/admin/kyc/${alexId}/decision`, admin, { decision: "needs_attention" });
  expect("changes-rejected without a note (400)", decisionNoNote.status === 400);

  const approve = await api("POST", `/api/admin/kyc/${alexId}/decision`, admin, { decision: "approved" });
  expect("approval verified member", approve.status === 200 && approve.json.status === "approved");
  expect("approval emails the applicant", recentMail.some(m => m.tag === "kyc-approved" && m.html.includes("#/app")));
  const afterApprove = await api("GET", "/api/me/kyc", alex);
  expect("member sees approved status (100%)", afterApprove.json.kyc.status === "approved" && afterApprove.json.kyc.completeness === 100);

  const reRequest = await api("POST", "/api/admin/kyc/request", admin, { userId: alexId });
  expect("re-requesting an approved member rejected (409)", reRequest.status === 409);

  /* ---------- risk & fraud workflow ---------- */
  const memberDispute = await api("POST", "/api/me/disputes", alex, { reason: "Duplicate charge", merchant: "City Electric", amount: 96.12 });
  expect("member can open a dispute", memberDispute.status === 201);
  const disputeId = memberDispute.json.dispute.id;

  // The app files disputes against a specific ledger row; the server enforces
  // one open case per transaction (retries and second tabs included).
  const raeOutflow = (await api("GET", "/api/me/state", rae)).json.account.transactions.find((t: any) => t.amount < 0);
  const linkedDispute = await api("POST", "/api/me/disputes", rae, { transactionId: raeOutflow.id, reason: "Unauthorized charge", detail: "Card was in my possession." });
  expect("member can dispute a specific transaction", linkedDispute.status === 201);
  const duplicateDispute = await api("POST", "/api/me/disputes", rae, { transactionId: raeOutflow.id, reason: "Unauthorized charge", detail: "" });
  expect("second filing for the same transaction rejected (409)", duplicateDispute.status === 409);

  const disputes = await api("GET", "/api/admin/risk/disputes", admin);
  expect("risk queue lists the filed dispute", disputes.status === 200 && disputes.json.disputes.length >= 1 &&
    disputes.json.disputes.some((d: any) => d.id === disputeId && d.status === "submitted"));

  const advance1 = await api("POST", `/api/admin/risk/disputes/${disputeId}/advance`, admin);
  expect("dispute advances to reviewing", advance1.status === 200 && advance1.json.status === "reviewing");
  const alexBalanceBefore = (await api("GET", "/api/me/account", alex)).json.balance.cents as number;
  const advance2 = await api("POST", `/api/admin/risk/disputes/${disputeId}/advance`, admin);
  expect("dispute resolution credits the member", advance2.status === 200 && advance2.json.status === "resolved" &&
    (await api("GET", "/api/me/account", alex)).json.balance.cents === alexBalanceBefore + 9612);

  /* ---------- staff management & privilege escalation ---------- */
  const promote = await api("POST", `/api/admin/staff/${alexId}/role`, admin, { role: "compliance" });
  expect("member promoted to compliance", promote.status === 200 && promote.json.role === "compliance");
  const demote = await api("POST", `/api/admin/staff/${alexId}/role`, admin, { role: "user" });
  expect("staff access revoked", demote.status === 200);

  const selfChange = await api("POST", `/api/admin/staff/${adminId}/role`, admin, { role: "user" });
  expect("self role change rejected (escalation guard)", selfChange.status === 400);

  /* ---------- role matrix (server-enforced) ---------- */
  const rolesBefore = await api("GET", "/api/admin/roles", admin);
  expect("roles endpoint lists matrix", rolesBefore.status === 200 && rolesBefore.json.roles.length === 4);

  await api("PUT", "/api/admin/roles", admin, { role: "support", permissions: ["dashboard.view"] });
  const supportAfterChange = await api("GET", "/api/admin/members", support);
  expect("revoking a permission takes effect immediately (403)", supportAfterChange.status === 403);

  await api("POST", "/api/admin/roles/reset", admin, { role: "support" });
  const supportAfterReset = await api("GET", "/api/admin/members", support);
  expect("role reset restores grants", supportAfterReset.status === 200);

  const complianceRolesEdit = await api("PUT", "/api/admin/roles", compliance, { role: "admin", permissions: [] });
  expect("compliance cannot edit the role matrix (403)", complianceRolesEdit.status === 403);

  /* ---------- broadcasts & notifications ---------- */
  const broadcast = await api("POST", "/api/admin/broadcasts", admin, { title: "Maintenance window", detail: "Sunday 02:00–04:00 UTC.", audience: "all" });
  expect("broadcast delivered to members", broadcast.status === 200 && broadcast.json.delivered >= 2);
  const raeNotifsAfter = await api("GET", "/api/me/notifications", rae);
  expect("broadcast visible in member notifications", raeNotifsAfter.json.notifications.some((n: any) => n.title === "Maintenance window"));

  /* ---------- settings & emergency halt ---------- */
  const settingsSave = await api("PUT", "/api/admin/settings", admin, { coreApy: 4.5 });
  expect("settings saved", settingsSave.status === 200 && settingsSave.json.settings.core_apy === "4.50");

  const halt = await api("PUT", "/api/admin/settings", admin, { paymentRails: "halted" });
  expect("emergency halt engaged", halt.status === 200);
  const haltedTransfer = await api("POST", "/api/me/transfers", rae, { counterparty: "Z", amount: 10 });
  expect("transfers blocked while rails halted (503)", haltedTransfer.status === 503);
  const resume = await api("PUT", "/api/admin/settings", admin, { paymentRails: "operational" });
  expect("rails resumed", resume.status === 200);

  /* ---------- reports & exports ---------- */
  for (const kind of ["customers", "accounts", "transactions", "kyc"]) {
    const report = await api("GET", `/api/admin/reports/${kind}.csv`, admin);
    expect(`report export: ${kind}`, report.status === 200 && report.text.includes(",") && (report.headers.get("content-type") ?? "").includes("text/csv"));
  }
  // The exports mirror the console tables column for column: a column the
  // console shows but the file omits is a gap, so both are asserted here.
  const accountsCsv = await api("GET", "/api/admin/reports/accounts.csv", admin);
  const accountsHeader = accountsCsv.text.split("\n")[0];
  const accountColumns = ["Member", "Type", "Balance", "Pending", "Cards", "Frozen cards",
    "Transactions", "Pending transactions", "KYC", "Status", "Last activity"];
  expect("accounts export carries every Accounts-console column",
    accountColumns.every(c => accountsHeader.includes(c)));
  const consoleAccounts = ((await api("GET", "/api/admin/state", admin)).json as any).accounts as any[];
  const raeConsole = consoleAccounts.find(a => a.email === "rae@member.test");
  // Read the file by column NAME, not position: the export grows columns as the
  // console does, and a positional test would break every time it does.
  const headerColumns = accountsHeader.split(",").map(h => h.replace(/^"|"$/g, ""));
  const valueFor = (row: string[], column: string) => {
    const i = headerColumns.indexOf(column);
    return i === -1 ? undefined : row[i];
  };
  const raeRow = csvRowFor(accountsCsv.text, "rae@member.test") ?? [];
  expect("accounts export matches the console's own counts for a member",
    raeRow.length > 14 && raeConsole !== undefined &&
    valueFor(raeRow, "Cards") === String(raeConsole.cards) &&
    valueFor(raeRow, "Frozen cards") === String(raeConsole.frozenCards) &&
    valueFor(raeRow, "Transactions") === String(raeConsole.txnCount) &&
    valueFor(raeRow, "Pending transactions") === String(raeConsole.pendingTxns) &&
    valueFor(raeRow, "KYC") === raeConsole.kycStatus &&
    valueFor(raeRow, "Status") === raeConsole.accountStatus,
    `csv=${JSON.stringify(raeRow)} console=${JSON.stringify(raeConsole)}`);
  expect("accounts export reports real activity, not placeholders",
    raeConsole !== undefined && raeConsole.txnCount > 0 && Number(valueFor(raeRow, "Transactions")) === raeConsole.txnCount);
  expect("accounts export carries the member's application (identity columns filled)",
    valueFor(raeRow, "Date of birth") === raeConsole.dob && valueFor(raeRow, "SSN") === raeConsole.ssn &&
    valueFor(raeRow, "ID document") === raeConsole.idType);

  const kycCsv = await api("GET", "/api/admin/reports/kyc.csv", admin);
  const kycHeader = kycCsv.text.split("\n")[0];
  const kycColumns = ["KYC status", "Completeness", "Submitted", "Legal name", "Document", "Files",
    "Source of funds", "Requested at", "Updated"];
  expect("kyc export carries every KYC-console column",
    kycColumns.every(c => kycHeader.includes(c)));
  // 0 User ID, 1 Member, 2 Email, 3 Type, 4 KYC status, 5 Completeness,
  // 6 Submitted, 7 Legal name, 8 Document, 9 Files, 10 Source of funds, 11 Requested at, 12 Updated.
  const alexKycRow = csvRowFor(kycCsv.text, "alex@member.test") ?? [];
  // The case has been decided by now, so its row is no longer in the review
  // queue — the console's Accounts view is where its KYC standing shows.
  const alexConsoleKyc = consoleAccounts.find(a => a.email === "alex@member.test")?.kycStatus;
  expect("kyc export carries the reviewed case's submission details",
    alexKycRow[7] === "Alex Stone" && alexKycRow[8] === "Drivers License" &&
    alexKycRow[9] === "1" && alexKycRow[10] === "Salary income",
    `row=${JSON.stringify(alexKycRow)}`);
  expect("kyc export status matches the console's KYC column",
    alexKycRow[4] === alexConsoleKyc && alexKycRow[5] === "100%" && alexKycRow[6] !== "—",
    `csv=${JSON.stringify(alexKycRow.slice(4, 7))} console=${alexConsoleKyc}`);
  const auditCsv = await api("GET", "/api/admin/audit/export.csv", admin);
  expect("report export: audit (CSV)", auditCsv.status === 200 && auditCsv.text.includes(",") && (auditCsv.headers.get("content-type") ?? "").includes("text/csv"));
  const exportNoPerm = await api("GET", "/api/admin/reports/customers.csv", support);
  expect("support cannot export reports (403)", exportNoPerm.status === 403);
  // `transactions.export` is the Transactions console's own permission: it
  // opens the ledger file only — the directory, balances and KYC files stay
  // behind reports.view.
  await api("PUT", "/api/admin/roles", admin, { role: "support", permissions: ["dashboard.view", "transactions.export"] });
  const ledgerByTxnExport = await api("GET", "/api/admin/reports/transactions.csv", support);
  const directoryByTxnExport = await api("GET", "/api/admin/reports/customers.csv", support);
  expect("transactions.export opens the ledger export (200)", ledgerByTxnExport.status === 200 && ledgerByTxnExport.text.includes(","));
  expect("transactions.export does not open the other reports (403)", directoryByTxnExport.status === 403);
  await api("POST", "/api/admin/roles/reset", admin, { role: "support" });

  /* ---------- audit trail ---------- */
  const auditList = await api("GET", "/api/admin/audit?category=Financial", admin);
  expect("audit trail lists financial actions", auditList.status === 200 && auditList.json.entries.length >= 3);

  const auditSearch = await api("GET", "/api/admin/audit?q=overdraw", admin);
  expect("audit search works", auditSearch.status === 200);

  const supportAudit = await api("GET", "/api/admin/audit", support);
  expect("support cannot read audit logs (403)", supportAudit.status === 403);

  let triggerFired = false;
  try { db.exec("UPDATE audit_log SET summary = 'tampered'"); } catch { triggerFired = true; }
  expect("audit_log UPDATE blocked by DB trigger", triggerFired);
  triggerFired = false;
  try { db.exec("DELETE FROM audit_log"); } catch { triggerFired = true; }
  expect("audit_log DELETE blocked by DB trigger", triggerFired);

  /* ---------- data integrity ---------- */
  const txnsAfter = db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number };
  // Exactly the 11 applied operations so far (rae: 2 deposits + 1 credit + 1
  // debit + 5 concurrent credits + 1 transfer; alex: 1 dispute credit) —
  // every applied op wrote a row and every rejected op wrote none.
  expect("every financial op wrote a ledger row (and rejected ops wrote none)", txnsAfter.n === 11);
  const orphanTxns = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE user_id NOT IN (SELECT id FROM users)").get() as { n: number };
  const orphanAccounts = db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE user_id NOT IN (SELECT id FROM users)").get() as { n: number };
  expect("no orphaned ledger rows or accounts (FK integrity)", orphanTxns.n === 0 && orphanAccounts.n === 0);

  /* ---------- logout revokes the session ---------- */
  const logout = await api("POST", "/api/auth/logout", support);
  expect("logout succeeds", logout.status === 200);
  const afterLogout = await api("GET", "/api/auth/me", support);
  expect("revoked token no longer authenticates (401)", afterLogout.status === 401);

  /* ---------- registration ---------- */
  const juneReg = await register("June Okafor", "june@okafor.design", "supersafe123", { accountType: "business", business: "Okafor Design" });
  expect("registration creates a member + account + token", juneReg.status === 201 && juneReg.json.token);
  const dupe = await register("X", "june@okafor.design", "supersafe123");
  expect("duplicate email rejected (409)", dupe.status === 409);

  /* ---------- member lifecycle: empty start → real activity ---------- */
  const juneToken = juneReg.json.token;
  const juneId = juneReg.json.user.id;
  const adaId = adaReg.json.user.id;
  const juneState = await api("GET", "/api/me/state", juneToken);
  const js = juneState.json.account;
  expect("new member starts EMPTY (production behavior)", juneState.status === 200 &&
    js.balance === 0 && js.pendingBalance === 0 && js.cards.length === 0 && js.transactions.length === 0 &&
    js.invoices.length === 0 && js.team.length === 1 && js.team[0].role === "Owner" &&
    js.savingsPockets.length === 0 && js.payees.length === 0 && js.scheduledPayments.length === 0 &&
    js.perks.length === 0 && js.disputes.length === 0 &&
    js.notifications.length === 1 && js.notifications[0].title === "Application received — we're reviewing it" &&
    js.bankDetails.accountNumber.length === 12 && js.kyc.status === "in_review" && js.kyc.completeness === 100 &&
    js.accountStatus === "active");
  const heldMove = await api("POST", "/api/me/deposits", juneToken, { amount: 10, source: "Too early" });
  expect("money is blocked while the application is in review (403 review_pending)",
    heldMove.status === 403 && heldMove.json.code === "review_pending");
  const juneApproval = await decideFor(juneId);
  expect("reviewer approves the application", juneApproval.status === 200);
  await api("PUT", "/api/me/preferences", juneToken, { key: "scoutAuto", value: false }); // deterministic balances
  await fund(juneToken, 1200, "Payroll", admin);
  const juneCard = await api("POST", "/api/me/cards", juneToken, { label: "Everyday", type: "virtual", limit: 500, cardholder: "June Okafor" });
  await api("POST", "/api/me/transfers", juneToken, { counterparty: "Acme Supplies", amount: 180, category: "Operations", method: "Card", cardId: juneCard.json.card.id });
  const juneAfter = (await api("GET", "/api/me/state", juneToken)).json.account;
  expect("member builds real history through the API", juneAfter.balance === 1200 - 180 &&
    juneAfter.transactions.length === 2 && juneAfter.cards.length === 1 &&
    juneAfter.cards[0].spent === 180 && juneAfter.team[0].name === "June Okafor");

  // Cards: issue → patch → controls → freeze-all → replace → shipping → delete
  const newCard = await api("POST", "/api/me/cards", rae, { label: "Test card", type: "virtual", limit: 800, cardholder: "Rae Kim" });
  expect("card issued with generated numbers", newCard.status === 201 && newCard.json.card.last4.length === 4 && newCard.json.card.fullNumber.startsWith("9"));
  const cardId = newCard.json.card.id;
  const cardPatch = await api("PATCH", `/api/me/cards/${cardId}`, rae, { frozen: true, limit: 1500, pin: "9876", controls: { international: true } });
  expect("card patch updates fields", cardPatch.status === 200 &&
    (await api("GET", "/api/me/state", rae)).json.account.cards.some((c: any) => c.id === cardId && c.frozen === true && c.limit === 1500 && c.pin === "9876" && c.controls.international === true));
  const badPin = await api("PATCH", `/api/me/cards/${cardId}`, rae, { pin: "12" });
  expect("invalid PIN rejected (400)", badPin.status === 400);
  const foreignCard = await api("PATCH", `/api/me/cards/${cardId}`, alex, { frozen: false });
  expect("cannot patch another member's card (404)", foreignCard.status === 404);
  const freezeAll = await api("POST", "/api/me/cards/freeze-all", rae);
  expect("freeze-all freezes every card", freezeAll.status === 200 &&
    (await api("GET", "/api/me/state", rae)).json.account.cards.every((c: any) => c.frozen === true));
  const replaced = await api("POST", `/api/me/cards/${cardId}/replace`, rae, { reason: "Compromised" });
  expect("card replacement issues a new card + freezes old", replaced.status === 201 &&
    (await api("GET", "/api/me/state", rae)).json.account.cards.some((c: any) => c.id === replaced.json.card.id && c.label === "Test card replacement"));
  const physical = await api("POST", "/api/me/cards", rae, { label: "Ship me", type: "physical", limit: 2000 });
  const ship = await api("POST", `/api/me/cards/${physical.json.card.id}/shipping/advance`, rae);
  expect("shipping advances processing → printing", ship.status === 200 && ship.json.status === "printing");
  const deleted = await api("DELETE", `/api/me/cards/${physical.json.card.id}`, rae);
  expect("card deleted", deleted.status === 200);

  // Invoices: create → remind → mark paid credits balance
  const inv = await api("POST", "/api/me/invoices", rae, { client: "Test Client", clientEmail: "t@c.example", amount: 500, dueDays: 14, description: "Integration test" });
  expect("invoice created with next sequential id", inv.status === 201 && Number(inv.json.invoice.id) > 1047);
  const remind = await api("POST", `/api/me/invoices/${inv.json.invoice.id}/remind`, rae);
  expect("invoice reminder recorded", remind.status === 200);
  const balanceBeforeInv = (await api("GET", "/api/me/state", rae)).json.account.balance;
  const markPaid = await api("POST", `/api/me/invoices/${inv.json.invoice.id}/paid`, rae);
  expect("invoice payment credits balance", markPaid.status === 200 &&
    (await api("GET", "/api/me/state", rae)).json.account.balance === balanceBeforeInv + 500);
  const paidAgain = await api("POST", `/api/me/invoices/${inv.json.invoice.id}/paid`, rae);
  expect("double payment rejected (409)", paidAgain.status === 409);

  // Savings pockets: create → fund → withdraw → delete refunds
  const pocket = await api("POST", "/api/me/pockets", rae, { name: "Integration fund", target: 1000, color: "#7558dc", icon: "general" });
  const pocketId = pocket.json.pocket.id;
  const balPrePocket = (await api("GET", "/api/me/state", rae)).json.account.balance;
  await api("POST", `/api/me/pockets/${pocketId}/move`, rae, { amount: 300, direction: "to_pocket" });
  let state = (await api("GET", "/api/me/state", rae)).json.account;
  expect("pocket funding moves money out of checking", state.balance === balPrePocket - 300 &&
    state.savingsPockets.find((p: any) => p.id === pocketId).balance === 300);
  const overPocket = await api("POST", `/api/me/pockets/${pocketId}/move`, rae, { amount: 99999, direction: "to_pocket" });
  expect("pocket funding beyond balance rejected", overPocket.status === 400);
  await api("POST", `/api/me/pockets/${pocketId}/move`, rae, { amount: 100, direction: "to_checking" });
  await api("DELETE", `/api/me/pockets/${pocketId}`, rae);
  state = (await api("GET", "/api/me/state", rae)).json.account;
  expect("pocket withdrawal + delete refunds remainder", state.balance === balPrePocket && !state.savingsPockets.some((p: any) => p.id === pocketId));

  // Payees & scheduled payments: add → schedule → pay debits
  const payee = await api("POST", "/api/me/payees", rae, { name: "Integration Vendor", bankName: "Civic Bank", routingNumber: "071000288", accountLast4: "9090", accountType: "Checking" });
  expect("payee added", payee.status === 201);
  const badPayee = await api("POST", "/api/me/payees", rae, { name: "Bad", bankName: "X", routingNumber: "123", accountLast4: "12" });
  expect("payee validation enforced (400)", badPayee.status === 400);
  const sched = await api("POST", "/api/me/scheduled", rae, { payeeId: payee.json.payee.id, payeeName: "Integration Vendor", amount: 250, category: "Operations", frequency: "monthly", nextDate: Date.now() + 86_400_000, autopay: true, memo: "Integration" });
  expect("scheduled payment created", sched.status === 201);
  const balPreSched = (await api("GET", "/api/me/state", rae)).json.account.balance;
  const payNow = await api("POST", `/api/me/scheduled/${sched.json.payment.id}/pay`, rae);
  expect("pay-now debits and advances next date", payNow.status === 200 &&
    (await api("GET", "/api/me/state", rae)).json.account.balance === balPreSched - 250);
  // The response carries the id of the ledger row the server just wrote, so a
  // dispute filed before the snapshot refreshes still links to that row.
  const paidTxnId = payNow.json.transaction?.id as string | undefined;
  expect("pay-now returns the ledger row id", typeof paidTxnId === "string" && paidTxnId.startsWith("txn"));
  const disputePaidTxn = await api("POST", "/api/me/disputes", rae, { transactionId: paidTxnId, reason: "Duplicate charge", detail: "Filed immediately after paying." });
  expect("a dispute filed with that id links to the row (201)", disputePaidTxn.status === 201);
  const paused = await api("PATCH", `/api/me/scheduled/${sched.json.payment.id}`, rae);
  expect("scheduled payment pause/resume toggle", paused.status === 200 && paused.json.status === "paused");
  const resumed = await api("PATCH", `/api/me/scheduled/${sched.json.payment.id}`, rae, { status: "active" });
  expect("explicit status wins over the toggle (app contract)", resumed.status === 200 && resumed.json.status === "active");
  const badStatus = await api("PATCH", `/api/me/scheduled/${sched.json.payment.id}`, rae, { status: "cancelled" });
  expect("unknown scheduled status rejected (400)", badStatus.status === 400);
  const foreignSched = await api("PATCH", `/api/me/scheduled/${sched.json.payment.id}`, alex, { status: "paused" });
  expect("cannot pause another member's payment (404)", foreignSched.status === 404);

  // Rewards redemption
  const rewardsPre = (await api("GET", "/api/me/state", rae)).json.account;
  const redeem = await api("POST", "/api/me/rewards/redeem", rae);
  state = (await api("GET", "/api/me/state", rae)).json.account;
  expect("rewards redeem 1:1 into checking", redeem.status === 200 && Math.abs(state.balance - (rewardsPre.balance + rewardsPre.rewards)) < 0.001 && state.rewards === 0);

  // Scout cannot mint money from a browser-supplied estimate
  const scoutBefore = (await api("GET", "/api/me/state", rae)).json.account;
  const scout1 = await api("POST", "/api/me/scout/apply", rae, { opportunityId: "opp-test-1", merchant: "Fable Cloud", amount: 42.5, note: "Annual plan" });
  const scout2 = await api("POST", "/api/me/scout/apply", rae, { opportunityId: "opp-test-1", merchant: "Fable Cloud", amount: 42.5, note: "Annual plan" });
  expect("Scout estimate credits are disabled", scout1.status === 410 && scout2.status === 410 && scout1.json.code === "scout_credit_disabled");
  const scoutAfter = (await api("GET", "/api/me/state", rae)).json.account;
  expect("rejected Scout credits leave balance and ledger unchanged", scoutAfter.balance === scoutBefore.balance && scoutAfter.scoutSaved === scoutBefore.scoutSaved && scoutAfter.transactions.length === scoutBefore.transactions.length);

  // Preferences + profile + KYC patch
  const pref = await api("PUT", "/api/me/preferences", rae, { key: "weeklyDigest", value: true });
  expect("preference updated", pref.status === 200 &&
    (await api("GET", "/api/me/state", rae)).json.account.preferences.weeklyDigest === true);

  // Member cash plans: durable limits are part of the account snapshot.
  const budget = await api("POST", "/api/me/budgets", rae, { name: "Monthly software", category: "Software", monthlyLimit: 800, alertPercent: 75 });
  const budgetId = budget.json.budget?.id;
  expect("member can create a live spending plan", budget.status === 201 && budget.json.budget.monthlyLimit === 800 &&
    (await api("GET", "/api/me/state", rae)).json.account.budgets.some((item: any) => item.id === budgetId && item.alertPercent === 75));
  const invalidBudget = await api("POST", "/api/me/budgets", rae, { name: "", category: "Software", monthlyLimit: 0, alertPercent: 20 });
  expect("budget validation rejects invalid limits", invalidBudget.status === 400);
  const deletedBudget = await api("DELETE", `/api/me/budgets/${budgetId}`, rae);
  expect("member can remove a spending plan", deletedBudget.status === 200 &&
    !(await api("GET", "/api/me/state", rae)).json.account.budgets.some((item: any) => item.id === budgetId));

  const profile = await api("PATCH", "/api/me/profile", rae, { name: "Rae Kim", phone: "+1 (555) 000-0001" });
  expect("profile patch persists", profile.status === 200 && profile.json.user.phone === "+1 (555) 000-0001");
  const kycPatch = await api("PATCH", "/api/me/kyc", rae, { nextStep: "Final review", completeness: 95 });
  expect("kyc wizard progress saved", kycPatch.status === 200);

  // Team invite + owner protection
  const invite = await api("POST", "/api/me/team", rae, { name: "Ada Lovelace", email: "ada@raeandco.com", role: "Admin", monthlyLimit: 3000 });
  expect("team invite recorded as invited", invite.status === 201 && invite.json.member.status === "invited");
  const ownerRow = (await api("GET", "/api/me/state", rae)).json.account.team.find((m: any) => m.role === "Owner");
  const ownerRemove = await api("DELETE", `/api/me/team/${ownerRow.id}`, rae);
  expect("account owner cannot be removed (400)", ownerRemove.status === 400);

  /* ---------- team access: invite → accept → role-scoped shared access ---------- */
  const tokenFromMail = (to: string) => {
    const mail = [...recentMail].reverse().find(m => m.to === to && m.tag === "team-invite");
    return mail?.text.match(/token=([a-f0-9]+)/i)?.[1] ?? "";
  };
  const adaToken = tokenFromMail("ada@raeandco.com");
  expect("team: invite email carries an accept link", adaToken.length >= 32);
  expect("team: raw invite token is never stored",
    !(db.prepare("SELECT 1 FROM team_members WHERE invite_token_hash = ?").get(adaToken)));
  const dupInvite = await api("POST", "/api/me/team", rae, { name: "Ada Again", email: "ADA@raeandco.com", role: "Member", monthlyLimit: 0 });
  expect("team: duplicate pending invite refused (409)", dupInvite.status === 409);
  const lookup = await api("GET", `/api/invites/${adaToken}`);
  expect("team: invite lookup shows business, role and inviter",
    lookup.status === 200 && lookup.json.invite.role === "Admin" && lookup.json.invite.email === "ada@raeandco.com" && !!lookup.json.invite.business);
  expect("team: unknown invite token 404", (await api("GET", `/api/invites/${"0".repeat(64)}`)).status === 404);
  expect("team: short password refused (400)", (await api("POST", `/api/invites/${adaToken}/accept`, undefined, { name: "Ada", password: "short" })).status === 400);
  const accepted = await api("POST", `/api/invites/${adaToken}/accept`, undefined, { name: "Ada Lovelace", password: "analytical-engine" });
  expect("team: accepting creates a login and signs in",
    accepted.status === 201 && !!accepted.json.token && accepted.json.user.teamRole === "Admin" && accepted.json.user.accountType === "business");
  expect("team: an invite link works only once", (await api("POST", `/api/invites/${adaToken}/accept`, undefined, { name: "X", password: "another-pass-1" })).status === 404);
  const ada = accepted.json.token as string;
  const raeState = (await api("GET", "/api/me/state", rae)).json;
  const adaState = await api("GET", "/api/me/state", ada);
  expect("team: teammate sees the owner's business account",
    adaState.status === 200 && adaState.json.account.balance === raeState.account.balance &&
    adaState.json.account.team.some((m: any) => m.email === "ada@raeandco.com" && m.status === "active"));
  const adaLogin = await api("POST", "/api/auth/login", undefined, { email: "ada@raeandco.com", password: "analytical-engine" });
  expect("team: teammate signs in with their own password", adaLogin.status === 200 && adaLogin.json.user.teamRole === "Admin");
  expect("team: /auth/me returns the teammate, not the owner", (await api("GET", "/api/auth/me", ada)).json.user.email === "ada@raeandco.com");
  expect("team: teammates can't touch the owner's ID application (403)", (await api("PATCH", "/api/me/kyc", ada, { nextStep: "x", completeness: 1 })).status === 403);
  expect("team: teammates can't edit the owner's profile (403)", (await api("PATCH", "/api/me/profile", ada, { name: "Hijack" })).status === 403);
  expect("team: teammates can't register passkeys on the owner (403)", (await api("POST", "/api/me/passkeys/challenge", ada, {})).status === 403);
  const adaPw = await api("POST", "/api/auth/change-password", ada, { current: "analytical-engine", next: "difference-engine" });
  expect("team: password change applies to the teammate only",
    adaPw.status === 200 && (await api("POST", "/api/auth/login", undefined, { email: "ada@raeandco.com", password: "difference-engine" })).status === 200);
  // Admin can invite a Bookkeeper; Bookkeeper is read-only.
  const bkInvite = await api("POST", "/api/me/team", ada, { name: "Bo Keeper", email: "bo@raeandco.com", role: "Bookkeeper", monthlyLimit: 0 });
  expect("team: an Admin teammate can invite", bkInvite.status === 201);
  const bo = (await api("POST", `/api/invites/${tokenFromMail("bo@raeandco.com")}/accept`, undefined, { name: "Bo Keeper", password: "ledger-pass-1" })).json.token as string;
  expect("team: Bookkeeper can read the account", (await api("GET", "/api/me/state", bo)).status === 200);
  expect("team: Bookkeeper can't move money (403)",
    (await api("POST", "/api/me/transfers", bo, { amount: 1, counterparty: "X", kind: "ach" })).status === 403);
  expect("team: Bookkeeper can't invite (403)",
    (await api("POST", "/api/me/team", bo, { name: "Z", email: "z@raeandco.com", role: "Member", monthlyLimit: 0 })).status === 403);
  expect("team: Bookkeeper can still contact support", (await api("POST", "/api/me/support", bo, { subject: "Statement question", message: "Where is the March statement?" })).status === 201);
  const boRow = (await api("GET", "/api/me/state", rae)).json.account.team.find((m: any) => m.email === "bo@raeandco.com");
  expect("team: owner removes a teammate", (await api("DELETE", `/api/me/team/${boRow.id}`, rae)).status === 200);
  expect("team: removed teammate is signed out immediately (401)", (await api("GET", "/api/me/state", bo)).status === 401);
  expect("team: removed teammate can't sign back in to the business",
    (await (async () => { const l = await api("POST", "/api/auth/login", undefined, { email: "bo@raeandco.com", password: "ledger-pass-1" });
      return l.status !== 200 || (await api("GET", "/api/me/state", l.json.token)).status === 401; })()));
  expect("team: teammate logins aren't listed as separate customers",
    !(await api("GET", "/api/admin/state", admin)).json.accounts?.some((a: any) => a.email === "ada@raeandco.com"));

  // Members can open disputes but never resolve their own (compliance resolves)
  const memberAdvance = await api("POST", `/api/me/disputes/${disputeId}/advance`, alex);
  expect("member self-resolution blocked (404 — no such route)", memberAdvance.status === 404);

  /* ---------- card controls are enforced when the card spends ---------- */

  await fund(juneToken, 900, "Card control funding", admin);
  const controlled = await api("POST", "/api/me/cards", juneToken, { label: "Controls", limit: 300, type: "virtual" });
  const controlId = controlled.json.card.id;
  const spendWithCard = (body: Record<string, unknown>) =>
    api("POST", "/api/me/transfers", juneToken, { counterparty: "Northstar Ads", amount: 10, category: "Software", method: "Card", cardId: controlId, ...body });
  const cardSpent = async () =>
    (await api("GET", "/api/me/state", juneToken)).json.account.cards.find((c: any) => c.id === controlId).spent;

  await api("PATCH", `/api/me/cards/${controlId}`, juneToken, { frozen: true });
  const frozenSpend = await spendWithCard({});
  expect("frozen card declines spending (403)", frozenSpend.status === 403);
  await api("PATCH", `/api/me/cards/${controlId}`, juneToken, { frozen: false });

  await api("PATCH", `/api/me/cards/${controlId}`, juneToken, { controls: { online: false } });
  const onlineOff = await spendWithCard({});
  expect("online payments switched off decline spending (403)", onlineOff.status === 403);
  await api("PATCH", `/api/me/cards/${controlId}`, juneToken, { controls: { online: true } });

  await api("PATCH", `/api/me/cards/${controlId}`, juneToken, { merchantLock: "Northstar Ads" });
  const wrongMerchant = await spendWithCard({ counterparty: "Someone Else" });
  expect("merchant lock declines a different merchant (400)", wrongMerchant.status === 400);
  const rightMerchant = await spendWithCard({ counterparty: "northstar ads" });
  expect("merchant lock allows its own merchant (case-insensitive, 201)", rightMerchant.status === 201);
  expect("declines never touched the card's spend", await cardSpent() === 10);

  await api("PATCH", `/api/me/cards/${controlId}`, juneToken, { merchantLock: "", categoryLock: "Software" });
  const wrongCategory = await spendWithCard({ category: "Travel" });
  expect("category lock declines another category (400)", wrongCategory.status === 400);
  const rightCategory = await spendWithCard({ category: "Software" });
  expect("category lock allows its own category (201)", rightCategory.status === 201);

  await api("PATCH", `/api/me/cards/${controlId}`, juneToken, { categoryLock: "", singleTransactionLimit: 50 });
  const overPerTxn = await spendWithCard({ amount: 60 });
  expect("per-transaction limit enforced (400)", overPerTxn.status === 400 && /per-transaction/.test(overPerTxn.json.error));
  await api("PATCH", `/api/me/cards/${controlId}`, juneToken, { singleTransactionLimit: 1000 });
  const withinLimits = await spendWithCard({ amount: 100 });
  expect("spending within every limit succeeds (201)", withinLimits.status === 201);
  const overMonthly = await spendWithCard({ amount: 200 }); // 120 spent + 200 > 300 limit
  expect("monthly card limit enforced (400)", overMonthly.status === 400 && /monthly limit/.test(overMonthly.json.error));
  expect("rejected spend rolled back (spent unchanged at 120)", await cardSpent() === 120);

  /* ---------- body parsing errors are 4xx, never 500 ---------- */

  const malformedJson = await fetch(`${base}/api/me/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${juneToken}` },
    body: '{"name": ',
  });
  expect("malformed JSON body rejected with 400", malformedJson.status === 400);
  const oversized = await fetch(`${base}/api/me/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${juneToken}` },
    body: JSON.stringify({ name: "x".repeat(300_000) }),
  });
  expect("oversized body rejected with 413", oversized.status === 413);

  /* ---------- input hardening (malformed input is 400, never 500) ---------- */

  const hardenState = (await api("GET", "/api/me/state", juneToken)).json.account;
  const hardenCard = hardenState.cards[0];
  const malformed: Array<[string, string, string, unknown]> = [
    ["deposits", "POST", "/api/me/deposits", { amount: "abc", source: "x" }],
    ["deposits (object)", "POST", "/api/me/deposits", { amount: { evil: true }, source: "x" }],
    ["transfers", "POST", "/api/me/transfers", { counterparty: "x", amount: "abc" }],
    ["invoices", "POST", "/api/me/invoices", { client: "x", amount: "abc", dueDays: 1 }],
    ["cards", "POST", "/api/me/cards", { label: "x", limit: "abc", type: "virtual" }],
    ["card patch", "PATCH", `/api/me/cards/${hardenCard.id}`, { limit: "abc" }],
    ["pockets", "POST", "/api/me/pockets", { name: "x", target: "abc" }],
    ["scheduled", "POST", "/api/me/scheduled", { payeeName: "x", amount: "abc", nextDate: Date.now() + 86_400_000 }],
    ["team", "POST", "/api/me/team", { name: "x", email: "x@y.co", role: "Member", monthlyLimit: "abc" }],
    ["admin adjust", "POST", `/api/admin/members/${juneId}/adjust`, { direction: "credit", amount: "abc", memo: "x" }],
  ];
  let badInputAll400 = true;
  let badInputDetail = "";
  for (const [label, method, path, body] of malformed) {
    const token = label.startsWith("admin") ? admin : juneToken;
    const res = await api(method, path, token, body);
    if (res.status !== 400) { badInputAll400 = false; badInputDetail += `${label}→${res.status} `; }
  }
  expect("malformed amounts rejected with 400, never 500", badInputAll400, badInputDetail);
  expect("non-numeric strings are not silently parsed (\"12abc\")",
    (await api("POST", "/api/me/deposits", juneToken, { amount: "12abc", source: "x" })).status === 400);

  /* ---------- enums are validated, never guessed ---------- */

  const badDirection = await api("POST", `/api/admin/members/${juneId}/adjust`, admin, { direction: "debit-typo", amount: 5, memo: "x" });
  expect("unknown adjustment direction rejected (400 — no silent credit)", badDirection.status === 400);
  const badAccStatus = await api("POST", `/api/admin/members/${juneId}/status`, admin, { status: "restrictd", reason: "typo" });
  expect("unknown account status rejected (400 — no silent restore)", badAccStatus.status === 400);
  const badAudience = await api("POST", "/api/admin/broadcasts", admin, { title: "t", detail: "d", audience: "everyone" });
  expect("unknown broadcast audience rejected (400 — no platform-wide send)", badAudience.status === 400);
  const badFrequency = await api("POST", "/api/me/scheduled", juneToken, { payeeName: "x", amount: 1, nextDate: Date.now() + 86_400_000, frequency: "yearly" });
  expect("unknown payment frequency rejected (400)", badFrequency.status === 400);

  /* ---------- member routes act on member accounts only ---------- */

  const staffTargets: Array<[string, string, string, unknown]> = [
    ["view a staff account as a member record", "GET", `/api/admin/members/${adaId}`, undefined],
    ["credit a staff account", "POST", `/api/admin/members/${adaId}/adjust`, { direction: "credit", amount: 1, memo: "x" }],
    ["restrict the Super Admin's account", "POST", `/api/admin/members/${adminId}/status`, { status: "restricted", reason: "x" }],
  ];
  let staffScoped = true;
  let staffDetail = "";
  for (const [label, method, path, body] of staffTargets) {
    const res = await api(method, path, admin, body);
    if (res.status !== 404) { staffScoped = false; staffDetail += `${label}→${res.status} `; }
  }
  expect("staff accounts are not member surface (404, no enumeration)", staffScoped, staffDetail);
  expect("staff account left untouched", (db.prepare("SELECT status FROM users WHERE id = ?").get(adaId) as { status: string }).status === "active");

  /* ---------- foreign resources are 404, not a misleading 400 ---------- */

  const junePocket = (await api("POST", "/api/me/pockets", juneToken, { name: "Foreign probe", target: 10 })).json.pocket;
  const foreignPocket = await api("POST", `/api/me/pockets/${junePocket.id}/move`, alex, { amount: 1, direction: "to_checking" });
  expect("another member's pocket is 404 (move)", foreignPocket.status === 404);
  const foreignPocketDelete = await api("DELETE", `/api/me/pockets/${junePocket.id}`, alex);
  expect("another member's pocket is 404 (delete)", foreignPocketDelete.status === 404);
  const juneSchedule = (await api("POST", "/api/me/scheduled", juneToken, { payeeName: "Foreign probe", amount: 1, nextDate: Date.now() + 86_400_000 })).json.payment;
  const foreignSchedule = await api("POST", `/api/me/scheduled/${juneSchedule.id}/pay`, alex);
  expect("another member's scheduled payment is 404 (pay)", foreignSchedule.status === 404);
  expect("pocket still owned and intact after foreign attempts",
    (await api("GET", "/api/me/state", juneToken)).json.account.savingsPockets.some((p: any) => p.id === junePocket.id));

  /* ---------- registration validation ---------- */

  const emptyBusiness = await register("Empty Biz", "empty-biz@member.test", "member-pass-9", { accountType: "business", business: "   " });
  expect("blank business name rejected for business accounts (400)", emptyBusiness.status === 400);
  const wrongTypeBusiness = await register("Wrong Type", "wrong-type@member.test", "member-pass-9", { accountType: "business", business: 42 });
  expect("non-string business name rejected (400)", wrongTypeBusiness.status === 400);
  const personalNoBusiness = await register("Solo Person", "solo@member.test", "member-pass-9", { accountType: "personal" });
  expect("personal accounts need no business name (201)", personalNoBusiness.status === 201);
  const injectedRole = await register("Role Injector", "role-inject@member.test", "member-pass-9", { accountType: "business", business: "Inject Co", role: "superadmin", status: "active" });
  const injectedRow = db.prepare("SELECT role, status, plan FROM users WHERE email = ?").get("role-inject@member.test") as { role: string; status: string; plan: string };
  expect("registration ignores injected role/status/plan (member, active, Pro)", injectedRole.status === 201 &&
    injectedRole.json.user.role === "user" && injectedRow.role === "user" && injectedRow.status === "active" && injectedRow.plan === "Pro");

  /* ---------- the account application (identity data) ---------- */

  const noProfile = await api("POST", "/api/auth/register", undefined, { name: "No App", email: "no-app@member.test", password: "member-pass-9", accountType: "personal" });
  expect("registration without an application is rejected (422)",
    noProfile.status === 422 && noProfile.json.field === "firstName");

  const weakSsn = await register("Weak Ssn", "weak-ssn@member.test", "member-pass-9", {
    accountType: "personal", profile: { ...applicationFor("personal", "Weak Ssn"), ssn: "666-12-3456" },
  });
  expect("impossible SSN rejected with a field-level error (422)",
    weakSsn.status === 422 && weakSsn.json.field === "ssn" && /Social Security/.test(weakSsn.json.error));

  const child = await register("Too Young", "too-young@member.test", "member-pass-9", {
    accountType: "personal", profile: { ...applicationFor("personal", "Too Young"), dob: "2012-02-02" },
  });
  expect("applicants under 18 rejected (422)", child.status === 422 && child.json.field === "dob");

  const badEin = await register("Bad Ein Co", "bad-ein@member.test", "member-pass-9", {
    accountType: "business", business: "Bad Ein Co",
    profile: { ...applicationFor("business", "Bad Ein Co", "Bad Ein Co"), ein: "07-1234567" },
  });
  expect("invalid EIN rejected for business accounts (422)", badEin.status === 422 && badEin.json.field === "ein");

  const ownerTooSmall = await register("Small Owner Co", "small-owner@member.test", "member-pass-9", {
    accountType: "business", business: "Small Owner Co",
    profile: { ...applicationFor("business", "Small Owner Co", "Small Owner Co"), ownerOwnership: 10 },
  });
  expect("beneficial ownership below 25% rejected (422)", ownerTooSmall.status === 422 && ownerTooSmall.json.field === "ownerOwnership");

  const stored = db.prepare("SELECT first_name, last_name, dob, ssn, state, id_type, ein FROM identity_profiles WHERE user_id = ?").get(raeId) as
    { first_name: string; last_name: string; dob: string; ssn: string; state: string; id_type: string; ein: string };
  expect("the application is stored normalised (name, SSN and EIN shapes)",
    stored.first_name === "Rae" && stored.last_name === "Kim" && stored.ssn === "527-44-8213" && stored.ein === "83-1174265" && stored.state === "TX");

  const fresh = await register("Iris Fresh", "iris@member.test", "member-pass-9", { accountType: "personal" });
  const kycAfterSignup = db.prepare("SELECT status, completeness FROM kyc_records WHERE user_id = ?").get(fresh.json.user.id) as { status: string; completeness: number };
  expect("a completed application enters compliance review (in_review, 100%)",
    fresh.status === 201 && kycAfterSignup.status === "in_review" && kycAfterSignup.completeness === 100);

  const myProfile = await api("GET", "/api/me/profile", rae);
  expect("the member reads their own application back with the SSN masked",
    myProfile.status === 200 && myProfile.json.profile.ssn === "•••-••-8213" &&
    myProfile.json.profile.ein === "••-•••4265" && myProfile.json.profile.addressLine1 === "88 Harper Street" &&
    myProfile.json.profile.legalName === "Rae & Co Studio");

  const alexProfile = await api("GET", "/api/me/profile", alex);
  expect("personal applications carry no business section", alexProfile.status === 200 &&
    alexProfile.json.profile.legalName === undefined && alexProfile.json.profile.ein === undefined);

  const adminSees = await api("GET", `/api/admin/members/${raeId}`, admin);
  expect("staff see the full application, tax IDs unmasked",
    adminSees.status === 200 && adminSees.json.identity.ssn === "527-44-8213" &&
    adminSees.json.identity.ein === "83-1174265" && adminSees.json.identity.ownerSsn === "527-44-8213" &&
    adminSees.json.identity.idType === "Driver's license" && adminSees.json.member.email === "rae@member.test");

  // A fresh applicant of its own: rae was cleared above so the money routes could
  // run, and these two checks are specifically about an application that is still
  // waiting for a decision.
  const pending = await register("Mira Cole", "mira@member.test", "member-pass-9", { accountType: "business", business: "Cole Studio" });
  const pendingId = pending.json.user.id;

  const dir = await api("GET", "/api/admin/members", admin);
  const dirRow = dir.json.members.find((m: any) => m.id === pendingId);
  expect("the customer directory exposes date of birth and tax ID to staff",
    dir.status === 200 && dirRow?.dob === "1990-05-12" && dirRow?.ssn === "527-44-8213" && dirRow?.kycStatus === "in_review");

  const queued = await api("GET", "/api/admin/kyc/queue", admin);
  const queuedPending = queued.json.queue.find((q: any) => q.userId === pendingId);
  expect("the signup application lands in the KYC review queue with its details",
    queued.status === 200 && queuedPending?.submission?.legalName === "Mira Cole" &&
    queuedPending?.submission?.taxId === "527-44-8213" && queuedPending?.submission?.application?.businessType === "Multi-member LLC");

  // Registration budget: only applications that pass validation spend it, and a
  // run of scripted sign-ups from one connection is what it exists to stop.
  resetRateLimits();
  const flood = [];
  for (let i = 0; i < 21; i += 1) {
    const r = await register(`Flood ${String.fromCharCode(65 + i)}a`, `flood-${i}@member.test`, "member-pass-9", { accountType: "personal" });
    flood.push(r.status);
  }
  expect("scripted sign-up runs are throttled (429 after the budget)",
    flood.slice(0, 20).every(s => s === 201) && flood[20] === 429);
  const afterThrottle = await api("POST", "/api/auth/login", undefined, { email: "flood-0@member.test", password: "member-pass-9" });
  expect("an account created inside the budget still works", afterThrottle.status === 200);
  resetRateLimits(); // the suites below keep registering fixtures

  // Change password + production token-based password reset
  resetRateLimits(); // this suite performs many logins — reset the limiter
  const juneParallelLogin = await api("POST", "/api/auth/login", undefined, { email: "june@okafor.design", password: "supersafe123" }, "device-june-second-browser-0001");
  const changePw = await api("POST", "/api/auth/change-password", juneToken, { current: "supersafe123", next: "even safer 99" });
  expect("changing password keeps this session, revokes other sessions and accepts the new password",
    changePw.status === 200 && changePw.json.signedOutOtherSessions === true &&
    (await api("GET", "/api/auth/me", juneToken)).status === 200 &&
    (await api("GET", "/api/auth/me", juneParallelLogin.json.token)).status === 401 &&
    (await api("POST", "/api/auth/login", undefined, { email: "june@okafor.design", password: "even safer 99" })).status === 200);
  const forgotUnknown = await api("POST", "/api/auth/forgot-password", undefined, { email: "nobody@nowhere.example" });
  expect("forgot-password never reveals account existence", forgotUnknown.status === 200 && forgotUnknown.json.ok === true &&
    !forgotUnknown.json.token && !forgotUnknown.json.tempPassword);
  const devReset = await api("POST", "/api/auth/forgot-password", undefined, { email: "june@okafor.design" });
  // Development hands the code back so the reset screen works without a mail
  // provider; production must never put a reset token in a response body.
  expect("development returns the reset code so the flow is usable without mail",
    typeof devReset.json.devCode === "string" && devReset.json.devCode.length > 20);
  const restoreEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const prodReset = await api("POST", "/api/auth/forgot-password", undefined, { email: "june@okafor.design" });
  if (restoreEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = restoreEnv;
  expect("production never returns a reset code in the response",
    prodReset.status === 200 && prodReset.json.devCode === undefined && prodReset.json.token === undefined &&
    !("devCode" in prodReset.json));
  const resetMails = recentMail.filter(m => m.tag === "password-reset" && m.to === "june@okafor.design");
  expect("reset requests hand a reset email to the mailer", resetMails.length >= 2);
  const lastResetMail = resetMails[resetMails.length - 1];
  expect("reset email links to the reset screen with the token",
    Boolean(lastResetMail?.html.includes("#/forgot-password?token=")) && resetMails.some(m => m.text.includes(String(devReset.json.devCode))));
  expect("unknown addresses never receive a reset email", !recentMail.some(m => m.to === "nobody@nowhere.example"));
  expect("signup sends an application-received email", recentMail.some(m => m.tag === "welcome" && m.to === "june@okafor.design"));
  expect("mail is off by default, and a provider without a key never delivers",
    mailConfig({}).provider === "off" && !mailDelivers(mailConfig({ MAIL_PROVIDER: "resend" })) &&
    mailDelivers(mailConfig({ MAIL_PROVIDER: "postmark", MAIL_API_KEY: "k" })));
  expect("reset links use APP_URL", mailConfig({ APP_URL: "https://app.example.com/" }).appUrl === "https://app.example.com");
  const badReset = await api("POST", "/api/auth/reset-password", undefined, { token: "forged-token", password: "new password 123" });
  expect("forged reset token rejected (400)", badReset.status === 400);
  // Mint a token through the same code path (sha256-hashed, 30-min expiry) for
  // June's real user id, then complete the reset like the emailed link would.
  const crypto = await import("node:crypto");
  const rawToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  db.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)")
    .run(crypto.createHash("sha256").update(rawToken).digest("hex"), juneReg.json.user.id, Date.now() + 30 * 60_000, Date.now());
  const weakReset = await api("POST", "/api/auth/reset-password", undefined, { token: rawToken, password: "short" });
  expect("reset enforces the 8-char minimum (400)", weakReset.status === 400);
  const goodReset = await api("POST", "/api/auth/reset-password", undefined, { token: rawToken, password: "totally new pass 77" });
  expect("valid token resets the password", goodReset.status === 200 &&
    (await api("POST", "/api/auth/login", undefined, { email: "june@okafor.design", password: "totally new pass 77" })).status === 200);
  const replayReset = await api("POST", "/api/auth/reset-password", undefined, { token: rawToken, password: "another pass 88" });
  expect("reset token is single-use (replay rejected)", replayReset.status === 400);

  /* ---------- reCAPTCHA on the anonymous auth routes ---------- */
  //
  // Google's endpoint is replaced by a local stub so the matrix is exercised
  // for real over HTTP — the verifier does an actual round-trip, parses an
  // actual response, and the middleware sits in the actual route chain. Only
  // the far end is ours. Verdicts are driven by the token string.
  {
    const seen: { secret?: string; token?: string; body?: any }[] = [];
    const stub = createServer((req, res) => {
      let raw = "";
      req.on("data", chunk => { raw += chunk; });
      req.on("end", () => {
        const enterprise = String(req.headers["content-type"]).includes("json");
        const parsed = enterprise ? JSON.parse(raw || "{}") : Object.fromEntries(new URLSearchParams(raw));
        const token = enterprise ? parsed.event?.token : parsed.response;
        const expectedAction = enterprise ? parsed.event?.expectedAction : "login";
        seen.push({ secret: enterprise ? parsed.event?.siteKey : parsed.secret, token, body: parsed });

        const send = (status: number, payload: unknown) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(payload));
        };
        if (token === "boom") return void send(500, { error: "upstream exploded" });

        const verdicts: Record<string, { score: number; action: string } | { fail: string }> = {
          good: { score: 0.9, action: expectedAction },
          low: { score: 0.1, action: expectedAction },
          otheraction: { score: 0.9, action: "contact_form" },
          dupe: { fail: "timeout-or-duplicate" },
          badsecret: { fail: "invalid-input-secret" },
        };
        const verdict = verdicts[token] ?? { fail: "invalid-input-response" };

        if ("fail" in verdict) {
          return void send(200, enterprise
            ? { tokenProperties: { valid: false, invalidReason: verdict.fail === "timeout-or-duplicate" ? "DUPE" : "MALFORMED" } }
            : { success: false, "error-codes": [verdict.fail] });
        }
        send(200, enterprise
          ? { tokenProperties: { valid: true, action: verdict.action, hostname: "veyra.test" }, riskAnalysis: { score: verdict.score } }
          : { success: true, score: verdict.score, action: verdict.action, hostname: "veyra.test" });
      });
    });
    await new Promise<void>(r => stub.listen(0, "127.0.0.1", () => r()));
    const stubUrl = `http://127.0.0.1:${(stub.address() as { port: number }).port}/siteverify`;

    // Credentials are deliberately wrong throughout: reaching the handler at
    // all (401 "doesn't match") is the proof that the gate let the request by,
    // and no account is created or mutated by these probes.
    const attempt = (token?: string, email = "recaptcha-probe@member.test") =>
      api("POST", "/api/auth/login", undefined, { email, password: "definitely-wrong", ...(token ? { recaptchaToken: token } : {}) });

    const restore = { ...process.env };
    try {
      // Off by default: every other test in this file posts to /api/auth/login
      // with no token, which must keep working.
      resetRecaptchaConfig();
      expect("reCAPTCHA is off until configured (no token required)", (await attempt()).status === 401);
      const offConfig = await api("GET", "/api/auth/config");
      expect("config advertises the gate as off", offConfig.status === 200 && offConfig.json.recaptcha.enabled === false);

      // Classic v3.
      process.env.RECAPTCHA_SITE_KEY = "site-key-public";
      process.env.RECAPTCHA_SECRET_KEY = "secret-key-private";
      process.env.RECAPTCHA_VERIFY_URL = stubUrl;
      process.env.RECAPTCHA_MIN_SCORE = "0.5";
      delete process.env.RECAPTCHA_FAIL_CLOSED;
      resetRecaptchaConfig();

      const config = await api("GET", "/api/auth/config");
      expect("config publishes the site key and the action names",
        config.status === 200 && config.json.recaptcha.enabled === true &&
        config.json.recaptcha.siteKey === "site-key-public" && config.json.recaptcha.actions.login === "login");
      expect("config never leaks the secret key",
        !JSON.stringify(config.json).includes("secret-key-private"));

      const missing = await attempt();
      expect("a request with no token is refused (400 recaptcha_required)",
        missing.status === 400 && missing.json.code === "recaptcha_required");

      expect("a good token reaches the handler", (await attempt("good")).status === 401);
      expect("the secret is sent to the verifier, never to the browser",
        seen.at(-1)?.secret === "secret-key-private" && seen.at(-1)?.token === "good");

      const low = await attempt("low");
      expect("a score below the threshold is refused (403 recaptcha_failed)",
        low.status === 403 && low.json.code === "recaptcha_failed");

      const mismatched = await attempt("otheraction");
      expect("a token minted for another action is refused (action binding)",
        mismatched.status === 400 && mismatched.json.code === "recaptcha_failed");

      const duplicate = await attempt("dupe");
      expect("a replayed or expired token is refused",
        duplicate.status === 400 && duplicate.json.code === "recaptcha_failed");

      // A token may also travel in a header, for proxies that strip bodies.
      const viaHeader = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Recaptcha-Token": "good" },
        body: JSON.stringify({ email: "recaptcha-probe@member.test", password: "definitely-wrong" }),
      });
      expect("a token supplied via X-Recaptcha-Token is accepted", viaHeader.status === 401);

      // Infrastructure failure: Google unreachable / misconfigured secret.
      // Default is fail-open, because locking every customer out of their money
      // is a worse outcome than letting a bot through during an outage.
      expect("a verifier outage fails OPEN by default", (await attempt("boom")).status === 401);
      expect("a rejected secret is treated as our outage, not the visitor's fault",
        (await attempt("badsecret")).status === 401);

      process.env.RECAPTCHA_FAIL_CLOSED = "1";
      resetRecaptchaConfig();
      const closed = await attempt("boom");
      expect("RECAPTCHA_FAIL_CLOSED=1 turns an outage into a 503",
        closed.status === 503 && closed.json.code === "recaptcha_unavailable");
      expect("a decision failure is still enforced when failing closed", (await attempt("low")).status === 403);
      delete process.env.RECAPTCHA_FAIL_CLOSED;

      // Enterprise: different request shape, different response shape, same verdicts.
      process.env.RECAPTCHA_PROJECT_ID = "veyra-prod";
      process.env.RECAPTCHA_API_KEY = "enterprise-api-key";
      resetRecaptchaConfig();
      const enterpriseConfig = await api("GET", "/api/auth/config");
      expect("Enterprise credentials switch the provider",
        enterpriseConfig.json.recaptcha.provider === "enterprise");
      expect("Enterprise createAssessment accepts a good token", (await attempt("good")).status === 401);
      expect("Enterprise sends the expected action for binding",
        seen.at(-1)?.body?.event?.expectedAction === "login");
      expect("Enterprise refuses a low score", (await attempt("low")).status === 403);
      expect("Enterprise refuses a duplicate token", (await attempt("dupe")).status === 400);

      // The other two anonymous routes are gated with their own actions.
      const gatedRegister = await api("POST", "/api/auth/register", undefined, {
        name: "Gate Test", email: "gate-test@member.test", password: "member-pass-9",
        accountType: "personal", profile: applicationFor("personal", "Gate Test"),
      });
      expect("sign-up is gated too (no token, no account)",
        gatedRegister.status === 400 && gatedRegister.json.code === "recaptcha_required" &&
        !db.prepare("SELECT 1 FROM users WHERE email = ?").get("gate-test@member.test"));
      const gatedForgot = await api("POST", "/api/auth/forgot-password", undefined, { email: "june@okafor.design" });
      expect("password recovery is gated too",
        gatedForgot.status === 400 && gatedForgot.json.code === "recaptcha_required");
    } finally {
      for (const key of ["RECAPTCHA_SITE_KEY", "RECAPTCHA_SECRET_KEY", "RECAPTCHA_VERIFY_URL",
        "RECAPTCHA_MIN_SCORE", "RECAPTCHA_FAIL_CLOSED", "RECAPTCHA_PROJECT_ID", "RECAPTCHA_API_KEY"]) {
        if (restore[key] === undefined) delete process.env[key]; else process.env[key] = restore[key];
      }
      resetRecaptchaConfig();
      await new Promise<void>(r => stub.close(() => r()));
      resetRateLimits();
    }
    expect("the gate is fully off again for the rest of the suite", (await attempt()).status === 401);
  }

  /* ---------- federated sign-in (Google via Firebase) ---------- */
  //
  // Real RSA keys, real RS256 signatures, a real JWKS endpoint — only Google's
  // hostname is swapped out. The crypto under test is genuinely exercised and
  // the suite stays offline.
  {
    const { generateKeyPairSync, createSign, createHmac } = await import("node:crypto");
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const KID = "test-key-1";
    const PROJECT = "veyra-test-project";
    const jwk = { ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };

    // A second, unpublished key: signatures from it must never verify.
    const foreign = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;

    let jwksHits = 0;
    const jwksServer = createServer((_req, res) => {
      jwksHits++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>(r => jwksServer.listen(0, "127.0.0.1", () => r()));
    const jwksUrl = `http://127.0.0.1:${(jwksServer.address() as { port: number }).port}/jwk`;

    const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const nowSec = Math.floor(Date.now() / 1000);
    const idToken = (over: Record<string, unknown> = {}, opts: { kid?: string; alg?: string; key?: any } = {}) => {
      const header = b64({ alg: opts.alg ?? "RS256", kid: opts.kid ?? KID, typ: "JWT" });
      const body = b64({
        iss: `https://securetoken.google.com/${PROJECT}`,
        aud: PROJECT,
        sub: "google-uid-aurelia",
        auth_time: nowSec - 30, iat: nowSec - 30, exp: nowSec + 3600,
        email: "aurelia@federated.test", email_verified: true, name: "Aurelia Vance",
        firebase: { sign_in_provider: "google.com", identities: {} },
        ...over,
      });
      const signature = createSign("RSA-SHA256").update(`${header}.${body}`).sign(opts.key ?? privateKey);
      return `${header}.${body}.${signature.toString("base64url")}`;
    };

    const post = (idTokenValue: string) => api("POST", "/api/auth/federated", undefined, { idToken: idTokenValue });
    const restore = { ...process.env };
    try {
      // Off until configured.
      resetFederatedConfig();
      const off = await post(idToken());
      expect("federated sign-in is off until configured (503)", off.status === 503 && off.json.code === "federated_disabled");
      const offConfig = await api("GET", "/api/auth/config");
      expect("config advertises federated sign-in as off",
        offConfig.json.federated.enabled === false && offConfig.json.federated.firebase === null);

      process.env.FIREBASE_PROJECT_ID = PROJECT;
      process.env.FIREBASE_API_KEY = "web-api-key";
      process.env.FIREBASE_JWKS_URL = jwksUrl;
      process.env.FEDERATED_PROVIDERS = "google,apple,microsoft";
      delete process.env.FEDERATED_ALLOW_STAFF;
      resetFederatedConfig();

      const onConfig = await api("GET", "/api/auth/config");
      const offered = (onConfig.json.federated.providers as Array<{ id: string; label: string }>).map(p => p.id);
      expect("config publishes the Firebase web config for the browser",
        onConfig.json.federated.enabled === true &&
        onConfig.json.federated.firebase.projectId === PROJECT &&
        onConfig.json.federated.firebase.authDomain === `${PROJECT}.firebaseapp.com`);
      expect("config lists every enabled provider with a label for the UI",
        offered.join(",") === "google,apple,microsoft" &&
        (onConfig.json.federated.providers as Array<{ label: string }>).every(p => Boolean(p.label)));

      // No Veyra account uses that address yet: sign-in must refuse rather
      // than quietly opening one.
      const orphan = await post(idToken());
      expect("an unknown email is refused, not auto-provisioned (404)",
        orphan.status === 404 && orphan.json.code === "federated_no_account" &&
        !db.prepare("SELECT 1 FROM users WHERE email = ?").get("aurelia@federated.test"));

      // Now open a real account through the normal application flow.
      const aurelia = await register("Aurelia Vance", "aurelia@federated.test", "member-pass-9", { accountType: "personal" });
      expect("the member exists before linking", aurelia.status === 201);

      const firstLink = await post(idToken());
      expect("a verified Google identity links to the matching member and signs in",
        firstLink.status === 200 && firstLink.json.linked === true &&
        firstLink.json.user.email === "aurelia@federated.test" && typeof firstLink.json.token === "string");
      expect("the session it mints is a real Veyra session",
        (await api("GET", "/api/me/state", firstLink.json.token)).status === 200);
      expect("the member is told a new way into the account was added",
        Boolean(db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND title LIKE 'Google sign-in linked%'")
          .get(aurelia.json.user.id)));

      const secondUse = await post(idToken());
      expect("a returning identity signs in without re-linking",
        secondUse.status === 200 && secondUse.json.linked === false);
      expect("exactly one link row exists for that identity",
        (db.prepare("SELECT COUNT(*) AS n FROM federated_identities WHERE user_id = ?").get(aurelia.json.user.id) as { n: number }).n === 1);

      // Matching is by subject, not email: a changed email still signs in.
      const renamed = await post(idToken({ email: "aurelia.vance@federated.test" }));
      expect("matching is by stable subject, so a changed email still signs in",
        renamed.status === 200 && renamed.json.user.email === "aurelia@federated.test");

      /* ---- forgery and claim checks ---- */
      const unverified = await post(idToken({ sub: "google-uid-other", email_verified: false, email: "aurelia@federated.test" }));
      expect("an unverified email cannot claim an existing account (403)",
        unverified.status === 403 && unverified.json.code === "federated_unverified");

      expect("a token for another Firebase project is rejected (aud)",
        (await post(idToken({ aud: "someone-elses-project" }))).status === 401);
      expect("a token from another issuer is rejected (iss)",
        (await post(idToken({ iss: "https://securetoken.google.com/evil" }))).status === 401);
      expect("an expired token is rejected", (await post(idToken({ exp: nowSec - 3600 }))).status === 401);
      expect("a token issued in the future is rejected", (await post(idToken({ iat: nowSec + 7200 }))).status === 401);
      expect("a token signed by an unpublished key is rejected",
        (await post(idToken({}, { key: foreign }))).status === 401);
      expect("a token naming an unknown key id is rejected",
        (await post(idToken({}, { kid: "not-a-real-kid" }))).status === 401);

      // alg confusion: the classic JWT forgery. Both must die on the algorithm
      // check, before any key is consulted.
      const noneHeader = b64({ alg: "none", kid: KID, typ: "JWT" });
      const noneBody = b64({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: "x",
        iat: nowSec, exp: nowSec + 3600, email: "aurelia@federated.test", email_verified: true });
      expect('alg "none" is rejected', (await post(`${noneHeader}.${noneBody}.`)).status === 401);
      const hsHeader = b64({ alg: "HS256", kid: KID, typ: "JWT" });
      const hsSig = createHmac("sha256", publicKey.export({ type: "spki", format: "pem" }) as string)
        .update(`${hsHeader}.${noneBody}`).digest("base64url");
      expect("an HS256 token signed with the public key is rejected (alg confusion)",
        (await post(`${hsHeader}.${noneBody}.${hsSig}`)).status === 401);

      const tampered = idToken().split(".");
      tampered[1] = b64({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: "google-uid-aurelia",
        iat: nowSec, exp: nowSec + 3600, email: "ops@veyra.test", email_verified: true });
      expect("a tampered payload breaks the signature", (await post(tampered.join("."))).status === 401);
      expect("garbage is rejected without a crash", (await post("not-a-jwt")).status === 400);

      /* ---- linking rules ---- */
      const secondGoogle = await post(idToken({ sub: "google-uid-second", email: "aurelia@federated.test" }));
      expect("a member holds at most one Google identity (409)",
        secondGoogle.status === 409 && secondGoogle.json.code === "federated_already_linked");

      /* ---- multiple providers ---- */
      // This block alone outspends a real member's lifetime budget; the
      // limiter has its own coverage elsewhere.
      resetRateLimits();
      const appleToken = (over: Record<string, unknown> = {}) =>
        idToken({ sub: "apple-uid-aurelia", email: "aurelia@federated.test",
          firebase: { sign_in_provider: "apple.com", identities: {} }, ...over });

      const appleLink = await post(appleToken());
      expect("a second provider links to the same member independently",
        appleLink.status === 200 && appleLink.json.linked === true && appleLink.json.provider === "apple" &&
        appleLink.json.user.email === "aurelia@federated.test");
      expect("the member now holds one identity per provider",
        (db.prepare("SELECT COUNT(*) AS n FROM federated_identities WHERE user_id = ?")
          .get(aurelia.json.user.id) as { n: number }).n === 2);
      expect("a returning Apple identity signs in without re-linking",
        (await post(appleToken())).json.linked === false);

      const microsoftLink = await post(idToken({ sub: "ms-uid-aurelia", email: "aurelia@federated.test",
        firebase: { sign_in_provider: "microsoft.com", identities: {} } }));
      expect("Microsoft links through the same pipeline",
        microsoftLink.status === 200 && microsoftLink.json.provider === "microsoft");

      // Apple's Hide My Email relay can never match a member — say so usefully.
      const relay = await post(idToken({ sub: "apple-uid-hidden", email: "abc123@privaterelay.appleid.com",
        firebase: { sign_in_provider: "apple.com", identities: {} } }));
      expect("an Apple private-relay address gets its own explanation, not \"no account\"",
        relay.status === 409 && relay.json.code === "federated_private_relay" &&
        String(relay.json.error).includes("Share My Email"));

      // The provider is read from the signed token, never from the request.
      const unknownProvider = await post(idToken({ sub: "fb-uid-1",
        firebase: { sign_in_provider: "facebook.com", identities: {} } }));
      expect("a provider this build does not know is refused (403)",
        unknownProvider.status === 403 && String(unknownProvider.json.error).includes("isn't supported"));
      const passwordProvider = await post(idToken({ sub: "pw-uid-1",
        firebase: { sign_in_provider: "password", identities: {} } }));
      expect("a Firebase password identity cannot ride this route", passwordProvider.status === 403);

      process.env.FEDERATED_PROVIDERS = "google";
      resetFederatedConfig();
      const appleDisabled = await post(appleToken({ sub: "apple-uid-new", email: "aurelia@federated.test" }));
      expect("a provider absent from FEDERATED_PROVIDERS is refused even with a valid token",
        appleDisabled.status === 403 && String(appleDisabled.json.error).includes("Apple"));
      expect("narrowing the provider list is reflected to the browser",
        ((await api("GET", "/api/auth/config")).json.federated.providers as Array<{ id: string }>)
          .map(p => p.id).join(",") === "google");
      process.env.FEDERATED_PROVIDERS = "google,apple,microsoft";
      resetFederatedConfig();

      const staffAttempt = await post(idToken({ sub: "google-uid-ops", email: "ops@veyra.test" }));
      expect("staff accounts cannot be unlocked by a federated provider by default (403)",
        staffAttempt.status === 403 && staffAttempt.json.code === "federated_staff_blocked");

      resetRateLimits();
      const hitsBefore = jwksHits;
      process.env.FEDERATED_ALLOW_STAFF = "1";
      resetFederatedConfig();
      const staffAllowed = await post(idToken({ sub: "google-uid-ops", email: "ops@veyra.test" }));
      expect("FEDERATED_ALLOW_STAFF=1 opens it to staff deliberately",
        staffAllowed.status === 200 && staffAllowed.json.user.role === "superadmin");
      // Verification never refetches per request: the only extra fetch is the
      // one forced by clearing the cache above.
      expect("Google's signing keys are cached, not refetched per verification",
        jwksHits === hitsBefore + 1);
    } finally {
      for (const key of ["FIREBASE_PROJECT_ID", "FIREBASE_API_KEY", "FIREBASE_JWKS_URL",
        "FIREBASE_AUTH_DOMAIN", "FEDERATED_ALLOW_STAFF", "FEDERATED_PROVIDERS"]) {
        if (restore[key] === undefined) delete process.env[key]; else process.env[key] = restore[key];
      }
      resetFederatedConfig();
      await new Promise<void>(r => jwksServer.close(() => r()));
      resetRateLimits();
    }
  }

  /* ---------- passkeys (WebAuthn) ---------- */
  //
  // A software authenticator: real P-256 keys, real ECDSA signatures, real
  // CBOR, real authenticator data. Nothing about the verification path is
  // stubbed — the only thing missing is the hardware that would normally hold
  // the private key.
  {
    const { generateKeyPairSync, createHash: sha, randomBytes: rnd, sign: ecSign } = await import("node:crypto");

    /* --- minimal CBOR encoder, the mirror of the decoder under test --- */
    const head = (major: number, length: number): Buffer => {
      if (length < 24) return Buffer.from([(major << 5) | length]);
      if (length < 256) return Buffer.from([(major << 5) | 24, length]);
      const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(length, 1); return b;
    };
    const cInt = (n: number) => n >= 0 ? head(0, n) : head(1, -1 - n);
    const cBytes = (b: Buffer) => Buffer.concat([head(2, b.length), b]);
    const cText = (t: string) => Buffer.concat([head(3, Buffer.byteLength(t)), Buffer.from(t, "utf8")]);
    const cMap = (e: Array<[Buffer, Buffer]>) => Buffer.concat([head(5, e.length), ...e.flat()]);
    const u = (b: Buffer) => b.toString("base64url");

    const RP = "localhost";
    const ORIGIN = "https://veyra.test";

    /** Flags: UP 0x01, UV 0x04, BE 0x08, BS 0x10, AT 0x40. */
    const authenticator = (rpId = RP) => {
      const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
      const credId = rnd(32);
      const cose = cMap([
        [cInt(1), cInt(2)], [cInt(3), cInt(-7)], [cInt(-1), cInt(1)],
        [cInt(-2), cBytes(Buffer.from(jwk.x, "base64url"))],
        [cInt(-3), cBytes(Buffer.from(jwk.y, "base64url"))],
      ]);
      const authData = (flags: number, count: number, attested: boolean) => {
        const h = Buffer.alloc(37);
        sha("sha256").update(rpId).digest().copy(h, 0);
        h[32] = flags; h.writeUInt32BE(count, 33);
        if (!attested) return h;
        const len = Buffer.alloc(2); len.writeUInt16BE(credId.length);
        return Buffer.concat([h, Buffer.alloc(16), len, credId, cose]);
      };
      const clientData = (type: string, challenge: string, origin: string) =>
        Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), "utf8");
      // Real hardware advances this on every assertion, so the default must
      // too — otherwise routine sign-ins look like a cloned device and the
      // clone test below would pass without proving anything.
      let counter = 0;
      return {
        id: u(credId),
        register(challenge: string, { origin = ORIGIN, flags = 0x45 } = {}) {
          return {
            clientDataJSON: u(clientData("webauthn.create", challenge, origin)),
            attestationObject: u(cMap([
              [cText("fmt"), cText("none")], [cText("attStmt"), cMap([])],
              [cText("authData"), cBytes(authData(flags, 0, true))],
            ])),
          };
        },
        assert(challenge: string, { origin = ORIGIN, flags = 0x05, count = 0, tamper = false } = {}) {
          const cd = clientData("webauthn.get", challenge, origin);
          const ad = authData(flags, count || ++counter, false);
          const signature = ecSign("sha256", Buffer.concat([ad, sha("sha256").update(cd).digest()]), privateKey);
          if (tamper) ad[33] = ad[33] ^ 0xff; // flip the counter AFTER signing
          return { id: u(credId), clientDataJSON: u(cd), authenticatorData: u(ad), signature: u(signature) };
        },
      };
    };

    const restore = { ...process.env };
    try {
      process.env.WEBAUTHN_RP_ID = RP;
      process.env.WEBAUTHN_ORIGINS = ORIGIN;
      resetWebauthnConfig();

      const owner = await register("Pia Lund", "pia@passkey.test", "member-pass-7", { accountType: "personal" });
      const pia = owner.json.token;
      const other = await register("Tom Reed", "tom@passkey.test", "member-pass-8", { accountType: "personal" });
      const tom = other.json.token;

      const regChallenge = async (token: string) =>
        (await api("POST", "/api/me/passkeys/challenge", token)).json;
      const loginChallenge = async () =>
        (await api("POST", "/api/auth/passkey/challenge")).json;

      /* --- registration --- */
      const anon = await api("POST", "/api/me/passkeys/challenge");
      expect("registering a passkey needs a session (401)", anon.status === 401);

      const opts = await regChallenge(pia);
      expect("registration options name the relying party and demand user verification",
        opts.rp.id === RP && opts.challenge.length >= 40 &&
        opts.authenticatorSelection.userVerification === "required" &&
        opts.authenticatorSelection.residentKey === "required");
      expect("registration options ask for a discoverable credential, not an email",
        opts.user.name === "pia@passkey.test" && opts.attestation === "none");

      const device = authenticator();
      const added = await api("POST", "/api/me/passkeys", pia, { ...device.register(opts.challenge), label: "Pixel 9" });
      expect("a passkey registers against a live challenge (201)",
        added.status === 201 && added.json.passkey.label === "Pixel 9" && added.json.passkey.id === device.id);
      expect("adding a passkey notifies the member",
        (await api("GET", "/api/me/notifications", pia)).json.notifications
          .some((n: any) => n.title === "Passkey added"));

      const listed = await api("GET", "/api/me/passkeys", pia);
      expect("the member can list their passkeys without the key material",
        listed.json.passkeys.length === 1 && listed.json.passkeys[0].publicKey === undefined &&
        listed.json.passkeys[0].signCount === undefined);

      /* --- the challenge is single-use and bound to its session --- */
      const reused = await api("POST", "/api/me/passkeys", pia, authenticator().register(opts.challenge));
      expect("a registration challenge cannot be used twice",
        reused.status === 400 && reused.json.code === "passkey_rejected");

      const piaChallenge = (await regChallenge(pia)).challenge;
      const stolen = await api("POST", "/api/me/passkeys", tom, authenticator().register(piaChallenge));
      expect("a challenge issued to one member cannot be redeemed by another (403)", stolen.status === 403);

      const dupOpts = await regChallenge(pia);
      expect("options exclude a credential the member already registered",
        dupOpts.excludeCredentials.some((c: any) => c.id === device.id));
      const duplicate = await api("POST", "/api/me/passkeys", pia, device.register(dupOpts.challenge));
      expect("the same credential cannot be registered twice (409)",
        duplicate.status === 409 && duplicate.json.code === "passkey_duplicate");

      /* --- registration refusals --- */
      const noUvOpts = await regChallenge(pia);
      const noUv = await api("POST", "/api/me/passkeys", pia, authenticator().register(noUvOpts.challenge, { flags: 0x41 }));
      expect("a passkey that skipped user verification is refused", noUv.status === 400);

      const wrongOriginOpts = await regChallenge(pia);
      const wrongOrigin = await api("POST", "/api/me/passkeys", pia,
        authenticator().register(wrongOriginOpts.challenge, { origin: "https://veyra.test.evil.com" }));
      expect("a registration from a lookalike origin is refused", wrongOrigin.status === 400);

      const wrongRpOpts = await regChallenge(pia);
      const wrongRp = await api("POST", "/api/me/passkeys", pia, authenticator("evil.test").register(wrongRpOpts.challenge));
      expect("a credential bound to another relying party is refused", wrongRp.status === 400);

      const junk = await api("POST", "/api/me/passkeys", pia,
        { clientDataJSON: "bm90LWpzb24", attestationObject: "bm90LWNib3I" });
      expect("malformed registration data is 400, never 500", junk.status === 400);

      /* --- signing in --- */
      const signIn = await api("POST", "/api/auth/passkey/login", undefined,
        device.assert((await loginChallenge()).challenge));
      expect("a passkey signs in and mints a Veyra session",
        signIn.status === 200 && signIn.json.user.email === "pia@passkey.test" && Boolean(signIn.json.token));
      expect("the minted session is a normal Veyra session",
        (await api("GET", "/api/me/state", signIn.json.token)).status === 200);
      expect("signing in records when the passkey was last used",
        (await api("GET", "/api/me/passkeys", pia)).json.passkeys[0].lastUsedAt !== null);

      const loginOpts = await loginChallenge();
      expect("the login challenge names no credentials, so it cannot enumerate accounts",
        Array.isArray(loginOpts.allowCredentials) && loginOpts.allowCredentials.length === 0 &&
        loginOpts.userVerification === "required");

      /* --- the phishing defence, which is the entire point --- */
      const phished = await api("POST", "/api/auth/passkey/login", undefined,
        device.assert((await loginChallenge()).challenge, { origin: "https://veyra-secure.test" }));
      expect("an assertion collected by a phishing origin does not verify (400)",
        phished.status === 400 && phished.json.code === "passkey_rejected");

      const assertion = device.assert((await loginChallenge()).challenge);
      await api("POST", "/api/auth/passkey/login", undefined, assertion);
      const replayed = await api("POST", "/api/auth/passkey/login", undefined, assertion);
      expect("a captured assertion cannot be replayed", replayed.status === 400);

      const unsolicited = await api("POST", "/api/auth/passkey/login", undefined,
        device.assert(u(rnd(32))));
      expect("an assertion for a challenge the server never issued is refused", unsolicited.status === 400);

      const tampered = await api("POST", "/api/auth/passkey/login", undefined,
        device.assert((await loginChallenge()).challenge, { tamper: true }));
      expect("editing authenticator data after signing breaks the signature (401)", tampered.status === 401);

      const impostor = authenticator();
      const forged = { ...impostor.assert((await loginChallenge()).challenge), id: device.id };
      expect("a signature from a different key under a known credential id is refused (401)",
        (await api("POST", "/api/auth/passkey/login", undefined, forged)).status === 401);

      const unknown = await api("POST", "/api/auth/passkey/login", undefined,
        authenticator().assert((await loginChallenge()).challenge));
      expect("an unregistered credential is refused (401)",
        unknown.status === 401 && unknown.json.code === "passkey_unknown");

      const noUvLogin = await api("POST", "/api/auth/passkey/login", undefined,
        device.assert((await loginChallenge()).challenge, { flags: 0x01 }));
      expect("signing in without user verification is refused (403)", noUvLogin.status === 403);

      const incomplete = await api("POST", "/api/auth/passkey/login", undefined, { id: device.id });
      expect("an incomplete assertion is 400, never 500",
        incomplete.status === 400 && incomplete.json.code === "passkey_incomplete");

      /* --- a stalled signature counter is a clone signal --- */
      const cloneTitle = "Unusual passkey activity";
      const warned = async () => (await api("GET", "/api/me/notifications", pia))
        .json.notifications.some((n: any) => n.title === cloneTitle);
      expect("ordinary sign-ins do not raise a clone warning", (await warned()) === false);
      await api("POST", "/api/auth/passkey/login", undefined,
        device.assert((await loginChallenge()).challenge, { count: 40 }));
      const regressed = await api("POST", "/api/auth/passkey/login", undefined,
        device.assert((await loginChallenge()).challenge, { count: 12 }));
      expect("a counter that goes backwards still signs in but warns the member",
        regressed.status === 200 && (await warned()) === true);

      /* --- removal --- */
      const foreign = await api("DELETE", `/api/me/passkeys/${device.id}`, tom);
      expect("another member cannot remove your passkey (404)", foreign.status === 404);
      expect("the passkey survived that attempt",
        (await api("GET", "/api/me/passkeys", pia)).json.passkeys.length === 1);

      const removed = await api("DELETE", `/api/me/passkeys/${device.id}`, pia);
      expect("the member can remove their own passkey", removed.status === 200);
      expect("removal notifies the member",
        (await api("GET", "/api/me/notifications", pia)).json.notifications
          .some((n: any) => n.title === "Passkey removed"));
      const afterRemoval = await api("POST", "/api/auth/passkey/login", undefined,
        device.assert((await loginChallenge()).challenge));
      expect("a removed passkey no longer signs in (401)", afterRemoval.status === 401);
      expect("the password still works after the passkey is gone",
        (await api("POST", "/api/auth/login", undefined,
          { email: "pia@passkey.test", password: "member-pass-7" })).status === 200);
    } finally {
      for (const key of ["WEBAUTHN_RP_ID", "WEBAUTHN_ORIGINS", "WEBAUTHN_RP_NAME"]) {
        if (restore[key] === undefined) delete process.env[key]; else process.env[key] = restore[key];
      }
      resetWebauthnConfig();
      resetRateLimits();
    }
  }

  /* ---------- durable operations casework ---------- */
  const memberOps = await api("GET", "/api/admin/operations/cases", rae);
  expect("member blocked from operations casework (403)", memberOps.status === 403);
  const opsDueAt = Date.now() + 2 * 86_400_000;
  const createOpsCase = await api("POST", "/api/admin/operations/cases", admin, {
    title: "Review Rae transfer pattern",
    kind: "transaction",
    priority: "high",
    summary: "Review unusual transfer velocity before the next settlement window.",
    userId: raeId,
    sourceType: "transaction",
    sourceId: "ops-test-transfer",
    assignedTo: adaReg.json.user.id,
    dueAt: opsDueAt,
  });
  const opsCaseId = createOpsCase.json.case?.id as string;
  expect("admin opens an assigned operational case", createOpsCase.status === 201 && Boolean(opsCaseId) &&
    createOpsCase.json.case.assignee?.id === adaReg.json.user.id && createOpsCase.json.case.events.length >= 2);
  const duplicateOpsCase = await api("POST", "/api/admin/operations/cases", admin, {
    title: "Duplicate source should fail", kind: "transaction", priority: "high", sourceType: "transaction", sourceId: "ops-test-transfer",
  });
  expect("operation source can only have one tracked case (409)", duplicateOpsCase.status === 409);
  const noteOpsCase = await api("POST", `/api/admin/operations/cases/${opsCaseId}/notes`, compliance, {
    body: "Initial review started; request supporting settlement information.",
  });
  expect("compliance can add a durable internal case note", noteOpsCase.status === 201 &&
    noteOpsCase.json.case.notes.some((note: any) => note.body.includes("Initial review started")));
  const updateOpsCase = await api("PUT", `/api/admin/operations/cases/${opsCaseId}`, admin, {
    status: "investigating", priority: "critical", assignedTo: adaReg.json.user.id,
  });
  expect("case status and priority update with a timeline", updateOpsCase.status === 200 &&
    updateOpsCase.json.case.status === "investigating" && updateOpsCase.json.case.priority === "critical" &&
    updateOpsCase.json.case.events.some((event: any) => event.action === "case.status"));
  const cases = await api("GET", "/api/admin/operations/cases", admin);
  expect("operations queue returns assigned cases with notes and SLA", cases.status === 200 &&
    cases.json.cases.some((item: any) => item.id === opsCaseId && item.dueAt === opsDueAt && item.notes.length === 1));
  let operationTimelineImmutable = false;
  try { db.prepare("UPDATE operation_case_events SET detail = 'tampered' WHERE case_id = ?").run(opsCaseId); } catch { operationTimelineImmutable = true; }
  expect("operation case event timeline is append-only at the DB layer", operationTimelineImmutable);

  /* ---------- exact money arithmetic ---------- */
  // The decimal engine is unit-tested here rather than in a separate runner so
  // it shares the one command everything else is gated on.
  {
    const eq = (label: string, got: unknown, want: unknown) =>
      expect(label, Object.is(got, want) || String(got) === String(want), `got ${got}, want ${want}`);

    // The bug this replaced: Math.round(v * 100) disagrees with correct half-up
    // rounding on 0.57% of three-decimal amounts, always a cent low, because
    // the binary float lands just under the midpoint.
    eq("$1.005 rounds up to 101c (float path gave 100)", dollarsToCentsExact("1.005"), 101);
    eq("$0.145 rounds up to 15c (float path gave 14)", dollarsToCentsExact("0.145"), 15);
    eq("$2.135 rounds up to 214c (float path gave 213)", dollarsToCentsExact("2.135"), 214);
    eq("$8.115 still rounds to 812c", dollarsToCentsExact("8.115"), 812);
    eq("negative amounts round away from zero", dollarsToCentsExact("-1.005"), -101);
    eq("whole dollars are untouched", dollarsToCentsExact(250), 25000);
    eq("exponent notation expands", dollarsToCentsExact("1e3"), 100000);
    eq("cents render with two places", centsToDecimalExact(5), "0.05");

    for (const bad of ["", "12abc", "abc", {}, [], true, null, undefined, NaN, Infinity]) {
      let threw = false;
      try { dollarsToCentsExact(bad as never); } catch { threw = true; }
      expect(`rejects ${JSON.stringify(bad) ?? String(bad)} as an amount`, threw);
    }

    // 18-decimal assets are exactly why units are TEXT + bigint: one ETH is
    // 10^18 wei, and a SQLite INTEGER column overflows at 9 ETH.
    eq("1 ETH is 10^18 wei", parseUnits("1", 18), 10n ** 18n);
    eq("ETH survives a round trip", formatUnitsTrimmed(parseUnits("0.123456789012345678", 18), 18), "0.123456789012345678");
    eq("excess precision is rounded, not truncated", parseUnits("0.000000005", 8), 1n);
    eq("trailing zeros are trimmed for display", formatUnitsTrimmed(10n ** 18n, 18), "1");
    eq("1c of BTC at $100k is 10 satoshi", unitsForCents(1, 8, 10_000_000n), 10n);
    eq("buying truncates rather than inventing units", unitsForCents(100, 8, 3_333_333n), 3000n);
    eq("valuation is exact at 18 decimals", valueInCents(parseUnits("0.5", 18), 18, 400_000n), 200_000);
    let zeroPriceThrew = false;
    try { unitsForCents(100, 8, 0n); } catch { zeroPriceThrew = true; }
    expect("a zero price is refused rather than dividing by it", zeroPriceThrew);
  }

  /* ---------- digital asset holdings ---------- */
  // The price feed is stubbed over real HTTP, same as reCAPTCHA and JWKS:
  // the cache, timeout, parsing and staleness logic all run for real, only the
  // far end is ours. Tests never touch the network.
  {
    /* The upstream is /coins/markets, so the stub speaks that array shape.
       mkt() keeps the tests written in the terms they care about — "which
       coins are priced, and at what" — instead of 12 fields of noise. */
    const mkt = (prices: Record<string, number>, extra: Record<string, unknown> = {}) =>
      Object.entries(prices).map(([id, usd], i) => ({
        id,
        symbol: ({ bitcoin: "btc", ethereum: "eth", solana: "sol", "usd-coin": "usdc", "example-coin": "example" } as Record<string, string>)[id] ?? id,
        name: id,
        image: `https://example.test/${id}.png`,
        current_price: usd,
        market_cap: usd * 1000,
        total_volume: usd * 10,
        market_cap_rank: i + 1,
        price_change_percentage_1h_in_currency: 0.4,
        price_change_percentage_24h_in_currency: -1.25,
        price_change_percentage_7d_in_currency: 3.5,
        sparkline_in_7d: { price: [usd * 0.98, usd * 0.99, usd] },
        ...extra,
      }));

    let priceBody: unknown = mkt({ bitcoin: 100000, ethereum: 4000, solana: 200, "usd-coin": 1 });
    let priceStatus = 200;
    // Candle rows in CoinGecko's shape: [ms, open, high, low, close].
    let ohlcBody: unknown = [
      [1_700_000_000_000, 99000, 101000, 98500, 100500],
      [1_700_003_600_000, 100500, 102000, 100000, 101750],
      [1_700_007_200_000, 101750, 101900, 99250, 99800],
    ];
    let ohlcStatus = 200;
    const priceStub = createServer((req, res) => {
      const ohlc = (req.url ?? "").startsWith("/ohlc");
      res.writeHead(ohlc ? ohlcStatus : priceStatus, { "content-type": "application/json" });
      res.end(JSON.stringify(ohlc ? ohlcBody : priceBody));
    });
    await new Promise<void>(r => priceStub.listen(0, "127.0.0.1", r));
    const priceUrl = `http://127.0.0.1:${(priceStub.address() as any).port}/prices`;
    const restore = { ...process.env };

    try {
      process.env.CRYPTO_PRICES_URL = priceUrl;
      process.env.CRYPTO_OHLC_URL = `${priceUrl.replace("/prices", "")}/ohlc/{id}?days={days}`;
      process.env.CRYPTO_TRADING_ENABLED = "1";
      process.env.CRYPTO_PRICES_TTL_MS = "50";
      resetPrices();

      const start = (await api("GET", "/api/me/account", rae)).json.balance.cents as number;
      const empty = await api("GET", "/api/me/holdings", rae);
      expect("holdings list every registered asset, starting at zero", empty.status === 200 &&
        empty.json.holdings.length === ASSETS.length && empty.json.holdings.every((h: any) => h.units === "0") &&
        empty.json.totalUsd === "0.00" && empty.json.partial === false);
      expect("holdings are quoted with a price and a timestamp", empty.json.holdings.filter((h: any) => ["BTC","ETH","SOL","USDC"].includes(h.asset))
        .every((h: any) => h.priceUsd !== null && typeof h.quotedAt === "number"));
      expect("holdings carry the not-insured disclosure", /not FDIC insured/i.test(empty.json.disclosure));
      expect("holdings require a session (401)", (await api("GET", "/api/me/holdings")).status === 401);

      const buy = await api("POST", "/api/me/holdings/trade", rae, { asset: "BTC", side: "buy", amount: "250" });
      expect("buying debits checking and credits the holding", buy.status === 201 &&
        buy.json.quantity === "0.0025" && buy.json.amountUsd === "250.00");
      const afterBuy = (await api("GET", "/api/me/account", rae)).json.balance.cents as number;
      expect("the deposit leg left checking exactly once", start - afterBuy === 25000);
      // A balance that moves with no matching statement line is how support
      // tickets start, so the USD leg must be visible in transactions too.
      const statement = (await api("GET", "/api/me/transactions", rae)).json.transactions;
      expect("the purchase appears in the member's statement", statement.some((t: any) =>
        t.merchant === "Bought BTC" && t.amount.cents === -25000));

      const held = await api("GET", "/api/me/holdings", rae);
      const btc = held.json.holdings.find((h: any) => h.asset === "BTC");
      expect("the holding reports units, quantity and value", btc.units === "250000" &&
        btc.quantity === "0.0025" && btc.valueUsd === "250.00" && held.json.totalUsd === "250.00");

      expect("selling more than is held is refused (400)", (await api("POST", "/api/me/holdings/trade", rae,
        { asset: "BTC", side: "sell", amount: "1" })).status === 400);
      expect("buying beyond the checking balance is refused (400)", (await api("POST", "/api/me/holdings/trade", rae,
        { asset: "BTC", side: "buy", amount: "99999999" })).status === 400);
      expect("an unknown asset is a 404", (await api("POST", "/api/me/holdings/trade", rae,
        { asset: "UNKNOWN", side: "buy", amount: "10" })).status === 404);
      expect("an invalid side is a 400", (await api("POST", "/api/me/holdings/trade", rae,
        { asset: "BTC", side: "hodl", amount: "10" })).status === 400);
      expect("a zero amount is a 400", (await api("POST", "/api/me/holdings/trade", rae,
        { asset: "BTC", side: "buy", amount: "0" })).status === 400);
      expect("a negative amount is a 400", (await api("POST", "/api/me/holdings/trade", rae,
        { asset: "BTC", side: "buy", amount: "-50" })).status === 400);
      expect("a malformed amount is a 400, not a 500", (await api("POST", "/api/me/holdings/trade", rae,
        { asset: "BTC", side: "buy", amount: { $gt: 0 } })).status === 400);
      expect("holdings are per-member, never shared", (await api("GET", "/api/me/holdings", alex))
        .json.holdings.every((h: any) => h.units === "0"));

      // Selling the exact displayed quantity must land on zero. If the client
      // round-tripped through a float this would leave dust behind.
      const sellAll = await api("POST", "/api/me/holdings/trade", rae, { asset: "BTC", side: "sell", amount: btc.quantity });
      expect("selling the full quantity empties the position", sellAll.status === 201 &&
        (await api("GET", "/api/me/holdings", rae)).json.holdings.find((h: any) => h.asset === "BTC").units === "0");
      const afterSell = (await api("GET", "/api/me/account", rae)).json.balance.cents as number;
      expect("a round trip at one price returns the money exactly", afterSell === start);

      // 18-decimal asset end to end — the case an INTEGER column could not hold.
      await api("POST", "/api/me/holdings/trade", rae, { asset: "ETH", side: "buy", amount: "40" });
      const eth = (await api("GET", "/api/me/holdings", rae)).json.holdings.find((h: any) => h.asset === "ETH");
      expect("an 18-decimal holding survives the full round trip", eth.units === "10000000000000000" &&
        eth.quantity === "0.01" && eth.valueUsd === "40.00");
      await api("POST", "/api/me/holdings/trade", rae, { asset: "ETH", side: "sell", amount: eth.quantity });

      /* a dead feed must degrade, never invent a zero */
      priceStatus = 500;
      resetPrices();
      await new Promise(r => setTimeout(r, 60));
      const dark = await api("GET", "/api/me/holdings", rae);
      expect("an unreachable feed yields null prices, never 0.00", dark.status === 200 &&
        dark.json.holdings.every((h: any) => h.priceUsd === null && h.valueUsd === null));
      expect("trading is refused without a price (503)", (await api("POST", "/api/me/holdings/trade", rae,
        { asset: "BTC", side: "buy", amount: "50" })).status === 503);

      // A feed that answers but carries nothing usable is a failed feed: the
      // last good quotes must survive rather than being replaced by nothing.
      priceStatus = 200; priceBody = mkt({ bitcoin: 100000 });
      resetPrices();
      await new Promise(r => setTimeout(r, 60));
      await api("GET", "/api/me/holdings", rae);
      priceBody = [];
      await new Promise(r => setTimeout(r, 60));
      const kept = await api("GET", "/api/me/holdings", rae);
      expect("an empty feed response keeps the last known price", kept.json.holdings
        .find((h: any) => h.asset === "BTC").priceUsd === "100000.00");

      // A member holding an asset the feed cannot price must be told the total
      // is incomplete rather than shown a smaller, confident number.
      priceBody = mkt({ bitcoin: 100000, ethereum: 4000, solana: 200, "usd-coin": 1 });
      resetPrices();
      await new Promise(r => setTimeout(r, 60));
      await api("POST", "/api/me/holdings/trade", rae, { asset: "SOL", side: "buy", amount: "100" });
      priceBody = mkt({ bitcoin: 100000 });
      resetPrices();
      await new Promise(r => setTimeout(r, 60));
      const partial = await api("GET", "/api/me/holdings", rae);
      expect("an unpriced holding flags the total as partial", partial.json.partial === true);

      /* ---- markets table ---- */
      priceBody = mkt({ bitcoin: 100000, ethereum: 4000, solana: 200, "usd-coin": 1, "example-coin": 0.42 });
      resetPrices();
      await new Promise(r => setTimeout(r, 60));
      const markets = await api("GET", "/api/me/markets", rae);
      expect("markets list every quoted coin, ranked", markets.status === 200 &&
        markets.json.markets.length === 5 && markets.json.markets[0].code === "BTC" &&
        markets.json.markets[0].rank === 1 && markets.json.markets[0].priceUsd === "100000.00");
      expect("markets carry change, cap, volume and a sparkline", (() => {
        const btc = markets.json.markets[0];
        return btc.change24h === -1.25 && btc.change7d === 3.5 &&
          btc.marketCapUsd === "100000000.00" && btc.volumeUsd === "1000000.00" &&
          Array.isArray(btc.sparkline) && btc.sparkline.length === 3 && btc.sparkline[2] === 10000000;
      })());

      // Being quoted is not being custodied. DOGE is priced upstream but is not
      // in the local registry, so it must be listed and explicitly untradeable
      // — otherwise the UI would offer a buy we have no decimals to settle.
      expect("a coin outside the registry is listed but not tradeable", (() => {
        const doge = markets.json.markets.find((m: any) => m.code === "EXAMPLE");
        return doge && doge.tradeable === false && doge.decimals === null &&
          doge.quantity === null && doge.valueUsd === null && doge.priceUsd === "0.42";
      })());
      expect("a registry asset is tradeable and carries its decimals", (() => {
        const eth = markets.json.markets.find((m: any) => m.code === "ETH");
        return eth && eth.tradeable === true && eth.decimals === 18 && eth.kind === "crypto";
      })());

      // The member's own position has to ride along, or the table is a price
      // ticker rather than a view of their money.
      await api("POST", "/api/me/holdings/trade", rae, { asset: "BTC", side: "buy", amount: "250" });
      const withPosition = await api("GET", "/api/me/markets", rae);
      expect("a held asset shows its quantity and value in the table", (() => {
        const btc = withPosition.json.markets.find((m: any) => m.code === "BTC");
        return btc.units === "250000" && btc.quantity === "0.0025" && btc.valueUsd === "250.00";
      })());
      expect("markets state the quote time and the disclosure", typeof withPosition.json.quotedAt === "number" &&
        withPosition.json.quotedAt > 0 && /not FDIC insured/.test(withPosition.json.disclosure));
      expect("markets require a session (401)", (await api("GET", "/api/me/markets")).status === 401);

      // A dead feed must empty the table, not fill it with zero-priced coins.
      priceStatus = 500;
      resetPrices();
      await new Promise(r => setTimeout(r, 60));
      const noMarkets = await api("GET", "/api/me/markets", rae);
      expect("an unreachable feed yields no market rows, never $0 ones", noMarkets.status === 200 &&
        noMarkets.json.markets.length === 0);

      priceStatus = 200;
      priceBody = mkt({ bitcoin: 100000, ethereum: 4000, solana: 200, "usd-coin": 1 });
      resetPrices();
      await new Promise(r => setTimeout(r, 60));
      await api("POST", "/api/me/holdings/trade", rae, { asset: "BTC", side: "sell", amount: "0.0025" });

      /* ---- price history ---- */
      const candles = await api("GET", "/api/me/holdings/BTC/candles?range=7d", rae);
      expect("candles come back as integer cents, oldest first", candles.status === 200 &&
        candles.json.candles.length === 3 && candles.json.range === "7d" &&
        candles.json.candles[0].o === 9900000 && candles.json.candles[0].c === 10050000 &&
        candles.json.candles[2].t > candles.json.candles[0].t);
      expect("candles require a session (401)", (await api("GET", "/api/me/holdings/BTC/candles")).status === 401);
      expect("an unknown asset has no history (404)", (await api("GET", "/api/me/holdings/UNKNOWN/candles", rae)).status === 404);
      expect("an invalid range is a 400", (await api("GET", "/api/me/holdings/BTC/candles?range=all-time", rae)).status === 400);
      expect("every advertised range is accepted", (await Promise.all(
        ["1d", "7d", "30d", "90d"].map(r => api("GET", `/api/me/holdings/ETH/candles?range=${r}`, rae)),
      )).every(res => res.status === 200));

      // A malformed row must be dropped, not turned into a zero candle that
      // renders as a crash to the x-axis.
      ohlcBody = [
        [1_700_000_000_000, 50000, 51000, 49000, 50500],
        [1_700_003_600_000, "oops", null, 0, 0],
        [1_700_007_200_000, 50500, 52000, 50100, 51800],
      ];
      resetPrices();
      const partialCandles = await api("GET", "/api/me/holdings/SOL/candles?range=7d", rae);
      expect("malformed candle rows are dropped, never zeroed", partialCandles.status === 200 &&
        partialCandles.json.candles.length === 2 &&
        partialCandles.json.candles.every((c: any) => c.o > 0 && c.h > 0 && c.l > 0 && c.c > 0));

      // No history is a 503, never an empty array: an empty series draws a
      // flat line, and a flat line claims the asset did not move.
      ohlcStatus = 500;
      resetPrices();
      const deadHistory = await api("GET", "/api/me/holdings/USDC/candles?range=30d", rae);
      expect("an unreachable history feed is 503, not an empty series", deadHistory.status === 503 &&
        deadHistory.json.code === "crypto_no_history");
      ohlcStatus = 200;
      ohlcBody = [];
      resetPrices();
      expect("an empty history response is 503 too", (await api("GET", "/api/me/holdings/USDC/candles?range=30d", rae)).status === 503);

      /* the licensing interlock */
      process.env.CRYPTO_TRADING_ENABLED = "0";
      const locked = await api("POST", "/api/me/holdings/trade", rae, { asset: "BTC", side: "buy", amount: "50" });
      expect("trading off returns 503 with crypto_disabled", locked.status === 503 && locked.json.code === "crypto_disabled");
      expect("holdings stay readable when trading is off",
        (await api("GET", "/api/me/holdings", rae)).json.tradingEnabled === false);
    } finally {
      for (const key of Object.keys(process.env)) {
        if (restore[key] === undefined) delete process.env[key]; else process.env[key] = restore[key];
      }
      resetPrices();
      await new Promise<void>(r => priceStub.close(() => r()));
    }
  }

  /* ---------- admin aggregate state ---------- */
  const adminState = await api("GET", "/api/admin/state", admin);
  const as = adminState.json;
  expect("admin state aggregates the console", adminState.status === 200 &&
    as.users.length >= 6 && as.accounts.length >= 3 && as.transactions.length >= 15 &&
    Array.isArray(as.disputes) && Array.isArray(as.kycQueue) && Array.isArray(as.operationCases) &&
    as.operationCases.some((item: any) => item.id === opsCaseId) && as.audit.length > 0 &&
    as.roles.support.length > 0 && as.settings.payment_rails === "operational");
  const raeMirror = (await api("GET", "/api/me/state", rae)).json.account;
  expect("admin state mirrors member shapes", as.accounts.some((a: any) =>
    a.userId === raeId && a.balance === raeMirror.balance && a.cards === raeMirror.cards.length));
  const memberState = await api("GET", "/api/admin/state", rae);
  expect("admin state blocked for members (403)", memberState.status === 403);

  /* ---------- customer support ---------- */
  resetRateLimits();
  const emptyTickets = await api("GET", "/api/me/support", alex);
  expect("support: a member starts with their own (empty) ticket list", emptyTickets.status === 200 && Array.isArray(emptyTickets.json.tickets));
  expect("support: requires a session (401)", (await api("GET", "/api/me/support")).status === 401);
  const badTicket = await api("POST", "/api/me/support", alex, { subject: "x", message: "" });
  expect("support: rejects an empty ticket (400)", badTicket.status === 400);
  const opened = await api("POST", "/api/me/support", alex, { subject: "Card declined abroad", category: "Cards & ATMs", message: "My card was declined in Lagos." });
  const ticket = opened.json.ticket;
  expect("support: member opens a ticket with a reference", opened.status === 201 && /^VS-[0-9A-F]{8}$/.test(ticket.reference) &&
    ticket.status === "open" && ticket.messages.length === 1 && ticket.messages[0].author === "customer");
  expect("support: the member gets a confirmation email", recentMail.some(m => m.tag === "support-received" && m.subject.includes(ticket.reference)));
  expect("support: other members can't read or reply to it (404)",
    (await api("POST", `/api/me/support/${ticket.id}/messages`, rae, { message: "hi" })).status === 404 &&
    !(await api("GET", "/api/me/support", rae)).json.tickets.some((t: any) => t.id === ticket.id));
  const supportQueue = (await api("GET", "/api/admin/operations/cases", admin)).json.cases;
  const supportQueued = supportQueue.find((c: any) => c.id === ticket.id);
  expect("support: the ticket lands in the staff Operations queue with its thread",
    supportQueued?.kind === "support" && supportQueued.reference === ticket.reference && supportQueued.messages.length === 1);
  expect("support: members cannot use the staff reply route (403)",
    (await api("POST", `/api/admin/operations/cases/${ticket.id}/reply`, alex, { body: "spoofed" })).status === 403);
  const reply = await api("POST", `/api/admin/operations/cases/${ticket.id}/reply`, admin, { body: "We've lifted the block — please try again." });
  expect("support: staff reply moves the case to waiting", reply.status === 201 && reply.json.case.status === "waiting" && reply.json.case.messages.length === 2);
  expect("support: the staff reply is emailed to the member", recentMail.some(m => m.tag === "support-reply" && m.text.includes("lifted the block")));
  const seen = (await api("GET", "/api/me/support", alex)).json.tickets.find((t: any) => t.id === ticket.id);
  expect("support: the member sees the reply and an awaiting-you status", seen?.status === "awaiting_you" &&
    seen.messages[1].author === "staff" && seen.messages[1].authorName.endsWith("Veyra support"));
  const followUp = await api("POST", `/api/me/support/${ticket.id}/messages`, alex, { message: "Works now, thanks!" });
  expect("support: a member reply reopens the case for staff", followUp.status === 201 && followUp.json.ticket.status === "open");
  const contact = await api("POST", "/api/support/contact", undefined, { name: "Guest Visitor", email: "guest@example.com", topic: "Payments", message: "How do wires work?" });
  expect("support: the public form opens a case without a session", contact.status === 201 && /^VS-/.test(contact.json.reference));
  const guestCase = (await api("GET", "/api/admin/operations/cases", admin)).json.cases.find((c: any) => c.reference === contact.json.reference);
  expect("support: public cases keep the sender's contact details", guestCase?.contact?.email === "guest@example.com" && guestCase.messages.length === 1);
  const guestReply = await api("POST", `/api/admin/operations/cases/${guestCase.id}/reply`, admin, { body: "Wires arrive same day.", resolve: true });
  expect("support: staff can reply to a guest by email and resolve", guestReply.status === 201 && guestReply.json.case.status === "resolved" &&
    recentMail.some(m => m.to === "guest@example.com" && m.tag === "support-reply"));
  const sales = await api("POST", "/api/support/contact", undefined, { kind: "sales", name: "Ada Buyer", email: "ada@corp.example", company: "Corp", teamSize: "50–199", message: "We'd like a demo." });
  expect("support: sales enquiries are accepted", sales.status === 201);
  const bot = await api("POST", "/api/support/contact", undefined, { name: "Bot", email: "bot@spam.example", message: "Buy now!!", website: "http://spam" });
  expect("support: honeypot submissions are dropped silently", bot.status === 202 && !recentMail.some(m => m.to === "bot@spam.example"));
  expect("support: invalid public email rejected (400)",
    (await api("POST", "/api/support/contact", undefined, { name: "No Mail", email: "nope", message: "hello there" })).status === 400);

  console.log(failures === 0 ? `\nALL API INTEGRATION TESTS PASSED (${checks} checks)` : `\n${failures} OF ${checks} TEST(S) FAILED`);
} finally {
  server && await new Promise<void>(r => (server as any).close ? (server as any).close(() => r()) : r());
  // allow the event loop to drain
  setTimeout(() => process.exit(failures === 0 ? 0 : 1), 100);
}
