/**
 * Per-member crypto wallets.
 *
 * Every account owner gets deposit addresses for Bitcoin, Ethereum (ETH + USDC)
 * and Solana, plus optional linked external wallets. Addresses are generated
 * once, stored, and never rotated unless staff overwrite them. Incoming
 * deposits credit Veyra holdings (account ledger only — not a chain broadcast).
 */
import { createHmac, randomUUID } from "node:crypto";
import { bech32, base58 } from "@scure/base";
import { keccak_256 } from "@noble/hashes/sha3";
import type { Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { assetByCode } from "./assets.js";
import { BadInputError, inTransaction, now, rid } from "./db.js";
import { formatUnitsTrimmed, parseUnits } from "./money.js";
import { rateLimit } from "./security.js";
import { validWallet } from "../../shared/walletAddress.js";

type Audit = (req: Request, action: string, category: "Financial", target: string, summary: string, before?: string, after?: string) => void;
type WalletRow = { id: string; user_id: string; kind: "deposit" | "linked"; network: string; asset: string; address: string; label: string; created_at: number };

const NETWORKS = ["Bitcoin", "Ethereum", "Solana"] as const;
const DEPOSITS: Array<{ network: typeof NETWORKS[number]; asset: string; label: string }> = [
  { network: "Bitcoin", asset: "BTC", label: "Bitcoin" },
  { network: "Ethereum", asset: "ETH", label: "Ethereum" },
  { network: "Ethereum", asset: "USDC", label: "USD Coin" },
  { network: "Solana", asset: "SOL", label: "Solana" },
];

function fail(message: string): never { throw new BadInputError(message); }
function text(value: unknown, max: number, required = false) {
  if (typeof value !== "string") { if (required) fail("Invalid wallet input."); return ""; }
  const trimmed = value.trim();
  if (trimmed.length > max) fail("That value is too long.");
  if (required && !trimmed) fail("A required wallet field is missing.");
  return trimmed;
}
function requestKey(body: Record<string, unknown>) {
  const key = text(body.requestKey, 80, true);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) fail("Retry this request with a valid request key.");
  return key;
}
function seed(label: string, userId: string) {
  const secret = process.env.TOKEN_SECRET || process.env.WALLET_ADDRESS_SECRET || "veyra-dev-wallet-seed";
  return createHmac("sha256", secret).update(`${label}:${userId}`).digest();
}
function ethereumAddress(userId: string, label = "eth") {
  const body = seed(label, userId).subarray(0, 20);
  const hex = Buffer.from(body).toString("hex");
  const hash = Array.from(keccak_256(new TextEncoder().encode(hex)), byte => byte.toString(16).padStart(2, "0")).join("");
  const mixed = [...hex].map((char, i) => (/[a-f]/.test(char) && parseInt(hash[i], 16) >= 8 ? char.toUpperCase() : char)).join("");
  return `0x${mixed}`;
}
function bitcoinAddress(userId: string) {
  const program = seed("btc", userId).subarray(0, 20);
  return bech32.encode("bc", [0, ...bech32.toWords(program)]);
}
function solanaAddress(userId: string) {
  return base58.encode(seed("sol", userId));
}
function generate(network: typeof NETWORKS[number], userId: string, asset = "") {
  const address = network === "Bitcoin" ? bitcoinAddress(userId) : network === "Solana" ? solanaAddress(userId) : ethereumAddress(userId, asset === "USDC" ? "usdc" : "eth");
  if (!validWallet(network, address)) fail("Could not mint a valid deposit address. Retry.");
  return address;
}

function publicRow(row: WalletRow) {
  return { id: row.id, kind: row.kind, network: row.network, asset: row.asset, address: row.address, label: row.label, createdAt: row.created_at };
}

