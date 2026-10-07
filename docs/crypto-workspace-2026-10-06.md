# Hybrid crypto workspace — 6 October 2026 (updated 7 October 2026)

## Delivered scope

Open **Crypto** in either the personal or business navigation (`/#/app/assets`). The workspace separates Veyra account holdings from a connected external wallet. Existing market charts remain under Markets; this does not add dashboard charts or change the Add funds workflow.

- Account **buy / sell / swap** now use a server-generated, expiring review and a separate confirmation. Account portfolio, available/reserved quantities, search and reviewed-order history are included. Existing holdings Buy/Sell buttons and market purchase links open this review flow.
- **Veyra-account Send** records an immediate account debit and a request; it is not broadcast, cannot be cancelled, and has no network fee/hash/confirmation.
- **Development-only Sepolia test send:** with `CRYPTO_TESTNET_SEND=1`, a separate direct-wallet flow supports native ETH on Ethereum Sepolia. It verifies chain ID `0xaa36a7`, checks the account again before signing, shows amount and gas estimate for review, and delegates `eth_sendTransaction` to the user's wallet. It reads the transaction receipt/hash but never changes Veyra holdings or stores the wallet key. An explicit wallet rejection returns to review; an ambiguous response blocks a retry until the user checks wallet activity. Production startup rejects this flag; all mainnet sends remain disabled.
- **External wallet connections:** Ethereum EIP-6963 discovery with an EIP-1193 fallback; Phantom for Solana; UniSat for Bitcoin. Mainnet balance connections are read-only. The Sepolia flow is a separate explicit transaction approval. One connection at a time, explicit user permission, memory-only connection state, account/network-change invalidation and listener cleanup.
- **External balances:** ETH plus Ethereum-mainnet USDC/USDT through the connected Ethereum provider; confirmed BTC through UniSat; finalized SOL through an optional server-side mainnet reader. Other wallet tokens are not indexed. Missing/failed balances are unavailable, never substituted with zero or included in the account total.
- **External receive:** copyable full address and downloadable, scannable QR. The UI explicitly says this is the external wallet's address, not a Veyra custody address, and receipt there does not credit Veyra's account holdings.
- Mainnet checks reject Ethereum testnets and UniSat Fractal despite its `livenet` label. Phantom does not report its selected network through this connector; the UI requires an independent network check. The optional SOL reader verifies mainnet genesis separately.
- Responsive layouts at 320, 390, 768 and 1440 pixels, moderate balances, existing 3D asset art, keyboard focus trapping, Escape/close handling and reduced-motion support.

## Financial and authorization controls

The reviewed-order service is **internal accounting, not exchange execution or custody**. A completed order changes account records only. Users explicitly acknowledge that distinction before reviewing. An account swap does not bridge chains.

New reviewed orders require an active, approved account owner. Team users can view account data but cannot initiate the new quote/confirm flow. This fails closed rather than bypassing monthly spending controls. Existing legacy trade API permissions and teammate spending enforcement remain intact; the new UI no longer calls that legacy mutation route.

- Strict decimal strings, asset precision validation, exact BigInt unit arithmetic and integer USD cents.
- One rational conversion for swaps; output is rounded down to destination precision, without an intermediate USD-cent truncation.
- Fresh server market data, maximum 60-second review lifetime bounded by the underlying price freshness window, immutable server-stored quote parameters.
- Order value between $0.01 and $250,000; checking credits cannot exceed the existing $10 million account ceiling.
- Available quantities exclude withdrawal reservations. Confirmation rechecks balances, approval/owner status, asset precision, execution configuration and the operational halt.
- `BEGIN IMMEDIATE` atomically records asset movements, any checking movement, the completion receipt and audit. Swaps never create a fictitious checking inflow/outflow.
- A quote ID executes once. Concurrent confirmations and later retries return the stored receipt, including after expiry or a trading-configuration change. Different concurrent orders cannot reuse a checking balance.
- The browser stores a pending quote ID, scoped to the signed-in user, for lost-response recovery. A memory fallback supports blocked session storage for that page's lifetime. It does not persist private keys, seed phrases or wallet permissions. Cross-device recovery uses account history; browser storage is not a universal delivery guarantee.
- No quote reservation occurs merely from opening a review. Expired, unexecuted reviews older than a day are pruned when that owner requests another quote. Completed receipts remain in the database.

Migration **22** adds `crypto_orders`. Existing holdings, historical transactions and withdrawal requests are preserved. Swap asset legs share a reference and are distinguished by the swap order receipt; they do not represent two cash trades. The Activity tab shows the latest 100 completed reviewed orders plus withdrawal requests. Earlier cash trades remain in checking statements.

## Provider connection points

`server/src/web3Providers.ts` defines `CustodyAdapter`, `WalletSwapAdapter`, `CashGatewayAdapter` and explicit external-settlement states. They are extension contracts, **not installed production execution providers**. Capabilities keep custody, mainnet send/swap and cash on/off-ramp disabled. The only execution path is the user's own native-ETH transfer on Sepolia, enabled in non-production only by `CRYPTO_TESTNET_SEND=1`; production startup refuses the flag.

The only new optional live reader is:

```dotenv
# Server-side secret configuration; never use a VITE_ prefix.
SOLANA_RPC_URL=
```

Leave it empty until a mainnet RPC provider is selected. Requests verify the Solana-mainnet genesis hash, use finalized commitment, have a six-second deadline and fail closed on unsupported/unsafe numeric values. Production requires HTTPS. No arbitrary RPC URL or method can be supplied by the browser, and provider errors do not expose configured URLs or keys. Ethereum reads use the approved wallet provider; Bitcoin reads use UniSat. Neither needs a Veyra-managed private key.

