/**
 * Passkeys (WebAuthn): credential verification with `node:crypto` only.
 *
 * This is the one sign-in method with no third party in the trust path. A
 * passkey is a key pair the authenticator generates and keeps; the private key
 * never leaves it, and the signature it returns is bound to the origin that
 * asked for it. That binding is what makes passkeys phishing-resistant: a
 * lookalike domain cannot even ask for the right signature, so there is no
 * credential for a member to be tricked into handing over.
 *
 * Why hand-rolled rather than `@simplewebauthn/server`: the verification we
 * need is a signature check over two concatenated buffers plus a list of flag
 * and hash comparisons. The one genuinely fiddly part is CBOR, and only a
 * narrow slice of it — enough to read a COSE key. That is worth ~80 lines to
 * keep this dependency-free, the same trade already made in `federated.ts`.
 *
 * Veyra's member policy is deliberately `attestation: "none"`: people can use
 * the device in their hand, rather than only a company-issued authenticator.
 * The verifier enforces that policy — it accepts only the WebAuthn `none`
 * format with an empty statement and rejects any unexpected attestation object.
 * That is safer than silently ignoring a statement. A future hardware-only
 * policy needs a dedicated FIDO Metadata Service trust-chain verifier; do not
 * flip this into `direct` without adding that verifier.
 *
 * Environment:
 *   WEBAUTHN_RP_ID       Domain passkeys are bound to ("veyra.com"). No port,
 *                        no scheme. Must equal the site's domain or a parent.
 *   WEBAUTHN_ORIGINS     Comma list of full origins allowed to present one.
 *   WEBAUTHN_RP_NAME     Name shown in the OS prompt. Default "Veyra".
 */
import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";

/* ---------- base64url ---------- */

export const b64url = (buf: Buffer | Uint8Array): string => Buffer.from(buf).toString("base64url");
export const fromB64url = (s: string): Buffer => Buffer.from(s, "base64url");

/* ---------- configuration ---------- */

export type WebAuthnConfig = {
  rpId: string;
  rpName: string;
  /** Full origins (scheme + host + port) permitted to present a credential. */
  origins: string[];
};

let cached: WebAuthnConfig | null = null;

export function webauthnConfig(): WebAuthnConfig {
  if (cached) return cached;
  const origins = (process.env.WEBAUTHN_ORIGINS ?? "http://localhost:5173,http://localhost:8787")
    .split(",").map(o => o.trim().replace(/\/$/, "")).filter(Boolean);
  // The RP ID defaults to the first origin's hostname, which is right for every
  // single-domain deployment. Set it explicitly only to scope a passkey to a
  // parent domain (rp_id "veyra.com" for a credential used on app.veyra.com).
  let rpId = (process.env.WEBAUTHN_RP_ID ?? "").trim();
  if (!rpId) {
    try { rpId = new URL(origins[0] ?? "http://localhost").hostname; }
    catch { rpId = "localhost"; }
  }
  cached = { rpId, rpName: (process.env.WEBAUTHN_RP_NAME ?? "Veyra").trim() || "Veyra", origins };
  return cached;
}

/** Test helper: forces the next `webauthnConfig()` to re-read the environment. */
export function resetWebauthnConfig(): void {
  cached = null;
  challenges.clear();
}

export function describeWebauthn(): string {
  const c = webauthnConfig();
  return `Passkeys: on · rp ${c.rpId} · origins ${c.origins.join(", ")}`;
}

/* ---------- challenge store ---------- */

/**
 * Challenges live in memory with a short TTL and are consumed exactly once.
 *
 * In memory rather than in SQLite because a challenge is 60 seconds of
 * single-use noise, not a record: losing the set on restart costs an in-flight
 * member one retry, while a table would need its own sweeping. Single-use is
 * the part that matters — a replayed assertion finds nothing to match.
 *
 * (A multi-process deployment would need this shared. Veyra's API is one
 * process; if that changes, this is the thing to move to Redis.)
 */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const challenges = new Map<string, { purpose: "register" | "login"; userId: string; expires: number }>();

export function issueChallenge(purpose: "register" | "login", userId = ""): string {
  const nowMs = Date.now();
  if (challenges.size > 500) {
    for (const [key, held] of challenges) if (held.expires <= nowMs) challenges.delete(key);
  }
  const challenge = b64url(randomBytes(32));
  challenges.set(challenge, { purpose, userId, expires: nowMs + CHALLENGE_TTL_MS });
  return challenge;
}

