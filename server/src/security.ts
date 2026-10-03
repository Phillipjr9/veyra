/**
 * Security primitives: password hashing (scrypt), JWT-shaped bearer tokens
 * (HMAC-SHA256, implemented on node:crypto — no dependencies), and session
 * records so tokens can be revoked.
 *
 * Secrets: TOKEN_SECRET must come from the environment in production. In
 * development a fixed dev secret is used so tokens survive restarts, with a
 * loud warning.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const DEV_SECRET = "veyra-dev-secret-do-not-use-in-production";

export const TOKEN_SECRET = process.env.TOKEN_SECRET ?? DEV_SECRET;
export const IS_DEV_SECRET = TOKEN_SECRET === DEV_SECRET;

/* ---------- passwords (scrypt: memory-hard, built into Node) ---------- */

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `s2$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "s2" || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(hashB64, "base64url");
  const actual = scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/* ---------- tokens (header.payload.signature, HS256) ---------- */

const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");

export type TokenPayload = {
  sub: string;        // user id
  jti: string;        // session id
  role: string;
  iat: number;
  exp: number;
};

export function signToken(payload: Omit<TokenPayload, "iat" | "exp">): string {
  const header = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ ...payload, iat: Date.now(), exp: Date.now() + TOKEN_TTL_MS });
  const signature = createHmac("sha256", TOKEN_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = createHmac("sha256", TOKEN_SECRET).update(`${header}.${body}`).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenPayload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ---------- tiny in-memory rate limiter (login endpoint) ---------- */

const attempts = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit = 8, windowMs = 60_000): boolean {
  const entry = attempts.get(key);
  const t = Date.now();
  if (!entry || entry.resetAt < t) {
    attempts.set(key, { count: 1, resetAt: t + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}
