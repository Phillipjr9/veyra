import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getSetting, setSetting } from "./db.js";
import { verifyPassword } from "./security.js";
import { DEMO_PASSWORD } from "./demo.js";
import { previewCryptoEnabled } from "./previewCrypto.js";

export const PREVIEW_CRYPTO_BUYS = [
  { asset: "BTC", dollars: "500", quantity: "0.01" },
  { asset: "ETH", dollars: "750", quantity: "0.25" },
  { asset: "SOL", dollars: "1000", quantity: "5" },
  { asset: "USDC", dollars: "500", quantity: "500" },
  { asset: "USDT", dollars: "250", quantity: "250" },
] as const;

/** Only known disposable owners. Persist quote IDs BEFORE confirming so a
 * restart after a lost response replays an order, never buys twice. */
export async function seedPreviewCrypto(db: DatabaseSync, baseUrl: string, log: (line: string) => void = () => {}) {
  if (!previewCryptoEnabled()) return;
  for (const type of ["personal", "business"] as const) {
    const email = `demo.${type}@veyra.dev`;
    const owner = db.prepare("SELECT id,password_hash FROM users WHERE email=? AND account_type=? AND role='user' AND status='active' AND team_owner_id IS NULL").get(email, type) as { id: string; password_hash: string } | undefined;
    let verified = false;
    try { verified = !!owner && verifyPassword(DEMO_PASSWORD, owner.password_hash); } catch { /* Invalid fixture hashes fail closed. */ }
    if (!owner || !verified) { log(`Skipped unverified ${type} fixture`); continue; }
    const login = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: DEMO_PASSWORD }) });
    const session = await login.json() as { token?: string };
    if (!login.ok || !session.token) { log(`Skipped unavailable ${type} fixture login`); continue; }
    const headers = { "content-type": "application/json", authorization: `Bearer ${session.token}` };
    const sources = await fetch(`${baseUrl}/api/me/funding`, { headers });
    const funding = await sources.json() as { immediateFunding?: boolean; methods?: { id: string; kind: string }[] };
    const method = funding.methods?.find(row => row.kind === "bank");
    if (!sources.ok || !funding.immediateFunding || !method) throw new Error("Preview crypto needs account-ledger funding enabled.");
    const fundingMarker = `preview_crypto_funding_v1:${owner.id}`;
    const fundingKey = getSetting(db, fundingMarker) ?? randomUUID();
    setSetting(db, fundingMarker, fundingKey, owner.id);
    // The same key replays this preview credit across boots, even after it is
    // spent. Skip the request entirely once its funding row exists so a changed
    // display note can never turn a restart into a conflicting replay.
    const alreadyFunded = db.prepare("SELECT id FROM funding_requests WHERE user_id=? AND request_key=?").get(owner.id, fundingKey);
    if (!alreadyFunded) {
      const funded = await fetch(`${baseUrl}/api/me/deposits`, { method: "POST", headers, body: JSON.stringify({
        accountEntry: true, methodId: method.id, amount: "3000", requestKey: fundingKey,
        note: "Preview crypto balance",
      }) });
      if (!funded.ok) throw new Error(`Cannot prepare preview crypto balance: ${await funded.text()}`);
    }
    for (const buy of PREVIEW_CRYPTO_BUYS) {
      const marker = `preview_crypto_v1:${owner.id}:${buy.asset}`;
      let quoteId = getSetting(db, marker);
      if (quoteId) {
        const prior = await fetch(`${baseUrl}/api/me/crypto/orders/${quoteId}`, { headers });
        if (!prior.ok) throw new Error(`Cannot verify earlier ${type} ${buy.asset} seed; refusing to buy again.`);
        const order = await prior.json() as { receipt: unknown; status: string };
        if (order.receipt) continue;
        if (order.status === "expired") quoteId = undefined;
      }
      if (!quoteId) {
        const quoted = await fetch(`${baseUrl}/api/me/crypto/quote`, { method: "POST", headers, body: JSON.stringify({ action: "buy", fromAsset: "USD", toAsset: buy.asset, amount: buy.dollars }) });
        if (!quoted.ok) throw new Error(`Cannot prepare ${type} ${buy.asset} preview holding: ${await quoted.text()}`);
        const body = await quoted.json() as { quote: { id: string } };
        quoteId = body.quote.id;
        setSetting(db, marker, quoteId, owner.id);
      }
      const confirmed = await fetch(`${baseUrl}/api/me/crypto/confirm`, { method: "POST", headers, body: JSON.stringify({ quoteId }) });
      if (!confirmed.ok) throw new Error(`Cannot confirm ${type} ${buy.asset} preview holding: ${await confirmed.text()}`);
      log(`${type}: ${buy.quantity} ${buy.asset} preview holding prepared through an account buy`);
    }
  }
}
