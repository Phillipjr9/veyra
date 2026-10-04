/**
 * reCAPTCHA verification for the public auth endpoints.
 *
 * Veyra's three anonymous routes — sign in, open an account, request a
 * password reset — are the only surface a script can reach without a session,
 * and each one costs the server real work (scrypt, five inserts, a token
 * mint). The in-memory budgets in security.ts throttle a single address;
 * reCAPTCHA is what answers a distributed run from many addresses.
 *
 * Two providers, one interface, chosen by which variables are set:
 *
 *   classic v3   RECAPTCHA_SITE_KEY + RECAPTCHA_SECRET_KEY
 *                → POST https://www.google.com/recaptcha/api/siteverify
 *   Enterprise   RECAPTCHA_SITE_KEY + RECAPTCHA_PROJECT_ID + RECAPTCHA_API_KEY
 *                → POST .../v1/projects/{id}/assessments  (createAssessment)
 *
 * Enterprise is the one Firebase App Check sits on top of, so starting here
 * does not have to be redone if App Check is adopted later.
 *
 * ── Two kinds of failure, deliberately treated differently ──────────────────
 *
 *   DECISION   Google answered and the answer was "no": score below the
 *              threshold, wrong action, expired or replayed token, malformed
 *              token, missing token. Always enforced — this is the feature.
 *
 *   INFRA      Google did not answer, or answered that *we* are misconfigured:
 *              network error, timeout, 5xx, bad secret. Governed by
 *              RECAPTCHA_FAIL_CLOSED (default: fail OPEN).
 *
 * Failing open on INFRA is the default on purpose. Failing closed there means
 * an outage at Google — or one bad env var — locks every customer out of their
 * money, which is a worse incident than the bots it would stop. The event is
 * logged loudly either way, and RECAPTCHA_FAIL_CLOSED=1 flips it for operators
 * who would rather take the outage.
 *
 * Replay is Google's job: a token is single-use and expires after two minutes,
 * and a second verification of the same token comes back `timeout-or-duplicate`
 * (classic) / `DUPE` (Enterprise). There is no local nonce cache to keep.
 *
 * Disabled unless configured. No site key means every check is a pass-through,
 * so development, CI and the integration suite run without a Google round-trip.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { rateLimit } from "./security.js";

/** Action names the client must mint tokens with. Sent to the browser in `GET /api/auth/config` so the two cannot drift. */
export const RECAPTCHA_ACTIONS = {
  login: "login",
  register: "register",
  forgotPassword: "forgot_password",
} as const;

export type RecaptchaAction = (typeof RECAPTCHA_ACTIONS)[keyof typeof RECAPTCHA_ACTIONS];

const CLASSIC_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
const ENTERPRISE_BASE_URL = "https://recaptchaenterprise.googleapis.com/v1";

export type RecaptchaConfig = {
  enabled: boolean;
  provider: "v3" | "enterprise" | "off";
  siteKey: string;
  secretKey: string;
  projectId: string;
  apiKey: string;
  minScore: number;
  failClosed: boolean;
  /** Empty = accept any hostname (Google already scopes a key to its domains). */
  hostnames: string[];
  timeoutMs: number;
  /** Override for tests and for sites that proxy Google's endpoint. */
  verifyUrl: string;
};

let cached: RecaptchaConfig | null = null;

const num = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Reads configuration from the environment. Memoised, because this runs on
 * every anonymous request; `resetRecaptchaConfig()` clears it for tests.
 */
export function recaptchaConfig(): RecaptchaConfig {
  if (cached) return cached;
  const siteKey = (process.env.RECAPTCHA_SITE_KEY ?? "").trim();
  const secretKey = (process.env.RECAPTCHA_SECRET_KEY ?? "").trim();
  const projectId = (process.env.RECAPTCHA_PROJECT_ID ?? "").trim();
  const apiKey = (process.env.RECAPTCHA_API_KEY ?? "").trim();

  // Enterprise wins when its pair is present: a project that has both set is
  // running Enterprise and the classic secret is a leftover.
  const provider: RecaptchaConfig["provider"] = !siteKey
    ? "off"
    : projectId && apiKey
      ? "enterprise"
      : secretKey
        ? "v3"
        : "off";

  const defaultUrl = provider === "enterprise"
    ? `${ENTERPRISE_BASE_URL}/projects/${encodeURIComponent(projectId)}/assessments`
    : CLASSIC_VERIFY_URL;

  cached = {
    enabled: provider !== "off",
    provider,
    siteKey,
    secretKey,
    projectId,
    apiKey,
    // 0.5 is Google's documented starting point: 1.0 is very likely human,
    // 0.0 very likely a bot.
    minScore: Math.min(1, Math.max(0, num(process.env.RECAPTCHA_MIN_SCORE, 0.5))),
    failClosed: process.env.RECAPTCHA_FAIL_CLOSED === "1",
    hostnames: (process.env.RECAPTCHA_HOSTNAMES ?? "").split(",").map(h => h.trim()).filter(Boolean),
    timeoutMs: num(process.env.RECAPTCHA_TIMEOUT_MS, 4000),
    verifyUrl: (process.env.RECAPTCHA_VERIFY_URL ?? "").trim() || defaultUrl,
  };
  return cached;
}