`CRYPTO_TRADING_ENABLED` retains its existing development/production behavior. Enabling it enables internal ledger trading, **not asset backing, a regulated offering, external settlement or mainnet execution**. `CRYPTO_TESTNET_SEND` is a separate, explicit, development-only Sepolia capability; it transfers from the user's external wallet and never calls Veyra's withdrawal/account-ledger endpoint. Production runtime validation refuses it. Market-data configuration remains in `server/src/prices.ts` and `.env.example`. No generated prices are used outside isolated automated test fixtures.

### Required before any real execution launch

1. Select and contract custody, execution, cash gateway and chain/RPC providers; establish product eligibility, legal/regulatory requirements, sanctions/destination controls, asset backing and reconciliation.
2. Separate historical/unbacked internal records from genuinely provider-backed assets. **Never automatically broadcast existing pending reservations** or treat existing account holdings as withdrawable custody inventory. Require fresh consent, verified backing and a newly reviewed live fee quote.
3. Implement and register chain-specific execution adapters. Verify chain IDs/genesis, native assets, token contract/mint identity, decimals and destination requirements. Bitcoin UTXOs/fees, Ethereum nonces/gas/token allowances and Solana blockhashes/instructions require separate handling.
4. Present complete unsigned transactions, amounts, destination, network, minimum output/slippage and fees for wallet approval. Do not introduce unlimited token approvals, private-key import or silent signing.
5. Persist provider idempotency keys, bind quotes to owner/source/network, authenticate webhooks and independently reconcile submitted, broadcast, confirmed, failed/replaced and reorganized transactions. A wallet signature or provider acknowledgement is not final settlement.
6. Add live cash gateway checkout, external funding/settlement verification, reversals, disputes and reconciliation before describing cash buy/sell as operational.
7. Configure WalletConnect/mobile linking separately if required. No project ID or QR session is fabricated in this release; supported wallet browsers/extensions are the current connection path. Browser extensions may not be exposed inside the Arena preview iframe—use the standalone-tab option.
8. Validate with provider sandboxes/test networks, security review, recovery/reconciliation testing, operational monitoring and updated product disclosures before controlled mainnet activation.

## Source map

- `shared/cryptoWorkspace.ts`: public order/capability contracts, exact display formatting and Ethereum token identities.
- `shared/walletAddress.ts`: shared checksummed network-address validation (also re-exported by the existing banking service).
- `server/src/cryptoWorkspace.ts`: reviews, atomic confirmation, ownership checks, history and reader endpoint.
- `server/src/web3Providers.ts`: future execution ports and optional read-only Solana adapter.
- `src/lib/web3.ts`: discovered/injected wallet adapters, safe metadata handling, mainnet reads and event cleanup.
- `src/lib/ethereumTestnet.ts`: exact wei parsing, Sepolia chain/account checks, fee/balance review, user-wallet send request and read-only receipt validation.
- `src/components/{CryptoWorkspace,CryptoTradeDialog,ConnectedWallet,SepoliaSendDialog}.tsx`: workspace, review/recovery, wallet/receive UI and explicitly gated Sepolia test send.
- `src/styles/crypto-workspace.css`: scoped responsive styling.
- `src/content/legal.ts`: substantive hybrid-wallet, custody, privacy and execution limitations; revision 7 October 2026.

## API

All endpoints require a valid Veyra session; none authenticates a Veyra user through a wallet address.

- `GET /api/me/crypto/capabilities` — includes `sepoliaTestnetSend` only for non-production runtime with `CRYPTO_TESTNET_SEND=1`; no server-side wallet-send route is added.
- `POST /api/me/crypto/quote` — `{ action, fromAsset, toAsset, amount }`; USD is the source of a buy or destination of a sell.
- `POST /api/me/crypto/confirm` — `{ quoteId }` only.
- `GET /api/me/crypto/orders`
- `GET /api/me/crypto/orders/:id`
- `POST /api/me/crypto/wallet-balance` — `{ network: "Solana", address }`, read-only.
- Existing withdrawal create/list/cancel endpoints remain under `/api/me/crypto-withdrawals`.

## Verification

- Full `npm test` passed, including existing financial, authorization, funding, address and banking regressions and the crypto service checks.
- **57 focused API/unit checks** pass: ownership, approval, staff/team refusals, exact arithmetic, expiry, stale prices, reservation accounting, concurrent/replayed confirmations, balance ceilings, audit rollback, scoped history, mainnet reader verification, unknown balances and Sepolia capability gating.
- **17 crypto browser scenarios** pass: personal/business buy/swap/sell, send/cancel, lost-response recovery across reload, wallet discovery, exact/separate balances, QR decoding, wrong-network/rejection handling, permission-free initial load, network/account invalidation including in-flight reads, responsive/focus behavior, and Sepolia wallet review/broadcast/receipt, mainnet refusal, explicit rejection and ambiguous-response duplicate protection.
- **3 existing crypto browser regressions** pass after updating them for the new review interface.
- **4 legal browser checks** pass, including all supported widths, contents navigation, printing and updated disclosures.
- Client/server typechecks, E2E typecheck and production build pass. Route coverage/security audit accounts for all 132 server routes.

Tests use disposable databases, offline price fixtures and explicitly injected wallet fixtures; they do not move real cryptocurrency or certify a real wallet extension/provider integration. Browser fixtures exercise the actual adapters and real account API. Production extension compatibility and future live execution still need independent integration testing.

Reference specifications: [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963), [Phantom connection API](https://docs.phantom.com/solana/establishing-a-connection), [UniSat wallet API](https://docs.unisat.io/developer-support/open-api-documentation/unisat-wallet).
