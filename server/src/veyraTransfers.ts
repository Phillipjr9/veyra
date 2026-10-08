/**
 * Veyra-to-Veyra transfers.
 *
 * Every member has a Veyra ID (and their email) that other members can use to
 * send money to them instantly. The ID is deliberately not the account number:
 * sharing it reveals no bank details, and it can be shown as a scannable code.
 *
 * Money moves in one database transaction: the sender is debited, the recipient
 * is credited, both ledger rows are written, and a replay-safe record is kept
 * under the sender's request key. A retried request returns the original
 * result instead of paying twice.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { BadInputError, centsToDecimal, dollarsToCents, inTransaction, now, rid } from "./db.js";
import { rateLimit } from "./security.js";

export const VEYRA_ID_PATTERN = /^VYR\d{9}$/;
const MAX_TRANSFER_CENTS = 250_000_00;
const MAX_BALANCE_CENTS = 1_000_000_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

type Recipient = { id: string; name: string; email: string; veyra_id: string };

export type VeyraTransferDeps = {
  notify: (userId: string, type: string, title: string, detail: string) => void;
  /** Team spend limits apply to every outgoing payment, Veyra transfers included. */
  enforceSpend: (ownerId: string, actorId: string, cents: number, at: number) => void;
  paymentsHalted: () => boolean;
};

/** Accepts a member's email (any case) or a Veyra ID (spaces and dashes ignored). */
export function normaliseIdentifier(raw: unknown): { kind: "email" | "veyraId"; value: string } | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 254) return null;
  if (trimmed.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? { kind: "email", value: trimmed.toLowerCase() } : null;
  const compact = trimmed.replace(/[\s-]/g, "").toUpperCase();
  return VEYRA_ID_PATTERN.test(compact) ? { kind: "veyraId", value: compact } : null;
}

/**
 * Finds the active member a sender may pay. Unknown and ineligible identifiers
 * return the same wording, so the lookup does not reveal which emails exist.
 */
export function findRecipient(db: DatabaseSync, senderId: string, raw: unknown): Recipient | string {
  const identifier = normaliseIdentifier(raw);
  if (!identifier) return "Enter a valid email address or Veyra ID (VYR followed by nine digits).";
  const row = identifier.kind === "email"
    ? db.prepare("SELECT id, name, email, veyra_id, status FROM users WHERE email = ? COLLATE NOCASE AND role = 'user' AND team_owner_id IS NULL").get(identifier.value)
    : db.prepare("SELECT id, name, email, veyra_id, status FROM users WHERE veyra_id = ? AND role = 'user' AND team_owner_id IS NULL").get(identifier.value);
  if (!row) return "No Veyra member matches that email or Veyra ID. Check it with the recipient.";
  const found = row as Recipient & { status: string };
  if (found.id === senderId) return "That is your own Veyra ID. Choose another member.";
  if (found.status !== "active") return "This member cannot receive transfers right now.";
  if (!db.prepare("SELECT 1 FROM accounts WHERE user_id = ?").get(found.id)) return "This member cannot receive transfers yet.";
  return { id: found.id, name: found.name, email: found.email, veyra_id: found.veyra_id };
}

