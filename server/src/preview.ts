import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { inTransaction, now, rid } from "./db.js";
import { hashPassword } from "./security.js";

/**
 * Ephemeral role shortcuts for the Arena/Vite preview only.
 *
 * These records are never created unless PREVIEW_ACCOUNTS=true and are
 * refused whenever NODE_ENV=production. The UI is also compiled out of a
 * production Vite build via import.meta.env.DEV.
 */
export type PreviewPersona = "personal" | "business" | "superadmin";

type PreviewIdentity = {
  id: string;
  name: string;
  email: string;
  business: string;
  accountType: "personal" | "business";
  role: "user" | "superadmin";
  plan: "Starter" | "Pro";
  balanceCents: number;
  pendingCents: number;
  rewardsCents: number;
  accountNumber: string;
};

const identities: Record<PreviewPersona, PreviewIdentity> = {
  personal: {
    id: "preview_personal", name: "Amara Okafor", email: "preview.personal@veyra.local", business: "",
    accountType: "personal", role: "user", plan: "Starter", balanceCents: 824_650, pendingCents: 12_480,
    rewardsCents: 4_286, accountNumber: "427105028614",
  },
  business: {
    id: "preview_business", name: "Maya Adeyemi", email: "preview.business@veyra.local", business: "Northstar Studio",
    accountType: "business", role: "user", plan: "Pro", balanceCents: 4_825_000, pendingCents: 138_400,
    rewardsCents: 18_640, accountNumber: "684220391075",
  },
  superadmin: {
    id: "preview_superadmin", name: "Alex Morgan", email: "preview.admin@veyra.local", business: "Veyra Operations",
    accountType: "business", role: "superadmin", plan: "Pro", balanceCents: 0, pendingCents: 0,
    rewardsCents: 0, accountNumber: "990041782640",
  },
};

export function previewAccessEnabled(): boolean {
  return process.env.PREVIEW_ACCOUNTS === "true" && process.env.NODE_ENV !== "production";
}

/** Creates a representative but fully isolated preview dataset exactly once. */
export function ensurePreviewProfiles(db: DatabaseSync): void {
  inTransaction(db, () => {
    for (const identity of Object.values(identities)) {
      if (db.prepare("SELECT 1 FROM users WHERE id = ?").get(identity.id)) continue;
      createIdentity(db, identity);
    }
  });
}

export function previewUserId(persona: PreviewPersona): string {
  return identities[persona].id;
}

function createIdentity(db: DatabaseSync, identity: PreviewIdentity): void {
  const createdAt = now();
  db.prepare(
    `INSERT INTO users (id, name, email, phone, business, account_type, role, plan, password_hash, status, created_at)
     VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, 'active', ?)`,
  ).run(
    identity.id, identity.name, identity.email, identity.business, identity.accountType, identity.role, identity.plan,
    hashPassword(randomUUID()), createdAt,
  );
  db.prepare(
    `INSERT INTO accounts (user_id, account_number, routing_number, bank_name, balance_cents, pending_cents, rewards_cents, created_at, updated_at)
     VALUES (?, ?, '091408735', 'Northfield Bank', ?, ?, ?, ?, ?)`,
  ).run(identity.id, identity.accountNumber, identity.balanceCents, identity.pendingCents, identity.rewardsCents, createdAt, createdAt);
  db.prepare("UPDATE accounts SET lifetime_rewards_cents = ?, scout_saved_cents = ? WHERE user_id = ?")
    .run(identity.rewardsCents * 3, identity.accountType === "business" ? 6_850 : 1_420, identity.id);
  db.prepare(
    `INSERT INTO kyc_records (user_id, status, completeness, document_type, country, next_step, updated_at)
     VALUES (?, 'approved', 100, 'Passport', 'United States', 'Verification complete', ?)`,
  ).run(identity.id, createdAt);
  db.prepare("INSERT INTO preferences (user_id, two_factor, login_alerts, scout_auto, weekly_digest) VALUES (?, 1, 1, 1, 1)").run(identity.id);
  db.prepare(
    `INSERT INTO team_members (id, user_id, name, email, role, card_count, monthly_limit_cents, status)
     VALUES (?, ?, ?, ?, 'Owner', 1, 0, 'active')`,
  ).run(rid("preview_team"), identity.id, identity.name, identity.email);
  db.prepare(
    `INSERT INTO security_sessions (id, user_id, device, browser, location, last_active, current, trusted)
     VALUES (?, ?, 'Preview workspace', 'Vite preview', 'Preview environment', ?, 1, 1)`,
  ).run(rid("preview_session"), identity.id, createdAt);

  if (identity.role === "superadmin") return;
  seedCard(db, identity, createdAt);
  seedTransactions(db, identity, createdAt);
  if (identity.accountType === "business") seedBusinessWorkspace(db, identity, createdAt);
  else seedPersonalWorkspace(db, identity, createdAt);
}

