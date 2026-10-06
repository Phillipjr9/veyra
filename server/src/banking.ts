import type { DatabaseSync } from "node:sqlite";
import type { Request, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { base58, bech32, bech32m } from "@scure/base";
import { keccak_256 } from "@noble/hashes/sha3";
import { ASSETS } from "../../shared/catalog.js";
import { BadInputError, dollarsToCents, getSetting, inTransaction, now, rid } from "./db.js";
import { assetByCode, tradingEnabled } from "./assets.js";
import { formatUnitsTrimmed, parseUnits } from "./money.js";

type Audit = (req: Request, action: string, category: "Financial", target: string, summary: string, before?: string, after?: string) => void;
type Method = { id: string; user_id: string; label: string; kind: string; instructions: string; bank_name: string; routing_number: string; account_number: string; recipient: string; enabled: number };
const text = (value: unknown, max: number, required = false) => {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new BadInputError("Check the required text fields and length limits.");
  return value.trim();
};
const requestKey = (body: any) => { const key = body?.requestKey; if (typeof key !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key)) throw new BadInputError("A request identifier is required."); return key; };
const ref = () => `VYR-${randomUUID().slice(0, 8).toUpperCase()}`;

export function validWallet(network: string, address: string): boolean {
  try {
    if (["Ethereum", "BNB Smart Chain", "Avalanche C-Chain"].includes(network)) {
      if (!/^0x[\da-fA-F]{40}$/.test(address) || /^0x0{40}$/.test(address)) return false;
      const body = address.slice(2);
      if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
      const hash = Buffer.from(keccak_256(Buffer.from(body.toLowerCase()))).toString("hex");
      return [...body].every((c, i) => !/[a-fA-F]/.test(c) || (parseInt(hash[i], 16) >= 8 ? c === c.toUpperCase() : c === c.toLowerCase()));
    }
    if (network === "Solana") return base58.decode(address).length === 32 && address !== "11111111111111111111111111111111";
    if (network === "Bitcoin") {
      if (/^bc1/i.test(address)) {
        for (const codec of [bech32, bech32m]) {
          try {
            const decoded = codec.decode(address as `${string}1${string}`);
            const version = decoded.words[0], program = codec.fromWords(decoded.words.slice(1));
            if (decoded.prefix !== "bc" || version > 16) continue;
            if (version === 0 && codec === bech32 && [20, 32].includes(program.length)) return true;
            if (version > 0 && codec === bech32m && program.length >= 2 && program.length <= 40) return true;
          } catch { /* Try the other checksum variant. */ }
        }
        return false;
      }
      const bytes = Buffer.from(base58.decode(address));
      if (bytes.length !== 25 || ![0, 5].includes(bytes[0])) return false;
      const checksum = createHash("sha256").update(createHash("sha256").update(bytes.subarray(0, 21)).digest()).digest().subarray(0, 4);
      return checksum.equals(bytes.subarray(21));
    }
  } catch { return false; }
  return false;
}

