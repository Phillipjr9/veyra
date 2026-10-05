/**
 * Passkeys in the browser.
 *
 * Thin wrapper over the WebAuthn API: fetch a challenge, hand it to the
 * authenticator, post the result back. All verification happens server-side
 * in server/src/webauthn.ts — nothing here is trusted, and nothing here needs
 * to be, since a response that was not signed by a registered key simply
 * fails the check at the other end.
 *
 * The browser does two things for us that no amount of client code could:
 * it refuses to release a credential to the wrong origin, and it requires a
 * local user gesture (fingerprint, face, PIN) before signing. That is why a
 * passkey cannot be phished the way a password can.
 */
import { apiGet, apiPost, apiDelete } from "./api";

/* ---------- base64url <-> ArrayBuffer ---------- */

const toBuffer = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const toB64url = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/* ---------- capability ---------- */

/** Whether this browser can do WebAuthn at all. */
export const passkeySupported = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.PublicKeyCredential === "function" &&
  typeof navigator.credentials?.create === "function";

/**
 * Whether this device can *create* a passkey — i.e. it has a built-in
 * authenticator (Touch ID, Windows Hello, Android biometrics).
 *
 * Checked before offering to add one, because a desktop with no biometrics
 * and no security key would otherwise show a prompt it cannot satisfy. Sign-in
 * is never gated on this: a member may well be using a phone or a USB key.
 */
export async function passkeyRegistrationAvailable(): Promise<boolean> {
  if (!passkeySupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

/* ---------- shared types ---------- */

export type Passkey = {
  id: string;
  label: string;
  transports: string[];
  syncedToCloud: boolean;
  createdAt: number;
  lastUsedAt: number | null;
};

type RegistrationOptions = {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ type: "public-key"; alg: number }>;
  authenticatorSelection: AuthenticatorSelectionCriteria;
  attestation: AttestationConveyancePreference;
  timeout: number;
  excludeCredentials: Array<{ id: string; type: "public-key" }>;
};

type AuthenticationOptions = {
  challenge: string;
  rpId: string;
  userVerification: UserVerificationRequirement;
  timeout: number;
  allowCredentials: Array<{ id: string; type: "public-key" }>;
};

/**
 * Turns a DOMException from the authenticator into something a member can act
 * on. The browser's own messages are written for developers and frequently
 * say nothing at all (an empty `message` on a user cancellation is normal).
 */
export function passkeyErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name ?? "";
  switch (name) {
    case "NotAllowedError":
      // Also what you get on timeout, which is indistinguishable from a cancel.
      return "That was cancelled, or it timed out. Try again when you're ready.";
    case "InvalidStateError":
      return "This device already has a passkey for your Veyra account.";
    case "NotSupportedError":
      return "This device can't create a passkey Veyra accepts.";
    case "SecurityError":
      return "Passkeys need a secure connection (https) on a matching domain.";
    case "AbortError":
      return "That passkey request was interrupted. Try again.";
    default:
      return (err as Error)?.message || "Something went wrong talking to your device.";
  }
}

/** Thrown when the member backs out of the OS prompt — not worth an error toast. */
export const isPasskeyCancellation = (err: unknown): boolean =>
  (err as { name?: string })?.name === "NotAllowedError" || (err as { name?: string })?.name === "AbortError";

/* ---------- ceremonies ---------- */

/**
 * Creates a passkey on the member's device and registers it.
 *
 * Requires a signed-in session: a passkey is added to an account, never used
 * to open one. Opening a Veyra account needs the full application.
 */
export async function createPasskey(label: string): Promise<Passkey> {
  const options = await apiPost<RegistrationOptions>("/api/me/passkeys/challenge");

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: toBuffer(options.challenge) as BufferSource,
      rp: options.rp,
      user: {
        id: toBuffer(options.user.id) as BufferSource,
        name: options.user.name,
        displayName: options.user.displayName,
      },
      pubKeyCredParams: options.pubKeyCredParams,
      authenticatorSelection: options.authenticatorSelection,
      attestation: options.attestation,
      timeout: options.timeout,
      excludeCredentials: options.excludeCredentials.map(c => ({
        id: toBuffer(c.id) as BufferSource, type: c.type,
      })),
    },
  }) as PublicKeyCredential | null;
  if (!credential) throw new Error("Your device didn't return a passkey.");

  const response = credential.response as AuthenticatorAttestationResponse;
  const { passkey } = await apiPost<{ passkey: Passkey }>("/api/me/passkeys", {
    clientDataJSON: toB64url(response.clientDataJSON),
    attestationObject: toB64url(response.attestationObject),
    transports: typeof response.getTransports === "function" ? response.getTransports() : [],
    label,
  });
  return passkey;
}

/**
 * Signs in with a passkey.
 *
 * No email is collected first. The credential is discoverable, so the browser
 * already knows which passkeys it holds for this site and shows the member a
 * picker. Asking for an email would add a step and hand the server a way to
 * confirm which addresses have accounts.
 */
export async function signInWithPasskey(): Promise<{ token: string; user: unknown }> {
  const options = await apiPost<AuthenticationOptions>("/api/auth/passkey/challenge");

  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: toBuffer(options.challenge) as BufferSource,
      rpId: options.rpId,
      userVerification: options.userVerification,
      timeout: options.timeout,
      allowCredentials: options.allowCredentials.map(c => ({
        id: toBuffer(c.id) as BufferSource, type: c.type,
      })),
    },
  }) as PublicKeyCredential | null;
  if (!credential) throw new Error("Your device didn't return a passkey.");

  const response = credential.response as AuthenticatorAssertionResponse;
  return apiPost<{ token: string; user: unknown }>("/api/auth/passkey/login", {
    id: credential.id,
    clientDataJSON: toB64url(response.clientDataJSON),
    authenticatorData: toB64url(response.authenticatorData),
    signature: toB64url(response.signature),
  });
}

export const listPasskeys = () => apiGet<{ passkeys: Passkey[]; rpId: string }>("/api/me/passkeys");

export const deletePasskey = (id: string) =>
  apiDelete<{ ok: true }>(`/api/me/passkeys/${encodeURIComponent(id)}`);

/** A sensible default name, so most members never have to type one. */
export function suggestPasskeyLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android device";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Linux/.test(ua)) return "Linux device";
  return "This device";
}