function seedCard(db: DatabaseSync, identity: PreviewIdentity, createdAt: number): void {
  const business = identity.accountType === "business";
  const id = `${identity.id}_card_primary`;
  const last4 = business ? "4839" : "1842";
  const limit = business ? 2_500_000 : 350_000;
  const spent = business ? 688_450 : 92_870;
  const controls = { online: true, contactless: true, atm: !business, international: true, magstripe: !business };
  db.prepare(
    `INSERT INTO cards (id, user_id, label, last4, full_number, expiry, cvv, type, cardholder, merchant_lock, category_lock,
      limit_cents, spent_cents, single_txn_limit_cents, daily_atm_limit_cents, pin, frozen, wallet_status, controls_json, shipping_json, created_at)
     VALUES (?, ?, ?, ?, ?, '09/29', '482', ?, ?, NULL, NULL, ?, ?, ?, ?, '8042', 0, 'added', ?, ?, ?)`,
  ).run(
    id, identity.id, business ? "Northstar operations" : "Everyday debit", last4, `9482 7714 9220 ${last4}`,
    business ? "virtual" : "physical", business ? identity.business : identity.name, limit, spent,
    business ? 500_000 : 125_000, business ? 0 : 60_000, JSON.stringify(controls),
    JSON.stringify(business ? { status: "not_applicable" } : { status: "delivered", deliveredAt: createdAt - 45 * 86_400_000, address: "Preview account" }), createdAt - 60 * 86_400_000,
  );
}

function seedTransactions(db: DatabaseSync, identity: PreviewIdentity, createdAt: number): void {
  const account = db.prepare("SELECT id FROM accounts WHERE user_id = ?").get(identity.id) as { id: number };
  const business = identity.accountType === "business";
  const rows = business
    ? [
        ["Horizon Labs", "Professional", "ACH", 1_280_000, "Client retainer"],
        ["Northstar Commerce", "Professional", "ACH", 962_500, "Project milestone"],
        ["Stratus Compute", "Software", "Card", -48_500, "Cloud infrastructure"],
        ["Figma", "Software", "Card", -15_000, "Design workspace"],
        ["Metro Media", "Advertising", "Card", -82_000, "Campaign spend"],
        ["Ellis & Finch", "Professional", "Wire", -215_000, "Legal advisory"],
        ["Field Notes Co.", "Operations", "Card", -36_450, "Studio supplies"],
        ["Olive & Main", "Travel", "Card", -22_700, "Client meeting"],
      ]
    : [
        ["Employer payroll", "Operations", "ACH", 462_000, "Monthly payroll"],
        ["Market Street Grocer", "Operations", "Card", -12_840, "Weekly groceries"],
        ["Metro Transit", "Travel", "Card", -5_650, "Commute"],
        ["Cloudline Mobile", "Utilities", "Card", -7_900, "Phone plan"],
        ["Brightside Savings", "Operations", "Transfer", -25_000, "Savings transfer"],
        ["Weekend Market", "Operations", "Card", -8_420, "Weekend spend"],
      ];

  rows.forEach(([merchant, category, method, amount, note], index) => {
    const isSpend = Number(amount) < 0;
    db.prepare(
      `INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, status, reference, note, performed_by, created_at, reward_cents, scout_cents, card_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'cleared', ?, ?, NULL, ?, ?, ?, ?)`,
    ).run(
      `${identity.id}_txn_${index}`, account.id, identity.id, merchant, category, method, amount,
      `PVW-${String(index + 1).padStart(4, "0")}`, note, createdAt - (index * 8 + 2) * 86_400_000,
      isSpend ? Math.round(Math.abs(Number(amount)) * 0.02) : 0, isSpend && index % 3 === 0 ? 120 : 0,
      method === "Card" ? `${identity.id}_card_primary` : null,
    );
  });
}

