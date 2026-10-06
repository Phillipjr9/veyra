/** Shared product definitions. Prices describe plans, not an active billing integration. */
export const PLANS = {
  personal: [
    { id: "Starter", name: "Everyday", monthly: 0, features: ["Personal account workspace", "Transaction history and PDF receipts", "Savings pockets and spending reports", "Manual funding requests"] },
    { id: "Pro", name: "Plus", monthly: 9, features: ["Everyday workspace features", "Scout spending insights", "Rewards reporting", "Digital-asset workspace where enabled"] },
  ],
  business: [
    { id: "Starter", name: "Starter", monthly: 0, features: ["Business account workspace", "Invoices and payment records", "Team roles and spending controls", "Statements and PDF receipts"] },
    { id: "Pro", name: "Pro", monthly: 99, features: ["Starter workspace features", "Scout spending insights", "Rewards reporting", "Digital-asset workspace where enabled"] },
  ],
} as const;
export const PLAN_NOTICE = "Plan selection is recorded in your account. Subscription billing and plan-specific feature limits are not currently enforced. Scout provides estimates, not guaranteed savings. External payment services require activation.";

/** Explicit asset identity prevents unrelated tokens with the same ticker sharing a quote. */
export const ASSETS = [
  { code: "BTC", name: "Bitcoin", decimals: 8, id: "bitcoin", network: "Bitcoin" },
  { code: "ETH", name: "Ethereum", decimals: 18, id: "ethereum", network: "Ethereum" },
  { code: "SOL", name: "Solana", decimals: 9, id: "solana", network: "Solana" },
  { code: "USDC", name: "USD Coin", decimals: 6, id: "usd-coin", network: "Ethereum", stable: true },
  { code: "USDT", name: "Tether", decimals: 6, id: "tether", network: "Ethereum", stable: true },
  { code: "BNB", name: "BNB", decimals: 18, id: "binancecoin", network: "BNB Smart Chain" },
  { code: "XRP", name: "XRP", decimals: 6, id: "ripple", network: null },
  { code: "ADA", name: "Cardano", decimals: 6, id: "cardano", network: null },
  { code: "DOGE", name: "Dogecoin", decimals: 8, id: "dogecoin", network: null },
  { code: "AVAX", name: "Avalanche", decimals: 18, id: "avalanche-2", network: "Avalanche C-Chain" },
  { code: "LINK", name: "Chainlink", decimals: 18, id: "chainlink", network: "Ethereum" },
  { code: "DOT", name: "Polkadot", decimals: 10, id: "polkadot", network: null },
  { code: "LTC", name: "Litecoin", decimals: 8, id: "litecoin", network: null },
  { code: "BCH", name: "Bitcoin Cash", decimals: 8, id: "bitcoin-cash", network: null },
  { code: "UNI", name: "Uniswap", decimals: 18, id: "uniswap", network: "Ethereum" },
  { code: "ATOM", name: "Cosmos", decimals: 6, id: "cosmos", network: null },
  { code: "XLM", name: "Stellar", decimals: 7, id: "stellar", network: null },
  { code: "NEAR", name: "NEAR Protocol", decimals: 24, id: "near", network: null },
  { code: "APT", name: "Aptos", decimals: 8, id: "aptos", network: null },
  { code: "ARB", name: "Arbitrum", decimals: 18, id: "arbitrum", network: null },
  { code: "ETC", name: "Ethereum Classic", decimals: 18, id: "ethereum-classic", network: null },
  { code: "AAVE", name: "Aave", decimals: 18, id: "aave", network: "Ethereum" },
  { code: "ICP", name: "Internet Computer", decimals: 8, id: "internet-computer", network: null },
  { code: "DAI", name: "Dai", decimals: 18, id: "dai", network: "Ethereum", stable: true },
] as const;
