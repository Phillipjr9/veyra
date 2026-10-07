/**
 * Stripe Treasury / Connect rail adapter.
 *
 * Veyra is the ledger and product shell; Stripe is the regulated money-movement
 * provider. This module owns the boundary between them:
 *
 * - a Veyra member maps to one Stripe connected account and financial account;
 * - onboarding is hosted by Stripe, so identity documents and bank credentials
 *   never transit Veyra's API or database;
 * - every provider callback is signature-verified, deduplicated, and reduced
 *   into a small local status record for the existing finance UI;
 * - provider objects are only referenced by ID. PANs, CVVs, external account
 *   numbers, setup-intent secrets, and raw webhook payloads are not persisted.
 *
 * The adapter deliberately does not manufacture local money when Stripe is
 * unavailable. A missing configuration means rails are unavailable, not
 * simulated. Stripe Treasury and Issuing must be enabled for the platform by
 * Stripe before the requested capabilities can become active.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { now } from "./db.js";

const STRIPE_API = "https://api.stripe.com";
const WEBHOOK_TOLERANCE_SEC = 5 * 60;

type Json = Record<string, any>;

export type StripeConfig = {
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
  appUrl: string;
  apiBase: string;
  apiVersion: string;
  enabled: boolean;
  live: boolean;
};

/** Read per call rather than at module load so deployment checks and tests are deterministic. */
export function stripeConfig(env: NodeJS.ProcessEnv = process.env): StripeConfig {
  const secretKey = String(env.STRIPE_SECRET_KEY ?? "").trim();
  const publishableKey = String(env.STRIPE_PUBLISHABLE_KEY ?? "").trim();
  const webhookSecret = String(env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  const appUrl = String(env.APP_URL ?? "").trim().replace(/\/+$/, "");
  const requestedBase = String(env.STRIPE_API_BASE ?? "").trim().replace(/\/+$/, "");
  const apiBase = requestedBase || STRIPE_API;
  const keyLooksValid = /^sk_(?:test|live)_[A-Za-z0-9]+$/.test(secretKey);
  return {
    secretKey,
    publishableKey,
    webhookSecret,
    appUrl,
    apiBase,
    apiVersion: String(env.STRIPE_API_VERSION ?? "").trim(),
    enabled: keyLooksValid,
    live: secretKey.startsWith("sk_live_"),
  };
}

export function describeStripe(cfg = stripeConfig()): string {
  if (!cfg.enabled) return "Stripe rails: off (set STRIPE_SECRET_KEY after Stripe Treasury / Issuing approval)";
  const mode = cfg.live ? "live" : "test";
  const webhook = cfg.webhookSecret ? "webhook verification ready" : "WEBHOOK SECRET MISSING";
  return `Stripe rails: ${mode} · ${webhook}`;
}

export class StripeError extends Error {
  constructor(public status: number, message: string, public code = "stripe_error") { super(message); }
}

function assertConfigured(cfg: StripeConfig): void {
  if (!cfg.enabled) throw new StripeError(503, "Live banking rails are not configured yet.", "rails_unavailable");
  if (!cfg.appUrl || !/^https?:\/\//.test(cfg.appUrl)) {
    throw new StripeError(503, "Stripe rails need APP_URL before onboarding can begin.", "rails_misconfigured");
  }
}

function encodeForm(params: Record<string, string | number | boolean | undefined>): string {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) form.set(key, String(value));
  return form.toString();
}

