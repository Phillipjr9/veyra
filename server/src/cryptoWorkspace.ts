import { sendCryptoNotification } from "./cryptoNotifications.js";
import { previewCryptoEnabled } from "./previewCrypto.js";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { assetByCode, tradingEnabled } from "./assets.js";
import { BadInputError, centsToDecimal, dollarsToCents, getSetting, inTransaction } from "./db.js";
import { formatUnitsTrimmed, parseUnits } from "./money.js";
import { loadPrices, quoteIsFresh, quoteValidUntil } from "./prices.js";
import { rateLimit } from "./security.js";
import { applyFee, quoteFee } from "../../shared/fees.js";
import { WALLET_NETWORKS, type CryptoCapabilities, type CryptoQuote, type CryptoReceipt } from "../../shared/cryptoWorkspace.js";
import { solanaBalance } from "./web3Providers.js";

type OrderRow = { id: string; user_id: string; quote_json: string; result_json: string | null; expires_at: number; created_at: number; reference: string | null };
type Audit = (req: Request, action: string, category: "Financial", target: string, summary: string, before?: string, after?: string) => void;
function fail(message: string): never { throw new BadInputError(message); }
const validId = (value: unknown) => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);

export function createCryptoWorkspace(db: DatabaseSync, audit: Audit) {
  function eligible(req: Request) {
    if (req.user?.loginId || req.user?.role !== "user") return false;
    const row = db.prepare(`SELECT u.status, u.role, u.team_owner_id, k.review_state FROM users u
      JOIN kyc_records k ON k.user_id=u.id WHERE u.id=?`).get(req.user!.id);
    return row?.role === "user" && row.status === "active" && row?.review_state === "approved" && !row?.team_owner_id;
  }
  function checkMovement(req: Request) {
    if (!eligible(req)) fail("An active, approved account owner is required for crypto orders.");
    if (!tradingEnabled()) fail("Crypto trading is currently unavailable.");
    if (getSetting(db, "payment_rails") === "halted") fail("Account movements are temporarily paused.");
  }
  function owned(req: Request, id: unknown) {
    if (!validId(id)) fail("Invalid crypto order identifier.");
    const row = db.prepare("SELECT * FROM crypto_orders WHERE id=? AND user_id=?").get(String(id), req.user!.id) as OrderRow | undefined;
    if (!row) fail("Crypto order not found in your account.");
    return row;
  }
  const shape = (row: OrderRow) => ({ quote: JSON.parse(row.quote_json) as CryptoQuote,
    status: row.result_json ? "completed" : row.expires_at <= Date.now() ? "expired" : "quoted",
    receipt: row.result_json ? JSON.parse(row.result_json) as CryptoReceipt : null });
  const holding = (id: string, asset: string) => BigInt(String(db.prepare("SELECT units FROM holdings WHERE user_id=? AND asset=?").get(id, asset)?.units ?? "0"));
  function checkBalances(id: string, q: CryptoQuote, feeCents: number) {
    const cash = db.prepare("SELECT id,balance_cents FROM accounts WHERE user_id=?").get(id) as { id: number; balance_cents: number } | undefined;
    if (!cash) fail("Account unavailable.");
    const available = q.fromAsset === "USD" ? BigInt(cash.balance_cents) : holding(id, q.fromAsset);
    const required = q.fromAsset === "USD" ? BigInt(q.fromUnits) + BigInt(feeCents) : BigInt(q.fromUnits);
    if (available < required) fail(`Insufficient available ${q.fromAsset}. Reserved units cannot be used.`);
    if (q.action === "swap" && cash.balance_cents < feeCents) fail("Insufficient checking balance for the swap fee.");
    if (q.toAsset === "USD") {
      const netCredit = applyFee(Number(q.toUnits), feeCents);
      if (!Number.isSafeInteger(cash.balance_cents + netCredit) || cash.balance_cents + netCredit > 1_000_000_000) fail("The account balance limit would be exceeded.");
    }
    return cash;
  }
  return {
    capabilities(req: Request, res: Response) {
      const enabled = tradingEnabled() && getSetting(db, "payment_rails") !== "halted";
      const capabilities: CryptoCapabilities = { accountTrading: enabled, canOperate: eligible(req), withdrawals: enabled && eligible(req), networks: WALLET_NETWORKS,
        custody: false, onchainSend: false, onchainSwap: false, cashOnramp: false, cashOfframp: false,
        sepoliaTestnetSend: process.env.NODE_ENV !== "production" && process.env.CRYPTO_TESTNET_SEND === "1",
        solanaBalance: !!process.env.SOLANA_RPC_URL?.trim() };
      res.json(capabilities);
    },
    async quote(req: Request, res: Response) {
      checkMovement(req);
      if (!rateLimit(`crypto-quote:${req.user!.id}`, 30, 60_000)) fail("Too many quote requests. Try again in a minute.");
      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["action", "fromAsset", "toAsset", "amount"].includes(key))) fail("Unexpected order fields.");
      const { action, fromAsset, toAsset, amount } = body;
      if (!["buy", "sell", "swap"].includes(action) || typeof fromAsset !== "string" || typeof toAsset !== "string" || fromAsset === toAsset) fail("Select an order type and two different assets.");
      if ((action === "buy" && (fromAsset !== "USD" || toAsset === "USD")) || (action === "sell" && (toAsset !== "USD" || fromAsset === "USD")) || (action === "swap" && [fromAsset, toAsset].includes("USD"))) fail("The selected assets do not match this order type.");
      const from = fromAsset === "USD" ? { code: "USD", decimals: 2 } : assetByCode(db, fromAsset);
      const to = toAsset === "USD" ? { code: "USD", decimals: 2 } : assetByCode(db, toAsset);
      if (!from || !to || from.code !== fromAsset || to.code !== toAsset) fail("Unsupported asset.");
      if (typeof amount !== "string" || !/^\d{1,40}(\.\d{1,30})?$/.test(amount) || (amount.split(".")[1] ?? "").length > from.decimals) fail(`Enter a positive quantity with at most ${from.decimals} decimal places.`);
      const fromUnits = parseUnits(amount, from.decimals);
      if (fromUnits <= 0n) fail("Amount must be greater than zero.");
      const prices = await loadPrices();
      // Authorization/configuration can change while the price request is in flight.
      checkMovement(req);
      const at = Date.now();
      const source = fromAsset === "USD" ? { cents: 100n, fetchedAt: at } : prices.get(fromAsset);
      const target = toAsset === "USD" ? { cents: 100n, fetchedAt: at } : prices.get(toAsset);
      if (!source || !target || !quoteIsFresh(source.fetchedAt) || !quoteIsFresh(target.fetchedAt)) fail("A current price is unavailable. Refresh prices before requesting another quote.");
      const cents = fromUnits * source.cents / (10n ** BigInt(from.decimals));
      if (cents < 1n || cents > 25_000_000n) fail("Orders must be worth between $0.01 and $250,000.");
      // One rational conversion; no intermediate float or USD-cent rounding for swaps.
      const toUnits = fromUnits * source.cents * (10n ** BigInt(to.decimals)) / ((10n ** BigInt(from.decimals)) * target.cents);
      if (toUnits <= 0n) fail("This amount is too small to receive any of the selected asset.");
      const fee = quoteFee(action === "buy" ? "crypto_buy" : action === "sell" ? "crypto_sell" : "crypto_swap", Number(cents));
      const q: CryptoQuote = { previewData: previewCryptoEnabled(), id: randomUUID(), action, fromAsset, toAsset, fromUnits: fromUnits.toString(), toUnits: toUnits.toString(),
        fromQuantity: formatUnitsTrimmed(fromUnits, from.decimals), toQuantity: formatUnitsTrimmed(toUnits, to.decimals), fromDecimals: from.decimals, toDecimals: to.decimals,
        fromPriceCents: source.cents.toString(), toPriceCents: target.cents.toString(), notionalUsd: centsToDecimal(Number(cents)), feeUsd: centsToDecimal(fee.feeCents), feeCents: fee.feeCents.toString(),
        createdAt: at, expiresAt: Math.min(at + 60_000, quoteValidUntil(source.fetchedAt), quoteValidUntil(target.fetchedAt)), settlement: "account" };
      checkBalances(req.user!.id, q, fee.feeCents);
      // Expired, unexecuted reviews are not financial history. Bound their storage.
      db.prepare("DELETE FROM crypto_orders WHERE user_id=? AND result_json IS NULL AND expires_at<?").run(req.user!.id, at - 86_400_000);
      db.prepare("INSERT INTO crypto_orders(id,user_id,quote_json,expires_at,created_at) VALUES(?,?,?,?,?)").run(q.id, req.user!.id, JSON.stringify(q), q.expiresAt, at);
      res.status(201).json({ quote: q });
    },
    confirm(req: Request, res: Response) {
      if (!req.body || Object.keys(req.body).some(key => key !== "quoteId")) fail("Confirm using only the reviewed quote identifier.");
      const ownedOrder = owned(req, req.body.quoteId);
      const reviewed = JSON.parse(ownedOrder.quote_json) as CryptoQuote;
      let result: CryptoReceipt;
      try { result = inTransaction(db, () => {
        const row = owned(req, req.body.quoteId);
        // A retry is a read, even if the quote has since expired or rails paused.
        if (row.result_json) return JSON.parse(row.result_json) as CryptoReceipt;
        checkMovement(req);
        const q = JSON.parse(row.quote_json) as CryptoQuote;
        if (!!q.previewData !== previewCryptoEnabled()) fail("The price source changed. Request a new quote before confirming.");
        if (row.expires_at <= Date.now()) fail("This quote expired. Request a fresh quote and review it again.");
        for (const [code, decimals] of [[q.fromAsset, q.fromDecimals], [q.toAsset, q.toDecimals]] as const) {
          if (code !== "USD" && assetByCode(db, code)?.decimals !== decimals) fail("The asset configuration changed. Request a new quote.");
        }
        const notionalCents = dollarsToCents(q.notionalUsd);
        const expectedFee = quoteFee(q.action === "buy" ? "crypto_buy" : q.action === "sell" ? "crypto_sell" : "crypto_swap", notionalCents);
        const feeCents = Number(q.feeCents ?? expectedFee.feeCents);
        if (feeCents !== expectedFee.feeCents) fail("The reviewed fee changed. Request a fresh quote and review it again.");
        const id = req.user!.id, cash = checkBalances(id, q, feeCents), at = Date.now(), reference = `VYR-${randomUUID().toUpperCase()}`;
        const setHolding = db.prepare("INSERT INTO holdings(user_id,asset,units,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,asset) DO UPDATE SET units=excluded.units,updated_at=excluded.updated_at");
        if (q.fromAsset !== "USD") setHolding.run(id, q.fromAsset, (holding(id, q.fromAsset) - BigInt(q.fromUnits)).toString(), at);
        if (q.toAsset !== "USD") setHolding.run(id, q.toAsset, (holding(id, q.toAsset) + BigInt(q.toUnits)).toString(), at);
        const principal = q.fromAsset === "USD" ? -Number(q.fromUnits) : q.toAsset === "USD" ? Number(q.toUnits) : 0;
        const delta = applyFee(principal, feeCents);
        if (delta) {
          db.prepare("UPDATE accounts SET balance_cents=balance_cents+?,updated_at=? WHERE id=?").run(delta, at, cash.id);
          const merchant = q.action === "buy" ? `Bought ${q.toAsset}` : q.action === "sell" ? `Sold ${q.fromAsset}` : `Swapped ${q.fromAsset} → ${q.toAsset}`;
          db.prepare(`INSERT INTO transactions(id,account_id,user_id,merchant,category,method,amount_cents,fee_cents,status,reference,note,created_at,performed_by)
            VALUES(?,?,?,?,'Investing','Internal',?,?,'cleared',?,?,?,?)`).run(randomUUID(), cash.id, id, merchant, principal, feeCents, reference,
              `${q.fromQuantity} ${q.fromAsset} → ${q.toQuantity} ${q.toAsset}. Account order; no external execution.${feeCents ? ` Fee ${centsToDecimal(feeCents)}.` : ""}`, at, id);
        }
        const movement = db.prepare("INSERT INTO holding_transactions(id,user_id,asset,side,units,usd_cents,price_cents,reference,created_at) VALUES(?,?,?,?,?,?,?,?,?)");
        if (q.fromAsset !== "USD") movement.run(randomUUID(), id, q.fromAsset, "sell", q.fromUnits, q.action === "swap" ? 0 : Number(q.toUnits), q.fromPriceCents, reference, at);
        if (q.toAsset !== "USD") movement.run(randomUUID(), id, q.toAsset, "buy", q.toUnits, q.action === "swap" ? 0 : Number(q.fromUnits), q.toPriceCents, reference, at);
        const receipt: CryptoReceipt = { ...q, reference, completedAt: at, status: "completed", transactionHash: null };
        db.prepare("UPDATE crypto_orders SET result_json=?,reference=? WHERE id=?").run(JSON.stringify(receipt), reference, q.id);
        audit(req, `crypto.${q.action}`, "Financial", `user:${id}`, `Account order: ${q.fromQuantity} ${q.fromAsset} → ${q.toQuantity} ${q.toAsset}. ${reference}`, undefined, JSON.stringify(receipt));
        return receipt;
      });
      } catch (error) {
        if (error instanceof BadInputError && !ownedOrder.result_json) sendCryptoNotification(db, req.user!.id, {
          activity: reviewed.action, status: "failed", reference: reviewed.id, occurredAt: Date.now(),
          asset: reviewed.fromAsset, quantity: reviewed.fromQuantity, toAsset: reviewed.toAsset, toQuantity: reviewed.toQuantity, settlement: "account",
        });
        throw error;
      }
      sendCryptoNotification(db, req.user!.id, { activity: result.action, status: "completed", reference: result.reference, occurredAt: result.completedAt,
        asset: result.fromAsset, quantity: result.fromQuantity, toAsset: result.toAsset, toQuantity: result.toQuantity, settlement: "account" });
      res.json({ receipt: result });
    },
    order(req: Request, res: Response) { res.json(shape(owned(req, req.params.id))); },
    history(req: Request, res: Response) {
      const rows = db.prepare("SELECT * FROM crypto_orders WHERE user_id=? AND result_json IS NOT NULL ORDER BY created_at DESC LIMIT 100").all(req.user!.id) as OrderRow[];
      res.json({ orders: rows.map(shape), scope: "Recent reviewed account orders" });
    },
    async walletBalance(req: Request, res: Response) {
      if (!rateLimit(`wallet-read:${req.user!.id}`, 30, 60_000)) fail("Too many wallet reads. Please wait a minute.");
      if (req.body?.network !== "Solana" || typeof req.body?.address !== "string") fail("Choose a supported balance reader.");
      res.json(await solanaBalance(req.body.address));
    },
  };
}
