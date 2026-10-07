/** Public contracts contain no private keys, signing material or provider secrets. */
export type CryptoAction = "buy" | "sell" | "swap";
export type WalletNetwork = "Bitcoin" | "Ethereum" | "Solana";
export const WALLET_NETWORKS: WalletNetwork[] = ["Bitcoin", "Ethereum", "Solana"];
export type CryptoQuote = {
  previewData?: boolean;
  id: string; action: CryptoAction; fromAsset: string; toAsset: string;
  fromUnits: string; toUnits: string; fromQuantity: string; toQuantity: string;
  fromDecimals: number; toDecimals: number; fromPriceCents: string; toPriceCents: string;
  notionalUsd: string; feeUsd: string; feeCents?: string; createdAt: number; expiresAt: number;
  settlement: "account";
};
export type CryptoReceipt = CryptoQuote & { reference: string; completedAt: number; status: "completed"; transactionHash: null };
export type CryptoOrder = { quote: CryptoQuote; status: "quoted" | "expired" | "completed"; receipt: CryptoReceipt | null };
export type CryptoCapabilities = {
  accountTrading: boolean; canOperate: boolean; withdrawals: boolean;
  networks: WalletNetwork[];
  custody: false; onchainSend: false; onchainSwap: false; cashOnramp: false; cashOfframp: false;
  /** Development-only direct-wallet send on Ethereum Sepolia; never mainnet. */
  sepoliaTestnetSend: boolean;
  solanaBalance: boolean;
};

/** Display base units without ever converting a crypto quantity to a float. */
export function displayUnits(units: string, decimals: number): string {
  if (!/^\d+$/.test(units) || !Number.isInteger(decimals) || decimals < 0 || decimals > 30) throw new Error("Invalid asset units.");
  const padded = units.replace(/^0+(?=\d)/, "").padStart(decimals + 1, "0");
  if (!decimals) return padded;
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return padded.slice(0, -decimals) + (fraction ? `.${fraction}` : "");
}

// These are Ethereum-mainnet token identities, not ticker-only matches.
export const ETHEREUM_TOKENS = [
  { symbol: "USDC", decimals: 6, address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
  { symbol: "USDT", decimals: 6, address: "0xdac17f958d2ee523a2206206994597c13d831ec7" },
] as const;
