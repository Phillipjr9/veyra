/**
 * TOTP support for authenticator-app sign-in verification (RFC 6238 / RFC 4226).
 * Secrets are encrypted at rest with a separately rotatable encryption secret;
 * TOKEN_SECRET remains a backwards-compatible fallback for installations that
 * predate TOTP_ENCRYPTION_KEY. The setup secret is only returned once, while
 * the account holder is enrolling it.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { TOKEN_SECRET, TOKEN_SECRET_PREVIOUS } from "./security.js";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_ENCRYPTION_SECRET = process.env.TOTP_ENCRYPTION_KEY ?? TOKEN_SECRET;
const previousEncryptionSecrets = (process.env.TOTP_ENCRYPTION_KEY_PREVIOUS ?? "")
  .split(",").map(secret => secret.trim()).filter(Boolean);
// Include the historic token-derived key when moving to a dedicated TOTP key.
const decryptionSecrets = [...new Set([TOTP_ENCRYPTION_SECRET, ...previousEncryptionSecrets, TOKEN_SECRET, ...TOKEN_SECRET_PREVIOUS])];
const keyFor = (secret: string) => createHash("sha256").update(`veyra:totp:v1:${secret}`).digest();
const SECRET_KEY = keyFor(TOTP_ENCRYPTION_SECRET);
const STEP_MS = 30_000;
const CODE_DIGITS = 6;

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECOVERY_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/;

/** Ten high-entropy, human-readable one-time codes; show them only once. */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(12);
    const code = Array.from(bytes, byte => RECOVERY_ALPHABET[byte & 31]).join("");
    return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
  });
}

/** Canonicalize a displayed recovery code, rejecting lookalike/invalid characters. */
export function normalizeRecoveryCode(candidate: unknown): string | null {
  if (typeof candidate !== "string") return null;
  const code = candidate.toUpperCase().replace(/[\s-]/g, "");
  return RECOVERY_CODE_RE.test(code) ? code : null;
}

/** SHA-256 is suitable here because recovery codes are random 60-bit secrets. */
export function hashRecoveryCode(candidate: unknown): string | null {
  const code = normalizeRecoveryCode(candidate);
  if (!code) return null;
  return createHash("sha256").update(`veyra:recovery:v1:${code}`).digest("hex");
}

export function encodeBase32(bytes: Uint8Array): string {
  let buffer = 0;
  let bits = 0;
  let out = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
  return out;
}

export function decodeBase32(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let buffer = 0;
  let bits = 0;
  const out: number[] = [];
  for (const char of clean) {
    const value = BASE32.indexOf(char);
    if (value < 0) throw new Error("Invalid authenticator secret.");
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
    buffer &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}

export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", SECRET_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptTotpSecret(encrypted: string): string {
  const [version, ivText, tagText, dataText] = encrypted.split(".");
  if (version !== "v1" || !ivText || !tagText || !dataText) throw new Error("Authenticator secret is unavailable.");
  const iv = Buffer.from(ivText, "base64url"), tag = Buffer.from(tagText, "base64url"), data = Buffer.from(dataText, "base64url");
  for (const secret of decryptionSecrets) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    } catch { /* Try the narrowly bounded previous-key grace list. */ }
  }
  throw new Error("Authenticator secret is unavailable.");
}

/** Testable TOTP generator; callers must never return this value to a client. */
export function totpCode(secret: string, at = Date.now()): string {
  const counter = BigInt(Math.floor(at / STEP_MS));
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", decodeBase32(secret)).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String((binary >>> 0) % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, "0");
}

/** Accept the previous/current/next 30-second code to tolerate clock skew. */
export function verifyTotp(secret: string, candidate: unknown, at = Date.now()): boolean {
  if (typeof candidate !== "string" || !/^\d{6}$/.test(candidate)) return false;
  const supplied = Buffer.from(candidate, "ascii");
  for (const offset of [-1, 0, 1]) {
    const expected = Buffer.from(totpCode(secret, at + offset * STEP_MS), "ascii");
    if (timingSafeEqual(expected, supplied)) return true;
  }
  return false;
}

export function authenticatorUri(secret: string, email: string): string {
  const label = `Veyra:${email}`;
  const query = new URLSearchParams({ secret, issuer: "Veyra", algorithm: "SHA1", digits: String(CODE_DIGITS), period: String(STEP_MS / 1000) });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}
