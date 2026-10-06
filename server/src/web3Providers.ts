import type { WalletNetwork } from "../../shared/cryptoWorkspace.js";
import { validWallet } from "../../shared/walletAddress.js";

/** Future execution ports. Implementations must reconcile durable idempotency keys,
 * provider webhooks and actual chain receipts before changing settlement state.
 * No execution implementation is registered in this release. */
export type ExternalSettlement =
  | { status: "pending"; providerReference: string; transactionHash: null }
  | { status: "broadcast" | "confirmed"; providerReference: string; transactionHash: string; network: WalletNetwork }
  | { status: "failed"; providerReference: string; transactionHash: string | null; reason: string };
export interface CustodyAdapter {
  depositAddress(userId: string, network: WalletNetwork, asset: string): Promise<{ address: string; network: WalletNetwork }>;
  prepareWithdrawal(input: { userId: string; asset: string; units: string; network: WalletNetwork; address: string }): Promise<{ quoteId: string; feeUnits: string; feeAsset: string; expiresAt: number }>;
  executeWithdrawal(quoteId: string, idempotencyKey: string): Promise<ExternalSettlement>;
  reconcile(providerReference: string): Promise<ExternalSettlement>;
}
export interface WalletSwapAdapter {
  quote(input: { network: WalletNetwork; account: string; sourceToken: string; targetToken: string; units: string; slippageBps: number }): Promise<{ quoteId: string; minimumOutputUnits: string; expiresAt: number; fees: { asset: string; units: string }[] }>;
  // The browser must independently review and approve a chain-specific unsigned
  // payload. Never collect keys, sign server-side for a user, or approve unlimited spending.
  unsignedTransaction(quoteId: string): Promise<{ network: WalletNetwork; payload: unknown }>;
}
export interface CashGatewayAdapter {
  checkout(input: { userId: string; direction: "buy" | "sell"; asset: string; network: WalletNetwork; amount: string; idempotencyKey: string }): Promise<{ providerReference: string; checkoutUrl: string }>;
  verifyWebhook(rawBody: Uint8Array, signature: string): Promise<{ providerReference: string; status: "pending" | "settled" | "failed" }>;
}

const SOLANA_MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2cWB";
export async function solanaBalance(address: string) {
  const unavailable = (reason: string) => ({ network: "Solana", asset: "SOL", units: null, observedAt: null, status: "unavailable", reason });
  if (address.length > 120 || !validWallet("Solana", address)) return unavailable("Invalid Solana address.");
  const url = process.env.SOLANA_RPC_URL?.trim();
  if (!url) return unavailable("Solana balance reader is not connected yet.");
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol) || (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")) return unavailable("Balance reader configuration is unavailable.");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 6000);
    try {
      const rpc = async (method: string, params: unknown[]) => {
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: controller.signal, redirect: "error" });
        if (!response.ok) throw new Error("RPC unavailable");
        const data = await response.json() as { result?: unknown; error?: unknown };
        if (data.error || data.result === undefined) throw new Error("RPC unavailable");
        return data.result;
      };
      if (await rpc("getGenesisHash", []) !== SOLANA_MAINNET_GENESIS) return unavailable("The balance reader is not on Solana mainnet.");
      const result = await rpc("getBalance", [address, { commitment: "finalized" }]) as { value?: unknown };
      if (typeof result.value !== "number" || !Number.isSafeInteger(result.value) || result.value < 0) return unavailable("The provider returned an unsupported balance value.");
      return { network: "Solana", asset: "SOL", units: String(result.value), observedAt: Date.now(), status: "available", reason: null };
    } finally { clearTimeout(timer); }
  } catch { return unavailable("The Solana balance reader could not be reached. Try again later."); }
}