function consumeChallenge(challenge: string, purpose: "register" | "login"): { ok: boolean; userId: string } {
  const held = challenges.get(challenge);
  if (!held) return { ok: false, userId: "" };
  challenges.delete(challenge); // single use, whatever happens next
  if (held.purpose !== purpose || held.expires <= Date.now()) return { ok: false, userId: "" };
  return { ok: true, userId: held.userId };
}

/* ---------- minimal CBOR ---------- */

type Cbor = number | string | Buffer | Cbor[] | Map<number | string, Cbor> | boolean | null;

/**
 * Decodes the CTAP2 canonical subset: definite-length integers, byte strings,
 * text strings, arrays, maps and simple values. Indefinite lengths and
 * bignums are rejected rather than guessed at — an authenticator that emits
 * them is not speaking the profile WebAuthn requires.
 */
function cborDecode(buf: Buffer, offset: number): { value: Cbor; next: number } {
  if (offset >= buf.length) throw new Error("CBOR ended early");
  const first = buf[offset];
  const major = first >> 5;
  const minor = first & 0x1f;
  let pos = offset + 1;

  let length = minor;
  if (minor === 24) { length = buf.readUInt8(pos); pos += 1; }
  else if (minor === 25) { length = buf.readUInt16BE(pos); pos += 2; }
  else if (minor === 26) { length = buf.readUInt32BE(pos); pos += 4; }
  else if (minor === 27) {
    const big = buf.readBigUInt64BE(pos); pos += 8;
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("CBOR integer too large");
    length = Number(big);
  } else if (minor > 27) throw new Error(`CBOR indefinite or reserved length (${minor})`);

  switch (major) {
    case 0: return { value: length, next: pos };
    case 1: return { value: -1 - length, next: pos };
    case 2: {
      if (pos + length > buf.length) throw new Error("CBOR byte string overruns");
      return { value: buf.subarray(pos, pos + length), next: pos + length };
    }
    case 3: {
      if (pos + length > buf.length) throw new Error("CBOR text string overruns");
      return { value: buf.subarray(pos, pos + length).toString("utf8"), next: pos + length };
    }
    case 4: {
      const items: Cbor[] = [];
      for (let i = 0; i < length; i++) {
        const item = cborDecode(buf, pos);
        items.push(item.value); pos = item.next;
      }
      return { value: items, next: pos };
    }
    case 5: {
      const map = new Map<number | string, Cbor>();
      for (let i = 0; i < length; i++) {
        const key = cborDecode(buf, pos); pos = key.next;
        const val = cborDecode(buf, pos); pos = val.next;
        if (typeof key.value !== "number" && typeof key.value !== "string") {
          throw new Error("CBOR map key is not an integer or string");
        }
        map.set(key.value, val.value);
      }
      return { value: map, next: pos };
    }
    case 6: return cborDecode(buf, pos); // tag: ignore, decode the content
    case 7:
      if (minor === 20) return { value: false, next: pos };
      if (minor === 21) return { value: true, next: pos };
      if (minor === 22) return { value: null, next: pos };
      throw new Error(`CBOR simple value ${minor} is not supported`);
    default: throw new Error(`CBOR major type ${major} is not supported`);
  }
}

/* ---------- COSE keys ---------- */

/** The algorithms we accept, by COSE identifier. */
const ES256 = -7, EDDSA = -8, RS256 = -257;
export const SUPPORTED_ALGS = [ES256, RS256, EDDSA] as const;

type Jwk = Record<string, string>;

/**
 * Converts a COSE_Key into a JWK, which `createPublicKey` consumes directly —
 * the same shortcut `federated.ts` takes with Google's JWKS, and the reason no
 * DER/SPKI assembly is needed here.
 */
