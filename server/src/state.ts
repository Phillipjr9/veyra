/**
 * Member state engine — the server-side mirror of the frontend Account model
 * (src/lib/store.tsx). Two responsibilities:
 *
 *   1. seedMemberState(): populates the full demo dataset for a member — the
 *      same cards, transactions, invoices, team, pockets, payees, scheduled
 *      bills, perks, sessions and notifications the standalone localStorage
 *      demo generates, so switching to the API backend looks identical.
 *
 *   2. buildMemberState(): reads every table for a user and returns the
 *      snapshot in the exact `Account` JSON shape the frontend consumes
 *      (dollar decimals, camelCase), so the client needs no data mapping.
 *
 * Money is integer cents in the database; dollars only at the API boundary.
 */
import type { DatabaseSync } from "node:sqlite";
import { now, rid } from "./db.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;

export const SCHEMA_VERSION = 6;

const RATE: Record<string, number> = { Software: 0.04, Advertising: 0.045, Travel: 0.035, Operations: 0.025, Utilities: 0.025, Equipment: 0.03, Professional: 0.02 };
export const rewardRate = (category: string) => RATE[category] ?? 0.02;

const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
export const makeReference = () =>
  `VYR-${Math.random().toString(36).slice(2, 6).toUpperCase()}${Date.now().toString(36).slice(-4).toUpperCase()}`;

export type MemberProfile = { name: string; business: string; email: string; accountType: "personal" | "business" };

const defaultControls = (type: "virtual" | "physical") => ({
  online: true,
  contactless: true,
  atm: type === "physical",
  international: false,
  magstripe: type === "physical",
});

const virtualShipping = () => ({ status: "not_applicable" as const });
const deliveredShipping = (t: number) => ({
  status: "delivered" as const,
  carrier: "ParcelPost",
  tracking: `VP${digits(12)}`,
  orderedAt: t - DAY * 38,
  estimatedDelivery: t - DAY * 30,
  deliveredAt: t - DAY * 31,
  address: "125 Market Street · San Francisco, CA 94105",
});
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
const toCents = (amount: number) => Math.round(amount * 100);

/* ============================================================ seed ======== */