/** Test helper: forces the next `recaptchaConfig()` to re-read the environment. */
export function resetRecaptchaConfig(): void {
  cached = null;
}

/** The public half of the configuration, safe to hand to a browser. */
export function publicRecaptchaConfig() {
  const config = recaptchaConfig();
  return {
    enabled: config.enabled,
    provider: config.provider,
    siteKey: config.siteKey,
    actions: RECAPTCHA_ACTIONS,
  };
}

export type RecaptchaVerdict =
  | { ok: true; skipped: boolean; score: number | null; action: string; hostname: string }
  | { ok: false; kind: "decision" | "infra"; status: number; error: string; detail: string; score: number | null };

/** Classic error codes that mean *our* configuration is wrong, not the caller's token. */
const CONFIG_ERRORS = new Set(["missing-input-secret", "invalid-input-secret", "bad-request"]);

const decision = (status: number, error: string, detail: string, score: number | null = null): RecaptchaVerdict =>
  ({ ok: false, kind: "decision", status, error, detail, score });

const infra = (detail: string): RecaptchaVerdict =>
  ({ ok: false, kind: "infra", status: 503, error: "We could not verify this request. Try again in a moment.", detail, score: null });

/**
 * Verifies one token against the configured provider.
 *
 * Returns `{ ok: true, skipped: true }` when reCAPTCHA is not configured, so
 * callers never have to branch on whether the feature is switched on.
 */
export async function verifyRecaptchaToken(
  token: string,
  expectedAction: RecaptchaAction,
  remoteIp?: string,
): Promise<RecaptchaVerdict> {
  const config = recaptchaConfig();
  if (!config.enabled) return { ok: true, skipped: true, score: null, action: expectedAction, hostname: "" };

  if (!token) {
    return decision(400, "This request could not be verified. Reload the page and try again.", "no token supplied");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let payload: unknown;
  try {
    const res = await fetch(
      config.provider === "enterprise" ? `${config.verifyUrl}?key=${encodeURIComponent(config.apiKey)}` : config.verifyUrl,
      config.provider === "enterprise"
        ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            event: { token, siteKey: config.siteKey, expectedAction, ...(remoteIp ? { userIpAddress: remoteIp } : {}) },
          }),
        }
        : {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal: controller.signal,
          body: new URLSearchParams({
            secret: config.secretKey,
            response: token,
            ...(remoteIp ? { remoteip: remoteIp } : {}),
          }).toString(),
        },
    );
    // A 4xx/5xx from Google is an infrastructure problem (bad API key, quota,
    // outage) — never a verdict about this visitor.
    if (!res.ok) return infra(`${config.provider} endpoint returned HTTP ${res.status}`);
    payload = await res.json();
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError"
      ? `timed out after ${config.timeoutMs}ms`
      : err instanceof Error ? err.message : String(err);
    return infra(reason);
  } finally {
    clearTimeout(timer);
  }

  return config.provider === "enterprise"
    ? readEnterprise(payload, expectedAction, config)
    : readClassic(payload, expectedAction, config);
}

/** `{ success, score, action, hostname, "error-codes": [] }` */
function readClassic(payload: unknown, expectedAction: string, config: RecaptchaConfig): RecaptchaVerdict {
  const body = (payload ?? {}) as {
    success?: boolean; score?: number; action?: string; hostname?: string; "error-codes"?: string[];
  };
  const codes = Array.isArray(body["error-codes"]) ? body["error-codes"] : [];

  if (!body.success) {
    if (codes.some(code => CONFIG_ERRORS.has(code))) return infra(`siteverify rejected our credentials: ${codes.join(", ")}`);
    if (codes.includes("timeout-or-duplicate")) {
      return decision(400, "That verification has already been used. Try again.", "timeout-or-duplicate");
    }
    return decision(400, "This request could not be verified. Reload the page and try again.", codes.join(", ") || "siteverify returned success=false");
  }

  const score = typeof body.score === "number" ? body.score : null;
  return gradeVerdict(score, String(body.action ?? ""), String(body.hostname ?? ""), expectedAction, config);
}

/** `{ tokenProperties: { valid, action, hostname, invalidReason }, riskAnalysis: { score } }` */
function readEnterprise(payload: unknown, expectedAction: string, config: RecaptchaConfig): RecaptchaVerdict {
  const body = (payload ?? {}) as {
    tokenProperties?: { valid?: boolean; action?: string; hostname?: string; invalidReason?: string };
    riskAnalysis?: { score?: number };
  };
  const properties = body.tokenProperties ?? {};

  if (!properties.valid) {
    const reason = String(properties.invalidReason ?? "unknown");
    if (reason === "DUPE" || reason === "EXPIRED") {
      return decision(400, "That verification has expired. Try again.", `invalidReason=${reason}`);
    }
    return decision(400, "This request could not be verified. Reload the page and try again.", `invalidReason=${reason}`);
  }

  const score = typeof body.riskAnalysis?.score === "number" ? body.riskAnalysis.score : null;
  return gradeVerdict(score, String(properties.action ?? ""), String(properties.hostname ?? ""), expectedAction, config);
}

