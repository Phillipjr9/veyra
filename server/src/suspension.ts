/**
 * Suspension reasons — the catalogue an admin chooses from when restricting an
 * account, and the sentence the member reads on their own dashboard.
 *
 * This lives on the server on purpose: the console fetches it (so the picker can
 * never drift from what the API accepts), the API validates against it, and the
 * member's banner shows the exact text that was stored at suspend time. A
 * reason set at suspend time must not change meaning later, so a suspension
 * stores the resolved `memberText`, not the code.
 *
 * `code` is what the console sends. `other` is deliberately not in the list —
 * it is handled as "custom text" so a preset can never be silently overridden
 * by free text.
 */
export type SuspensionReason = {
  /** Stable identifier the console posts as `reasonCode`. */
  code: string;
  /** Short label for the operator's picker. */
  label: string;
  /** One line of guidance so two operators pick the same code for the same case. */
  note: string;
  /** The sentence the member sees, in plain language, without jargon. */
  memberText: string;
};

export const SUSPENSION_REASONS: SuspensionReason[] = [
  {
    code: "suspicious_activity",
    label: "Suspicious transaction activity",
    note: "Unusual, unexplained or out-of-pattern movement on the account.",
    memberText: "We noticed unusual activity on your account and paused outgoing transfers while our team reviews it.",
  },
  {
    code: "scam_or_fraud_risk",
    label: "Suspected scam or fraud in progress",
    note: "Signs the member may be sending money under someone else's influence.",
    memberText: "We paused outgoing transfers because we believe your account may be involved in a scam we are trying to prevent.",
  },
  {
    code: "reported_fraud",
    label: "Fraud reported on the account",
    note: "A counterparty, bank or the member reported fraudulent transactions.",
    memberText: "Fraud was reported on your account, so we paused outgoing transfers while we investigate.",
  },
  {
    code: "account_takeover",
    label: "Suspected account takeover",
    note: "Sign-in or device signals suggest someone else has access.",
    memberText: "We paused outgoing transfers because we believe someone else may have accessed your account.",
  },
  {
    code: "identity_unverified",
    label: "Identity could not be verified",
    note: "Documents were missing, unreadable or did not match our records.",
    memberText: "We could not verify your identity from the documents provided, so outgoing transfers are paused until verification is complete.",
  },
  {
    code: "document_forgery",
    label: "Suspected forged or altered documents",
    note: "Identity or business documents appear edited or inconsistent.",
    memberText: "The documents on your account appear altered, so we paused outgoing transfers while we review them.",
  },
  {
    code: "aml_review",
    label: "Anti-money-laundering review",
    note: "Routine or escalated AML/CFT review of activity on the account.",
    memberText: "Your account is part of a routine anti-money-laundering review, and outgoing transfers are paused while it completes.",
  },
  {
    code: "sanctions_match",
    label: "Possible sanctions or watchlist match",
    note: "A name, entity or payment screened against a restricted list.",
    memberText: "A payment or name on your account matched a restricted-party list, so outgoing transfers are paused while we check.",
  },
  {
    code: "legal_order",
    label: "Legal or regulatory order",
    note: "Subpoena, court order, law-enforcement or regulator instruction.",
    memberText: "We received a legal or regulatory instruction that requires outgoing transfers on your account to be paused.",
  },
  {
    code: "chargeback_abuse",
    label: "Excessive disputes or chargebacks",
    note: "A repeated pattern of disputed payments against counterparties.",
    memberText: "Your account has a high number of disputes, so outgoing transfers are paused while we review the pattern.",
  },
  {
    code: "terms_violation",
    label: "Terms of service violation",
    note: "Account use breaches the agreement in a way that requires a pause.",
    memberText: "Your account was used in a way that breaches our terms of service, so outgoing transfers are paused.",
  },
  {
    code: "prohibited_business",
    label: "Prohibited or restricted activity",
    note: "Business or transaction type Veyra does not support.",
    memberText: "Your account shows activity we are not able to support, so outgoing transfers are paused while we review it.",
  },
  {
    code: "duplicate_accounts",
    label: "Duplicate or linked accounts",
    note: "Multiple accounts held under mismatched or false identities.",
    memberText: "We found accounts linked to yours under inconsistent details, so outgoing transfers are paused while we review them.",
  },
  {
    code: "dormant_or_abandoned",
    label: "Dormant or abandoned account",
    note: "Long periods of inactivity with unexplained activity on return.",
    memberText: "This account has been inactive for a long period, so outgoing transfers are paused until we can confirm it is you.",
  },
  {
    code: "member_request",
    label: "Member asked us to pause it",
    note: "The account holder requested a hold (e.g. while travelling or after a loss).",
    memberText: "Outgoing transfers are paused at your request. Contact support whenever you want them switched back on.",
  },
];

/** The custom-reason escape hatch. Never a stored reason on its own. */
export const OTHER_REASON_CODE = "other";

const BY_CODE = new Map(SUSPENSION_REASONS.map(r => [r.code, r]));

/** Resolves what to store for a restriction: a preset's member text, or custom text. */
export function resolveSuspensionReason(code: unknown, custom: unknown):
  | { ok: true; text: string; code: string }
  | { ok: false; error: string } {
  const wanted = String(code ?? "").trim();
  const text = String(custom ?? "").trim();
  if (wanted === OTHER_REASON_CODE || (!wanted && text)) {
    if (text.length < 8) {
      return { ok: false, error: "Give the member a clear reason (at least 8 characters) when choosing 'Other'." };
    }
    return { ok: true, text, code: OTHER_REASON_CODE };
  }
  const preset = BY_CODE.get(wanted);
  if (!preset) {
    return { ok: false, error: "Choose a reason from the list, or pick 'Other' and write one." };
  }
  return { ok: true, text: preset.memberText, code: preset.code };
}
