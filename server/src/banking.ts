import type { ExternalAccount } from "../../shared/externalAccounts.js";
import { rateLimit } from "./security.js";
import { sendCryptoNotification } from "./cryptoNotifications.js";
import { demoPaymentsEnabled } from "./demoPayments.js";
import { sendZelleNotification } from "./zelleNotifications.js";
import type { DatabaseSync } from "node:sqlite";
import type { Request, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { validWallet } from "../../shared/walletAddress.js";
export { validWallet } from "../../shared/walletAddress.js";
import { FUNDING_OPTIONS, fundingOption, fundingRequiresProvider } from "../../shared/funding.js";
import { ASSETS } from "../../shared/catalog.js";
import { BadInputError, centsToDecimal, dollarsToCents, getSetting, inTransaction, now, rid } from "./db.js";
import { applyFee, quoteFee } from "../../shared/fees.js";
import { assetByCode, tradingEnabled } from "./assets.js";
import { formatUnitsTrimmed, parseUnits } from "./money.js";

type Audit = (req: Request, action: string, category: "Financial", target: string, summary: string, before?: string, after?: string) => void;
type Method = { id: string; user_id: string; label: string; kind: string; instructions: string; bank_name: string; routing_number: string; account_number: string; recipient: string; recipient_contact: string; enabled: number };
const text = (value: unknown, max: number, required = false) => {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new BadInputError("Check the required text fields and length limits.");
  return value.trim();
};
const requestKey = (body: any) => { const key = body?.requestKey; if (typeof key !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key)) throw new BadInputError("A request identifier is required."); return key; };
const ref = () => `VYR-${randomUUID().slice(0, 8).toUpperCase()}`;


