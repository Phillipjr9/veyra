import type { DatabaseSync } from "node:sqlite";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { BadInputError, inTransaction, now } from "./db.js";

type Audit = (req: Request, action: string, category: "Financial", target: string, summary: string, before?: string, after?: string) => void;
type Patch = Partial<{ bankName: string; routingNumber: string; bankAccountType: string }>;
type Row = { userId: string; name: string; email: string; accountNumber: string; bankName: string; routingNumber: string; bankAccountType: string };
type Snapshot = { rows: Row[]; patch: Patch; reason: string; scope: "all" | "selected" };
const fields = { bankName: "bank_name", routingNumber: "routing_number", bankAccountType: "bank_account_type" } as const;
const rowFields = `u.id AS userId,u.name,u.email,a.account_number AS accountNumber,a.bank_name AS bankName,a.routing_number AS routingNumber,a.bank_account_type AS bankAccountType`;
const ownerWhere = "u.role='user' AND u.team_owner_id IS NULL";
const publicRow = ({ accountNumber, ...row }: Row) => ({ ...row, accountLast4: accountNumber.slice(-4) });
const changes = (row: Row, patch: Patch) => Object.keys(patch).some(key => row[key as keyof Patch] !== patch[key as keyof Patch]);

export function createBulkAccounts(db: DatabaseSync, audit: Audit) {
  function owners(ids?: string[]) {
    const rows = db.prepare(`SELECT ${rowFields} FROM users u JOIN accounts a ON a.user_id=u.id WHERE ${ownerWhere} ORDER BY u.id`).all() as Row[];
    if (!ids) return rows;
    const wanted = new Set(ids); return rows.filter(row => wanted.has(row.userId));
  }
  return {
    preview(req: Request, res: Response) {
      const body = req.body ?? {}, raw = body.patch;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.keys(raw).length || Object.keys(raw).some(k => !Object.prototype.hasOwnProperty.call(fields,k))) throw new BadInputError("Choose only shared bank name, routing number or Checking/Savings type. Account numbers cannot be bulk changed.");
      const patch: Patch = {};
      for (const key of Object.keys(raw) as Array<keyof Patch>) {
        if (typeof raw[key] !== 'string' || !raw[key].trim()) throw new BadInputError("Selected fields cannot be empty.");
        patch[key] = raw[key].trim();
      }
      if (patch.bankName && patch.bankName.length > 120) throw new BadInputError("Bank name is too long.");
      if (patch.bankAccountType && !['Checking','Savings'].includes(patch.bankAccountType)) throw new BadInputError("Choose Checking or Savings.");
      if (patch.routingNumber) {
        const r = patch.routingNumber, d = [...r].map(Number);
        if (!/^\d{9}$/.test(r) || r === '000000000' || (3*(d[0]+d[3]+d[6])+7*(d[1]+d[4]+d[7])+d[2]+d[5]+d[8])%10) throw new BadInputError("Routing number must pass the nine-digit ABA checksum.");
      }
      if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) throw new BadInputError("Provide an audit reason of up to 500 characters.");
      if (!['all','selected'].includes(body.scope)) throw new BadInputError("Choose selected users or all account owners.");
      let ids: string[] | undefined;
      if (body.scope === 'selected') {
        if (!Array.isArray(body.userIds) || !body.userIds.length || body.userIds.length > 5000 || body.userIds.some((id: unknown) => typeof id !== 'string' || !id || id.length > 80)) throw new BadInputError("Select between 1 and 5,000 account owners.");
        ids = body.userIds;
        if (new Set(ids).size !== ids!.length) throw new BadInputError("Remove duplicate account selections.");
      }
      const result = inTransaction(db, () => {
        const rows = owners(ids);
        if (!rows.length || rows.length > 5000) throw new BadInputError("A review must contain 1–5,000 account owners. Use a smaller selection if needed.");
        if (ids && ids.length !== rows.length) throw new BadInputError("A selected account is missing or belongs to staff/a teammate. Refresh the directory.");
        db.prepare("DELETE FROM account_bulk_previews WHERE expires_at<? AND applied_at IS NULL").run(now());
        if ((db.prepare("SELECT COUNT(*) AS n FROM account_bulk_previews WHERE admin_id=? AND applied_at IS NULL").get(req.user!.id) as {n:number}).n >= 20) throw new BadInputError("Too many active reviews. Wait for old reviews to expire.");
        const previewId = randomUUID(), expiresAt = now() + 10*60_000;
        const snapshot: Snapshot = { rows, patch, reason: body.reason.trim(), scope: body.scope };
        db.prepare("INSERT INTO account_bulk_previews(id,admin_id,snapshot_json,expires_at,created_at) VALUES(?,?,?,?,?)").run(previewId,req.user!.id,JSON.stringify(snapshot),expiresAt,now());
        return { previewId, expiresAt, scope: body.scope, reason: snapshot.reason, patch, count: rows.length, changedCount: rows.filter(r => changes(r,patch)).length, rows: rows.map(publicRow) };
      });
      res.json(result);
    },
    apply(req: Request, res: Response) {
      if (typeof req.body?.previewId !== 'string') throw new BadInputError("Create a review before applying changes.");
      const result = inTransaction(db, () => {
        const record = db.prepare("SELECT * FROM account_bulk_previews WHERE id=? AND admin_id=?").get(req.body.previewId,req.user!.id) as { id:string; snapshot_json:string; expires_at:number; applied_at:number|null; changed_count:number|null } | undefined;
        if (!record) throw new BadInputError("Review not found for this administrator.");
        const snapshot = JSON.parse(record.snapshot_json) as Snapshot;
        if (req.body.confirmation !== `UPDATE ${snapshot.rows.length}`) throw new BadInputError("Enter the exact confirmation shown in the review.");
        if (record.applied_at !== null) return { count: snapshot.rows.length, changedCount: record.changed_count, appliedAt: record.applied_at, replayed: true };
        if (record.expires_at < now()) throw new BadInputError("This review expired. Review the current account details again.");
        const current = owners(snapshot.rows.map(r => r.userId));
        if (JSON.stringify(current) !== JSON.stringify(snapshot.rows)) throw new BadInputError("An account changed after this review. Nothing was updated. Start a fresh review.");
        const keys = Object.keys(snapshot.patch) as Array<keyof Patch>;
        const update = db.prepare(`UPDATE accounts SET ${keys.map(k => `${fields[k]}=?`).join(',')},receiving_details_configured=1,updated_at=? WHERE user_id=?`);
        const appliedAt = now(); let changedCount = 0;
        for (const row of current) {
          if (!changes(row,snapshot.patch)) continue;
          update.run(...keys.map(k => snapshot.patch[k]!), appliedAt, row.userId); changedCount++;
          audit(req,'account.bulk_details','Financial',`user:${row.userId}`,`Bulk ${record.id}: ${snapshot.reason}`,JSON.stringify(publicRow(row)),JSON.stringify(publicRow({...row,...snapshot.patch})));
        }
        audit(req,'account.bulk_summary','Financial',`bulk:${record.id}`,`${changedCount}/${current.length} accounts updated. ${snapshot.reason}`,undefined,JSON.stringify(snapshot.patch));
        db.prepare("UPDATE account_bulk_previews SET applied_at=?,changed_count=? WHERE id=?").run(appliedAt,changedCount,record.id);
        return { count: current.length, changedCount, appliedAt, replayed: false };
      });
      res.json(result);
    },
  };
}
