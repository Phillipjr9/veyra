/** Stable offline quotes/history for security audits and browser tests. */
import { createServer } from "node:http";

export function createPriceFixture() {
  const coins = [
    { id: "bitcoin", symbol: "btc", name: "Bitcoin", price: 50_000 },
    { id: "ethereum", symbol: "eth", name: "Ethereum", price: 3_000 },
    { id: "solana", symbol: "sol", name: "Solana", price: 200 },
    { id: "usd-coin", symbol: "usdc", name: "USD Coin", price: 1 },
    { id: "tether", symbol: "usdt", name: "Tether", price: 1 },
  ];

  return createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    const ohlc = url.pathname.match(/^\/ohlc\/([^/]+)$/);
    if (ohlc) {
      const coin = coins.find(c => c.id === ohlc[1]);
      if (!coin) { res.statusCode = 404; return void res.end('{"error":"Unknown asset"}'); }
      const days = Math.max(1, Number(url.searchParams.get("days")) || 1);
      const step = days * 86_400_000 / 48;
      const end = Date.now();
      return void res.end(JSON.stringify(Array.from({ length: 48 }, (_, i) => {
        const close = coin.price * (1 + Math.sin(i / 5) * .02);
        return [end - (47 - i) * step, close * .995, close * 1.01, close * .99, close];
      })));
    }
    res.end(JSON.stringify(coins.map((c, index) => ({
      id: c.id, symbol: c.symbol, name: c.name, image: null,
      current_price: c.price, market_cap: c.price * 1_000_000, total_volume: c.price * 10_000,
      market_cap_rank: index + 1,
      price_change_percentage_1h_in_currency: .25,
      price_change_percentage_24h_in_currency: 1.5,
      price_change_percentage_7d_in_currency: 3,
      sparkline_in_7d: { price: [c.price * .98, c.price * .99, c.price] },
    }))));
  });
}