/** Shared tail of both providers: bind the action, check the origin, apply the threshold. */
function gradeVerdict(
  score: number | null,
  action: string,
  hostname: string,
  expectedAction: string,
  config: RecaptchaConfig,
): RecaptchaVerdict {
  // Action binding. Without it a token minted on a cheap public form could be
  // replayed against sign-in, which is the whole point of having actions.
  if (action && action !== expectedAction) {
    return decision(400, "This request could not be verified. Reload the page and try again.",
      `action mismatch: token was minted for "${action}", expected "${expectedAction}"`, score);
  }
  if (config.hostnames.length && hostname && !config.hostnames.includes(hostname)) {
    return decision(400, "This request could not be verified. Reload the page and try again.",
      `hostname "${hostname}" is not in RECAPTCHA_HOSTNAMES`, score);
  }
  if (score !== null && score < config.minScore) {
    return decision(403, "This request looked automated, so we stopped it. If this was you, try again.",
      `score ${score} below threshold ${config.minScore}`, score);
  }
  return { ok: true, skipped: false, score, action: action || expectedAction, hostname };
}

/* ---------- logging (throttled: a Google outage must not flood the log) ---------- */

const lastLoggedAt = new Map<string, number>();
const LOG_EVERY_MS = 60_000;

function logThrottled(key: string, line: string): void {
  const previous = lastLoggedAt.get(key) ?? 0;
  if (Date.now() - previous < LOG_EVERY_MS) return;
  lastLoggedAt.set(key, Date.now());
  console.warn(line);
}

/* ---------- middleware ---------- */

/**
 * Gate for one public route.
 *
 * Ordering note: this runs before the handler, so it sits in front of scrypt
 * and the inserts — the expensive work — but it is itself an outbound network
 * call, so it gets its own per-address budget. Without that, an attacker could
 * post junk tokens and use Veyra to generate traffic against Google's quota.
 * A missing token is rejected locally and never spends the budget.
 */
export function requireRecaptcha(action: RecaptchaAction): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const config = recaptchaConfig();
    if (!config.enabled) return void next();

    const token = typeof req.body?.recaptchaToken === "string"
      ? req.body.recaptchaToken
      : String(req.header("X-Recaptcha-Token") ?? "");
    const ip = req.ip ?? "unknown";

    if (!token) {
      return void res.status(400).json({
        error: "This request could not be verified. Reload the page and try again.",
        code: "recaptcha_required",
      });
    }
    if (!rateLimit(`recaptcha:${ip}`, 60, 60_000)) {
      return void res.status(429).json({ error: "Too many attempts — wait a minute, then try again.", code: "recaptcha_throttled" });
    }

    void verifyRecaptchaToken(token, action, ip)
      .then(verdict => {
        if (verdict.ok) {
          // The score is useful signal even on success — it is what you tune
          // RECAPTCHA_MIN_SCORE against before turning enforcement up.
          if (!verdict.skipped && verdict.score !== null && verdict.score < config.minScore + 0.2) {
            logThrottled(`low:${action}`, `[recaptcha] ${action}: allowed a low score (${verdict.score}, threshold ${config.minScore})`);
          }
          return void next();
        }
        if (verdict.kind === "infra") {
          logThrottled(`infra:${action}`, `[recaptcha] ${action}: verification unavailable — ${verdict.detail}` +
            ` (failing ${config.failClosed ? "CLOSED: request rejected" : "OPEN: request allowed"})`);
          if (!config.failClosed) return void next();
          return void res.status(503).json({ error: verdict.error, code: "recaptcha_unavailable" });
        }
        logThrottled(`decision:${action}:${verdict.status}`, `[recaptcha] ${action}: rejected — ${verdict.detail}`);
        res.status(verdict.status).json({ error: verdict.error, code: "recaptcha_failed" });
      })
      .catch((err: unknown) => {
        // Defensive: verifyRecaptchaToken already converts throws into verdicts.
        logThrottled(`throw:${action}`, `[recaptcha] ${action}: verifier threw — ${err instanceof Error ? err.message : String(err)}`);
        if (!config.failClosed) return void next();
        res.status(503).json({ error: "We could not verify this request. Try again in a moment.", code: "recaptcha_unavailable" });
      });
  };
}

/** Boot-time summary, so an operator can see at a glance whether the gate is live. */
export function describeRecaptcha(): string {
  const config = recaptchaConfig();
  if (!config.enabled) return "reCAPTCHA: off (set RECAPTCHA_SITE_KEY + a provider credential to enable)";
  return `reCAPTCHA: ${config.provider} · min score ${config.minScore} · ` +
    `${config.failClosed ? "fail-closed" : "fail-open"} on verifier outage` +
    `${config.hostnames.length ? ` · hostnames ${config.hostnames.join(", ")}` : ""}`;
}
