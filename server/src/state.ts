import { readLedgerAnalytics } from "./ledgerAnalytics.js";
import { teamSpendByActor, teamSpendWindow } from "./teamSpending.js";
/**
 * Member state engine — server-side source of truth for the Account model
 * (src/lib/store.tsx). buildMemberState() reads every table for a user and
 * returns the snapshot in the exact `Account` JSON shape the frontend
 * consumes (dollar decimals, camelCase), so the client needs no data mapping.
 *
 * Money is integer cents in the database; dollars only at the API boundary.
 * Card/reward/reference helpers are shared by the API routes that create them.
 */
import type { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = 6;

const RATE: Record<string, number> = { Software: 0.04, Advertising: 0.045, Travel: 0.035, Operations: 0.025, Utilities: 0.025, Equipment: 0.03, Professional: 0.02 };
export const rewardRate = (category: string) => RATE[category] ?? 0.02;

const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
export const makeReference = () =>
  `VYR-${Math.random().toString(36).slice(2, 6).toUpperCase()}${Date.now().toString(36).slice(-4).toUpperCase()}`;

export function cardNumbers(fixedLast4?: string) {
  const last4 = fixedLast4 && /^\d{4}$/.test(fixedLast4) ? fixedLast4 : digits(4);
  const year = (new Date().getFullYear() + 3 + Math.floor(Math.random() * 2)) % 100;
  const month = 1 + Math.floor(Math.random() * 12);
  return {
    last4,
    fullNumber: `9${digits(3)} ${digits(4)} ${digits(4)} ${last4}`,
    exp: `${String(month).padStart(2, "0")}/${String(year).padStart(2, "0")}`,
    cvv: digits(3),
  };
}

const dollars = (cents: number) => Math.round(cents) / 100;

/* ============================================================ snapshot ==== */

/** Loads a column value as nullable string. */
const s = (v: unknown) => (v == null ? undefined : String(v));

export function buildMemberState(db: DatabaseSync, userId: string, currentTokenId?: string): Record<string, unknown> | null {
  const user = db.prepare(
    "SELECT name, email, business, account_type, status, status_reason, status_changed_at, status_changed_by, totp_secret_encrypted, veyra_id FROM users WHERE id = ?",
  ).get(userId) as
    | { name: string; email: string; business: string; account_type: string; status: string; status_reason: string | null; status_changed_at: number | null; status_changed_by: string | null; totp_secret_encrypted: string | null; veyra_id: string | null }
    | undefined;
  if (!user) return null;
  const account = db.prepare("SELECT * FROM accounts WHERE user_id = ?").get(userId) as Record<string, unknown> | undefined;
  const personal = user.account_type === "personal";
  const holder = personal ? user.name : user.business || "Your business";

  const cards = (db.prepare("SELECT * FROM cards WHERE user_id = ? ORDER BY created_at DESC").all(userId) as Array<Record<string, unknown>>).map(c => ({
    id: String(c.id),
    label: String(c.label),
    last4: String(c.last4),
    fullNumber: String(c.full_number),
    exp: String(c.expiry),
    cvv: String(c.cvv),
    limit: dollars(c.limit_cents as number),
    spent: dollars(c.spent_cents as number),
    frozen: c.frozen === 1,
    type: c.type,
    merchantLock: s(c.merchant_lock),
    categoryLock: s(c.category_lock),
    cardholder: String(c.cardholder),
    pin: String(c.pin),
    singleTransactionLimit: dollars(c.single_txn_limit_cents as number),
    dailyAtmLimit: dollars(c.daily_atm_limit_cents as number),
    controls: JSON.parse(String(c.controls_json ?? "{}")),
    shipping: JSON.parse(String(c.shipping_json ?? "{}")),
    walletStatus: c.wallet_status,
    /** Opaque status from Stripe Issuing; its presence means no PAN/CVV/PIN is stored by Veyra. */
    providerStatus: s(c.provider_status),
    createdAt: c.created_at as number,
  }));

  const transactions = (db.prepare("SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 400").all(userId) as Array<Record<string, unknown>>).map(t => ({
    id: String(t.id),
    merchant: String(t.merchant),
    category: String(t.category),
    amount: dollars(t.amount_cents as number),
    fee: dollars((t.fee_cents as number) ?? 0),
    reward: dollars(t.reward_cents as number),
    scout: dollars(t.scout_cents as number),
    date: t.created_at as number,
    cardId: s(t.card_id),
    note: s(t.note) ?? "",
    method: s(t.method),
    reference: s(t.reference),
    status: t.status,
  }));

  const invoices = (db.prepare("SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at DESC").all(userId) as Array<Record<string, unknown>>).map(i => ({
    id: String(i.id),
    client: String(i.client),
    clientEmail: String(i.client_email),
    amount: dollars(i.amount_cents as number),
    status: i.status,
    due: i.due_at as number,
    createdAt: i.created_at as number,
    description: s(i.description),
  }));

  const spendAt = Date.now();
  const spentByActor = teamSpendByActor(db, userId, spendAt);
  const { resetsAt } = teamSpendWindow(spendAt);
  const trackingSince = (db.prepare("SELECT applied_at FROM schema_migrations WHERE version = 16").get() as { applied_at: number }).applied_at;
  const team = (db.prepare("SELECT * FROM team_members WHERE user_id = ?").all(userId) as Array<Record<string, unknown>>).map(m => ({
    id: String(m.id),
    name: String(m.name),
    email: String(m.email),
    role: m.role,
    cardCount: m.card_count as number,
    monthlyLimit: dollars(m.monthly_limit_cents as number),
    monthlySpent: dollars(spentByActor.get(String(m.member_user_id ?? "")) ?? 0),
    monthlyRemaining: m.role === "Owner" ? null : dollars(Math.max(0, (m.monthly_limit_cents as number) - (spentByActor.get(String(m.member_user_id ?? "")) ?? 0))),
    spendResetsAt: resetsAt,
    spendTrackingSince: trackingSince,
    status: m.status,
  }));

  const perks = (db.prepare("SELECT * FROM perks WHERE user_id = ?").all(userId) as Array<Record<string, unknown>>).map(p => ({
    id: String(p.id),
    partner: String(p.partner),
    category: String(p.category),
    value: String(p.value),
    description: String(p.description),
    code: String(p.code),
    status: p.status,
  }));

  const notifications = (db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40").all(userId) as Array<Record<string, unknown>>).map(n => ({
    id: String(n.id),
    title: String(n.title),
    detail: String(n.detail),
    time: n.created_at as number,
    read: n.read === 1,
    type: n.type,
  }));

  const prefs = db.prepare("SELECT * FROM preferences WHERE user_id = ?").get(userId) as Record<string, unknown> | undefined;
  const recoveryCodesRemaining = Number((db.prepare("SELECT COUNT(*) AS count FROM totp_recovery_codes WHERE user_id = ?").get(userId) as { count: number }).count);

  const pockets = (db.prepare("SELECT * FROM savings_pockets WHERE user_id = ?").all(userId) as Array<Record<string, unknown>>).map(p => ({
    id: String(p.id),
    name: String(p.name),
    balance: dollars(p.balance_cents as number),
    target: dollars(p.target_cents as number),
    color: String(p.color),
    icon: p.icon,
    createdAt: p.created_at as number,
  }));

  const payees = (db.prepare("SELECT * FROM payees WHERE user_id = ?").all(userId) as Array<Record<string, unknown>>).map(p => ({
    id: String(p.id),
    name: String(p.name),
    nickname: s(p.nickname),
    bankName: String(p.bank_name),
    routingNumber: String(p.routing_number),
    accountLast4: String(p.account_last4),
    accountType: p.account_type,
    verified: p.verified === 1,
    createdAt: p.created_at as number,
  }));

  const scheduled = (db.prepare("SELECT * FROM scheduled_payments WHERE user_id = ?").all(userId) as Array<Record<string, unknown>>).map(p => ({
    id: String(p.id),
    payeeId: s(p.payee_id),
    payeeName: String(p.payee_name),
    amount: dollars(p.amount_cents as number),
    category: String(p.category),
    frequency: p.frequency,
    nextDate: p.next_date as number,
    status: p.status,
    autopay: p.autopay === 1,
    memo: s(p.memo),
  }));

  const disputes = (db.prepare("SELECT * FROM disputes WHERE user_id = ? ORDER BY opened_at DESC").all(userId) as Array<Record<string, unknown>>).map(d => ({
    id: String(d.id),
    transactionId: s(d.transaction_id),
    merchant: String(d.merchant),
    amount: dollars(d.amount_cents as number),
    reason: String(d.reason),
    detail: s(d.detail),
    status: d.status,
    openedAt: d.opened_at as number,
    updatedAt: d.updated_at as number,
  }));

  const sessions = (db.prepare(`
    SELECT ss.* FROM security_sessions ss JOIN sessions s ON s.token_id = ss.auth_token_id AND s.user_id = ss.user_id
    WHERE ss.user_id = ? AND s.revoked = 0 AND s.expires_at > ?
    ORDER BY ss.last_active DESC
  `).all(userId, Date.now()) as Array<Record<string, unknown>>).map(x => ({
    id: String(x.id),
    device: String(x.device),
    browser: String(x.browser),
    location: String(x.location ?? ""),
    lastActive: x.last_active as number,
    current: typeof currentTokenId === "string" && x.auth_token_id === currentTokenId,
    trusted: x.trusted === 1,
  }));

  const budgets = (db.prepare("SELECT * FROM budgets WHERE user_id = ? ORDER BY created_at DESC").all(userId) as Array<Record<string, unknown>>).map(b => ({
    id: String(b.id),
    name: String(b.name),
    category: String(b.category),
    monthlyLimit: dollars(b.monthly_limit_cents as number),
    alertPercent: b.alert_percent as number,
    createdAt: b.created_at as number,
  }));

  const kycRow = db.prepare("SELECT * FROM kyc_records WHERE user_id = ?").get(userId) as Record<string, unknown> | undefined;
  const requester = kycRow?.requested_by ? (db.prepare("SELECT name FROM users WHERE id = ?").get(String(kycRow.requested_by)) as { name: string } | undefined) : undefined;
  const reviewer = kycRow?.reviewed_by ? (db.prepare("SELECT name FROM users WHERE id = ?").get(String(kycRow.reviewed_by)) as { name: string } | undefined) : undefined;
  const kyc = {
    status: kycRow?.status ?? "not_started",
    completeness: kycRow?.completeness ?? 0,
    lastUpdated: kycRow?.updated_at ?? 0,
    nextStep: String(kycRow?.next_step ?? ""),
    documentType: String(kycRow?.document_type ?? ""),
    country: String(kycRow?.country ?? ""),
    requestedAt: kycRow?.requested_at as number | undefined,
    requestedBy: requester?.name,
    requestReason: s(kycRow?.request_reason),
    requirements: JSON.parse(String(kycRow?.request_reqs_json ?? "[]")),
    submission: kycRow?.submission_json ? JSON.parse(String(kycRow.submission_json)) : undefined,
    /**
     * The application review — the decision a human makes before the account is
     * usable. Separate from `status`, which tracks documents for accounts that
     * are already open: being asked for an extra document must never lock an
     * existing customer out of their money.
     */
    review: {
      state: (kycRow?.review_state as string) ?? "approved",
      note: String(kycRow?.review_note ?? ""),
      requirements: JSON.parse(String(kycRow?.review_reqs_json ?? "[]")),
      reviewedBy: reviewer?.name,
      reviewedAt: (kycRow?.reviewed_at as number) ?? null,
      // When the application itself arrived — identity_profiles is the row the
      // sign-up wrote, so its timestamp is the honest one.
      submittedAt: (db.prepare("SELECT submitted_at FROM identity_profiles WHERE user_id = ?").get(userId) as { submitted_at: number } | undefined)?.submitted_at ?? null,
    },
  };

  return {
    version: SCHEMA_VERSION,
    balance: dollars((account?.balance_cents as number) ?? 0),
    pendingBalance: dollars((account?.pending_cents as number) ?? 0),
    rewards: dollars((account?.rewards_cents as number) ?? 0),
    lifetimeRewards: dollars((account?.lifetime_rewards_cents as number) ?? 0),
    scoutSaved: dollars((account?.scout_saved_cents as number) ?? 0),
    cards,
    transactions,
    analytics: readLedgerAnalytics(db, userId),
    invoices,
    bankDetails: {
      accountNumber: String(account?.account_number ?? ""),
      routingNumber: String(account?.routing_number ?? ""),
      bankName: String(account?.bank_name ?? ""),
      accountType: `${personal ? "Personal" : "Business"} ${String(account?.bank_account_type ?? "Checking").toLowerCase()}`,
      holder,
    },
    team,
    perks,
    notifications,
    preferences: {
      twoFactor: prefs?.two_factor === 1 && Boolean(user.totp_secret_encrypted),
      loginAlerts: prefs?.login_alerts !== 0,
      scoutAuto: prefs?.scout_auto !== 0,
      weeklyDigest: prefs?.weekly_digest === 1,
    },
    recoveryCodesRemaining,
    savingsPockets: pockets,
    payees,
    scheduledPayments: scheduled,
    disputes,
    sessions,
    budgets,
    scoutApplied: JSON.parse(String(account?.scout_applied_json ?? "[]")),
    kyc,
    // Shown with the member's email as the code others use to send them money.
    veyraId: user.veyra_id ?? "",
    veyraEmail: user.email,
    accountStatus: user.status === "restricted" ? "restricted" : "active",
    // Why the account is on hold — the member's dashboard banner reads this
    // verbatim, so it is the sentence an admin chose when suspending, not a code.
    statusReason: user.status_reason || undefined,
    statusChangedAt: user.status_changed_at ?? undefined,
    statusChangedBy: user.status_changed_by || undefined,
  };
}
