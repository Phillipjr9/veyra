/**
 * Phone verification in the browser.
 *
 * Firebase sends the six-digit text and checks it. What comes back is a Firebase
 * ID token whose `phone_number` claim names the number that was proved. That token
 * goes to the server, which decides whether it proves the number on the account
 * (see server/src/phoneAuth.ts). Nothing here decides policy.
 *
 * Firebase's own session is discarded as soon as the token is in hand, as in
 * federated.ts: Veyra's session is the only one that should survive.
 *
 * Like the federated SDK, Firebase is loaded on demand so the single-file bundle
 * stays light for deployments that never enable phone verification.
 */
import { apiGet, apiPost } from "./api";
import { authConfig } from "./authConfig";

export type PhoneStatus = {
  /** False when FIREBASE_PROJECT_ID is unset: nothing is gated and nothing needs proving. */
  enforced: boolean;
  /** The stored number in E.164, or null if the profile has none. */
  phone: string | null;
  maskedPhone: string | null;
  /** False when the stored number can't receive a text. */
  valid: boolean;
  verified: boolean;
  verifiedAt: number | null;
};

export type SmsFallback = {
  twoFactorRequired: true;
  challengeId: string;
  method: "sms";
  phone: string;
  maskedPhone: string;
  expiresIn: number;
};

export const fetchPhoneStatus = () => apiGet<PhoneStatus>("/api/me/phone");

export const submitPhoneProof = (idToken: string) =>
  apiPost<PhoneStatus>("/api/me/phone/verify", { idToken });

/** Authenticator user asks for a text instead, on a challenge the password already unlocked. */
export const requestSmsFallback = (challengeId: string) =>
  apiPost<SmsFallback>("/api/auth/login/sms-fallback", { challengeId });

/** Raised for anything the member should read: a wrong code, an expired one, a blocked number. */
export class PhoneCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhoneCodeError";
  }
}

type FirebaseAuthModule = typeof import("firebase/auth");
type FirebaseAppModule = typeof import("firebase/app");

let sdk: Promise<{ app: FirebaseAppModule; auth: FirebaseAuthModule }> | null = null;

function loadSdk() {
  if (!sdk) {
    sdk = Promise.all([import("firebase/app"), import("firebase/auth")])
      .then(([app, auth]) => ({ app, auth }))
      .catch(err => { sdk = null; throw err; });
  }
  return sdk;
}

const SEND_ERRORS: Record<string, string> = {
  "auth/invalid-phone-number": "That number can't receive texts. Check it in your profile.",
  "auth/missing-phone-number": "Add a phone number before asking for a code.",
  "auth/too-many-requests": "Too many texts were requested. Wait a few minutes, then try again.",
  "auth/quota-exceeded": "Text messages are paused right now. Try again later.",
  "auth/operation-not-allowed": "Text-message sign-in isn't turned on for this site yet.",
  "auth/captcha-check-failed": "The security check didn't complete. Refresh the page and try again.",
};

const CHECK_ERRORS: Record<string, string> = {
  "auth/invalid-verification-code": "That code didn't match. Check the text and try again.",
  "auth/code-expired": "That code has expired. Send a new one.",
  "auth/session-expired": "That code has expired. Send a new one.",
  "auth/too-many-requests": "Too many wrong codes. Wait a few minutes, then send a new one.",
};

const codeOf = (err: unknown) => (err as { code?: string })?.code ?? "";

/**
 * Texts a code to `e164`. Returns a handle: `confirm(code)` checks the code and
 * resolves to a Firebase ID token; `dispose()` releases the reCAPTCHA widget.
 * `containerId` is the id of an empty element the invisible reCAPTCHA renders into.
 */
export async function sendPhoneCode(e164: string, containerId: string) {
  const config = (await authConfig()).federated;
  if (!config.enabled || !config.firebase) throw new PhoneCodeError("Text-message verification isn't available right now.");

  const { app: appMod, auth: authMod } = await loadSdk();
  const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(config.firebase);
  const auth = authMod.getAuth(app);
  const verifier = new authMod.RecaptchaVerifier(auth, containerId, { size: "invisible" });

  let confirmation: Awaited<ReturnType<typeof authMod.signInWithPhoneNumber>>;
  try {
    confirmation = await authMod.signInWithPhoneNumber(auth, e164, verifier);
  } catch (err) {
    verifier.clear();
    throw new PhoneCodeError(SEND_ERRORS[codeOf(err)] ?? "We couldn't send that code. Try again.");
  }

  return {
    async confirm(code: string): Promise<string> {
      let idToken: string;
      try {
        const credential = await confirmation.confirm(code.trim());
        idToken = await credential.user.getIdToken();
      } catch (err) {
        // A wrong code leaves the confirmation usable, so the member can retype it.
        throw new PhoneCodeError(CHECK_ERRORS[codeOf(err)] ?? "That code didn't work. Try again.");
      }
      // The Firebase session has done its job; Veyra's session is the only one kept.
      await authMod.signOut(auth).catch(() => undefined);
      return idToken;
    },
    dispose() { verifier.clear(); },
  };
}