async function stripeRequest<T extends Json>(
  cfg: StripeConfig,
  method: "GET" | "POST",
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  options: { account?: string; idempotencyKey?: string } = {},
): Promise<T> {
  assertConfigured(cfg);
  const url = new URL(`${cfg.apiBase}${path}`);
  const headers: Record<string, string> = {
    authorization: `Bearer ${cfg.secretKey}`,
    accept: "application/json",
  };
  if (cfg.apiVersion) headers["Stripe-Version"] = cfg.apiVersion;
  if (options.account) headers["Stripe-Account"] = options.account;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  let body: string | undefined;
  if (method === "GET") {
    for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value));
  } else {
    body = encodeForm(params);
    headers["content-type"] = "application/x-www-form-urlencoded";
  }
  let response: globalThis.Response;
  try {
    response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new StripeError(503, "Stripe could not be reached. Try again shortly.", "stripe_unreachable");
  }
  const payload = await response.json().catch(() => ({})) as Json;
  if (!response.ok) {
    const providerMessage = typeof payload?.error?.message === "string" ? payload.error.message : "Stripe rejected this request.";
    // Do not pass through a raw provider message to a customer. It can reveal
    // capability/onboarding details that belong in the operator console.
    const customerMessage = response.status >= 500
      ? "Stripe could not complete this request. Try again shortly."
      : providerMessage.slice(0, 240);
    throw new StripeError(response.status === 401 || response.status === 403 ? 503 : response.status, customerMessage,
      typeof payload?.error?.code === "string" ? payload.error.code : "stripe_error");
  }
  return payload as T;
}

const featureNames = [
  "card_issuing", "financial_addresses.aba", "inbound_transfers.ach",
  "outbound_payments.ach", "outbound_payments.us_domestic_wire",
  "outbound_transfers.ach", "outbound_transfers.us_domestic_wire",
] as const;

function requestedFinancialAccountFeatures(): Record<string, true> {
  return {
    "supported_currencies[]": true,
    "features[card_issuing][requested]": true,
    "features[deposit_insurance][requested]": true,
    "features[financial_addresses][aba][requested]": true,
    "features[inbound_transfers][ach][requested]": true,
    "features[intra_stripe_flows][requested]": true,
    "features[outbound_payments][ach][requested]": true,
    "features[outbound_payments][us_domestic_wire][requested]": true,
    "features[outbound_transfers][ach][requested]": true,
    "features[outbound_transfers][us_domestic_wire][requested]": true,
  };
}

function featureState(object: Json): { active: string[]; pending: string[]; restricted: string[] } {
  return {
    active: Array.isArray(object.active_features) ? object.active_features.filter((v: unknown) => typeof v === "string") : [],
    pending: Array.isArray(object.pending_features) ? object.pending_features.filter((v: unknown) => typeof v === "string") : [],
    restricted: Array.isArray(object.restricted_features) ? object.restricted_features.filter((v: unknown) => typeof v === "string") : [],
  };
}

function financialAddress(object: Json): Json | null {
  const addresses = Array.isArray(object.financial_addresses) ? object.financial_addresses : [];
  const aba = addresses.find((address: Json) => address?.type === "aba" && address?.aba)?.aba;
  if (!aba || typeof aba !== "object") return null;
  // These are already designated receiving details by Stripe. Save only what
  // Veyra's current account UI needs, never a full external account number.
  return {
    bankName: String(aba.bank_name ?? ""),
    routingNumber: String(aba.routing_number ?? ""),
    accountNumberLast4: String(aba.account_number_last4 ?? ""),
    supportedNetworks: Array.isArray(addresses.find((a: Json) => a?.aba === aba)?.supported_networks)
      ? addresses.find((a: Json) => a?.aba === aba).supported_networks : [],
  };
}

function deriveRailStatus(account: Json | null, financial: Json | null): string {
  if (financial?.status === "open") {
    const features = featureState(financial);
    if (features.restricted.length) return "restricted";
    if (features.pending.length) return "pending";
    return "active";
  }
  if (account && account.details_submitted) return "provisioning";
  if (account) return "onboarding";
  return "not_started";
}

function safeJson(value: unknown): string { return JSON.stringify(value ?? {}); }

/** Stripe's documented `t=...,v1=...` signature. Reject stale/replayed payloads. */
export function verifyStripeSignature(raw: Buffer, header: string | undefined, secret: string, at = Date.now()): boolean {
  if (!secret || !header) return false;
  const parts = header.split(",").map(part => part.trim());
  const timestamp = parts.find(part => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter(part => part.startsWith("v1=")).map(part => part.slice(3));
  if (!timestamp || !/^\d+$/.test(timestamp) || !signatures.length) return false;
  if (Math.abs(Math.floor(at / 1000) - Number(timestamp)) > WEBHOOK_TOLERANCE_SEC) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw.toString("utf8")}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  return signatures.some(signature => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const supplied = Buffer.from(signature, "hex");
    return supplied.length === expectedBuf.length && timingSafeEqual(supplied, expectedBuf);
  });
}