export function createBanking(db: DatabaseSync, audit: Audit) {
  const member = (id: string) => {
    const row = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(id) as any;
    if (!row || row.team_owner_id) throw new BadInputError("Select an account owner, not a staff or team-member login.");
    return row;
  };
  const methods = (id: string) => db.prepare("SELECT * FROM funding_methods WHERE user_id = ? ORDER BY updated_at DESC").all(id);
  const externalColumns = "id,kind,bank_name,account_name,last4,account_type,card_brand,card_exp_month,card_exp_year,billing_address_json,status,verification_kind,verification_note,created_at";
  const externalAccounts = (id: string) => db.prepare(`SELECT ${externalColumns} FROM external_accounts WHERE user_id=? ORDER BY created_at DESC`).all(id) as ExternalAccount[];
  const linkedAccounts = (id: string) => externalAccounts(id).filter(account => account.status === "verified");
  const directDeposit = (id: string) => {
    const account = db.prepare("SELECT a.*,u.name FROM accounts a JOIN users u ON u.id=a.user_id WHERE a.user_id=? AND a.receiving_details_configured=1").get(id) as any;
    if (account) return { bank_name: account.bank_name, routing_number: account.routing_number, account_number: account.account_number, account_type: account.bank_account_type, recipient: account.name };
    const configured = db.prepare("SELECT * FROM funding_methods WHERE user_id=? AND kind='direct_deposit' AND enabled=1 AND bank_name!='' AND routing_number!='' AND account_number!='' ORDER BY updated_at DESC LIMIT 1").get(id) as any;
    return configured ? { bank_name: configured.bank_name, routing_number: configured.routing_number, account_number: configured.account_number, account_type: "", recipient: configured.recipient } : null;
  };
  const accountMethods = (id: string) => FUNDING_OPTIONS.flatMap(option => {
    const receiving = option.kind === "direct_deposit" ? directDeposit(id) : null;
    const base = { id: `demo_${id}_${option.kind}`, user_id: id, label: option.label, kind: option.kind,
      instructions: "Add funds directly to your account balance. External bank and card processing is not connected.",
      bank_name: "", routing_number: "", account_number: "", account_type: "", recipient: "Your Veyra account", recipient_contact: "", enabled: 0, demo: true, ledgerOnly: true,
      linkedAccountId: "", unavailable: option.kind === "direct_deposit" && !receiving, ...receiving };
    if (option.kind !== "ach" && option.kind !== "card") return [base];
    const linked = linkedAccounts(id).filter(account => (account.kind ?? "bank") === (option.kind === "card" ? "card" : "bank"));
    if (!linked.length) return [{ ...base, unavailable: true }];
    return linked.map(account => ({
      ...base,
      id: `linked_${id}_${account.id}`,
      linkedAccountId: account.id,
      label: account.kind === "card"
        ? `${account.card_brand ? `${account.card_brand} ` : "Debit card "}•••• ${account.last4} · Card funding`
        : `${account.bank_name} ${account.account_type} •••• ${account.last4}${account.verification_kind === "staff_reference" ? " · Account reference" : " · ACH"}`,
      instructions: account.kind === "card"
        ? "Fund your Veyra account from this debit card reference. The card number and security code are validated in your browser and never stored."
        : base.instructions,
    }));
  });
  const fundingRequests = (id: string) => db.prepare("SELECT * FROM funding_requests WHERE user_id = ? ORDER BY (status='pending') DESC, created_at DESC LIMIT 100").all(id);
  const withdrawOut = (row: any) => ({ ...row, quantity: formatUnitsTrimmed(BigInt(row.units), assetByCode(db, row.asset)!.decimals) });
  return {
    accountGet(req: Request, res: Response) {
      const id = String(req.params.id), user = member(id);
      const account = db.prepare("SELECT * FROM accounts WHERE user_id = ?").get(id) as any;
      res.json({ account: { accountNumber: account?.account_number ?? "", routingNumber: account?.routing_number ?? "", bankName: account?.bank_name ?? "", bankAccountType: account?.bank_account_type ?? "Checking", accountType: user.account_type, business: user.business } });
    },
    accountSave(req: Request, res: Response) {
      const id = String(req.params.id); member(id);
      const b = req.body ?? {};
      const number = text(b.accountNumber, 34, true), routing = text(b.routingNumber, 9, true), bank = text(b.bankName, 120, true), reason = text(b.reason, 500, true);
      if (!/^\d{4,34}$/.test(number) || !/^\d{9}$/.test(routing)) throw new BadInputError("Use a 4–34 digit account number and a 9-digit routing number.");
      if (!["Checking", "Savings"].includes(b.bankAccountType) || !["personal", "business"].includes(b.accountType)) throw new BadInputError("Select valid account types.");
      const business = text(b.business ?? "", 160, b.accountType === "business");
      inTransaction(db, () => {
        const user = member(id);
        const before = db.prepare("SELECT * FROM accounts WHERE user_id = ?").get(id) as any;
        if (!before) throw new BadInputError("This member has no deposit account.");
        if (before.routing_number !== routing) {
          const d = [...routing].map(Number);
          if (routing === "000000000" || (3 * (d[0]+d[3]+d[6]) + 7 * (d[1]+d[4]+d[7]) + d[2]+d[5]+d[8]) % 10) throw new BadInputError("Routing number failed the ABA checksum. Verify it with the bank.");
        }
        if (b.accountType === "personal" && user.account_type !== "personal" && db.prepare("SELECT 1 FROM team_members WHERE user_id = ? AND role != 'Owner' AND status IN ('active','invited')").get(id)) throw new BadInputError("Remove active teammates and pending invitations before converting to personal.");
        if (db.prepare("SELECT 1 FROM accounts WHERE account_number = ? AND user_id != ?").get(number, id)) throw new BadInputError("That account number is already assigned.");
        db.prepare("UPDATE accounts SET account_number=?,routing_number=?,bank_name=?,bank_account_type=?,receiving_details_configured=1,updated_at=? WHERE user_id=?").run(number, routing, bank, b.bankAccountType, now(), id);
        db.prepare("UPDATE users SET account_type=?,business=? WHERE id=?").run(b.accountType, business, id);
        audit(req, "account.details", "Financial", `user:${id}`, reason, JSON.stringify({ accountNumber: before.account_number, routingNumber: before.routing_number, bankName: before.bank_name, bankAccountType: before.bank_account_type, accountType: user.account_type, business: user.business }), JSON.stringify({ accountNumber: number, routingNumber: routing, bankName: bank, bankAccountType: b.bankAccountType, accountType: b.accountType, business }));
      });
      res.json({ ok: true });
    },
    externalAccountsGet(req: Request, res: Response) {
      res.json({ accounts: linkedAccounts(req.user!.id), requests: externalAccounts(req.user!.id).filter(account => account.status !== "verified"), linkingAvailable: true,
        referenceRequestsAvailable: req.user!.role === "user" && !req.user!.loginId && req.user!.status === "active" });
    },
    requestExternalAccount(req: Request, res: Response) {
      if (req.user!.role !== "user" || req.user!.loginId || req.user!.status !== "active") return void res.status(403).json({ error: "Only an active account owner can submit a funding reference." });
      const body = req.body ?? {}, id = req.user!.id, key = requestKey(body);
      const forbidden = ["cardNumber", "pan", "cvv", "cvc", "securityCode", "fullNumber", "routingNumber", "accountNumber"];
      if (Object.keys(body).some(field => forbidden.includes(field))) throw new BadInputError("Never submit a full card number, security code, bank account number or routing number.");
      const kind = body.kind === "card" ? "card" : body.kind === "bank" || body.kind === undefined ? "bank" : null;
      if (!kind) throw new BadInputError("Select either a bank account reference or a debit card.");
      if (kind === "bank") {
        if (Object.keys(body).some(field => !["kind","bankName","accountName","last4","accountType","ownershipConfirmed","requestKey"].includes(field))) throw new BadInputError("Only a bank name, display name, type and last four digits are accepted. Never submit bank credentials or a full account number.");
        const bank = text(body.bankName,120,true), name = text(body.accountName,120,true), last4 = text(body.last4,4,true);
        if (!/^\d{4}$/.test(last4) || !["Checking","Savings"].includes(body.accountType) || body.ownershipConfirmed !== true) throw new BadInputError("Confirm ownership and provide the account type and exactly four final digits.");
        const result = inTransaction(db, () => {
          const prior = db.prepare("SELECT * FROM external_accounts WHERE user_id=? AND request_key=?").get(id,key) as any;
          if (prior) {
            if (prior.kind !== "bank" || prior.bank_name !== bank || prior.account_name !== name || prior.last4 !== last4 || prior.account_type !== body.accountType) throw new BadInputError("This request identifier was already used for different details.");
            return { id: prior.id, replayed: true };
          }
          if (!rateLimit(`bank-reference:${id}`,10,3600000)) throw new BadInputError("Too many account-reference requests. Try again later.");
          if (externalAccounts(id).length >= 25) throw new BadInputError("Contact support to manage your existing account references before adding more.");
          if (db.prepare("SELECT 1 FROM external_accounts WHERE user_id=? AND kind='bank' AND bank_name=? COLLATE NOCASE AND last4=? AND account_type=? AND status IN ('pending','verified')").get(id,bank,last4,body.accountType)) throw new BadInputError("An account with this bank, type and ending is already listed. Review its existing status.");
          const accountId = rid("external"), at = now();
          db.prepare("INSERT INTO external_accounts(id,user_id,kind,bank_name,account_name,last4,account_type,status,provider_reference,created_at,updated_at,verification_kind,request_key) VALUES(?,?,'bank',?,?,?,?,'pending',NULL,?,?,'staff_reference',?)").run(accountId,id,bank,name,last4,body.accountType,at,at,key);
          return { id: accountId, replayed: false };
        });
        res.status(result.replayed ? 200 : 201).json({ account: externalAccounts(id).find(account => account.id === result.id), replayed: result.replayed });
        return;
      }
      // Debit-card funding reference. The browser validates the PAN/expiry and
      // sends only an opaque token plus last-four; Veyra stores a hash of that
      // token, never the token itself, and never stores a PAN or CVV.
      if (Object.keys(body).some(field => !["kind","cardToken","cardBrand","cardLast4","cardExpMonth","cardExpYear","cardholderName","billingName","billingAddressLine1","billingAddressLine2","billingCity","billingState","billingPostalCode","billingCountry","ownershipConfirmed","requestKey"].includes(field))) throw new BadInputError("Only a masked card token, card brand, last four digits, expiry, cardholder name and billing address are accepted.");
      if (body.ownershipConfirmed !== true) throw new BadInputError("Confirm that you own this debit card.");
      const token = text(body.cardToken, 160, true);
      if (!/^[A-Za-z0-9_-]{16,120}$/.test(token)) throw new BadInputError("This card reference token is invalid. Reload the form and try again.");
      const brandRaw = text(body.cardBrand, 20, true).toLowerCase().replace(/[^a-z]/g, "");
      const brands: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", mc: "Mastercard", amex: "American Express", americanexpress: "American Express", discover: "Discover" };
      const brand = brands[brandRaw];
      if (!brand) throw new BadInputError("Select Visa, Mastercard, American Express or Discover.");
      const last4 = text(body.cardLast4, 4, true);
      if (!/^\d{4}$/.test(last4)) throw new BadInputError("Provide exactly the last four digits of the card.");
      const month = Number(body.cardExpMonth), year = Number(body.cardExpYear);
      if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) throw new BadInputError("Provide a valid card expiry month and year.");
      const nowDate = new Date(), currentYear = nowDate.getFullYear(), currentMonth = nowDate.getMonth() + 1;
      if (year < currentYear || year > currentYear + 30 || (year === currentYear && month < currentMonth)) throw new BadInputError("This card expiry has passed. Use an unexpired card.");
      const cardholder = text(body.cardholderName, 120, true), billingName = text(body.billingName ?? cardholder, 120);
      const line1 = text(body.billingAddressLine1, 160, true), line2 = text(body.billingAddressLine2 ?? "", 160);
      const city = text(body.billingCity, 100, true), state = text(body.billingState, 60, true), postal = text(body.billingPostalCode, 20, true), country = text(body.billingCountry, 60, true).toUpperCase();
      const billing = { name: billingName, line1, line2, city, state, postalCode: postal, country };
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const providerReference = `card-token:${tokenHash}`;
      const result = inTransaction(db, () => {
        const prior = db.prepare("SELECT * FROM external_accounts WHERE user_id=? AND request_key=?").get(id,key) as any;
        if (prior) {
          if (prior.kind !== "card" || prior.provider_reference !== providerReference || prior.last4 !== last4 || prior.card_brand !== brand || prior.card_exp_month !== month || prior.card_exp_year !== year || prior.account_name !== cardholder || prior.billing_address_json !== JSON.stringify(billing)) throw new BadInputError("This request identifier was already used for different card details.");
          return { id: prior.id, replayed: true };
        }
        if (!rateLimit(`card-reference:${id}`,10,3600000)) throw new BadInputError("Too many card-reference requests. Try again later.");
        if (externalAccounts(id).length >= 25) throw new BadInputError("Contact support to manage your existing funding references before adding more.");
        if (db.prepare("SELECT 1 FROM external_accounts WHERE user_id=? AND kind='card' AND card_brand=? AND last4=? AND card_exp_month=? AND card_exp_year=? AND status IN ('pending','verified')").get(id,brand,last4,month,year)) throw new BadInputError("This card is already linked. Review its existing status.");
        const accountId = rid("external"), at = now();
        db.prepare(`INSERT INTO external_accounts(id,user_id,kind,bank_name,account_name,last4,account_type,card_brand,card_exp_month,card_exp_year,billing_address_json,status,provider_reference,created_at,updated_at,verification_kind,verification_note,request_key)
          VALUES(?,?,'card',?,?,?,'Checking',?,?,?,?,'verified',?,?,?,'card_token','Card details validated in the browser; only a masked reference is stored.',?)`).run(accountId,id,brand,cardholder,last4,brand,month,year,JSON.stringify(billing),providerReference,at,at,key);
        audit(req, "external_account.card", "Financial", `user:${id}`, `Debit-card funding reference added: ${brand} •••• ${last4}.`, undefined, JSON.stringify({ kind: "card", brand, last4, expMonth: month, expYear: year }));
        return { id: accountId, replayed: false };
      });
      res.status(result.replayed ? 200 : 201).json({ account: externalAccounts(id).find(account => account.id === result.id), replayed: result.replayed });
    },
    reviewExternalAccount(req: Request, res: Response) {
      const id = String(req.params.id); member(id);
      const body = req.body ?? {}, note = text(body.note,500,true);
      if (Object.keys(body).some(field => !["decision","note","ownershipVerified"].includes(field)) || !["approve","reject"].includes(body.decision) || note.length < 15) throw new BadInputError("Choose an approval or rejection and include a review note of at least 15 characters.");
      if (body.decision === "approve" && body.ownershipVerified !== true) throw new BadInputError("Independently verify ownership before approving an account reference.");
      const status = body.decision === "approve" ? "verified" : "disconnected";
      inTransaction(db, () => {
        const row = db.prepare("SELECT * FROM external_accounts WHERE id=? AND user_id=? AND verification_kind='staff_reference'").get(String(req.params.accountId),id) as any;
        if (!row) throw new BadInputError("Account reference not found for this member.");
        if (row.status === status && row.verification_note === note) return;
        if (row.status !== "pending") throw new BadInputError("This account reference was already reviewed. Refresh its status.");
        const at = now();
        // Legacy column stores a non-secret attestation ID here, not a bank token.
        // Live payment adapters must require verification_kind='provider'.
        db.prepare("UPDATE external_accounts SET status=?,verification_note=?,reviewed_by=?,provider_reference=?,updated_at=? WHERE id=?").run(status,note,req.user!.id,status === "verified" ? `staff-reference:${row.id}` : null,at,row.id);
        audit(req,"external_account.review","Financial",`user:${id}`,`Account reference ${row.id}: ${body.decision}. ${note}`,JSON.stringify({status:row.status}),JSON.stringify({status,scope:"account reference only; no bank connection or debit authorization"}));
        db.prepare("INSERT INTO notifications(id,user_id,type,title,detail,read,created_at) VALUES(?,?,'info',?,?,0,?)").run(rid("note"),id,status === "verified" ? "Bank account reference approved" : "Bank account reference needs attention",`${row.bank_name} •••• ${row.last4}. ${note} Open Accounts → External accounts. This is not a bank connection or debit authorization.`,at);
      });
      res.json({ accounts: externalAccounts(id) });
    },
    fundingGet(req: Request, res: Response) {
      res.json({ immediateFunding: demoPaymentsEnabled(), demoMode: demoPaymentsEnabled(), methods: demoPaymentsEnabled() ? accountMethods(req.user!.id) : methods(req.user!.id).filter((r: any) => r.enabled),
        linkedAccounts: linkedAccounts(req.user!.id), directDeposit: directDeposit(req.user!.id), requests: fundingRequests(req.user!.id) });
    },
    adminFundingGet(req: Request, res: Response) {
      const id = String(req.params.id); member(id);
      res.json({ methods: methods(id), requests: fundingRequests(id), externalAccounts: externalAccounts(id) });
    },
    fundingSave(req: Request, res: Response) {
      const id = String(req.params.id); member(id);
      const list = req.body?.methods;
      if (!Array.isArray(list) || list.length > 12) throw new BadInputError("Provide up to 12 funding methods.");
      const cleaned = list.map((m: any) => {
        if (!m || !fundingOption(m.kind) || typeof m.enabled !== "boolean") throw new BadInputError("Invalid funding method.");
        const row = { id: m.id ? text(m.id, 80, true) : rid("fund"), label: text(m.label, 100, true), kind: m.kind, instructions: text(m.instructions, 2000, true), bankName: text(m.bankName ?? "", 120), routingNumber: text(m.routingNumber ?? "", 9), accountNumber: text(m.accountNumber ?? "", 34), recipient: text(m.recipient ?? "", 160), recipientContact: text(m.recipientContact ?? "", 160), enabled: m.enabled };
        if (row.routingNumber && !/^\d{9}$/.test(row.routingNumber)) throw new BadInputError("Funding routing numbers must be nine digits.");
        if (row.accountNumber && !/^\d{4,34}$/.test(row.accountNumber)) throw new BadInputError("Funding account numbers must be 4–34 digits. Never enter a card PAN.");
        if (fundingRequiresProvider(row.kind) && (row.accountNumber || row.routingNumber)) throw new BadInputError("External bank and debit-card details must be collected by a connected provider, not stored in funding instructions.");
        if (row.kind !== "zelle" && row.recipientContact) throw new BadInputError("Recipient email or phone is only used for Zelle instructions.");
        if (row.kind === "zelle") {
          if (row.accountNumber || row.routingNumber) throw new BadInputError("Use a recipient email or US phone number for Zelle, not bank account details.");
          const phone = row.recipientContact.replace(/[ ()-]/g, "");
          const validContact = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.recipientContact) || /^(?:\+?1)?[2-9]\d{9}$/.test(phone);
          if ((row.enabled || row.recipientContact) && !validContact) throw new BadInputError("Enter the recipient’s enrolled Zelle email or US phone number.");
          if (row.enabled && !row.recipient) throw new BadInputError("Provide the recipient name so the member can check it in their bank app.");
        }
        return row;
      });
      if (new Set(cleaned.map(m => m.id)).size !== cleaned.length) throw new BadInputError("Duplicate funding method.");
      inTransaction(db, () => {
        const before = methods(id);
        for (const m of cleaned) {
          const existing = db.prepare("SELECT user_id FROM funding_methods WHERE id = ?").get(m.id) as any;
          if (existing && existing.user_id !== id) throw new BadInputError("Invalid funding method identifier.");
        }
        db.prepare("UPDATE funding_methods SET enabled=0 WHERE user_id=?").run(id);
        for (const m of cleaned) db.prepare(`INSERT INTO funding_methods(id,user_id,label,kind,instructions,bank_name,routing_number,account_number,recipient,enabled,updated_at,recipient_contact) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,kind=excluded.kind,instructions=excluded.instructions,bank_name=excluded.bank_name,routing_number=excluded.routing_number,account_number=excluded.account_number,recipient=excluded.recipient,recipient_contact=excluded.recipient_contact,enabled=excluded.enabled,updated_at=excluded.updated_at`).run(m.id,id,m.label,m.kind,m.instructions,m.bankName,m.routingNumber,m.accountNumber,m.recipient,m.enabled ? 1 : 0,now(),m.recipientContact);
        audit(req, "funding.methods", "Financial", `user:${id}`, "Updated per-member funding instructions; no external account was linked or charged.", JSON.stringify(before), JSON.stringify(cleaned));
      });
      res.json({ methods: methods(id) });
    },
    deposit(req: Request, res: Response) {
      if (demoPaymentsEnabled()) {
        if (req.user!.role !== "user" || req.user!.loginId || req.user!.status !== "active") return void res.status(403).json({ error: "Only an active account owner can add funds." });
        if (req.body?.accountEntry !== true && req.body?.demo !== true) throw new BadInputError("Reload Add funds before confirming an account credit.");
        if (Object.keys(req.body).some(key => !["amount", "methodId", "note", "requestKey", "demo", "accountEntry"].includes(key))) throw new BadInputError("Bank or card credentials are not accepted here.");
        if (!["string", "number"].includes(typeof req.body.amount) || !/^\d+(\.\d{1,2})?$/.test(String(req.body.amount))) throw new BadInputError("Enter a dollar amount with at most two decimals.");
        const amount = dollarsToCents(req.body.amount), id = req.user!.id, key = requestKey(req.body), note = text(req.body.note ?? "", 500);
        if (amount < 1000 || amount > 10000000) throw new BadInputError("Add between $10 and $100,000.");
        const request = inTransaction(db, () => {
          const prior = db.prepare("SELECT * FROM funding_requests WHERE user_id=? AND request_key=?").get(id, key) as any;
          if (prior) {
            if (prior.amount_cents !== amount || prior.method_id !== req.body.methodId || prior.note !== note || !JSON.parse(prior.method_snapshot).demo) throw new BadInputError("This request identifier was already used for different details.");
            const replayFee = quoteFee(JSON.parse(prior.method_snapshot).kind === "card" ? "card_deposit" : "deposit", prior.amount_cents);
            return { request: prior, feeCents: replayFee.feeCents, creditCents: applyFee(prior.amount_cents, replayFee.feeCents) };
          }
          const m = accountMethods(id).find(method => method.id === req.body.methodId);
          if (!m || m.unavailable) throw new BadInputError("Choose an available funding method. Bank funding requires a verified linked account; Direct Deposit requires configured receiving details.");
          const fee = quoteFee(m.kind === "card" ? "card_deposit" : "deposit", amount);
          const credit = applyFee(amount, fee.feeCents);
          if (credit <= 0) throw new BadInputError("This amount is too small to cover the card deposit fee.");
          const a = db.prepare("SELECT * FROM accounts WHERE user_id=?").get(id) as any;
          if (!a || !Number.isSafeInteger(a.balance_cents + credit) || a.balance_cents + credit > 1000000000) throw new BadInputError("Account cannot accept this credit (maximum balance $10,000,000).");
          // Disabled internal fixture: turning demo mode off never exposes it as a live method.
          db.prepare("INSERT INTO funding_methods(id,user_id,label,kind,instructions,bank_name,routing_number,account_number,recipient,enabled,updated_at,recipient_contact) VALUES(?,?,?,?,?,'','','',?,0,?,'') ON CONFLICT(id) DO NOTHING").run(m.id,id,m.label,m.kind,m.instructions,m.recipient,now());
          const requestId = rid("deposit"), reference = `VYR-${randomUUID().slice(0,12).toUpperCase()}`, at = now();
          db.prepare("INSERT INTO funding_requests(id,user_id,method_id,amount_cents,status,reference,method_snapshot,note,evidence,request_key,created_at,reviewed_at) VALUES(?,?,?,?,'confirmed',?,?,?,?,?,?,?)").run(requestId,id,m.id,amount,reference,JSON.stringify(m),note,fee.feeCents ? `Account credit less ${fee.label}; external processing not connected.` : "Account credit; external processing not connected.",key,at,at);
          db.prepare("UPDATE accounts SET balance_cents=balance_cents+?,updated_at=? WHERE id=?").run(credit,at,a.id);
          db.prepare("INSERT INTO transactions(id,account_id,user_id,merchant,category,method,amount_cents,fee_cents,status,reference,note,created_at,performed_by) VALUES(?,?,?,?,'Funding',?, ?,?,'cleared',?,?,?,?)").run(rid("txn"),a.id,id,m.label,m.kind,amount,fee.feeCents,reference,fee.feeCents ? `Account credit less ${fee.label.toLowerCase()} — external processing not connected.` : "Account credit — external processing not connected.",at,id);
          return { request: db.prepare("SELECT * FROM funding_requests WHERE id=?").get(requestId), feeCents: fee.feeCents, creditCents: credit };
        });
        res.status(201).json({ request: request.request, status: "confirmed", fee: centsToDecimal(request.feeCents), amountCredited: centsToDecimal(request.creditCents), message: request.feeCents ? `Funds added after a ${centsToDecimal(request.feeCents)} card deposit fee.` : "Funds added to your account immediately." });
        return;
      }
      if (req.body?.accountEntry || req.body?.demo) throw new BadInputError("Immediate account funding is unavailable. Reload your funding methods.");
      const amount = dollarsToCents(req.body?.amount ?? 0);
      if (amount < 1000 || amount > 10000000) throw new BadInputError("Funding requests must be between $10 and $100,000.");
      const key = requestKey(req.body), id = req.user!.id;
      const note = text(req.body?.note ?? "", 500);
      let created = false;
      const request = inTransaction(db, () => {
        const prior = db.prepare("SELECT * FROM funding_requests WHERE user_id=? AND request_key=?").get(id,key) as any;
        if (prior) { if (prior.amount_cents !== amount || prior.method_id !== req.body?.methodId || prior.note !== note) throw new BadInputError("This request identifier was already used for different details."); return prior; }
        if ((db.prepare("SELECT COUNT(*) AS n FROM funding_requests WHERE user_id=? AND status='pending'").get(id) as {n:number}).n >= 20) throw new BadInputError("You have 20 pending funding requests. Resolve existing requests before adding more.");
        const m = db.prepare("SELECT * FROM funding_methods WHERE id=? AND user_id=? AND enabled=1").get(String(req.body?.methodId ?? ""),id) as Method | undefined;
        if (!m) throw new BadInputError("Choose an enabled funding method configured for your account.");
        if (fundingRequiresProvider(m.kind)) throw new BadInputError("This funding method is awaiting provider activation. No bank linking, trial deposits or card charges are available yet.");
        const requestId = rid("deposit"), reference = ref();
        db.prepare("INSERT INTO funding_requests(id,user_id,method_id,amount_cents,reference,method_snapshot,note,request_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(requestId,id,m.id,amount,reference,JSON.stringify(m),note,key,now());
        created = true;
        return db.prepare("SELECT * FROM funding_requests WHERE id=?").get(requestId);
      });
      if (created && JSON.parse(request.method_snapshot).kind === "zelle") sendZelleNotification(db,id,{event:"incoming_pending",amountCents:request.amount_cents,reference:request.reference,occurredAt:request.created_at});
      res.status(201).json({ request, status: request.status, message: "Request recorded. No funds have been collected or credited." });
    },
    reviewDeposit(req: Request, res: Response) {
      const id = String(req.params.id); member(id);
      const decision = req.body?.decision;
      if (!["confirmed", "rejected"].includes(decision)) throw new BadInputError("Choose confirmed or rejected.");
      const evidence = text(req.body?.evidence, 500, true);
      const reviewed = inTransaction(db, () => {
        const request = db.prepare("SELECT * FROM funding_requests WHERE id=? AND user_id=?").get(String(req.params.requestId),id) as any;
        if (!request) throw new BadInputError("Funding request not found.");
        if (request.status !== "pending") { if (request.status === decision && request.evidence === evidence) return; throw new BadInputError("This request has already been reviewed."); }
        if (decision === "confirmed") {
          const a = db.prepare("SELECT * FROM accounts WHERE user_id=?").get(id) as any;
          if (!a || !Number.isSafeInteger(a.balance_cents + request.amount_cents)) throw new BadInputError("Account balance cannot accept this credit.");
          const m = JSON.parse(request.method_snapshot) as Method;
          db.prepare("UPDATE accounts SET balance_cents=balance_cents+?, updated_at=? WHERE user_id=?").run(request.amount_cents,now(),id);
          db.prepare("INSERT INTO transactions(id,account_id,user_id,merchant,category,method,amount_cents,status,reference,note,created_at,performed_by) VALUES(?,?,?,?,'Funding',?,?,'cleared',?,?,?,?)").run(rid("txn"),a.id,id,m.label,m.kind,request.amount_cents,request.reference,`Staff-confirmed receipt of funds: ${evidence}`,now(),req.user!.id);
        }
        db.prepare("UPDATE funding_requests SET status=?,evidence=?,reviewed_by=?,reviewed_at=? WHERE id=?").run(decision,evidence,req.user!.id,now(),request.id);
        audit(req,"funding.review","Financial",`user:${id}`,`${request.reference}: ${decision}. ${evidence}`,"pending",decision);
        return request;
      });
      if (reviewed && JSON.parse(reviewed.method_snapshot).kind === "zelle") sendZelleNotification(db,id,{event:decision === "confirmed" ? "incoming_confirmed" : "incoming_rejected",amountCents:reviewed.amount_cents,reference:reviewed.reference,occurredAt:now()});
      res.json({ ok: true });
    },
    withdrawalsGet(req: Request, res: Response) {
      res.json({ withdrawals: db.prepare("SELECT * FROM crypto_withdrawals WHERE user_id=? ORDER BY created_at DESC LIMIT 100").all(req.user!.id).map(withdrawOut) });
    },
    withdraw(req: Request, res: Response) {
      if (getSetting(db,"payment_rails") === "halted") return void res.status(503).json({error:"Outgoing payment requests are temporarily halted."});
      if (!tradingEnabled()) return void res.status(503).json({ error: "Crypto movement is disabled." });
      if (req.user!.status !== "active" || req.user!.loginId) return void res.status(403).json({ error: "Only an unrestricted account owner can request a crypto withdrawal." });
      const key = requestKey(req.body), id = req.user!.id;
      const asset = assetByCode(db, String(req.body?.asset ?? ""));
      const spec = ASSETS.find(a => a.code === asset?.code);
      if (!asset || !spec?.network || req.body?.network !== spec.network) throw new BadInputError("Withdrawals on this asset/network are not supported.");
      const address = text(req.body?.address, 120, true);
      if (!validWallet(spec.network,address)) throw new BadInputError("Invalid destination address for the selected mainnet. Check its network and checksum.");
      if (typeof req.body.amount !== "string" || !/^\d{1,40}(\.\d{1,30})?$/.test(req.body.amount)) throw new BadInputError("Enter a decimal asset quantity, not a dollar amount.");
      if ((req.body.amount.split(".")[1] ?? "").length > asset.decimals) throw new BadInputError(`Use no more than ${asset.decimals} decimal places.`);
      let units: bigint; try { units = parseUnits(req.body.amount,asset.decimals); } catch { throw new BadInputError("Invalid asset precision."); }
      if (units <= 0n) throw new BadInputError("Quantity must be greater than zero.");
      let request: any;
      try { request = inTransaction(db, () => {
        const prior = db.prepare("SELECT * FROM crypto_withdrawals WHERE user_id=? AND request_key=?").get(id,key) as any;
        if (prior) { if (prior.asset !== asset.code || prior.units !== units.toString() || prior.network !== spec.network || prior.address !== address) throw new BadInputError("Request identifier already used with different details."); return prior; }
        const current = BigInt((db.prepare("SELECT units FROM holdings WHERE user_id=? AND asset=?").get(id,asset.code) as any)?.units ?? "0");
        if (units > current) throw new BadInputError("Insufficient available asset units.");
        db.prepare("UPDATE holdings SET units=?,updated_at=? WHERE user_id=? AND asset=?").run((current-units).toString(),now(),id,asset.code);
        const requestId = rid("withdraw");
        db.prepare("INSERT INTO crypto_withdrawals(id,user_id,asset,units,network,address,reference,request_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(requestId,id,asset.code,units.toString(),spec.network,address,ref(),key,now());
        return db.prepare("SELECT * FROM crypto_withdrawals WHERE id=?").get(requestId);
      });
      } catch (error) {
        if (error instanceof BadInputError) sendCryptoNotification(db, id, { activity: "withdrawal", status: "failed", reference: key, occurredAt: now(),
          asset: asset.code, quantity: formatUnitsTrimmed(units, asset.decimals), network: spec.network, settlement: "request" });
        throw error;
      }
      const recorded = withdrawOut(request);
      sendCryptoNotification(db, id, { activity: "withdrawal", status: "recorded", reference: recorded.reference, occurredAt: recorded.created_at,
        asset: recorded.asset, quantity: recorded.quantity, network: recorded.network, settlement: "request" });
      res.status(201).json({ withdrawal: recorded, message: "Request recorded and units debited. No transaction has been broadcast; network fees and execution are not confirmed." });
    },
  };
}
