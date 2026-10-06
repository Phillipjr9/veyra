import type { DatabaseSync } from "node:sqlite";
import { centsToDecimal } from "./db.js";

/** UTC calendar months, not a rolling window or a browser-provided timezone. */
export function teamSpendWindow(at = Date.now()) {
  const date = new Date(at);
  return {
    startsAt: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
    resetsAt: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
  };
}

export function teamSpendByActor(db: DatabaseSync, ownerId: string, at = Date.now()) {
  const { startsAt, resetsAt } = teamSpendWindow(at);
  return new Map((db.prepare(`
    SELECT performed_by AS actor, SUM(-amount_cents) AS spent
    FROM transactions
    WHERE user_id = ? AND performed_by IS NOT NULL AND amount_cents < 0
      AND status IN ('cleared', 'pending') AND created_at >= ? AND created_at < ?
    GROUP BY performed_by
  `).all(ownerId, startsAt, resetsAt) as Array<{ actor: string; spent: number }>).map(row => [row.actor, row.spent]));
}

export class TeamSpendingError extends Error {
  readonly status = 403;
  constructor(public code: "team_monthly_limit" | "team_access", message: string,
    public details: { limit?: number; spent?: number; remaining?: number; resetsAt?: number } = {}) {
    super(message);
  }
}

/**
 * Call ONLY inside the same BEGIN IMMEDIATE transaction as the debit and its
 * ledger insert. Stamp that insert with the authenticated actor in performed_by.
 * Existing unattributed ledger entries are preserved, not guessed or reassigned.
 */
export function enforceTeamSpend(db: DatabaseSync, ownerId: string, actorId: string, cents: number, at = Date.now()) {
  if (!db.isTransaction) throw new Error("Team spending checks require a write transaction.");
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error("Invalid spending amount.");
  if (actorId === ownerId) return; // Owners are governed by account/card controls, not teammate caps.

  // Re-read access after acquiring the lock (a quote fetch may have awaited).
  const member = db.prepare(`
    SELECT m.monthly_limit_cents AS cap, m.status, u.team_role AS role
    FROM team_members m JOIN users u ON u.id = m.member_user_id AND u.team_owner_id = m.user_id
    WHERE m.user_id = ? AND m.member_user_id = ?
  `).get(ownerId, actorId) as { cap: number; status: string; role: string } | undefined;
  if (!member || member.status !== "active" || !["Admin", "Member"].includes(member.role)) {
    throw new TeamSpendingError("team_access", "Your team access no longer permits spending. Ask the account owner.");
  }
  const spent = teamSpendByActor(db, ownerId, at).get(actorId) ?? 0;
  const cap = Number.isSafeInteger(member.cap) && member.cap > 0 ? member.cap : 0;
  const remaining = Math.max(0, cap - spent);
  if (cents > remaining) {
    const { resetsAt } = teamSpendWindow(at);
    throw new TeamSpendingError("team_monthly_limit",
      `Monthly team spending limit exceeded. $${centsToDecimal(remaining)} remains until ${new Date(resetsAt).toISOString().slice(0, 10)} (UTC). Ask the account owner to review your limit.`,
      { limit: cap / 100, spent: spent / 100, remaining: remaining / 100, resetsAt });
  }
}