function coseToJwk(cose: Map<number | string, Cbor>): { jwk: Jwk; alg: number } {
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (typeof alg !== "number") throw new Error("COSE key has no algorithm");
  if (!SUPPORTED_ALGS.includes(alg as typeof SUPPORTED_ALGS[number])) {
    throw new Error(`COSE algorithm ${alg} is not supported`);
  }

  if (kty === 2) { // EC2
    const crv = cose.get(-1), x = cose.get(-2), y = cose.get(-3);
    if (crv !== 1) throw new Error(`EC curve ${String(crv)} is not P-256`);
    if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y)) throw new Error("EC key is missing a coordinate");
    if (alg !== ES256) throw new Error("EC key algorithm must be ES256");
    return { jwk: { kty: "EC", crv: "P-256", x: b64url(x), y: b64url(y) }, alg };
  }
  if (kty === 3) { // RSA
    const n = cose.get(-1), e = cose.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e)) throw new Error("RSA key is missing a parameter");
    if (alg !== RS256) throw new Error("RSA key algorithm must be RS256");
    if (n.length < 256) throw new Error("RSA modulus is shorter than 2048 bits");
    return { jwk: { kty: "RSA", n: b64url(n), e: b64url(e) }, alg };
  }
  if (kty === 1) { // OKP (Ed25519)
    const crv = cose.get(-1), x = cose.get(-2);
    if (crv !== 6) throw new Error(`OKP curve ${String(crv)} is not Ed25519`);
    if (!Buffer.isBuffer(x)) throw new Error("OKP key is missing its coordinate");
    if (alg !== EDDSA) throw new Error("OKP key algorithm must be EdDSA");
    return { jwk: { kty: "OKP", crv: "Ed25519", x: b64url(x) }, alg };
  }
  throw new Error(`COSE key type ${String(kty)} is not supported`);
}

/* ---------- authenticator data ---------- */

export type AuthData = {
  rpIdHash: Buffer;
  userPresent: boolean;
  userVerified: boolean;
  /** Backup eligible / backed up: whether this passkey syncs between devices. */
  backupEligible: boolean;
  backedUp: boolean;
  signCount: number;
  credentialId: Buffer | null;
  aaguid: string;
  cose: Map<number | string, Cbor> | null;
};

/**
 * authData is a packed binary record, not CBOR (though it may end with a CBOR
 * key): 32-byte RP ID hash, flag byte, 4-byte counter, then optional attested
 * credential data and extensions.
 */
function parseAuthData(buf: Buffer): AuthData {
  if (buf.length < 37) throw new Error("authenticator data is too short");
  const flags = buf[32];
  const out: AuthData = {
    rpIdHash: buf.subarray(0, 32),
    userPresent: (flags & 0x01) !== 0,
    userVerified: (flags & 0x04) !== 0,
    backupEligible: (flags & 0x08) !== 0,
    backedUp: (flags & 0x10) !== 0,
    signCount: buf.readUInt32BE(33),
    credentialId: null,
    aaguid: "",
    cose: null,
  };
  const attested = (flags & 0x40) !== 0;
  if (!attested) return out;

  if (buf.length < 55) throw new Error("attested credential data is truncated");
  out.aaguid = buf.subarray(37, 53).toString("hex");
  const idLength = buf.readUInt16BE(53);
  // The spec caps credential IDs at 1023 bytes; anything longer is malformed.
  if (idLength > 1023 || 55 + idLength > buf.length) throw new Error("credential id length is invalid");
  out.credentialId = buf.subarray(55, 55 + idLength);
  const decoded = cborDecode(buf, 55 + idLength);
  if (!(decoded.value instanceof Map)) throw new Error("credential public key is not a COSE map");
  out.cose = decoded.value;
  return out;
}

/* ---------- client data ---------- */

type Verdict<T> = { ok: true; value: T } | { ok: false; status: number; error: string; detail: string };

const fail = (detail: string, status = 400, error = "That passkey could not be verified. Try again."):
  { ok: false; status: number; error: string; detail: string } => ({ ok: false, status, error, detail });

/**
 * The origin check is the whole phishing defence. A credential created for
 * veyra.com produces signatures whose clientDataJSON names veyra.com, so an
 * assertion collected by a lookalike site names the lookalike and dies here.
 */
function checkClientData(raw: Buffer, expectedType: string, purpose: "register" | "login"):
  Verdict<{ userId: string }> {
  let parsed: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try { parsed = JSON.parse(raw.toString("utf8")); }
  catch { return fail("clientDataJSON is not valid JSON"); }

  if (parsed.type !== expectedType) return fail(`clientData.type is "${String(parsed.type)}", expected "${expectedType}"`);
  if (parsed.crossOrigin === true) return fail("credential was presented from a cross-origin frame");

  const origin = typeof parsed.origin === "string" ? parsed.origin.replace(/\/$/, "") : "";
  const { origins } = webauthnConfig();
  if (!origins.includes(origin)) return fail(`origin "${origin}" is not in WEBAUTHN_ORIGINS`);

  const challenge = typeof parsed.challenge === "string" ? parsed.challenge : "";
  const held = consumeChallenge(challenge, purpose);
  if (!held.ok) return fail("challenge is unknown, already used, or expired");
  return { ok: true, value: { userId: held.userId } };
}