const maskEmail = (email: string) => {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 2)}${"•".repeat(Math.max(1, local.length - 2))}@${domain}`;
};

export function createVeyraTransfers(db: DatabaseSync, deps: VeyraTransferDeps) {
  return {
    lookup(req: Request, res: Response) {
      const senderId = req.user!.id;
      if (!rateLimit(`veyra-lookup:${senderId}`, 60, 60 * 60_000)) {
        return void res.status(429).json({ error: "Too many recipient checks. Try again later." });
      }
      const found = findRecipient(db, senderId, req.body?.identifier);
      if (typeof found === "string") return void res.status(400).json({ error: found });
      res.json({ recipient: { name: found.name, veyraId: found.veyra_id, email: maskEmail(found.email) } });
    },

    transfer(req: Request, res: Response) {
      const body = req.body ?? {};
      const senderId = req.user!.id;
      if (req.user!.status === "restricted") return void res.status(403).json({ error: "Your account is restricted. Outgoing transfers are paused — contact support." });
      if (deps.paymentsHalted()) return void res.status(503).json({ error: "Payment rails are temporarily halted. Please try again shortly." });
      if (typeof body.requestKey !== "string" || !UUID.test(body.requestKey)) return void res.status(400).json({ error: "A request identifier is required." });
      if (!["string", "number"].includes(typeof body.amount) || !/^\d+(\.\d{1,2})?$/.test(String(body.amount))) return void res.status(400).json({ error: "Enter a dollar amount with at most two decimals." });
      const cents = dollarsToCents(body.amount);
      if (cents <= 0) return void res.status(400).json({ error: "Amount must be greater than zero." });
      if (cents > MAX_TRANSFER_CENTS) return void res.status(400).json({ error: "Transfers are limited to $250,000 per transaction." });
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
      const suppliedCategory = typeof body.category === "string" ? body.category.trim() : "";
      if (suppliedCategory.length > 80) return void res.status(400).json({ error: "Category is too long." });
      if (req.user!.accountType === "business" && !suppliedCategory) return void res.status(400).json({ error: "A category is required for business transfers." });
      const category = suppliedCategory || "Uncategorized";
      if (!rateLimit(`veyra-transfer:${senderId}`, 30, 60 * 60_000)) return void res.status(429).json({ error: "Too many transfers. Try again later." });

      try {
        const found = findRecipient(db, senderId, body.identifier);
        if (typeof found === "string") return void res.status(400).json({ error: found });
        const outcome = inTransaction(db, () => {
          const prior = db.prepare("SELECT * FROM veyra_transfers WHERE sender_id = ? AND request_key = ?").get(senderId, body.requestKey) as
            | { id: string; amount_cents: number; recipient_id: string; reference: string; created_at: number; note: string; sender_before_cents: number; sender_after_cents: number }
            | undefined;
          if (prior) {
            if (prior.amount_cents !== cents || prior.recipient_id !== found.id || prior.note !== note) {
              throw new BadInputError("This request identifier was already used for different details.");
            }
            return { replayed: true, row: prior };
          }
          const sender = db.prepare("SELECT id, balance_cents FROM accounts WHERE user_id = ?").get(senderId) as { id: number; balance_cents: number } | undefined;
          if (!sender) throw new BadInputError("No account found.");
          if (sender.balance_cents < cents) throw new BadInputError("Insufficient funds for this transfer.");
          const receiver = db.prepare("SELECT id, balance_cents FROM accounts WHERE user_id = ?").get(found.id) as { id: number; balance_cents: number };
          if (receiver.balance_cents + cents > MAX_BALANCE_CENTS) throw new BadInputError("The recipient's account cannot accept this amount.");
          const at = now();
          deps.enforceSpend(senderId, req.user!.loginId ?? senderId, cents, at);
          const senderAfter = sender.balance_cents - cents;
          db.prepare("UPDATE accounts SET balance_cents = ?, updated_at = ? WHERE id = ?").run(senderAfter, at, sender.id);
          db.prepare("UPDATE accounts SET balance_cents = balance_cents + ?, updated_at = ? WHERE id = ?").run(cents, at, receiver.id);
          const reference = `VYR-${randomUUID().slice(0, 12).toUpperCase()}`;
          const senderName = (db.prepare("SELECT name FROM users WHERE id = ?").get(senderId) as { name: string }).name;
          const memo = note || `Veyra transfer to ${found.name}`;
          const recordId = rid("vxfer");
          db.prepare("INSERT INTO veyra_transfers (id, sender_id, recipient_id, amount_cents, reference, request_key, note, created_at, sender_before_cents, sender_after_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run(recordId, senderId, found.id, cents, reference, body.requestKey, note, at, sender.balance_cents, senderAfter);
          db.prepare(`INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, fee_cents, status, reference, note, created_at, performed_by)
            VALUES (?, ?, ?, ?, ?, 'Veyra', ?, 0, 'cleared', ?, ?, ?, ?)`)
            .run(rid("txn"), sender.id, senderId, found.name, category, -cents, reference, memo, at, senderId);
          db.prepare(`INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, fee_cents, status, reference, note, created_at, performed_by)
            VALUES (?, ?, ?, ?, 'Transfers', 'Veyra', ?, 0, 'cleared', ?, ?, ?, ?)`)
            .run(rid("txn"), receiver.id, found.id, senderName, cents, reference, note || `Veyra transfer from ${senderName}`, at, senderId);
          deps.notify(senderId, "transfer", `Sent ${centsToDecimal(cents)} to ${found.name}`, "Veyra transfer · instant · no fee");
          deps.notify(found.id, "transfer", `Received ${centsToDecimal(cents)} from ${senderName}`, "Veyra transfer · available now");
          return { replayed: false, row: { id: recordId, amount_cents: cents, recipient_id: found.id, reference, created_at: at, note, sender_before_cents: sender.balance_cents, sender_after_cents: senderAfter } };
        });
        const row = outcome.row;
        const current = (db.prepare("SELECT balance_cents FROM accounts WHERE user_id = ?").get(senderId) as { balance_cents: number }).balance_cents;
        res.status(outcome.replayed ? 200 : 201).json({
          replayed: outcome.replayed,
          result: {
            reference: row.reference, date: row.created_at, amount: row.amount_cents / 100, fee: 0,
            balanceBefore: row.sender_before_cents / 100, balanceAfter: row.sender_after_cents / 100, reward: 0, scout: 0,
          },
          recipient: { name: found.name, veyraId: found.veyra_id },
          balance: centsToDecimal(current),
        });
      } catch (error) {
        if (error instanceof BadInputError) return void res.status(400).json({ error: error.message });
        res.status(500).json({ error: "Transfer could not be completed. Check your balance and try again." });
      }
    },
  };
}
