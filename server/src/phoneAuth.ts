/**
 * Phone verification by text message, proved through Firebase.
 *
 * Firebase is the credential step, exactly as for federated sign-in: the browser
 * sends a text-message code to the member's number, Firebase checks the code, and
 * the browser receives a Firebase ID token whose `phone_number` claim names the
 * number that was proved. This module decides what that token is worth:
 *
 *   1. The token must be a genuine, current Firebase token (signature, exp, iat,
 *      aud, iss, sub — see verifyFirebaseSignedToken in federated.ts).
 *   2. `firebase.sign_in_provider` must be "phone". A Google or Apple token proves
 *      an email, not a phone, and must never satisfy this check.
 *   3. The `phone_number` claim must equal the number stored on the account,
 *      normalised to E.164 on both sides. Proving some other number proves nothing.
 *   4. `auth_time` must be within PHONE_AUTH_MAX_AGE_SEC. A token minted by an old
 *      sign-in is not evidence that the person holding the phone is present now.
 *   5. A token is accepted once. Within its validity window, a captured token
 *      must not be replayable against a second request.
 *
 * Enforcement is switched on by FIREBASE_PROJECT_ID alone. Without it, nothing in
 * this module gates anything, so demo and seeded accounts keep working unchanged.
 */
import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { verifyFirebaseSignedToken } from "./federated.js";

/** A text-message proof older than this is refused. */
export const PHONE_AUTH_MAX_AGE_SEC = 300;
/** How long a used token's fingerprint is remembered. Longer than the freshness window. */
const REPLAY_MEMORY_MS = 15 * 60_000;

/** True when phone verification is required. Enforcement follows FIREBASE_PROJECT_ID. */
export function phoneVerificationEnforced(): boolean {
  return (process.env.FIREBASE_PROJECT_ID ?? "").trim() !== "";
}

/**
 * Normalises a phone number to E.164 (+15551234567). Accepts an explicit "+" prefix,
 * or a US/Canada number written without one (10 digits, or 11 starting with 1).
 * Returns null for anything that can't be texted.
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let e164: string;
  if (trimmed.startsWith("+")) {
    e164 = `+${trimmed.slice(1).replace(/\D/g, "")}`;
  } else {
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length === 10) e164 = `+1${digits}`;
    else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
    else return null;
  }
  return /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : null;
}

/** "+1 •••• 4567" — enough for a member to recognise their own number, never the whole thing. */
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 2)} •••• ${e164.slice(-4)}`;
}

type PhoneRow = { phone: string | null; phone_verified_number: string | null; phone_verified_at?: number | null };

/** The member's verified number, but only if it still matches the number on the account. */
export function isPhoneVerified(row: PhoneRow | undefined | null): boolean {
  if (!row) return false;
  const current = normalizePhone(row.phone ?? "");
  return current !== null && row.phone_verified_number === current;
}

export function phoneStatus(db: DatabaseSync, userId: string) {
  const row = db.prepare("SELECT phone, phone_verified_number, phone_verified_at FROM users WHERE id = ?")
    .get(userId) as PhoneRow | undefined;
  const e164 = normalizePhone(row?.phone ?? "");
  const verified = isPhoneVerified(row);
  return {
    enforced: phoneVerificationEnforced(),
    /** The stored number, normalised. The member is entitled to see their own. */
    phone: e164,
    maskedPhone: e164 ? maskPhone(e164) : null,
    /** False when the stored number can't receive a text (e.g. a half-typed number). */
    valid: e164 !== null,
    verified,
    verifiedAt: verified ? (row?.phone_verified_at ?? null) : null,
  };
}

const replayMemory = new Map<string, number>();

function rememberToken(fingerprint: string, nowMs: number): boolean {
  for (const [key, expiresAt] of replayMemory) {
    if (expiresAt <= nowMs) replayMemory.delete(key);
  }
  if (replayMemory.has(fingerprint)) return false;
  replayMemory.set(fingerprint, nowMs + REPLAY_MEMORY_MS);
  return true;
}

export type PhoneTokenResult =
  | { ok: true; phone: string }
  | { ok: false; status: number; code: string; error: string };

/**
 * Checks a Firebase ID token as proof of possession of `expectedE164`.
 * The caller supplies the number the account has on file, already normalised.
 */
export async function verifyPhoneToken(idToken: string, expectedE164: string): Promise<PhoneTokenResult> {
  const signed = await verifyFirebaseSignedToken(idToken);
  if (!signed.ok) {
    return { ok: false, status: signed.status, code: "phone_token_rejected", error: "That verification could not be checked. Request a new code and try again." };
  }
  const { payload } = signed;
  const firebase = (payload.firebase ?? {}) as { sign_in_provider?: unknown };
  if (firebase.sign_in_provider !== "phone") {
    return { ok: false, status: 403, code: "phone_provider_required", error: "Verify with the text-message code we send to your phone." };
  }

  const claimed = normalizePhone(typeof payload.phone_number === "string" ? payload.phone_number : "");
  if (!claimed || claimed !== expectedE164) {
    return { ok: false, status: 403, code: "phone_mismatch", error: "That code was sent to a different number than the one on your account." };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const authTime = typeof payload.auth_time === "number" ? payload.auth_time : null;
  if (authTime === null || nowSec - authTime > PHONE_AUTH_MAX_AGE_SEC) {
    return { ok: false, status: 401, code: "phone_auth_stale", error: "That code is too old. Request a new one." };
  }

  const fingerprint = createHash("sha256").update(idToken).digest("hex");
  if (!rememberToken(fingerprint, Date.now())) {
    return { ok: false, status: 401, code: "phone_token_reused", error: "That code has already been used. Request a new one." };
  }
  return { ok: true, phone: claimed };
}

/** Test seam: forgets replay state so a fresh run starts clean. */
export function resetPhoneReplayMemory(): void {
  replayMemory.clear();
}

/**
 * Route guard for money movement. Enforced only when FIREBASE_PROJECT_ID is set.
 * Must run after requireAuth.
 */
export function createRequirePhoneVerified(db: DatabaseSync): RequestHandler {
  return (req, res, next) => {
    if (!phoneVerificationEnforced()) return void next();
    const row = db.prepare("SELECT phone, phone_verified_number FROM users WHERE id = ?")
      .get(req.user!.id) as PhoneRow | undefined;
    if (isPhoneVerified(row)) return void next();
    res.status(403).json({
      error: "Verify your phone number before moving money. We'll text a code to the number on your account.",
      code: "phone_verification_required",
    });
  };
}