function rpIdMatches(hash: Buffer): boolean {
  const expected = createHash("sha256").update(webauthnConfig().rpId).digest();
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

/* ---------- registration ---------- */

export type RegistrationResult = {
  credentialId: string;
  publicKeyJwk: string;
  alg: number;
  signCount: number;
  aaguid: string;
  backedUp: boolean;
  /** The session that asked for the challenge — never taken from the request. */
  userId: string;
};

/**
 * Verifies a `navigator.credentials.create()` response.
 *
 * The member is already signed in when this runs: a passkey is added to an
 * account, never used to conjure one. That mirrors the federated rule — opening
 * a Veyra account requires the full application, and no credential ceremony
 * shortcuts it.
 */
export function verifyRegistration(input: {
  clientDataJSON: string;
  attestationObject: string;
}): Verdict<RegistrationResult> {
  let clientDataRaw: Buffer, attestationRaw: Buffer;
  try {
    clientDataRaw = fromB64url(input.clientDataJSON);
    attestationRaw = fromB64url(input.attestationObject);
  } catch { return fail("registration payload is not valid base64url"); }
  if (!clientDataRaw.length || !attestationRaw.length) return fail("registration payload is incomplete");

  const client = checkClientData(clientDataRaw, "webauthn.create", "register");
  if (!client.ok) return client;

  let authData: AuthData;
  try {
    const decoded = cborDecode(attestationRaw, 0);
    if (!(decoded.value instanceof Map)) throw new Error("attestationObject is not a CBOR map");
    const fmt = decoded.value.get("fmt");
    const statement = decoded.value.get("attStmt");
    // registrationOptions() requests `none`. Do not accept a different format
    // and accidentally claim it was verified — attestation trust chains need
    // FIDO metadata and explicit roots, which this product does not yet use.
    if (fmt !== "none") throw new Error("attestation format is not permitted by this passkey policy");
    if (!(statement instanceof Map) || statement.size !== 0) throw new Error("none attestation must carry an empty statement");
    const raw = decoded.value.get("authData");
    if (!Buffer.isBuffer(raw)) throw new Error("attestationObject has no authData");
    authData = parseAuthData(raw);
  } catch (err) {
    return fail(`attestation object rejected — ${(err as Error).message}`);
  }

  if (!rpIdMatches(authData.rpIdHash)) return fail("rpIdHash does not match this site");
  if (!authData.userPresent) return fail("authenticator did not report user presence");
  // Veyra requires user verification, so the passkey is two factors in one
  // gesture: the device (something you have) plus the biometric or PIN that
  // unlocked it (something you are / know). Without this a passkey is only the
  // device, which is a weaker credential than the password it replaces.
  if (!authData.userVerified) {
    return fail("authenticator did not verify the user", 400,
      "Your device didn't confirm it was you. Set up a fingerprint, face unlock or a device PIN, then try again.");
  }
  if (!authData.credentialId || !authData.cose) return fail("registration carried no credential");

  let key: { jwk: Jwk; alg: number };
  try { key = coseToJwk(authData.cose); }
  catch (err) { return fail(`credential key rejected — ${(err as Error).message}`); }

  // Prove the key is loadable now, not at first sign-in.
  try { createPublicKey({ key: key.jwk as never, format: "jwk" }); }
  catch { return fail("credential public key is not usable"); }

  return {
    ok: true,
    value: {
      credentialId: b64url(authData.credentialId),
      publicKeyJwk: JSON.stringify(key.jwk),
      alg: key.alg,
      signCount: authData.signCount,
      aaguid: authData.aaguid,
      backedUp: authData.backedUp,
      userId: client.value.userId,
    },
  };
}

/* ---------- authentication ---------- */

export type StoredCredential = {
  credentialId: string;
  publicKeyJwk: string;
  alg: number;
  signCount: number;
};

export type AuthenticationResult = { signCount: number; clonedWarning: boolean; backedUp: boolean };

/**
 * Verifies a `navigator.credentials.get()` response against a stored key.
 *
 * The signature covers `authenticatorData || sha256(clientDataJSON)` — so the
 * challenge, the origin and the authenticator's own flags are all inside what
 * was signed, and none of them can be edited in transit.
 */
export function verifyAuthentication(input: {
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  credential: StoredCredential;
}): Verdict<AuthenticationResult> {
  let clientDataRaw: Buffer, authDataRaw: Buffer, signature: Buffer;
  try {
    clientDataRaw = fromB64url(input.clientDataJSON);
    authDataRaw = fromB64url(input.authenticatorData);
    signature = fromB64url(input.signature);
  } catch { return fail("assertion payload is not valid base64url"); }
  if (!clientDataRaw.length || !authDataRaw.length || !signature.length) {
    return fail("assertion payload is incomplete");
  }

  const client = checkClientData(clientDataRaw, "webauthn.get", "login");
  if (!client.ok) return client;

  let authData: AuthData;
  try { authData = parseAuthData(authDataRaw); }
  catch (err) { return fail(`authenticator data rejected — ${(err as Error).message}`); }

  if (!rpIdMatches(authData.rpIdHash)) return fail("rpIdHash does not match this site");
  if (!authData.userPresent) return fail("authenticator did not report user presence");
  if (!authData.userVerified) {
    return fail("authenticator did not verify the user", 403,
      "Your device didn't confirm it was you. Unlock it with a fingerprint, face or PIN and try again.");
  }

  let key: KeyObject;
  try { key = createPublicKey({ key: JSON.parse(input.credential.publicKeyJwk) as never, format: "jwk" }); }
  catch { return fail("stored credential key could not be loaded", 500); }

  const signed = Buffer.concat([authDataRaw, createHash("sha256").update(clientDataRaw).digest()]);
  // Ed25519 signs the message itself; ECDSA and RSA sign a SHA-256 digest.
  const digest = input.credential.alg === EDDSA ? null : "sha256";
  let valid = false;
  try { valid = cryptoVerify(digest, signed, key, signature); }
  catch { valid = false; }
  if (!valid) return fail("signature does not verify", 401);

  // A counter that fails to advance suggests a copied authenticator. Synced
  // passkeys legitimately report 0 forever, so this only means something when
  // both numbers are non-zero — flagged rather than fatal, because a false
  // positive would lock a member out of their own account.
  const stored = input.credential.signCount;
  const cloned = stored > 0 && authData.signCount > 0 && authData.signCount <= stored;

  return {
    ok: true,
    value: { signCount: authData.signCount, clonedWarning: cloned, backedUp: authData.backedUp },
  };
}

/* ---------- ceremony options ---------- */

/** Options for `navigator.credentials.create()`, minus the challenge. */
export function registrationOptions(user: { id: string; email: string; name: string }, exclude: string[]) {
  const config = webauthnConfig();
  return {
    rp: { id: config.rpId, name: config.rpName },
    // The user handle is Veyra's own id, never the email: it ends up stored on
    // the authenticator, and an email can change.
    user: { id: b64url(Buffer.from(user.id, "utf8")), name: user.email, displayName: user.name || user.email },
    pubKeyCredParams: SUPPORTED_ALGS.map(alg => ({ type: "public-key" as const, alg })),
    authenticatorSelection: {
      residentKey: "required" as const,      // discoverable: sign in without typing an email
      requireResidentKey: true,
      userVerification: "required" as const, // see the UV note in verifyRegistration
    },
    attestation: "none" as const,
    timeout: 120_000,
    // Stops a member registering the same authenticator twice and wondering
    // why they have two identical entries.
    excludeCredentials: exclude.map(id => ({ id, type: "public-key" as const })),
  };
}

/** Options for `navigator.credentials.get()`, minus the challenge. */
export function authenticationOptions() {
  const config = webauthnConfig();
  return {
    rpId: config.rpId,
    userVerification: "required" as const,
    timeout: 120_000,
    // Deliberately no allowCredentials: the browser offers whichever passkeys
    // it holds for this site. Naming them would mean answering "which passkeys
    // does this email have?" to anyone who asks, which is account enumeration.
    allowCredentials: [] as Array<{ id: string; type: "public-key" }>,
  };
}