type RailRow = {
  user_id: string; connected_account_id: string | null; financial_account_id: string | null; status: string;
  active_features_json: string; pending_features_json: string; restricted_features_json: string;
  financial_address_json: string; requirements_json: string; livemode: number; updated_at: number;
};

function parseList(value: string): string[] { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter(v => typeof v === "string") : []; } catch { return []; } }
function parseObject(value: string): Json | null { try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null; } catch { return null; } }

function publicRail(row: RailRow | undefined, cfg: StripeConfig) {
  const configured = cfg.enabled;
  if (!row) return { provider: "stripe", configured, live: cfg.live, status: configured ? "not_started" : "unavailable", connected: false,
    accountReady: false, features: { active: [], pending: [], restricted: [] }, receiving: null };
  const active = parseList(row.active_features_json), pending = parseList(row.pending_features_json), restricted = parseList(row.restricted_features_json);
  return {
    provider: "stripe", configured, live: cfg.live, status: row.status, connected: Boolean(row.connected_account_id),
    accountReady: row.status === "active", features: { active, pending, restricted },
    receiving: parseObject(row.financial_address_json), updatedAt: row.updated_at,
  };
}

export function createStripeRails(db: DatabaseSync) {
  const rowFor = (userId: string) => db.prepare("SELECT * FROM stripe_rails WHERE user_id=?").get(userId) as RailRow | undefined;

  const writeRail = (userId: string, patch: Partial<RailRow> & { connected_account_id?: string | null; financial_account_id?: string | null }) => {
    const previous = rowFor(userId);
    const at = now();
    const next: RailRow = {
      user_id: userId,
      connected_account_id: patch.connected_account_id ?? previous?.connected_account_id ?? null,
      financial_account_id: patch.financial_account_id ?? previous?.financial_account_id ?? null,
      status: patch.status ?? previous?.status ?? "not_started",
      active_features_json: patch.active_features_json ?? previous?.active_features_json ?? "[]",
      pending_features_json: patch.pending_features_json ?? previous?.pending_features_json ?? "[]",
      restricted_features_json: patch.restricted_features_json ?? previous?.restricted_features_json ?? "[]",
      financial_address_json: patch.financial_address_json ?? previous?.financial_address_json ?? "{}",
      requirements_json: patch.requirements_json ?? previous?.requirements_json ?? "{}",
      livemode: patch.livemode ?? previous?.livemode ?? 0,
      updated_at: at,
    };
    db.prepare(`INSERT INTO stripe_rails(user_id,connected_account_id,financial_account_id,status,active_features_json,pending_features_json,restricted_features_json,financial_address_json,requirements_json,livemode,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
      connected_account_id=excluded.connected_account_id, financial_account_id=excluded.financial_account_id, status=excluded.status,
      active_features_json=excluded.active_features_json,pending_features_json=excluded.pending_features_json,
      restricted_features_json=excluded.restricted_features_json,financial_address_json=excluded.financial_address_json,
      requirements_json=excluded.requirements_json,livemode=excluded.livemode,updated_at=excluded.updated_at`)
      .run(next.user_id, next.connected_account_id, next.financial_account_id, next.status, next.active_features_json,
        next.pending_features_json, next.restricted_features_json, next.financial_address_json, next.requirements_json,
        next.livemode, previous ? (db.prepare("SELECT created_at FROM stripe_rails WHERE user_id=?").get(userId) as { created_at: number }).created_at : at, at);
    return rowFor(userId)!;
  };

  async function createConnectedAccount(user: { id: string; email: string; name: string; accountType: string }): Promise<Json> {
    const cfg = stripeConfig();
    const previous = rowFor(user.id);
    if (previous?.connected_account_id) return stripeRequest<Json>(cfg, "GET", `/v1/accounts/${encodeURIComponent(previous.connected_account_id)}`);
    const account = await stripeRequest<Json>(cfg, "POST", "/v1/accounts", {
      type: "custom", country: "US", email: user.email,
      business_type: user.accountType === "business" ? "company" : "individual",
      "controller[stripe_dashboard][type]": "none",
      "controller[fees][payer]": "application",
      "controller[losses][payments]": "application",
      "controller[requirement_collection]": "application",
      "capabilities[transfers][requested]": true,
      "capabilities[card_issuing][requested]": true,
      "capabilities[treasury][requested]": true,
      "capabilities[us_bank_account_ach_payments][requested]": true,
      "metadata[veyra_user_id]": user.id,
    }, { idempotencyKey: `veyra:stripe-account:${user.id}` });
    if (typeof account.id !== "string" || !account.id.startsWith("acct_")) throw new StripeError(502, "Stripe did not return a connected account.", "stripe_invalid_response");
    writeRail(user.id, {
      connected_account_id: account.id, status: deriveRailStatus(account, null),
      requirements_json: safeJson(account.requirements ?? {}), livemode: account.livemode ? 1 : 0,
    });
    return account;
  }

  async function refreshConnectedAccount(userId: string): Promise<Json | null> {
    const rail = rowFor(userId); const cfg = stripeConfig();
    if (!rail?.connected_account_id || !cfg.enabled) return null;
    const account = await stripeRequest<Json>(cfg, "GET", `/v1/accounts/${encodeURIComponent(rail.connected_account_id)}`);
    const financial = rail.financial_account_id ? await stripeRequest<Json>(cfg, "GET", `/v1/treasury/financial_accounts/${encodeURIComponent(rail.financial_account_id)}`, {}, { account: rail.connected_account_id }).catch(() => null) : null;
    const features = financial ? featureState(financial) : { active: [], pending: [], restricted: [] };
    writeRail(userId, {
      status: deriveRailStatus(account, financial), active_features_json: safeJson(features.active), pending_features_json: safeJson(features.pending),
      restricted_features_json: safeJson(features.restricted), financial_address_json: safeJson(financial ? financialAddress(financial) ?? {} : {}),
      requirements_json: safeJson(account.requirements ?? {}), livemode: account.livemode ? 1 : 0,
    });
    return account;
  }

  return {
    status(userId: string) { return publicRail(rowFor(userId), stripeConfig()); },

    async onboarding(user: { id: string; email: string; name: string; accountType: string }) {
      const cfg = stripeConfig();
      assertConfigured(cfg);
      const account = await createConnectedAccount(user);
      const accountId = String(account.id);
      const link = await stripeRequest<Json>(cfg, "POST", "/v1/account_links", {
        account: accountId, type: "account_onboarding",
        refresh_url: `${cfg.appUrl}/#/app/external-accounts?stripe=refresh`,
        return_url: `${cfg.appUrl}/#/app/external-accounts?stripe=return`,
      }, { idempotencyKey: `veyra:onboarding-link:${user.id}:${Math.floor(Date.now() / 60_000)}` });
      if (typeof link.url !== "string" || !/^https:\/\//.test(link.url)) throw new StripeError(502, "Stripe did not return a secure onboarding link.", "stripe_invalid_response");
      writeRail(user.id, { status: deriveRailStatus(account, null), requirements_json: safeJson(account.requirements ?? {}), livemode: account.livemode ? 1 : 0 });
      return { url: link.url, expiresAt: Number(link.expires_at ?? 0) * 1000 || null, rails: publicRail(rowFor(user.id), cfg) };
    },

    async provisionFinancialAccount(user: { id: string; email: string; name: string; accountType: string }) {
      const cfg = stripeConfig();
      assertConfigured(cfg);
      const account = await createConnectedAccount(user);
      const accountId = String(account.id);
      const requirements = account.requirements as Json | undefined;
      const currentlyDue = Array.isArray(requirements?.currently_due) ? requirements.currently_due : [];
      const capabilities = account.capabilities as Json | undefined;
      const treasuryActive = capabilities?.treasury === "active";
      if (currentlyDue.length || !treasuryActive) {
        writeRail(user.id, { status: "onboarding", requirements_json: safeJson(requirements ?? {}), livemode: account.livemode ? 1 : 0 });
        throw new StripeError(409, "Finish Stripe verification before activating your financial account.", "onboarding_required");
      }
      const existing = rowFor(user.id);
      if (existing?.financial_account_id) {
        await refreshConnectedAccount(user.id);
        return { rails: publicRail(rowFor(user.id), cfg), created: false };
      }
      const financial = await stripeRequest<Json>(cfg, "POST", "/v1/treasury/financial_accounts", {
        ...requestedFinancialAccountFeatures(), "supported_currencies[]": "usd", "metadata[veyra_user_id]": user.id,
      }, { account: accountId, idempotencyKey: `veyra:financial-account:${user.id}` });
      if (typeof financial.id !== "string" || !financial.id.startsWith("fa_")) throw new StripeError(502, "Stripe did not return a financial account.", "stripe_invalid_response");
      const features = featureState(financial);
      writeRail(user.id, {
        connected_account_id: accountId, financial_account_id: financial.id, status: deriveRailStatus(account, financial),
        active_features_json: safeJson(features.active), pending_features_json: safeJson(features.pending), restricted_features_json: safeJson(features.restricted),
        financial_address_json: safeJson(financialAddress(financial) ?? {}), requirements_json: safeJson(requirements ?? {}), livemode: financial.livemode ? 1 : 0,
      });
      return { rails: publicRail(rowFor(user.id), cfg), created: true };
    },

    async refresh(userId: string) {
      const cfg = stripeConfig();
      assertConfigured(cfg);
      await refreshConnectedAccount(userId);
      return { rails: publicRail(rowFor(userId), cfg) };
    },

    /** Client secret for Stripe Connect embedded financial-account/card components. Never store it. */
    async accountSession(userId: string) {
      const cfg = stripeConfig();
      assertConfigured(cfg);
      const rail = rowFor(userId);
      if (!rail?.connected_account_id || !rail.financial_account_id) throw new StripeError(409, "Complete onboarding and activate your financial account first.", "financial_account_required");
      const session = await stripeRequest<Json>(cfg, "POST", "/v1/account_sessions", {
        account: rail.connected_account_id,
        "components[financial_account][enabled]": true,
        "components[financial_account][features][send_money]": true,
        "components[financial_account][features][transfer_balance]": true,
        "components[financial_account][features][external_account_collection]": true,
        "components[issuing_cards_list][enabled]": true,
      }, { idempotencyKey: `veyra:account-session:${userId}:${Math.floor(Date.now() / 60_000)}` });
      if (typeof session.client_secret !== "string") throw new StripeError(502, "Stripe did not return an account session.", "stripe_invalid_response");
      return { clientSecret: session.client_secret, publishableKey: cfg.publishableKey, financialAccountId: rail.financial_account_id };
    },

    /**
     * Issues a Stripe Issuing card backed by the member's connected financial
     * account. Only non-sensitive display fields return to Veyra: Stripe is
     * the card-data vault and Veyra never writes a PAN, CVV, or PIN.
     */
    async issueCard(user: { id: string; email: string; name: string; accountType: string }, input: { type: "virtual" | "physical"; label: string }) {
      const cfg = stripeConfig();
      assertConfigured(cfg);
      const rail = rowFor(user.id);
      if (!rail?.connected_account_id || !rail.financial_account_id || rail.status !== "active") {
        throw new StripeError(409, "Activate your Stripe financial account before issuing a live card.", "financial_account_required");
      }
      if (!parseList(rail.active_features_json).includes("card_issuing")) {
        throw new StripeError(409, "Stripe card issuing is not active for this financial account yet.", "card_issuing_pending");
      }
      const profile = db.prepare(`SELECT first_name,last_name,phone,address_line1,address_line2,city,state,postal_code,country,
        legal_name,biz_address_line1,biz_address_line2,biz_city,biz_state,biz_postal_code,biz_country
        FROM identity_profiles WHERE user_id=?`).get(user.id) as Json | undefined;
      const business = user.accountType === "business";
      const name = business ? String(profile?.legal_name || user.name) : String(user.name);
      const address = business
        ? { line1: String(profile?.biz_address_line1 ?? ""), line2: String(profile?.biz_address_line2 ?? ""), city: String(profile?.biz_city ?? ""), state: String(profile?.biz_state ?? ""), postal: String(profile?.biz_postal_code ?? ""), country: String(profile?.biz_country ?? "US") }
        : { line1: String(profile?.address_line1 ?? ""), line2: String(profile?.address_line2 ?? ""), city: String(profile?.city ?? ""), state: String(profile?.state ?? ""), postal: String(profile?.postal_code ?? ""), country: String(profile?.country ?? "US") };
      if (!address.line1 || !address.city || !address.state || !address.postal || !address.country) {
        throw new StripeError(409, "A verified mailing address is required before issuing a live card.", "cardholder_address_required");
      }
      // Reuse a provider cardholder per account. Its opaque id is persisted on
      // the card rows, never its KYC data; Stripe remains the canonical record.
      const existing = db.prepare("SELECT provider_cardholder_id FROM cards WHERE user_id=? AND provider_cardholder_id IS NOT NULL AND provider_cardholder_id != '' LIMIT 1")
        .get(user.id) as { provider_cardholder_id: string } | undefined;
      let cardholderId = existing?.provider_cardholder_id;
      if (!cardholderId) {
        const cardholder = await stripeRequest<Json>(cfg, "POST", "/v1/issuing/cardholders", {
          name, email: user.email, phone: String(profile?.phone ?? ""), type: business ? "company" : "individual", status: "active",
          "billing[address][line1]": address.line1, "billing[address][line2]": address.line2 || undefined,
          "billing[address][city]": address.city, "billing[address][state]": address.state,
          "billing[address][postal_code]": address.postal, "billing[address][country]": address.country,
          "metadata[veyra_user_id]": user.id,
        }, { account: rail.connected_account_id, idempotencyKey: `veyra:cardholder:${user.id}` });
        if (typeof cardholder.id !== "string" || !cardholder.id.startsWith("ich_")) throw new StripeError(502, "Stripe did not return a cardholder.", "stripe_invalid_response");
        cardholderId = cardholder.id;
      }
      const card = await stripeRequest<Json>(cfg, "POST", "/v1/issuing/cards", {
        cardholder: cardholderId, currency: "usd", type: input.type, status: "active", financial_account: rail.financial_account_id,
        "metadata[veyra_user_id]": user.id, "metadata[veyra_label]": input.label,
      }, { account: rail.connected_account_id, idempotencyKey: `veyra:issuing-card:${user.id}:${Date.now()}` });
      if (typeof card.id !== "string" || !card.id.startsWith("ic_")) throw new StripeError(502, "Stripe did not return an issuing card.", "stripe_invalid_response");
      const month = Number(card.exp_month), year = Number(card.exp_year);
      return {
        providerCardId: card.id, providerCardholderId: cardholderId, status: String(card.status ?? "active"),
        last4: String(card.last4 ?? ""), expiry: Number.isInteger(month) && Number.isInteger(year) ? `${String(month).padStart(2, "0")}/${String(year).slice(-2)}` : "",
      };
    },

    /** Provider-side freeze/unfreeze: local controls alone must never imply a live card was stopped. */
    async setCardFrozen(userId: string, providerCardId: string, frozen: boolean) {
      const cfg = stripeConfig();
      assertConfigured(cfg);
      const rail = rowFor(userId);
      if (!rail?.connected_account_id) throw new StripeError(409, "No Stripe connected account is available for this card.", "financial_account_required");
      const card = await stripeRequest<Json>(cfg, "POST", `/v1/issuing/cards/${encodeURIComponent(providerCardId)}`, {
        status: frozen ? "inactive" : "active",
      }, { account: rail.connected_account_id, idempotencyKey: `veyra:card-status:${providerCardId}:${frozen ? "freeze" : "unfreeze"}` });
      return { status: String(card.status ?? (frozen ? "inactive" : "active")) };
    },

    /** Handles Stripe's raw, signed callback. It never exposes an event to a browser. */
    webhook(req: Request, res: Response) {
      const cfg = stripeConfig();
      if (!cfg.enabled || !cfg.webhookSecret) return void res.status(503).json({ error: "Stripe webhook is not configured." });
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!raw.length || !verifyStripeSignature(raw, req.header("stripe-signature"), cfg.webhookSecret)) {
        return void res.status(400).json({ error: "Invalid Stripe webhook signature." });
      }
      let event: Json;
      try { event = JSON.parse(raw.toString("utf8")) as Json; }
      catch { return void res.status(400).json({ error: "Invalid Stripe webhook payload." }); }
      const eventId = typeof event.id === "string" ? event.id : "";
      const type = typeof event.type === "string" ? event.type : "";
      const object = event?.data?.object as Json | undefined;
      if (!eventId || !type || !object || typeof object !== "object") return void res.status(400).json({ error: "Invalid Stripe event." });
      if (db.prepare("SELECT 1 FROM stripe_events WHERE id=?").get(eventId)) return void res.json({ received: true, duplicate: true });
      const objectId = typeof object.id === "string" ? object.id : "";
      const payloadHash = createHash("sha256").update(raw).digest("hex");
      db.prepare("INSERT INTO stripe_events(id,type,object_id,created_at,received_at,livemode,payload_sha256,status) VALUES(?,?,?,?,?,?,?,?)")
        .run(eventId, type, objectId, Number(event.created ?? 0) * 1000 || now(), now(), event.livemode ? 1 : 0, payloadHash, "received");
      try {
        const metadataUser = typeof object?.metadata?.veyra_user_id === "string" ? object.metadata.veyra_user_id : null;
        let rail = metadataUser ? rowFor(metadataUser) : undefined;
        if (!rail && objectId) rail = db.prepare("SELECT * FROM stripe_rails WHERE connected_account_id=? OR financial_account_id=?")
          .get(objectId, objectId) as RailRow | undefined;
        if (!rail && typeof object.financial_account === "string") rail = db.prepare("SELECT * FROM stripe_rails WHERE financial_account_id=?").get(object.financial_account) as RailRow | undefined;

        if (rail && type === "account.updated") {
          writeRail(rail.user_id, { status: deriveRailStatus(object, null), requirements_json: safeJson(object.requirements ?? {}), livemode: object.livemode ? 1 : 0 });
        } else if (rail && (type.startsWith("treasury.financial_account.") || object.object === "treasury.financial_account")) {
          const features = featureState(object);
          writeRail(rail.user_id, { financial_account_id: typeof object.id === "string" ? object.id : rail.financial_account_id,
            status: deriveRailStatus(null, object), active_features_json: safeJson(features.active), pending_features_json: safeJson(features.pending),
            restricted_features_json: safeJson(features.restricted), financial_address_json: safeJson(financialAddress(object) ?? {}), livemode: object.livemode ? 1 : 0 });
        }
        if (objectId && (type.startsWith("issuing_card.") || object.object === "issuing.card")) {
          const cardStatus = String(object.status ?? "");
          db.prepare("UPDATE cards SET provider_status=?, frozen=? WHERE provider_card_id=?")
            .run(cardStatus, cardStatus === "inactive" ? 1 : 0, objectId);
        }
        if (objectId) db.prepare("UPDATE stripe_operations SET status=?, updated_at=? WHERE provider_object_id=?")
          .run(String(object.status ?? type.split(".").at(-1) ?? "updated"), now(), objectId);
        db.prepare("UPDATE stripe_events SET status='processed',processed_at=? WHERE id=?").run(now(), eventId);
      } catch (error) {
        db.prepare("UPDATE stripe_events SET status='failed',processed_at=?,error_code=? WHERE id=?")
          .run(now(), error instanceof Error ? error.name.slice(0, 80) : "processing_error", eventId);
        // A non-2xx makes Stripe retry. The event row ensures the retry is
        // idempotent after an operator resolves the underlying database issue.
        return void res.status(500).json({ error: "Webhook processing failed." });
      }
      res.json({ received: true });
    },

    requestedFeatures: featureNames,
  };
}
