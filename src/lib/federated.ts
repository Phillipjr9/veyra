/**
 * Google sign-in, via Firebase Authentication.
 *
 * Firebase is only the credential step. It proves who the person is and hands
 * back an ID token; `POST /api/auth/federated` verifies that token server-side
 * (server/src/federated.ts), maps it onto an existing member, and mints
 * Veyra's own session. The Veyra session token is what every later request
 * carries — Firebase's session is discarded immediately.
 *
 * ── Why the SDK is loaded on demand ─────────────────────────────────────────
 *
 * The production build is a single inlined HTML file (vite-plugin-singlefile),
 * so anything imported at module scope lands in every page load whether or not
 * the visitor ever clicks "Continue with Google". The dynamic `import()` below
 * keeps it out of the initial parse and out of the bundle for deployments that
 * never enable federated sign-in.
 *
 * Nothing here decides policy. A member with no Veyra account, an unverified
 * address, or a staff account gets the server's answer, not a guess made here.
 */
import { authConfig } from "./authConfig";

export type FederatedResult = { idToken: string; email: string };

/** Thrown when the member closes the Google window — not an error worth showing. */
export class FederatedCancelled extends Error {
  constructor() {
    super("Sign-in was cancelled.");
    this.name = "FederatedCancelled";
  }
}

/** True when the server has federated sign-in switched on. */
export async function federatedEnabled(): Promise<boolean> {
  return (await authConfig()).federated.enabled;
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

/**
 * Runs the Google popup flow and returns a fresh Firebase ID token.
 *
 * The Firebase session is signed out before returning: Veyra's own session is
 * the only one that should survive, and leaving a second logged-in identity in
 * browser storage would be a quiet way for a shared computer to leak one.
 */
export async function googleIdToken(): Promise<FederatedResult> {
  const config = (await authConfig()).federated;
  if (!config.enabled || !config.firebase) throw new Error("Google sign-in is not enabled.");

  const { app: appMod, auth: authMod } = await loadSdk();
  const app = appMod.getApps().length
    ? appMod.getApp()
    : appMod.initializeApp(config.firebase);
  const auth = authMod.getAuth(app);

  const provider = new authMod.GoogleAuthProvider();
  // Always show the chooser: on a shared machine, silently reusing the last
  // Google session is how someone signs in as the wrong person.
  provider.setCustomParameters({ prompt: "select_account" });

  try {
    const credential = await authMod.signInWithPopup(auth, provider);
    const idToken = await credential.user.getIdToken();
    return { idToken, email: credential.user.email ?? "" };
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request" || code === "auth/user-cancelled") {
      throw new FederatedCancelled();
    }
    if (code === "auth/popup-blocked") {
      throw new Error("Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.");
    }
    throw new Error("Google sign-in didn't complete. Try again, or sign in with your email and password.");
  } finally {
    // Discard Firebase's own session regardless of outcome.
    try {
      const auth2 = authMod.getAuth(app);
      if (auth2.currentUser) await authMod.signOut(auth2);
    } catch { /* nothing to clean up */ }
  }
}
