/**
 * Staff can rewrite every field on a member account: contact details, plan,
 * identity application, and KYC review state. Bank numbers stay on the
 * existing account-details editor.
 */
import type { Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { BadInputError, now } from "./db.js";
import { PROFILE_COLUMNS, rowToApplication, type ApplicationValues } from "./identity.js";

type Audit = (req: Request, action: string, category: "Financial" | "KYC", target: string, summary: string, before?: string, after?: string) => void;
type UserRow = {
  id: string; name: string; email: string; phone: string; business: string;
  account_type: "personal" | "business"; plan: "Starter" | "Pro"; role: string;
  status: string; team_owner_id: string | null;
};

const NAME_RE = /^[A-Za-z][A-Za-z '.,-]{0,79}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLANS = ["Starter", "Pro"] as const;
const ACCOUNT_TYPES = ["personal", "business"] as const;
const REVIEW_STATES = ["submitted", "in_review", "approved", "rejected", "more_info"] as const;

function fail(message: string): never { throw new BadInputError(message); }
function text(value: unknown, max: number) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") fail("Invalid profile field.");
  const trimmed = value.trim();
  if (trimmed.length > max) fail("That value is too long.");
  return trimmed;
}

export function createMemberProfile(db: DatabaseSync, audit: Audit) {
  const member = (id: string) => db.prepare("SELECT * FROM users WHERE id=?").get(id) as UserRow | undefined;

  return {
    save(req: Request, res: Response) {
      const user = member(String(req.params.id));
      if (!user) return void res.status(404).json({ error: "Member not found." });
      if (user.team_owner_id) fail("Edit the business owner’s profile, not a team login.");
      const body = req.body ?? {};
      const reason = text(body.reason, 500);
      if (!reason) fail("A reason for the change is required.");

      const nextName = text(body.name, 80);
      const nextEmail = text(body.email, 160);
      const nextPhone = text(body.phone, 40);
      const nextBusiness = text(body.business, 160);
      const nextPlan = text(body.plan, 20);
      const nextType = text(body.accountType, 20);
      const nextReview = text(body.reviewState, 40);
      const identityPatch = body.identity && typeof body.identity === "object" && !Array.isArray(body.identity)
        ? body.identity as Record<string, unknown>
        : null;

      if (nextName !== undefined && !NAME_RE.test(nextName)) fail("Enter a valid legal name.");
      if (nextEmail !== undefined && !EMAIL_RE.test(nextEmail.toLowerCase())) fail("Enter a valid email address.");
      if (nextPlan !== undefined && !PLANS.includes(nextPlan as typeof PLANS[number])) fail("Plan must be Starter or Pro.");
      if (nextType !== undefined && !ACCOUNT_TYPES.includes(nextType as typeof ACCOUNT_TYPES[number])) fail("Account type must be personal or business.");
      if (nextType === "personal" && user.account_type === "business") {
        const teammates = db.prepare("SELECT COUNT(*) AS n FROM users WHERE team_owner_id=?").get(user.id) as { n: number };
        if (teammates.n > 0) fail("Remove business teammates before converting this account to personal.");
      }
      if (nextReview !== undefined && !REVIEW_STATES.includes(nextReview as typeof REVIEW_STATES[number])) fail("Unknown application review state.");
      if (nextEmail) {
        const clash = db.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE AND id!=?").get(nextEmail.toLowerCase(), user.id) as { id: string } | undefined;
        if (clash) fail("That email is already used by another account.");
      }

      const before = {
        name: user.name, email: user.email, phone: user.phone, business: user.business,
        accountType: user.account_type, plan: user.plan,
      };
      const at = now();
      db.prepare(`UPDATE users SET name=?, email=?, phone=?, business=?, account_type=?, plan=? WHERE id=?`).run(
        nextName ?? user.name,
        nextEmail ? nextEmail.toLowerCase() : user.email,
        nextPhone ?? user.phone,
        nextBusiness ?? user.business,
        nextType ?? user.account_type,
        nextPlan ?? user.plan,
        user.id,
      );
      if (nextType && nextType !== user.account_type) {
        db.prepare("UPDATE accounts SET updated_at=? WHERE user_id=?").run(at, user.id);
      }
      if (nextReview) {
        db.prepare("UPDATE kyc_records SET review_state=?, review_note=?, reviewed_by=?, reviewed_at=? WHERE user_id=?")
          .run(nextReview, reason, req.user!.id, at, user.id);
      }
      if (identityPatch) {
        const current = db.prepare("SELECT * FROM identity_profiles WHERE user_id=?").get(user.id) as Record<string, unknown> | undefined;
        if (!current) {
          db.prepare("INSERT INTO identity_profiles (user_id) VALUES (?)").run(user.id);
        }
        const merged = { ...(current ? rowToApplication(current) : {}), ...identityPatch } as ApplicationValues;
        const assignments = PROFILE_COLUMNS.map(([key, column]) => `${column}=?`).join(",");
        const values = PROFILE_COLUMNS.map(([key]) => {
          const value = merged[key];
          return key === "ownerOwnership" ? Number(value ?? 0) : String(value ?? "");
        });
        db.prepare(`UPDATE identity_profiles SET ${assignments} WHERE user_id=?`).run(...values, user.id);
      }

      const after = db.prepare("SELECT name,email,phone,business,account_type,plan FROM users WHERE id=?").get(user.id) as {
        name: string; email: string; phone: string; business: string; account_type: string; plan: string;
      };
      audit(req, "member.profile", "KYC", `user:${user.id}`, reason,
        JSON.stringify(before),
        JSON.stringify({ name: after.name, email: after.email, phone: after.phone, business: after.business, accountType: after.account_type, plan: after.plan }));
      res.json({
        member: {
          id: user.id, name: after.name, email: after.email, phone: after.phone, business: after.business,
          accountType: after.account_type, plan: after.plan,
        },
      });
    },
  };
}
