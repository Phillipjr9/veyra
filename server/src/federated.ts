/**
 * Federated sign-in: Firebase ID token verification and account linking.
 *
 * Firebase is an identity *provider* here, never the authority. The browser
 * runs the Google flow, receives a Firebase ID token, and posts it to
 * `POST /api/auth/federated`. This module proves the token is genuine, maps it
 * onto an existing Veyra member, and hands back control — the route then mints
 * Veyra's own session token.
 *
 * Everything downstream is unchanged: the `sessions` table still revokes
 * instantly, RBAC is still read fresh from the database on every request, and
 * `audit_log` still records what staff did. Nothing about the security model
 * moves to Google; only the credential check does.
 *
 * ── Verification ────────────────────────────────────────────────────────────
 *
 * A Firebase ID token is an RS256 JWT signed by Google. Verified here against
 * Google's published JWKS with node:crypto — no firebase-admin dependency, the
 * same way security.ts implements HS256 by hand. Every claim Firebase documents
 * is checked: alg, kid, signature, exp, iat, auth_time, aud, iss and sub.
 *
 * ── Linking policy (the part that matters) ──────────────────────────────────
 *
 *   1. `email_verified` must be true. An unverified address from any provider
 *      must never be able to claim an existing account — that is account
 *      takeover with extra steps.
 *   2. A known (provider, subject) pair signs in as the member it is linked to.
 *      The subject is stable; the email is not, so the subject is what is
 *      matched on after the first link.
 *   3. An unknown subject whose verified email matches an existing member links
 *      to it, once, and the member is notified.
 *   4. An unknown subject with no matching member is REFUSED. Opening a bank
 *      account requires a complete application — legal identity, tax ID,
 *      address, government ID (see identity.ts). Clicking "Continue with
 *      Google" cannot conjure one, so federated sign-in never auto-provisions.
 *   5. Staff and Super Admin accounts are excluded by default. The console can
 *      move $10M; letting a third-party IdP unlock it widens the blast radius
 *      to whoever controls that Google account. Set FEDERATED_ALLOW_STAFF=1 if
 *      your operators sign in through managed Workspace identities and you
 *      want that trade.
 *
 * Disabled unless FIREBASE_PROJECT_ID is set, so dev and CI run without it.
 */
import { createPublicKey, verify as cryptoVerify } from "node:crypto";

const GOOGLE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

export type FederatedConfig = {
  enabled: boolean;
  projectId: string;
  /** Public Firebase web config, handed to the browser so it can run the flow. */
  apiKey: string;
  authDomain: string;
  allowStaff: boolean;
  jwksUrl: string;
  timeoutMs: number;
  /** Tolerance for clock skew between this host and Google, in seconds. */
  leewaySec: number;
};

let cached: FederatedConfig | null = null;

export function federatedConfig(): FederatedConfig {
  if (cached) return cached;
  const projectId = (process.env.FIREBASE_PROJECT_ID ?? "").trim();
  cached = {
    enabled: Boolean(projectId),
    projectId,
    apiKey: (process.env.FIREBASE_API_KEY ?? "").trim(),
    authDomain: (process.env.FIREBASE_AUTH_DOMAIN ?? "").trim() || (projectId ? `${projectId}.firebaseapp.com` : ""),
    allowStaff: process.env.FEDERATED_ALLOW_STAFF === "1",
    jwksUrl: (process.env.FIREBASE_JWKS_URL ?? "").trim() || GOOGLE_JWKS_URL,
    timeoutMs: Number(process.env.FIREBASE_TIMEOUT_MS) || 4000,
    leewaySec: Number(process.env.FIREBASE_LEEWAY_SEC) || 60,
  };
  return cached;
}

/** Test helper: forces the next `federatedConfig()` to re-read the environment. */
export function resetFederatedConfig(): void {
  cached = null;
  jwks = { keys: new Map(), fetchedAt: 0, fetching: null };
}

/** The public half, safe to hand to a browser (the Firebase web config is public by design). */
export function publicFederatedConfig() {
  const config = federatedConfig();
  return {
    enabled: config.enabled,
    providers: config.enabled ? ["google"] : [],
    firebase: config.enabled
      ? { apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId }
      : null,
  };
}

/* ---------- JWKS cache ---------- */

type Jwks = { keys: Map<string, CryptoKeyLike>; fetchedAt: number; fetching: Promise<void> | null };
type CryptoKeyLike = ReturnType<typeof createPublicKey>;

let jwks: Jwks = { keys: new Map(), fetchedAt: 0, fetching: null };

/** Google rotates these keys; honour Cache-Control but never cache forever. */
const MAX_JWKS_AGE_MS = 6 * 60 * 60_000;
/** Floor between refetches, so an unknown `kid` cannot be used to hammer Google. */
const MIN_REFETCH_MS = 60_000;