export function createCryptoWallets(db: DatabaseSync, audit: Audit) {
  const list = (userId: string) => db.prepare("SELECT * FROM user_crypto_wallets WHERE user_id=? ORDER BY kind, network, asset").all(userId) as WalletRow[];
  function ensureDeposit(userId: string) {
    const existing = list(userId).filter(row => row.kind === "deposit");
    const at = now();
    for (const spec of DEPOSITS) {
      if (existing.some(row => row.network === spec.network && row.asset === spec.asset)) continue;
      const address = generate(spec.network, userId, spec.asset);
      db.prepare("INSERT INTO user_crypto_wallets(id,user_id,kind,network,asset,address,label,created_at) VALUES(?,?,'deposit',?,?,?,?,?)")
        .run(rid("cw"), userId, spec.network, spec.asset, address, spec.label, at);
    }
    return list(userId);
  }
  function eligible(req: Request) {
    if (req.user?.loginId || req.user?.role !== "user") return false;
    const row = db.prepare(`SELECT u.status, u.role, u.team_owner_id, k.review_state FROM users u
      JOIN kyc_records k ON k.user_id=u.id WHERE u.id=?`).get(req.user!.id) as { status: string; role: string; team_owner_id: string | null; review_state: string } | undefined;
    return !!row && row.role === "user" && row.status === "active" && row.review_state === "approved" && !row.team_owner_id;
  }

  return {
    mine(req: Request, res: Response) {
      res.json({ wallets: ensureDeposit(req.user!.id).map(publicRow) });
    },
    adminList(req: Request, res: Response) {
      res.json({ wallets: ensureDeposit(String(req.params.id)).map(publicRow) });
    },
    link(req: Request, res: Response) {
      if (!eligible(req)) fail("Only an active, approved account owner can link a wallet.");
      const body = req.body ?? {};
      if (Object.keys(body).some(field => !["network", "address", "label", "requestKey"].includes(field))) fail("Only a network, address and optional label are accepted.");
      const network = text(body.network, 40, true);
      if (!NETWORKS.includes(network as typeof NETWORKS[number])) fail("Choose Bitcoin, Ethereum or Solana.");
      const address = text(body.address, 120, true);
      if (!validWallet(network, address)) fail(`Enter a valid ${network} address.`);
      const label = text(body.label, 80) || `Linked ${network} wallet`;
      const key = requestKey(body);
      const id = req.user!.id;
      const result = inTransaction(db, () => {
        const prior = db.prepare("SELECT * FROM user_crypto_wallets WHERE user_id=? AND kind='linked' AND network=? AND address=?").get(id, network, address) as WalletRow | undefined;
        if (prior) return { row: prior, replayed: true };
        if (!rateLimit(`wallet-link:${id}`, 20, 3600000)) fail("Too many wallet-link requests. Try again later.");
        if (list(id).filter(row => row.kind === "linked").length >= 20) fail("Remove an existing linked wallet before adding another.");
        const row: WalletRow = { id: rid("cw"), user_id: id, kind: "linked", network, asset: network === "Bitcoin" ? "BTC" : network === "Solana" ? "SOL" : "ETH", address, label, created_at: now() };
        db.prepare("INSERT INTO user_crypto_wallets(id,user_id,kind,network,asset,address,label,created_at) VALUES(?,?,?,?,?,?,?,?)")
          .run(row.id, row.user_id, row.kind, row.network, row.asset, row.address, row.label, row.created_at);
        return { row, replayed: false };
      });
      if (!result.replayed) audit(req, "crypto.wallet.link", "Financial", `user:${id}`, `Linked ${network} wallet ${address}.`);
      void key;
      res.status(result.replayed ? 200 : 201).json({ wallet: publicRow(result.row), replayed: result.replayed });
    },
    receive(req: Request, res: Response) {
      if (!eligible(req)) fail("Only an active, approved account owner can record a crypto deposit.");
      const body = req.body ?? {};
      if (Object.keys(body).some(field => !["asset", "amount", "txid", "requestKey"].includes(field))) fail("Only an asset, amount, optional transaction id and request key are accepted.");
      const assetCode = text(body.asset, 8, true).toUpperCase();
      const asset = assetByCode(db, assetCode);
      if (!asset) fail("Choose BTC, ETH, SOL or USDC.");
      const amountText = text(body.amount, 40, true);
      let units: bigint;
      try { units = parseUnits(amountText, asset.decimals); } catch { fail("Enter a positive quantity with the correct precision."); }
      if (units <= 0n) fail("Enter a positive quantity.");
      const max = asset.code === "USDC" ? 1_000_000n * 10n ** BigInt(asset.decimals) : 100_000n * 10n ** BigInt(asset.decimals);
      if (units > max) fail("That deposit is above the account limit.");
      const txid = text(body.txid, 120);
      const key = requestKey(body);
      const id = req.user!.id;
      const wallets = ensureDeposit(id);
      const deposit = wallets.find(row => row.kind === "deposit" && row.asset === asset.code);
      if (!deposit) fail("A deposit address is not available for this asset.");
      const result = inTransaction(db, () => {
        const prior = db.prepare("SELECT id, reference FROM holding_transactions WHERE user_id=? AND reference=?").get(id, `DEP-${key}`) as { id: string; reference: string } | undefined;
        if (prior) {
          const holding = db.prepare("SELECT units FROM holdings WHERE user_id=? AND asset=?").get(id, asset.code) as { units: string } | undefined;
          return { reference: prior.reference, units: holding?.units ?? "0", replayed: true };
        }
        if (!rateLimit(`crypto-deposit:${id}`, 30, 3600000)) fail("Too many crypto deposit records. Try again later.");
        const at = now();
        const held = db.prepare("SELECT units FROM holdings WHERE user_id=? AND asset=?").get(id, asset.code) as { units: string } | undefined;
        const current = BigInt(String(held?.units ?? "0"));
        const next = current + units;
        db.prepare("INSERT INTO holdings(user_id,asset,units,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,asset) DO UPDATE SET units=excluded.units,updated_at=excluded.updated_at")
          .run(id, asset.code, next.toString(), at);
        const reference = `DEP-${key}`;
        db.prepare("INSERT INTO holding_transactions(id,user_id,asset,side,units,usd_cents,price_cents,reference,created_at) VALUES(?,?,?,'buy',?,0,'0',?,?)")
          .run(randomUUID(), id, asset.code, units.toString(), reference, at);
        return { reference, units: next.toString(), replayed: false };
      });
      if (!result.replayed) audit(req, "crypto.deposit", "Financial", `user:${id}`, `Recorded inbound ${amountText} ${asset.code} to ${deposit.address}${txid ? ` · ${txid}` : ""}.`);
      res.status(result.replayed ? 200 : 201).json({
        deposit: {
          asset: asset.code, quantity: formatUnitsTrimmed(units, asset.decimals), address: deposit.address,
          reference: result.reference, txid: txid || null, replayed: result.replayed,
        },
      });
    },
    adminSet(req: Request, res: Response) {
      const userId = String(req.params.id);
      const body = req.body ?? {};
      const reason = text(body.reason, 500, true);
      const address = text(body.address, 120, true);
      const label = text(body.label, 80);
      const id = text(body.id, 80);
      ensureDeposit(userId);
      if (id) {
        const before = db.prepare("SELECT * FROM user_crypto_wallets WHERE id=? AND user_id=?").get(id, userId) as WalletRow | undefined;
        if (!before) return void res.status(404).json({ error: "Wallet not found." });
        if (!validWallet(before.network, address)) fail(`Enter a valid ${before.network} address.`);
        db.prepare("UPDATE user_crypto_wallets SET address=?,label=? WHERE id=?").run(address, label || before.label, before.id);
        audit(req, "crypto.wallet.admin", "Financial", `user:${userId}`, reason, before.address, address);
        return void res.json({ wallets: list(userId).map(publicRow) });
      }
      const network = text(body.network, 40, true);
      if (!NETWORKS.includes(network as typeof NETWORKS[number])) fail("Choose Bitcoin, Ethereum or Solana.");
      if (!validWallet(network, address)) fail(`Enter a valid ${network} address.`);
      const asset = text(body.asset, 8, true).toUpperCase();
      const before = db.prepare("SELECT * FROM user_crypto_wallets WHERE user_id=? AND kind='deposit' AND network=? AND asset=?").get(userId, network, asset) as WalletRow | undefined;
      const at = now();
      if (before) {
        db.prepare("UPDATE user_crypto_wallets SET address=?,label=? WHERE id=?").run(address, label || before.label, before.id);
      } else {
        db.prepare("INSERT INTO user_crypto_wallets(id,user_id,kind,network,asset,address,label,created_at) VALUES(?,?,'deposit',?,?,?,?,?)")
          .run(rid("cw"), userId, network, asset, address, label || asset, at);
      }
      audit(req, "crypto.wallet.admin", "Financial", `user:${userId}`, reason, before?.address, address);
      res.json({ wallets: list(userId).map(publicRow) });
    },
  };
}
