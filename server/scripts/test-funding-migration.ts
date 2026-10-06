import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";

/** Reconstruct the exact v17 funding schema in a disposable copy and upgrade it. */
export function testFundingMigration(source: DatabaseSync, check: (name: string, ok: unknown) => void) {
  const dir = mkdtempSync(join(tmpdir(), "veyra-funding-migration-"));
  const path = join(dir, "legacy.db");
  let db: DatabaseSync | undefined;
  try {
    source.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
    db = new DatabaseSync(path);
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TEMP TABLE saved_methods AS SELECT id,user_id,label,kind,instructions,bank_name,routing_number,account_number,recipient,enabled,updated_at FROM funding_methods;
      CREATE TEMP TABLE saved_requests AS SELECT * FROM funding_requests;
      DROP TABLE funding_requests;
      DROP TABLE funding_methods;
      CREATE TABLE funding_methods (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), label TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('bank','wire','card','check','other')), instructions TEXT NOT NULL,
        bank_name TEXT NOT NULL DEFAULT '', routing_number TEXT NOT NULL DEFAULT '', account_number TEXT NOT NULL DEFAULT '',
        recipient TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_funding_methods_user ON funding_methods(user_id);
      CREATE TABLE funding_requests (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), method_id TEXT NOT NULL REFERENCES funding_methods(id),
        amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected')),
        reference TEXT NOT NULL, method_snapshot TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL DEFAULT '',
        request_key TEXT NOT NULL, created_at INTEGER NOT NULL, reviewed_at INTEGER, reviewed_by TEXT REFERENCES users(id),
        UNIQUE(user_id, request_key)
      );
      CREATE INDEX idx_funding_requests_user ON funding_requests(user_id, created_at);
      INSERT INTO funding_methods SELECT * FROM saved_methods;
      INSERT INTO funding_requests SELECT * FROM saved_requests;
      INSERT INTO funding_requests (id,user_id,method_id,amount_cents,reference,method_snapshot,request_key,created_at)
        SELECT 'upgrade-pending-fixture',user_id,id,2500,'MIGRATION-FIXTURE','{}','migration-fixture',1 FROM funding_methods LIMIT 1;
      DELETE FROM schema_migrations WHERE version=18;
    `);
    const methodsBefore = db.prepare("SELECT * FROM funding_methods ORDER BY id").all();
    const requestsBefore = db.prepare("SELECT * FROM funding_requests ORDER BY id").all();
    db.close(); db = openDb(path);
    const methodsAfter = db.prepare("SELECT id,user_id,label,kind,instructions,bank_name,routing_number,account_number,recipient,enabled,updated_at FROM funding_methods ORDER BY id").all();
    check("funding migration preserves method identifiers, instructions and disabled state", JSON.stringify(methodsBefore) === JSON.stringify(methodsAfter));
    check("funding migration preserves pending/confirmed/rejected requests and snapshots", JSON.stringify(requestsBefore) === JSON.stringify(db.prepare("SELECT * FROM funding_requests ORDER BY id").all()));
    check("funding migration retains valid foreign keys", db.prepare("PRAGMA foreign_key_check").all().length === 0);
    check("upgraded requests reference the final funding table", (db.prepare("PRAGMA foreign_key_list(funding_requests)").all() as Array<{table:string}>).some(r => r.table === 'funding_methods'));
    check("upgraded legacy methods have empty Zelle contact by default", (db.prepare("SELECT recipient_contact FROM funding_methods").all() as Array<{recipient_contact:string}>).every(m => m.recipient_contact === ''));
    db.close(); db = openDb(path);
    check("funding migration is safe to reopen", db.prepare("PRAGMA foreign_key_check").all().length === 0 && db.prepare("SELECT version FROM schema_migrations WHERE version=18").get());
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
}