function seedBusinessWorkspace(db: DatabaseSync, identity: PreviewIdentity, createdAt: number): void {
  const invoices = [
    ["INV-1048", "Meridian Health", "billing@meridian.example", 740_000, "open", 8, "April brand platform"],
    ["INV-1049", "Kite & Harbor", "ap@kiteharbor.example", 425_000, "open", 15, "Product design retainer"],
    ["INV-1042", "Studio Forty", "finance@studioforty.example", 195_000, "overdue", -4, "Website performance audit"],
  ];
  invoices.forEach(([id, client, email, amount, status, dueOffset, description], index) => {
    db.prepare(
      `INSERT INTO invoices (id, user_id, client, client_email, amount_cents, status, due_at, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, identity.id, client, email, amount, status, createdAt + Number(dueOffset) * 86_400_000, description, createdAt - (index + 1) * 5 * 86_400_000);
  });

  const payments = [
    ["preview_bill_payroll", "Studio payroll", 285_000, "Operations", "monthly", 3, 1, "April contractor payout"],
    ["preview_bill_cloud", "Stratus Compute", 48_500, "Software", "monthly", 6, 1, "Cloud services"],
    ["preview_bill_media", "Metro Media", 82_000, "Advertising", "monthly", 12, 0, "Campaign media spend"],
  ];
  payments.forEach(([id, payee, amount, category, frequency, offset, autopay, memo]) => {
    db.prepare(
      `INSERT INTO scheduled_payments (id, user_id, payee_id, payee_name, amount_cents, category, frequency, next_date, status, autopay, memo)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(id, identity.id, payee, amount, category, frequency, createdAt + Number(offset) * 86_400_000, autopay, memo);
  });

  const teammates = [
    ["Jordan Lee", "jordan@northstar.example", "Admin", 1, 500_000],
    ["Sade Williams", "sade@northstar.example", "Bookkeeper", 0, 0],
    ["Priya Kapoor", "priya@northstar.example", "Member", 1, 250_000],
  ];
  teammates.forEach(([name, email, role, cardCount, limit]) => {
    db.prepare(
      `INSERT INTO team_members (id, user_id, name, email, role, card_count, monthly_limit_cents, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
    ).run(rid("preview_team"), identity.id, name, email, role, cardCount, limit);
  });

  db.prepare("INSERT INTO notifications (id, user_id, type, title, detail, read, created_at) VALUES (?, ?, 'invoice', 'Invoice INV-1048 viewed', 'Meridian Health viewed their April brand platform invoice.', 0, ?)")
    .run(rid("preview_note"), identity.id, createdAt - 3 * 3_600_000);
  db.prepare("INSERT INTO notifications (id, user_id, type, title, detail, read, created_at) VALUES (?, ?, 'scout', 'Scout found a savings opportunity', 'Review software subscriptions before your next billing cycle.', 0, ?)")
    .run(rid("preview_note"), identity.id, createdAt - 2 * 86_400_000);
}

function seedPersonalWorkspace(db: DatabaseSync, identity: PreviewIdentity, createdAt: number): void {
  db.prepare(
    `INSERT INTO savings_pockets (id, user_id, name, balance_cents, target_cents, color, icon, created_at)
     VALUES (?, ?, 'Home deposit', 215_000, 750_000, '#7558dc', 'home', ?)`,
  ).run(rid("preview_pocket"), identity.id, createdAt - 40 * 86_400_000);
  db.prepare("INSERT INTO notifications (id, user_id, type, title, detail, read, created_at) VALUES (?, ?, 'scout', 'Scout saved $14.20', 'A lower-cost option was found for a recurring service.', 0, ?)")
    .run(rid("preview_note"), identity.id, createdAt - 86_400_000);
}
