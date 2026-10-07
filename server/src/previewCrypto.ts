import { ASSETS } from "../../shared/catalog.js";

/** Explicit, non-production generated data. Never a fallback for a failed live feed. */
export const previewCryptoEnabled = () => process.env.NODE_ENV !== "production" && process.env.PREVIEW_CRYPTO_DATA === "1";

const PRICES: Record<string, number> = {
  BTC: 50000, ETH: 3000, SOL: 200, USDC: 1, USDT: 1, BNB: 600,
  XRP: 2.5, ADA: .75, DOGE: .2, AVAX: 30, LINK: 15, DOT: 5,
  LTC: 100, BCH: 400, UNI: 8, ATOM: 6, XLM: .3, NEAR: 4,
  APT: 7, ARB: .8, ETC: 25, AAVE: 250, ICP: 10, DAI: 1,
};
function sampleClose(code: string, i: number, count: number) {
  const asset = ASSETS.find(a => a.code === code);
  const stable = asset && "stable" in asset && asset.stable;
  const wave = stable ? 0 : Math.sin((i - count + 1) / 5) * .035 + (i - count + 1) / count * .025;
  return Math.round(PRICES[code] * (1 + wave) * 100) / 100;
}
export function previewMarketRows() {
  if (!previewCryptoEnabled()) throw new Error("Preview crypto data is disabled.");
  return ASSETS.map((asset, index) => {
    const price = PRICES[asset.code], stable = "stable" in asset && asset.stable;
    return { id: asset.id, symbol: asset.code.toLowerCase(), name: asset.name, image: null,
      current_price: price, market_cap: price * 1_000_000, total_volume: price * 15_000, market_cap_rank: index + 1,
      price_change_percentage_1h_in_currency: stable ? 0 : .25,
      price_change_percentage_24h_in_currency: stable ? 0 : index % 3 === 0 ? -1.4 : 2.1,
      price_change_percentage_7d_in_currency: stable ? 0 : 3.5,
      sparkline_in_7d: { price: Array.from({ length: 48 }, (_, i) => sampleClose(asset.code, i, 48)) },
    };
  });
}
export function previewCandles(code: string, days: number) {
  if (!previewCryptoEnabled()) throw new Error("Preview crypto data is disabled.");
  if (!(code in PRICES)) return [];
  const end = Math.floor(Date.now() / 60_000) * 60_000;
  return Array.from({ length: 64 }, (_, i) => {
    const close = sampleClose(code, i, 64), open = sampleClose(code, i - 1, 64);
    return [end - (63 - i) * days * 86_400_000 / 64, open,
      Math.ceil(Math.max(open, close) * 1.005 * 100) / 100,
      Math.floor(Math.min(open, close) * .995 * 100) / 100, close];
  });
}