export function createBanking(db: DatabaseSync, audit: Audit) {
  const member = (id: string) => {
    const row = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(id) as any;
    if (!row || row.team_owner_id) throw new BadInputError("Select an account owner, not a staff or team-member login.");
    return row;
  };
  const methods = (id: string) => db.prepare("SELECT * FROM funding_methods WHERE user_id = ? ORDER BY updated_at DESC").all(id);
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
        db.prepare("UPDATE accounts SET account_number=?,routing_number=?,bank_name=?,bank_account_type=?,updated_at=? WHERE user_id=?").run(number, routing, bank, b.bankAccountType, now(), id);
        db.prepare("UPDATE users SET account_type=?,business=? WHERE id=?").run(b.accountType, business, id);
        audit(req, "account.details", "Financial", `user:${id}`, reason, JSON.stringify({ accountNumber: before.account_number, routingNumber: before.routing_number, bankName: before.bank_name, bankAccountType: before.bank_account_type, accountType: user.account_type, business: user.business }), JSON.stringify({ accountNumber: number, routingNumber: routing, bankName: bank, bankAccountType: b.bankAccountType, accountType: b.accountType, business }));
      });
      res.json({ ok: true });
    },
    fundingGet(req: Request, res: Response) {
      res.json({ methods: methods(req.user!.id).filter((r: any) => r.enabled), requests: fundingRequests(req.user!.id) });
    },
    adminFundingGet(req: Request, res: Response) {
      const id = String(req.params.id); member(id);
      res.json({ methods: methods(id), requests: fundingRequests(id) });
    },
    fundingSave(req: Request, res: Response) {
      const id = String(req.params.id); member(id);
      const list = req.body?.methods;
      if (!Array.isArray(list) || list.length > 12) throw new BadInputError("Provide up to 12 funding methods.");
      const cleaned = list.map((m: any) => {
        if (!m || !["bank", "wire", "card", "check", "other"].includes(m.kind) || typeof m.enabled !== "boolean") throw new BadInputError("Invalid funding method.");
        const row = { id: m.id ? text(m.id, 80, true) : rid("fund"), label: text(m.label, 100, true), kind: m.kind, instructions: text(m.instructions, 2000, true), bankName: text(m.bankName ?? "", 120), routingNumber: text(m.routingNumber ?? "", 9), accountNumber: text(m.accountNumber ?? "", 34), recipient: text(m.recipient ?? "", 160), enabled: m.enabled };
        if (row.routingNumber && !/^\d{9}$/.test(row.routingNumber)) throw new BadInputError("Funding routing numbers must be nine digits.");
        if (row.accountNumber && !/^\d{4,34}$/.test(row.accountNumber)) throw new BadInputError("Funding account numbers must be 4–34 digits. Never enter a card PAN.");
        if (row.kind === "card" && row.accountNumber) throw new BadInputError("Do not store full card numbers here. Use a masked label and provider instructions.");
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
        for (const m of cleaned) db.prepare(`INSERT INTO funding_methods(id,user_id,label,kind,instructions,bank_name,routing_number,account_number,recipient,enabled,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,kind=excluded.kind,instructions=excluded.instructions,bank_name=excluded.bank_name,routing_number=excluded.routing_number,account_number=excluded.account_number,recipient=excluded.recipient,enabled=excluded.enabled,updated_at=excluded.updated_at`).run(m.id,id,m.label,m.kind,m.instructions,m.bankName,m.routingNumber,m.accountNumber,m.recipient,m.enabled ? 1 : 0,now());
        audit(req, "funding.methods", "Financial", `user:${id}`, "Updated per-member funding instructions; no external account was linked or charged.", JSON.stringify(before), JSON.stringify(cleaned));
      });
      res.json({ methods: methods(id) });
    },
    deposit(req: Request, res: Response) {
      const amount = dollarsToCents(req.body?.amount ?? 0);
      if (amount < 1000 || amount > 10000000) throw new BadInputError("Funding requests must be between $10 and $100,000.");
      const key = requestKey(req.body), id = req.user!.id;
      const note = text(req.body?.note ?? "", 500);
      const request = inTransaction(db, () => {
        const prior = db.prepare("SELECT * FROM funding_requests WHERE user_id=? AND request_key=?").get(id,key) as any;
        if (prior) { if (prior.amount_cents !== amount || prior.method_id !== req.body?.methodId || prior.note !== note) throw new BadInputError("This request identifier was already used for different details."); return prior; }
        if ((db.prepare("SELECT COUNT(*) AS n FROM funding_requests WHERE user_id=? AND status='pending'").get(id) as {n:number}).n >= 20) throw new BadInputError("You have 20 pending funding requests. Resolve existing requests before adding more.");
        const m = db.prepare("SELECT * FROM funding_methods WHERE id=? AND user_id=? AND enabled=1").get(String(req.body?.methodId ?? ""),id) as Method | undefined;
        if (!m) throw new BadInputError("Choose an enabled funding method configured for your account.");
        const requestId = rid("deposit"), reference = ref();
        db.prepare("INSERT INTO funding_requests(id,user_id,method_id,amount_cents,reference,method_snapshot,note,request_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(requestId,id,m.id,amount,reference,JSON.stringify(m),note,key,now());
        return db.prepare("SELECT * FROM funding_requests WHERE id=?").get(requestId);
      });
      res.status(201).json({ request, status: request.status, message: "Request recorded. No funds have been collected or credited." });
    },
    reviewDeposit(req: Request, res: Response) {
      const id = String(req.params.id); member(id);
      const decision = req.body?.decision;
      if (!["confirmed", "rejected"].includes(decision)) throw new BadInputError("Choose confirmed or rejected.");
      const evidence = text(req.body?.evidence, 500, true);
      inTransaction(db, () => {
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
      });
      res.json({ ok: true });
    },
    withdrawalsGet(req: Request, res: Response) {
      res.json({ withdrawals: db.prepare("SELECT * FROM crypto_withdrawals WHERE user_id=? ORDER BY (status='pending') DESC, created_at DESC LIMIT 100").all(req.user!.id).map(withdrawOut) });
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
      const request = inTransaction(db, () => {
        const prior = db.prepare("SELECT * FROM crypto_withdrawals WHERE user_id=? AND request_key=?").get(id,key) as any;
        if (prior) { if (prior.asset !== asset.code || prior.units !== units.toString() || prior.network !== spec.network || prior.address !== address) throw new BadInputError("Request identifier already used with different details."); return prior; }
        if ((db.prepare("SELECT COUNT(*) AS n FROM crypto_withdrawals WHERE user_id=? AND status='pending'").get(id) as {n:number}).n >= 20) throw new BadInputError("Resolve existing withdrawal requests before adding more.");
        const current = BigInt((db.prepare("SELECT units FROM holdings WHERE user_id=? AND asset=?").get(id,asset.code) as any)?.units ?? "0");
        if (units > current) throw new BadInputError("Insufficient available asset units. Pending requests are already reserved.");
        db.prepare("UPDATE holdings SET units=?,updated_at=? WHERE user_id=? AND asset=?").run((current-units).toString(),now(),id,asset.code);
        const requestId = rid("withdraw");
        db.prepare("INSERT INTO crypto_withdrawals(id,user_id,asset,units,network,address,reference,request_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(requestId,id,asset.code,units.toString(),spec.network,address,ref(),key,now());
        return db.prepare("SELECT * FROM crypto_withdrawals WHERE id=?").get(requestId);
      });
      res.status(201).json({ withdrawal: withdrawOut(request), message: "Pending request only. No transaction has been broadcast; network fees and execution are not confirmed." });
    },
    cancelWithdrawal(req: Request, res: Response) {
      if (req.user!.loginId) return void res.status(403).json({ error: "Only the account owner can cancel." });
      inTransaction(db, () => {
        const r = db.prepare("SELECT * FROM crypto_withdrawals WHERE id=? AND user_id=?").get(String(req.params.id),req.user!.id) as any;
        if (!r) throw new BadInputError("Withdrawal not found.");
        if (r.status !== "pending") return;
        const holding = db.prepare("SELECT units FROM holdings WHERE user_id=? AND asset=?").get(req.user!.id,r.asset) as any;
        db.prepare("UPDATE holdings SET units=?,updated_at=? WHERE user_id=? AND asset=?").run((BigInt(holding.units)+BigInt(r.units)).toString(),now(),req.user!.id,r.asset);
        db.prepare("UPDATE crypto_withdrawals SET status='cancelled',cancelled_at=? WHERE id=?").run(now(),r.id);
      });
      res.json({ ok: true });
    },
  };
}