/** Wipes and (re)creates the full demo dataset for one member. */
export function seedMemberState(db: DatabaseSync, userId: string, p: MemberProfile): void {
  const t = now();
  const personal = p.accountType === "personal";
  const domain = p.email.includes("@") ? p.email.split("@")[1] : "company.example";

  for (const table of ["cards", "invoices", "team_members", "savings_pockets", "payees", "scheduled_payments", "perks", "security_sessions", "preferences", "notifications", "disputes", "transactions"]) {
    db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
  }
  db.prepare("DELETE FROM accounts WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM kyc_records WHERE user_id = ?").run(userId);
  db.prepare("INSERT OR REPLACE INTO kyc_records (user_id, status, completeness, updated_at) VALUES (?, 'not_started', 0, ?)").run(userId, t);

  /* ---- cards ---- */
  type SeedCard = { label: string; last4: string; limit: number; spent: number; frozen?: boolean; type: "virtual" | "physical"; categoryLock?: string; merchantLock?: string; pin: string; single: number; atm: number; international?: boolean };
  const businessCards: SeedCard[] = [
    { label: "Subscriptions", last4: "2903", limit: 4000, spent: 1182.4, type: "virtual", categoryLock: "Software", pin: "2846", single: 1200, atm: 0 },
    { label: "Advertising", last4: "7741", limit: 12000, spent: 5620.5, type: "virtual", merchantLock: "Northstar Ads", categoryLock: "Advertising", pin: "6031", single: 5000, atm: 0 },
    { label: "Metal debit", last4: "5118", limit: 15000, spent: 410, type: "physical", pin: "4917", single: 7500, atm: 1000 },
  ];
  const personalCards: SeedCard[] = [
    { label: "Everyday debit", last4: "1842", limit: 5000, spent: 682.71, type: "physical", pin: "3174", single: 2500, atm: 600 },
    { label: "Online spending", last4: "6219", limit: 1500, spent: 128.55, type: "virtual", categoryLock: "Software", pin: "5402", single: 500, atm: 0 },
    { label: "Travel", last4: "9086", limit: 3000, spent: 0, frozen: true, type: "virtual", categoryLock: "Travel", pin: "8251", single: 1200, atm: 0, international: true },
  ];
  const cards = personal ? personalCards : businessCards;
  const insertCard = db.prepare(
    `INSERT INTO cards (id, user_id, label, last4, full_number, expiry, cvv, type, cardholder, merchant_lock, category_lock,
       limit_cents, spent_cents, single_txn_limit_cents, daily_atm_limit_cents, pin, frozen, wallet_status, controls_json, shipping_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const cardIds: string[] = [];
  cards.forEach((c, i) => {
    const id = `card_${userId}_${i}`;
    cardIds.push(id);
    const nums = cardNumbers(c.last4);
    const controls = { ...defaultControls(c.type), ...(c.international ? { international: true } : {}) };
    const shipping = c.type === "physical" ? deliveredShipping(t) : virtualShipping();
    insertCard.run(id, userId, c.label, nums.last4, nums.fullNumber, nums.exp, nums.cvv, c.type, p.name,
      c.merchantLock ?? null, c.categoryLock ?? null, toCents(c.limit), toCents(c.spent), toCents(c.single), toCents(c.atm),
      c.pin, c.frozen ? 1 : 0, i === 0 || (personal && i === 1) ? "added" : "not_added", JSON.stringify(controls),
      JSON.stringify(shipping), t - DAY * (personal ? [70, 42, 20][i] : [90, 60, 38][i]));
  });
  const cardFor = (category: string) => personal
    ? category === "Software" ? cardIds[1] : category === "Travel" ? cardIds[2] : cardIds[0]
    : category === "Advertising" ? cardIds[1] : category === "Software" || category === "Utilities" ? cardIds[0] : cardIds[2];

  /* ---- account ---- */
  // Demo parity numbers for the seeded identities; random (unique) for everyone else.
  const parityNumber = personal ? "509381726142" : "409281729014";
  const taken = db.prepare("SELECT 1 FROM accounts WHERE account_number = ?").get(parityNumber);
  const accountNumber = taken ? Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join("") : parityNumber;
  const info = db.prepare(
    `INSERT INTO accounts (user_id, account_number, routing_number, bank_name, balance_cents, pending_cents, rewards_cents, lifetime_rewards_cents, scout_saved_cents, created_at, updated_at)
     VALUES (?, ?, '091408735', 'Northfield Bank', ?, ?, 0, 0, 0, ?, ?)`,
  ).run(userId, accountNumber, toCents(personal ? 6824.65 : 84290.42), toCents(personal ? 325 : 2174.5), t - DAY * 90, t);
  const accountId = Number(info.lastInsertRowid);

  /* ---- transactions ---- */
  // merchant, category, amount, daysAgo, memo, method, scoutRate
  const businessRows: Array<[string, string, number, number, string, string, number]> = [
    ["Fable Cloud", "Software", -218, 1, "Team workspace · monthly", "Card", 0.08],
    ["Northstar Ads", "Advertising", -1240.5, 3, "Spring retargeting campaign", "Card", 0.12],
    ["Orbit Mobile", "Utilities", -92, 5, "Team phone lines", "Card", 0],
    ["Pixelforge", "Software", -256, 8, "Design plugins · annual", "Card", 0.1],
    ["Harbor Studio", "Operations", -1480, 11, "Brand workshop", "ACH", 0],
    ["Canvas Studio", "Software", -150.4, 14, "Editor seats", "Card", 0],
    ["Skyline Rail", "Travel", -318.75, 18, "Client visit", "Card", 0.06],
    ["Mono Labs", "Operations", 6800, 21, "Invoice #1048 · milestone 2", "ACH", 0],
    ["Searchlight Ads", "Advertising", -860.2, 25, "Search campaign", "Card", 0.07],
    ["Deskwork Supply", "Equipment", -412.6, 29, "Monitors for new hires", "Card", 0],
    ["Stratus Compute", "Software", -642.1, 34, "Cloud hosting", "Card", 0.09],
    ["Commons Coworking", "Operations", -599, 42, "Desk memberships", "ACH", 0],
    ["Card processor payout", "Operations", 12450, 45, "Weekly sales settlement", "ACH", 0],
    ["Ledgerly Advisors", "Professional", -1200, 52, "Quarterly bookkeeping", "Wire", 0],
  ];
  const personalRows: Array<[string, string, number, number, string, string, number]> = [
    ["Green Basket Market", "Operations", -86.42, 1, "Weekly groceries", "Card", 0.04],
    ["Daily Grind Coffee", "Operations", -6.85, 2, "Morning coffee", "Card", 0],
    ["Northfield Payroll", "Operations", 3250, 3, "Direct deposit", "ACH", 0],
    ["Metro Transit", "Travel", -42, 5, "Monthly transit pass", "Card", 0.06],
    ["Streambox", "Software", -16.99, 8, "Monthly subscription", "Card", 0.08],
    ["Oak Street Rent", "Operations", -1450, 11, "Monthly rent", "ACH", 0],
    ["City Electric", "Utilities", -93.18, 14, "Electric bill", "ACH", 0.04],
    ["Harbor Pharmacy", "Operations", -34.6, 18, "Prescription", "Card", 0],
    ["Northstar Air", "Travel", -328.4, 23, "Weekend flight", "Card", 0.07],
    ["Corner Books", "Operations", -28.95, 27, "Books", "Card", 0],
    ["Orbit Mobile", "Utilities", -74, 33, "Mobile plan", "Card", 0.05],
    ["Northfield Payroll", "Operations", 3250, 34, "Direct deposit", "ACH", 0],
    ["Home Savings", "Operations", -500, 38, "Savings transfer", "ACH", 0],
    ["Fitness House", "Operations", -49, 47, "Monthly membership", "Card", 0.05],
  ];
  const rows = personal ? personalRows : businessRows;
  const insertTxn = db.prepare(
    `INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, reward_cents, scout_cents, card_id, status, reference, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cleared', ?, ?, ?)`,
  );
  let rewardsTotal = 0;
  let scoutTotal = 0;
  rows.forEach(([merchant, category, amount, daysAgo, note, method, scoutRate], i) => {
    const reward = amount < 0 ? Math.round(Math.abs(amount) * rewardRate(category) * 100) : 0;
    const scout = amount < 0 ? Math.round(Math.abs(amount) * scoutRate * 100) : 0;
    rewardsTotal += reward;
    scoutTotal += scout;
    insertTxn.run(`txn_${userId}_${i}`, accountId, userId, merchant, category, method, toCents(amount), reward, scout,
      method === "Card" ? cardFor(category) : null, makeReference(), note, t - DAY * daysAgo - Math.floor(Math.random() * 8) * HOUR);
  });
  const lifetimeRewards = rewardsTotal + toCents(personal ? 286.4 : 1420.5);
  db.prepare("UPDATE accounts SET rewards_cents = ?, lifetime_rewards_cents = ?, scout_saved_cents = ? WHERE id = ?")
    .run(rewardsTotal, lifetimeRewards, scoutTotal, accountId);

  /* ---- invoices ---- */
  const insertInvoice = db.prepare(
    `INSERT INTO invoices (id, user_id, client, client_email, amount_cents, status, due_at, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  if (!personal) {
    insertInvoice.run("1051", userId, "Quill & Co", "accounts@quill.example", toCents(3250), "open", t + DAY * 18, "Website retainer", t - DAY * 2);
    insertInvoice.run("1050", userId, "Lumen Retail", "finance@lumen.example", toCents(1150), "overdue", t - DAY * 4, "Product photography", t - DAY * 24);
    insertInvoice.run("1049", userId, "Harbor Studio", "ap@harbor.example", toCents(2400), "open", t + DAY * 6, "Workshop facilitation", t - DAY * 8);
    insertInvoice.run("1048", userId, "Mono Labs", "billing@monolabs.example", toCents(6800), "paid", t - DAY * 21, "Milestone 2 delivery", t - DAY * 35);
  }

  /* ---- team ---- */
  const insertTeam = db.prepare(
    `INSERT INTO team_members (id, user_id, name, email, role, card_count, monthly_limit_cents, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
  );
  insertTeam.run(rid("tm"), userId, p.name, p.email, "Owner", personal ? 3 : 2, toCents(personal ? 9500 : 25000));
  if (!personal) {
    insertTeam.run(rid("tm"), userId, "Marcus Vance", `marcus@${domain}`, "Admin", 1, toCents(8000));
    insertTeam.run(rid("tm"), userId, "Chloe Chen", `chloe@${domain}`, "Bookkeeper", 0, 0);
  }

  /* ---- perks ---- */
  const insertPerk = db.prepare(
    `INSERT INTO perks (id, user_id, partner, category, value, description, code, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const perks = personal ? [
    ["pp1", "Green Basket", "Everyday", "$15 grocery credit", "Spend $100 on groceries and get $15 back.", "VEYRA-GROCERY15", "available"],
    ["pp2", "Northstar Air", "Travel", "Free checked bag", "One checked bag on an eligible round trip.", "VEYRA-FLYFREE", "available"],
    ["pp3", "Streambox", "Entertainment", "3 months free", "New and returning members get three months on us.", "VEYRA-STREAM3", "redeemed"],
    ["pp4", "Daily Grind", "Dining", "20% back", "Cash back on one coffee order each week.", "VEYRA-COFFEE20", "available"],
  ] : [
    ["p1", "Stratus Compute", "Infrastructure", "$5,000 credits", "Cloud hosting credits for new business accounts.", "VEYRA-STRATUS-5K", "available"],
    ["p2", "Notebook Pro", "Productivity", "6 months free", "Docs, wikis and AI writing for your whole team.", "VEYRA-NOTEBOOK-6M", "available"],
    ["p3", "Paywell Checkout", "Payments", "$20k fee-free", "No processing fees on your first $20,000 in card sales.", "VEYRA-PAYWELL-20K", "redeemed"],
    ["p4", "Trackline", "Software", "$1,000 credit", "Issue tracking and roadmaps for product teams.", "VEYRA-TRACK-1K", "available"],
    ["p5", "Wayfare Travel", "Travel", "20% off hotels", "Corporate rates at boutique hotels worldwide.", "VEYRA-WAYFARE20", "available"],
    ["p6", "Ledgerly Advisors", "Finance", "First month free", "A dedicated bookkeeper and a clean monthly close.", "VEYRA-LEDGER-1M", "available"],
  ];
  for (const [id, partner, category, value, description, code, status] of perks) {
    insertPerk.run(`${id}_${userId}`, userId, partner, category, value, description, code, status);
  }

  /* ---- notifications ---- */
  const insertNotif = db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, detail, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  if (personal) {
    insertNotif.run(rid("n"), userId, "scout", "Scout saved $26.27", "A lower fare was applied to your Northstar Air purchase.", 0, t - 2 * HOUR);
    insertNotif.run(rid("n"), userId, "transfer", "Paycheck deposited", "+$3,250.00 is available in checking.", 0, t - DAY * 3);
    insertNotif.run(rid("n"), userId, "card", "Travel card is frozen", "No new purchases can be made until you unfreeze it.", 1, t - DAY * 5);
    insertNotif.run(rid("n"), userId, "security", "New sign-in", "Chrome on macOS · verified with two-factor.", 1, t - DAY * 8);
  } else {
    insertNotif.run(rid("n"), userId, "scout", "Scout saved $148.86", "Negotiated an annual rate on your Northstar Ads plan.", 0, t - 2 * HOUR);
    insertNotif.run(rid("n"), userId, "invoice", "Invoice #1050 is overdue", "Lumen Retail hasn't paid $1,150.00 yet.", 0, t - 9 * HOUR);
    insertNotif.run(rid("n"), userId, "transfer", "Deposit received", "+$6,800.00 from Mono Labs cleared via ACH.", 1, t - DAY * 2);
    insertNotif.run(rid("n"), userId, "security", "New sign-in", "Chrome on macOS · verified with two-factor.", 1, t - DAY * 4);
  }

  /* ---- pockets ---- */
  const insertPocket = db.prepare(
    `INSERT INTO savings_pockets (id, user_id, name, balance_cents, target_cents, color, icon, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  if (personal) {
    insertPocket.run(rid("pocket"), userId, "Emergency fund", toCents(1850), toCents(5000), "#7558dc", "shield", t - DAY * 120);
    insertPocket.run(rid("pocket"), userId, "Summer trip", toCents(740), toCents(2200), "#3f9a68", "travel", t - DAY * 70);
  } else {
    insertPocket.run(rid("pocket"), userId, "Tax reserve", toCents(12400), toCents(20000), "#7558dc", "tax", t - DAY * 140);
    insertPocket.run(rid("pocket"), userId, "Payroll buffer", toCents(6800), toCents(15000), "#3f9a68", "payroll", t - DAY * 95);
  }

  /* ---- payees ---- */
  const insertPayee = db.prepare(
    `INSERT INTO payees (id, user_id, name, nickname, bank_name, routing_number, account_last4, account_type, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  );
  const payeeIds: string[] = [];
  const payees = personal ? [
    ["Oak Street Properties", "Rent", "Civic Bank", "071000288", "3018"],
    ["Jordan Ellis", "Jordan", "Union Savings", "122105155", "8842"],
    ["City Electric", "", "Metro Bank", "026009593", "4420"],
  ] : [
    ["Harbor Studio", "", "Civic Bank", "071000288", "1180"],
    ["Ledgerly Advisors", "", "Union Savings", "122105155", "7204"],
    ["Commons Coworking", "", "Metro Bank", "026009593", "6107"],
  ];
  payees.forEach(([name, nickname, bankName, routing, last4], i) => {
    const id = rid("payee");
    payeeIds.push(id);
    insertPayee.run(id, userId, name, nickname, bankName, routing, last4, "Checking", t - DAY * (personal ? [100, 48, 80][i] : [120, 84, 64][i]));
  });

  /* ---- scheduled payments ---- */
  const insertSched = db.prepare(
    `INSERT INTO scheduled_payments (id, user_id, payee_id, payee_name, amount_cents, category, frequency, next_date, status, autopay, memo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  );
  if (personal) {
    insertSched.run(rid("bill"), userId, payeeIds[0], "Oak Street Properties", toCents(1450), "Operations", "monthly", t + DAY * 7, 1, "Monthly rent");
    insertSched.run(rid("bill"), userId, payeeIds[2], "City Electric", toCents(96), "Utilities", "monthly", t + DAY * 12, 1, "Electric bill");
    insertSched.run(rid("bill"), userId, null, "Orbit Mobile", toCents(74), "Utilities", "monthly", t + DAY * 19, 1, "Mobile plan");
  } else {
    insertSched.run(rid("bill"), userId, payeeIds[2], "Commons Coworking", toCents(599), "Operations", "monthly", t + DAY * 5, 1, "Workspace membership");
    insertSched.run(rid("bill"), userId, payeeIds[1], "Ledgerly Advisors", toCents(1200), "Professional", "monthly", t + DAY * 14, 0, "Bookkeeping retainer");
  }

  /* ---- security sessions ---- */
  const insertSession = db.prepare(
    `INSERT INTO security_sessions (id, user_id, device, browser, location, last_active, current, trusted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertSession.run(rid("session"), userId, "MacBook Pro", "Chrome", "San Francisco, CA", t, 1, 1);
  insertSession.run(rid("session"), userId, "iPhone", "Veyra mobile", "San Francisco, CA", t - 6 * HOUR, 0, 1);
  insertSession.run(rid("session"), userId, "Windows laptop", "Edge", "Oakland, CA", t - DAY * 18, 0, 0);

  /* ---- preferences + KYC ---- */
  db.prepare("INSERT OR REPLACE INTO preferences (user_id, two_factor, login_alerts, scout_auto, weekly_digest) VALUES (?, 1, 1, 1, 0)").run(userId);
  db.prepare(
    `INSERT OR REPLACE INTO kyc_records (user_id, status, completeness, document_type, country, next_step, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, personal ? "in_review" : "approved", personal ? 72 : 92, personal ? "Passport" : "Business registration",
    "United States", personal ? "Awaiting address verification review." : "Ready for final account review.", t - DAY * 2);

  /* ---- a seeded dispute for the risk queue (personal only) ---- */
  if (personal) {
    db.prepare(
      `INSERT INTO disputes (id, user_id, transaction_id, merchant, amount_cents, reason, detail, status, opened_at, updated_at)
       VALUES (?, ?, ?, 'Northstar Air', ?, 'Duplicate charge', 'Charged twice for the same booking.', 'submitted', ?, ?)`,
    ).run(rid("dsp"), userId, `txn_${userId}_8`, toCents(328.4), t - 2 * DAY, t - 2 * DAY);
  }
}

/* ============================================================ snapshot ==== */

/** Loads a column value as nullable string. */
const s = (v: unknown) => (v == null ? undefined : String(v));

export function buildMemberState(db: DatabaseSync, userId: string): Record<string, unknown> | null {
  const user = db.prepare("SELECT name, business, account_type, status FROM users WHERE id = ?").get(userId) as
    | { name: string; business: string; account_type: string; status: string }
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
    createdAt: c.created_at as number,
  }));

  const transactions = (db.prepare("SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 400").all(userId) as Array<Record<string, unknown>>).map(t => ({
    id: String(t.id),
    merchant: String(t.merchant),
    category: String(t.category),
    amount: dollars(t.amount_cents as number),
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

  const team = (db.prepare("SELECT * FROM team_members WHERE user_id = ?").all(userId) as Array<Record<string, unknown>>).map(m => ({
    id: String(m.id),
    name: String(m.name),
    email: String(m.email),
    role: m.role,
    cardCount: m.card_count as number,
    monthlyLimit: dollars(m.monthly_limit_cents as number),
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

  const sessions = (db.prepare("SELECT * FROM security_sessions WHERE user_id = ? ORDER BY last_active DESC").all(userId) as Array<Record<string, unknown>>).map(x => ({
    id: String(x.id),
    device: String(x.device),
    browser: String(x.browser),
    location: String(x.location),
    lastActive: x.last_active as number,
    current: x.current === 1,
    trusted: x.trusted === 1,
  }));

  const kycRow = db.prepare("SELECT * FROM kyc_records WHERE user_id = ?").get(userId) as Record<string, unknown> | undefined;
  const requester = kycRow?.requested_by ? (db.prepare("SELECT name FROM users WHERE id = ?").get(String(kycRow.requested_by)) as { name: string } | undefined) : undefined;
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
    invoices,
    bankDetails: {
      accountNumber: String(account?.account_number ?? ""),
      routingNumber: String(account?.routing_number ?? ""),
      bankName: String(account?.bank_name ?? ""),
      accountType: personal ? "Personal checking" : "Business checking",
      holder,
    },
    team,
    perks,
    notifications,
    preferences: {
      twoFactor: prefs?.two_factor !== 0,
      loginAlerts: prefs?.login_alerts !== 0,
      scoutAuto: prefs?.scout_auto !== 0,
      weeklyDigest: prefs?.weekly_digest === 1,
    },
    savingsPockets: pockets,
    payees,
    scheduledPayments: scheduled,
    disputes,
    sessions,
    scoutApplied: JSON.parse(String(account?.scout_applied_json ?? "[]")),
    kyc,
    accountStatus: user.status === "restricted" ? "restricted" : "active",
  };
}
