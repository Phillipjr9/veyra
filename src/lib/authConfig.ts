/**
 * Public auth configuration, read once per page load from `GET /api/auth/config`.
 *
 * Anonymous-surface features — reCAPTCHA, federated sign-in and address
 * suggestions — are switched on server-side, so the browser asks rather than guesses. That
 * keeps a cached bundle from ever disagreeing with the API about what is
 * required, and means enabling them needs no frontend rebuild.
 *
 * One shared fetch, so adding a feature here does not add a round-trip.
 * Everything degrades to "off" if the call fails: the sign-in attempt itself is
 * the better probe, and it surfaces the real error through the normal path.
 */

export type RecaptchaActionKey = "login" | "register" | "forgotPassword";

export type AuthConfig = {
  addresses: { enabled: boolean; countries: string[] };
  recaptcha: {
    enabled: boolean;
    provider: "v3" | "enterprise" | "off";
    siteKey: string;
    actions: Record<RecaptchaActionKey, string>;
  };
  federated: {
    enabled: boolean;
    /** One entry per provider the server accepts — the UI renders these. */
    providers: Array<{ id: string; label: string }>;
    firebase: { apiKey: string; authDomain: string; projectId: string } | null;
  };
};

export const AUTH_CONFIG_OFF: AuthConfig = {
  addresses: { enabled: false, countries: ["us"] },
  recaptcha: {
    enabled: false,
    provider: "off",
    siteKey: "",
    actions: { login: "login", register: "register", forgotPassword: "forgot_password" },
  },
  federated: { enabled: false, providers: [], firebase: null },
};

const CONFIG_TIMEOUT_MS = 4000;

let configPromise: Promise<AuthConfig> | null = null;

export function authConfig(): Promise<AuthConfig> {
  if (configPromise) return configPromise;
  configPromise = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CONFIG_TIMEOUT_MS);
      const res = await fetch("/api/auth/config", { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return AUTH_CONFIG_OFF;
      const body = (await res.json()) as Partial<AuthConfig>;

      const recaptcha = body?.recaptcha;
      const federated = body?.federated;
      return {
        addresses: body?.addresses?.enabled === true ? { enabled: true, countries: ["us"] } : AUTH_CONFIG_OFF.addresses,
        recaptcha: recaptcha?.enabled && recaptcha.siteKey
          ? {
            enabled: true,
            provider: recaptcha.provider === "enterprise" ? "enterprise" : "v3",
            siteKey: recaptcha.siteKey,
            actions: { ...AUTH_CONFIG_OFF.recaptcha.actions, ...(recaptcha.actions ?? {}) },
          }
          : AUTH_CONFIG_OFF.recaptcha,
        federated: federated?.enabled && federated.firebase?.apiKey && federated.providers?.length
          ? { enabled: true, providers: federated.providers, firebase: federated.firebase }
          : AUTH_CONFIG_OFF.federated,
      };
    } catch {
      return AUTH_CONFIG_OFF;
    }
  })();
  return configPromise;
}
