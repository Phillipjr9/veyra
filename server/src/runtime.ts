/**
 * Deployment guardrails.
 *
 * Runtime checks intentionally live outside individual adapters: an invalid
 * production configuration should fail before the API listens, rather than
 * silently weaken CORS, passkeys, tokens, or payment rails.
 */
import { stripeConfig } from "./stripe.js";

const list = (value: string | undefined) => (value ?? "").split(",").map(item => item.trim()).filter(Boolean);
const validHttpsOrigin = (value: string) => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.pathname.replace(/\/$/, "") && !url.search && !url.hash; }
  catch { return false; }
};

export type RuntimeReport = { errors: string[]; warnings: string[] };

export function productionRuntimeReport(env: NodeJS.ProcessEnv = process.env): RuntimeReport {
  const errors: string[] = [], warnings: string[] = [];
  if (env.NODE_ENV !== "production") return { errors, warnings };

  const tokenSecret = String(env.TOKEN_SECRET ?? "");
  if (tokenSecret.length < 32 || tokenSecret === "veyra-dev-secret-do-not-use-in-production") {
    errors.push("TOKEN_SECRET must be a unique production secret of at least 32 characters.");
  }
  for (const legacy of list(env.TOKEN_SECRET_PREVIOUS)) if (legacy.length < 32) errors.push("Every TOKEN_SECRET_PREVIOUS entry must be at least 32 characters.");
  const totpKey = String(env.TOTP_ENCRYPTION_KEY ?? tokenSecret);
  if (totpKey.length < 32) errors.push("TOTP_ENCRYPTION_KEY must be a unique secret of at least 32 characters.");

  if (env.PREVIEW_LOGIN_SHORTCUTS === "1" || env.PREVIEW_CRYPTO_DATA === "1" || env.DEMO_PAYMENTS_ENABLED === "1" || env.ACCOUNT_LEDGER_ENABLED === "1") {
    errors.push("Preview/demo money and login switches cannot be enabled in production.");
  }

  const appUrl = String(env.APP_URL ?? "").replace(/\/$/, "");
  if (!validHttpsOrigin(appUrl)) errors.push("APP_URL must be one canonical HTTPS origin in production (for email and Stripe return links).");

  const cors = list(env.CORS_ORIGIN);
  if (cors.includes("*")) errors.push("CORS_ORIGIN cannot contain * in production; list explicit HTTPS origins instead.");
  for (const origin of cors) if (!validHttpsOrigin(origin)) errors.push(`CORS_ORIGIN contains an invalid production origin: ${origin}`);

  const webauthnOrigins = list(env.WEBAUTHN_ORIGINS);
  if (!webauthnOrigins.length) errors.push("WEBAUTHN_ORIGINS must list the canonical HTTPS app origin in production.");
  for (const origin of webauthnOrigins) if (!validHttpsOrigin(origin)) errors.push(`WEBAUTHN_ORIGINS contains an invalid production origin: ${origin}`);
  const rpId = String(env.WEBAUTHN_RP_ID ?? "").trim();
  if (rpId && (!/^[a-z0-9.-]+$/i.test(rpId) || rpId.includes(".."))) errors.push("WEBAUTHN_RP_ID must be a bare domain, without a scheme, port, or path.");

  if (!env.RECAPTCHA_SITE_KEY) warnings.push("reCAPTCHA is not configured; use a WAF/bot policy before exposing anonymous auth routes.");
  if (env.RECAPTCHA_FAIL_CLOSED !== "1") warnings.push("reCAPTCHA outage policy is fail-open. Confirm this is an explicit availability decision.");
  if (env.TRUST_PROXY !== "1") warnings.push("TRUST_PROXY is not enabled. Behind a reverse proxy, client IP rate limits will apply to the proxy address.");

  const stripe = stripeConfig(env);
  const stripeMentioned = Boolean(env.STRIPE_SECRET_KEY || env.STRIPE_WEBHOOK_SECRET || env.STRIPE_PUBLISHABLE_KEY);
  if (stripeMentioned && !stripe.enabled) errors.push("STRIPE_SECRET_KEY must be a valid Stripe secret key (sk_test_… or sk_live_…).");
  if (stripe.enabled) {
    if (!stripe.live && env.STRIPE_ALLOW_TEST_MODE !== "1") errors.push("Refusing Stripe test mode in production. Use a live key or set STRIPE_ALLOW_TEST_MODE=1 for a deliberately isolated staging deployment.");
    if (!stripe.webhookSecret) errors.push("STRIPE_WEBHOOK_SECRET is required whenever Stripe rails are configured.");
    if (!stripe.publishableKey) warnings.push("STRIPE_PUBLISHABLE_KEY is missing; Stripe embedded financial-account components cannot be mounted yet.");
    if (env.STRIPE_API_BASE) errors.push("STRIPE_API_BASE is a test-only override and cannot be set in production.");
  }

  return { errors, warnings };
}
