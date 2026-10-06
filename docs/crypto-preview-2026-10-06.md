# Crypto testing preview — 6 October 2026

> Customer UI behavior superseded by `crypto-funding-polish-2026-10-06.md`:
> generated prices/charts are now suppressed rather than displayed with test
> banners. This document's seed and API fixture details remain valid. Run the
> normal server with the configured feed for customer-facing trade flows.

The requested testing setup is available through `npm run dev:preview` (both
servers) or `npm run server:preview` (API only). Normal server startup is unchanged.

## Starting portfolio, per Personal and Business quick-access owner

| Asset | Available units | Sample unit price | Sample value |
| --- | ---: | ---: | ---: |
| BTC | 0.01 | $50,000 | $500 |
| ETH | 0.25 | $3,000 | $750 |
| SOL | 5 | $200 | $1,000 |
| USDC | 500 | $1 | $500 |
| USDT | 250 | $1 | $250 |
| Total | | | $3,000 |

The 24-asset directory has sample quotes, rank, volume, market cap, change figures,
sparklines and OHLC candles. These are generated testing values, not live market
information. Sample quotes refresh under the ordinary cache/freshness policy.

Assets, Markets, account holdings, the dashboard crypto tile and order/withdrawal
dialogs identify test data. API holdings, markets, candles, quotes and receipts
also carry sample-data metadata. The Markets Buy action now opens a reviewed
order for the selected asset, rather than an inactive accounts query parameter.

## Isolation and persistence

- The explicit preview flag uses `server/preview-crypto.db`; startup passes this
  path directly to createApp, avoiding module-import timing of DB_PATH defaults.
- Production refuses either the preview flag or the preview database path.
- Sample quotes are not used as a silent fallback when a live feed fails.
- Switching price sources clears the caches. An unexecuted quote cannot confirm
  after its preview/live source changes; completed receipts remain readable.
- Only known active fixture owners with matching fixed fixture passwords are
  seeded. No general-user or connected-wallet balance is invented.
- One persisted UUID funds each fixture's $3,000 test credit. Five normal reviewed
  internal buys consume it, leaving the original checking balance unchanged.
- Quote IDs are saved before confirmation, so restarts/lost replies reconcile
  the same order. Seeds do not refill a portfolio after the user trades it.
- No external custody, signing, broadcasting, bridging or bank/card rail is added.

## Verification

- Full npm tests pass, including **22 preview-crypto checks**: all 24 quotes,
  charts, expiry/refetch, production guards, API labelling, seeding, replay,
  preserving user trades, and refusing quotes after a source switch.
- Client/server types, E2E types and production build pass.
- Two new real-server browser tests pass for sample labels, five balances,
  24 markets, BTC candles, Markets→Buy, buy/sell/swap, persistence, mobile fit,
  pending withdrawal animation and cancellation.
- All 13 existing crypto-workspace browser regressions pass with preview mode off.
- Preview balances were seeded and the seeder rerun without a second credit or
  duplicate buy. The runtime is explicitly restarted with server:preview.

Early verification caught a startup DB-path import-timing problem and an invalid
funding key; both were corrected before the final isolated preview was prepared.
The new market-chart test initially used a Recharts selector; it now verifies the
existing CandleChart. No authentication limits were weakened. No Git push or
public deployment was performed.
