/**
 * reCAPTCHA token minting for the three anonymous auth flows.
 *
 * The server is the enforcer (server/src/recaptcha.ts); this module's only job
 * is to hand it a fresh token. Everything here degrades to `null` rather than
 * throwing, because a browser that cannot reach Google — an ad blocker, a
 * strict extension, a corporate proxy, an offline laptop — must still be able
 * to *attempt* sign-in and get the server's answer, instead of being stopped
 * by a script that never loaded.
 *
 * Whether a missing token is fatal is therefore decided in exactly one place:
 * the API. The client never pre-emptively blocks the member.
 *
 * Configuration is fetched from `GET /api/auth/config` rather than baked in at
 * build time, so enabling reCAPTCHA does not require rebuilding the frontend
 * and a cached bundle can never disagree with the server about whether tokens
 * are required.
 */

import { authConfig, AUTH_CONFIG_OFF, type AuthConfig, type RecaptchaActionKey } from "./authConfig";

export type { RecaptchaActionKey };

type RecaptchaConfig = AuthConfig["recaptcha"];

/** `grecaptcha.execute` occasionally never settles; sign-in must not hang on it. */
const EXECUTE_TIMEOUT_MS = 8000;
const SCRIPT_TIMEOUT_MS = 8000;

type Grecaptcha = {
  ready: (cb: () => void) => void;
  execute: (siteKey: string, options: { action: string }) => Promise<string>;
};

declare global {
  interface Window {
    grecaptcha?: Grecaptcha & { enterprise?: Grecaptcha };
  }
}

/** Resolves `value` or `null` if it takes longer than `ms` — never rejects. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

/** The reCAPTCHA slice of the shared auth configuration. */
const recaptchaConfig = async (): Promise<RecaptchaConfig> => (await authConfig()).recaptcha;

/* ---------- script loading ---------- */

let scriptPromise: Promise<Grecaptcha | null> | null = null;

function loadScript(config: RecaptchaConfig): Promise<Grecaptcha | null> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<Grecaptcha | null>(resolve => {
    const enterprise = config.provider === "enterprise";
    const src = `https://www.google.com/recaptcha/${enterprise ? "enterprise" : "api"}.js?render=${encodeURIComponent(config.siteKey)}`;
    const pick = () => (enterprise ? window.grecaptcha?.enterprise : window.grecaptcha) ?? null;

    if (pick()) return resolve(pick());

    const existing = document.querySelector<HTMLScriptElement>(`script[data-veyra-recaptcha]`);
    const script = existing ?? document.createElement("script");
    const settle = () => {
      const api = pick();
      if (!api) return resolve(null);
      // `ready` fires once the library has finished initialising.
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(api); } };
      setTimeout(finish, SCRIPT_TIMEOUT_MS);
      try { api.ready(finish); } catch { finish(); }
    };

    if (!existing) {
      script.src = src;
      script.async = true;
      script.defer = true;
      script.dataset.veyraRecaptcha = "1";
      // A blocked or failed script is not an error worth surfacing — the
      // request proceeds without a token and the server decides.
      script.onerror = () => resolve(null);
      script.onload = settle;
      document.head.appendChild(script);
      setTimeout(() => resolve(pick()), SCRIPT_TIMEOUT_MS);
    } else {
      settle();
    }
  });
  return scriptPromise;
}

/**
 * Warms the config and the Google script so the first sign-in is not slowed by
 * a cold script load. Safe to call on mount of any auth screen; a no-op when
 * reCAPTCHA is switched off.
 */
export function prewarmRecaptcha(): void {
  void recaptchaConfig().then(config => {
    if (config.enabled) void loadScript(config);
  });
}

/**
 * Mints a token for one action, or returns `null` when reCAPTCHA is disabled
 * or unavailable in this browser.
 *
 * Tokens are single-use and expire after about two minutes, so one is minted
 * per attempt — never cached across submissions.
 */
export async function recaptchaToken(key: RecaptchaActionKey): Promise<string | null> {
  const config = await recaptchaConfig();
  if (!config.enabled) return null;

  const api = await loadScript(config);
  if (!api) return null;

  const action = config.actions[key] ?? AUTH_CONFIG_OFF.recaptcha.actions[key];
  try {
    return await withTimeout(api.execute(config.siteKey, { action }), EXECUTE_TIMEOUT_MS);
  } catch {
    return null;
  }
}

/**
 * Convenience for request bodies: `{ ...body, ...(await recaptchaField("login")) }`.
 * Produces an empty object when there is no token, so the field is simply
 * absent rather than present-and-null.
 */
export async function recaptchaField(key: RecaptchaActionKey): Promise<{ recaptchaToken?: string }> {
  const token = await recaptchaToken(key);
  return token ? { recaptchaToken: token } : {};
}
