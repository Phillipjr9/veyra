import type { DatabaseSync } from "node:sqlite";
import { DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD, DEMO_PASSWORD } from "./demo.js";
import { verifyPassword } from "./security.js";

/** Only public development fixtures, never configured operator credentials. */
const FIXTURES = [
  { label: "Personal", email: "demo.personal@veyra.dev", password: DEMO_PASSWORD, role: "user", accountType: "personal" },
  { label: "Business", email: "demo.business@veyra.dev", password: DEMO_PASSWORD, role: "user", accountType: "business" },
  { label: "Super Admin", email: DEMO_ADMIN_EMAIL, password: DEMO_ADMIN_PASSWORD, role: "superadmin", accountType: null },
] as const;

export function createPreviewAccess(db: DatabaseSync) {
  // Avoid repeated password hashing on this anonymous config read. Changes to
  // the stored hash invalidate the result; no plaintext is read from the DB.
  const checked = new Map<string, { hash: string; matches: boolean }>();
  return () => {
    if (process.env.NODE_ENV === "production" || process.env.PREVIEW_LOGIN_SHORTCUTS !== "1") return [];
    return FIXTURES.flatMap(fixture => {
      const row = db.prepare("SELECT password_hash,account_type FROM users WHERE email=? AND role=? AND status='active' AND team_owner_id IS NULL")
        .get(fixture.email, fixture.role) as { password_hash: string; account_type: string } | undefined;
      if (!row || (fixture.accountType && row.account_type !== fixture.accountType)) return [];
      let cached = checked.get(fixture.email);
      if (cached?.hash !== row.password_hash) {
        let matches = false;
        try { matches = verifyPassword(fixture.password, row.password_hash); } catch { /* Invalid hashes never advertise credentials. */ }
        cached = { hash: row.password_hash, matches };
        checked.set(fixture.email, cached);
      }
      return cached.matches ? [{ label: fixture.label, email: fixture.email, password: fixture.password }] : [];
    });
  };
}