async function loadJwks(force: boolean): Promise<void> {
  const config = federatedConfig();
  const age = Date.now() - jwks.fetchedAt;
  if (!force && jwks.keys.size && age < MAX_JWKS_AGE_MS) return;
  if (force && age < MIN_REFETCH_MS && jwks.keys.size) return;
  if (jwks.fetching) return jwks.fetching;

  jwks.fetching = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const res = await fetch(config.jwksUrl, { signal: controller.signal });
      if (!res.ok) throw new Error(`JWKS endpoint returned HTTP ${res.status}`);
      const body = (await res.json()) as { keys?: Array<Record<string, string>> };
      const keys = new Map<string, CryptoKeyLike>();
      for (const jwk of body.keys ?? []) {
        if (!jwk.kid || jwk.kty !== "RSA") continue;
        try { keys.set(jwk.kid, createPublicKey({ key: jwk as never, format: "jwk" })); } catch { /* skip malformed */ }
      }
      if (!keys.size) throw new Error("JWKS contained no usable RSA keys");
      jwks = { keys, fetchedAt: Date.now(), fetching: null };
    } finally {
      clearTimeout(timer);
      if (jwks.fetching) jwks.fetching = null;
    }
  })();
  return jwks.fetching;
}

/* ---------- token verification ---------- */

export type FederatedIdentity = {
  /** Firebase uid — stable, and what the link is keyed on. */
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
  provider: string;
};

export type VerifyResult =
  | { ok: true; identity: FederatedIdentity }
  | { ok: false; status: number; error: string; detail: string };

const bad = (detail: string, status = 401, error = "That sign-in could not be verified. Try again."): VerifyResult =>
  ({ ok: false, status, error, detail });

const decodeSegment = (segment: string): Record<string, unknown> | null => {
  try { return JSON.parse(Buffer.from(segment, "base64url").toString()) as Record<string, unknown>; }
  catch { return null; }
};

/**
 * Verifies a Firebase ID token against Google's JWKS and returns the identity
 * it asserts. Every check Firebase documents is applied; none are optional.
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<VerifyResult> {
  const config = federatedConfig();
  if (!config.enabled) return bad("federated sign-in is not configured", 503, "Google sign-in is not enabled.");
  if (!idToken || typeof idToken !== "string") return bad("no token supplied", 400);

  const parts = idToken.split(".");
  if (parts.length !== 3) return bad("token is not a three-part JWT", 400);
  const [headerB64, payloadB64, signatureB64] = parts;

  const header = decodeSegment(headerB64);
  const payload = decodeSegment(payloadB64);
  if (!header || !payload) return bad("token header or payload is not valid JSON", 400);

  // Algorithm is pinned: accepting "none", or an HMAC alg we would verify with
  // a public key, is the classic JWT forgery.
  if (header.alg !== "RS256") return bad(`unexpected alg "${String(header.alg)}" (only RS256 is accepted)`);
  const kid = typeof header.kid === "string" ? header.kid : "";
  if (!kid) return bad("token header carries no kid");

  // Signature first — nothing in the payload is trustworthy until it passes.
  let key: CryptoKeyLike | undefined;
  try {
    await loadJwks(false);
    key = jwks.keys.get(kid);
    if (!key) {
      // Unknown kid usually means Google rotated keys; refetch once (throttled).
      await loadJwks(true);
      key = jwks.keys.get(kid);
    }
  } catch (err) {
    return bad(`could not load Google's signing keys: ${err instanceof Error ? err.message : String(err)}`, 503,
      "We could not verify that sign-in right now. Try again in a moment.");
  }
  if (!key) return bad(`no published Google key matches kid "${kid}"`);

  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = Buffer.from(signatureB64, "base64url");
  if (!cryptoVerify("sha256", signingInput, key, signature)) return bad("signature does not verify");

  /* ---- claims (Firebase's documented requirements) ---- */
  const nowSec = Math.floor(Date.now() / 1000);
  const leeway = config.leewaySec;
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

  const exp = num(payload.exp);
  if (exp === null || exp + leeway < nowSec) return bad("token has expired");
  const iat = num(payload.iat);
  if (iat === null || iat - leeway > nowSec) return bad("token was issued in the future");
  const authTime = num(payload.auth_time);
  if (authTime !== null && authTime - leeway > nowSec) return bad("auth_time is in the future");

  if (payload.aud !== config.projectId) {
    return bad(`aud "${String(payload.aud)}" is not this project (${config.projectId})`);
  }
  const expectedIssuer = `https://securetoken.google.com/${config.projectId}`;
  if (payload.iss !== expectedIssuer) return bad(`iss "${String(payload.iss)}" is not ${expectedIssuer}`);

  const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!subject) return bad("token carries no subject (uid)");

  const firebase = (payload.firebase ?? {}) as { sign_in_provider?: unknown };
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";

  return {
    ok: true,
    identity: {
      subject,
      email,
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === "string" ? payload.name.trim() : "",
      provider: typeof firebase.sign_in_provider === "string" ? firebase.sign_in_provider : "unknown",
    },
  };
}

/** Boot-time summary, matching the reCAPTCHA banner. */
export function describeFederated(): string {
  const config = federatedConfig();
  if (!config.enabled) return "Federated sign-in: off (set FIREBASE_PROJECT_ID to enable Google sign-in)";
  return `Federated sign-in: google · project ${config.projectId} · ` +
    `${config.allowStaff ? "staff may link" : "members only (FEDERATED_ALLOW_STAFF=1 to widen)"}`;
}
