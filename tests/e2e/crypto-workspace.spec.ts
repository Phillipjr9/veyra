import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { applicationFor } from "../../server/scripts/fixtures";
import { PNG } from "pngjs";
import jsQR from "jsqr";

async function owner(page: Page, request: APIRequestContext, type: "personal" | "business" = "personal") {
  const name = "Crypto Browser Owner", email = `crypto-${crypto.randomUUID()}@veyra.test`;
  const admin = (await (await request.post("/api/auth/login", { data: { email: "admin@veyra.dev", password: "veyra-admin-2026" } })).json()).token;
  const created = await request.post("/api/auth/register", { data: { name, email, password: "Crypto-Browser-2026!", accountType: type, business: type === "business" ? "Crypto Browser Ltd" : "", profile: applicationFor(type, name, "Crypto Browser Ltd") } });
  expect(created.status()).toBe(201);
  const session = await created.json();
  expect((await request.post(`/api/admin/kyc/${session.user.id}/decision`, { headers: { authorization: `Bearer ${admin}` }, data: { decision: "approved" } })).status()).toBe(200);
  expect((await request.post(`/api/admin/members/${session.user.id}/adjust`, { headers: { authorization: `Bearer ${admin}` }, data: { direction: "credit", amount: 1000, memo: "Crypto browser fixture" } })).status()).toBe(200);
  await page.addInitScript(token => localStorage.setItem("veyra.token", token), session.token);
  await page.goto("/#/app/assets");
  await expect(page.getByRole("heading", { name: "Crypto, on your terms." })).toBeVisible();
  await expect(page.locator(".cw-asset-row")).toHaveCount(24);
  return { token: session.token as string, id: session.user.id as string };
}
async function balance(request: APIRequestContext, token: string) { return (await (await request.get("/api/me/state", { headers: { authorization: `Bearer ${token}` } })).json()).account.balance; }
async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
  for (const dialog of await page.getByRole("dialog").all()) expect(await dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
}
async function reviewBuy(page: Page, amount = "25.50") {
  await page.locator(".cw-action-bar").getByRole("button", { name: /^Buy/ }).click();
  const dialog = page.getByRole("dialog", { name: "Buy crypto", exact: true });
  await dialog.getByLabel("To", { exact: true }).selectOption("USDC");
  await dialog.getByLabel("Amount to spend (USD)").fill(amount);
  await expect(dialog.getByRole("button", { name: "Review order" })).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Review order" }).click();
  await expect(dialog.getByRole("button", { name: "Confirm buy" })).toBeEnabled();
  return dialog;
}
for (const type of ["personal", "business"] as const) test(`${type}: reviewed buy, exact swap and sell reconcile account balances and history`, async ({ page, request }) => {
  const session = await owner(page, request, type);
  const buy = await reviewBuy(page);
  expect(await balance(request, session.token)).toBe(1000);
  await buy.getByRole("button", { name: "Confirm buy" }).click();
  await expect(buy.getByRole("status")).toContainText("Recorded once in your account");
  await expect(buy).toContainText("No blockchain transaction hash");
  await buy.getByRole("button", { name: "Done" }).click();
  expect(await balance(request, session.token)).toBe(974.5);
  const usdc = page.getByRole("article", { name: "USD Coin account holding" });
  await expect(usdc).toContainText("25.5 USDC");
  await usdc.getByRole("button", { name: "Swap", exact: true }).click();
  const swap = page.getByRole("dialog", { name: "Swap crypto", exact: true });
  await swap.getByLabel("To", { exact: true }).selectOption("SOL");
  await swap.getByLabel("Quantity (USDC)").fill("10.123456");
  await swap.getByRole("checkbox").check();
  await swap.getByRole("button", { name: "Review order" }).click();
  await expect(swap).toContainText("0.05061728 SOL");
  await expect(swap).toContainText("does not bridge networks");
  await swap.getByRole("button", { name: "Confirm swap" }).click();
  await expect(swap.getByRole("status")).toContainText("Recorded once");
  await swap.getByRole("button", { name: "Done" }).click();
  expect(await balance(request, session.token)).toBe(974.5);
  await expect(usdc).toContainText("15.376544 USDC");
  await page.locator(".cw-action-bar").getByRole("button", { name: /^Sell/ }).click();
  const sell = page.getByRole("dialog", { name: "Sell crypto", exact: true });
  await sell.getByLabel("From", { exact: true }).selectOption("USDC");
  await sell.getByRole("button", { name: "Use available amount" }).click();
  await sell.getByRole("checkbox").check();
  await sell.getByRole("button", { name: "Review order" }).click();
  await expect(sell.locator(".cw-review")).toContainText("15.37 USD");
  await sell.getByRole("button", { name: "Confirm sell" }).click();
  await expect(sell.getByRole("status")).toContainText("Recorded once");
  await sell.getByRole("button", { name: "Done" }).click();
  expect(await balance(request, session.token)).toBe(989.87);
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.locator(".cw-order")).toHaveCount(3);
  await page.reload();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.locator(".cw-order")).toHaveCount(3);
  await expect(page.locator(".cw-order-status").first()).toContainText("Not on-chain");
});

test("lost confirmation response recovers the same completed order across reload without duplicate debit", async ({ page, request }) => {
  const session = await owner(page, request);
  await page.route("**/api/me/crypto/confirm", async route => { const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort("failed"); });
  const dialog = await reviewBuy(page, "30");
  await dialog.getByRole("button", { name: "Confirm buy" }).click();
  await expect(dialog.getByRole("button", { name: "Retry same order" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Edit / refresh quote" })).toBeDisabled();
  expect(await balance(request, session.token)).toBe(970);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Check earlier order" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText("Recorded once in your account");
  expect(await balance(request, session.token)).toBe(970);
  const orders = await (await request.get("/api/me/crypto/orders", { headers: { authorization: `Bearer ${session.token}` } })).json();
  expect(orders.orders).toHaveLength(1);
});

test("pending send reserves units, can be cancelled, and never masquerades as a blockchain transfer", async ({ page, request }) => {
  await owner(page, request);
  const buy = await reviewBuy(page, "25");
  await buy.getByRole("button", { name: "Confirm buy" }).click();
  await buy.getByRole("button", { name: "Done" }).click();
  await page.locator(".cw-action-bar").getByRole("button", { name: /^Send/ }).click();
  await page.locator(".cw-send-picker").getByRole("button", { name: /USDC/ }).click();
  const send = page.getByRole("dialog", { name: "Send USDC" });
  await send.getByLabel("Destination wallet address").fill("0x1111111111111111111111111111111111111111");
  await send.getByLabel("Quantity (USDC)").fill("10.123456");
  await send.getByRole("button", { name: "Review withdrawal" }).click();
  await send.getByRole("button", { name: "Confirm pending withdrawal" }).click();
  await expect(send.getByRole("status")).toContainText("Pending · not broadcast");
  await send.getByRole("button", { name: "Close", exact: true }).click();
  const usdc = page.getByRole("article", { name: "USD Coin account holding" });
  await expect(usdc).toContainText("14.876544 USDC");
  await expect(usdc).toContainText("10.123456 reserved");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByRole("button", { name: "Cancel and release units" }).click();
  await expect(page.locator(".crypto-request-history")).toContainText("cancelled");
  await page.getByRole("button", { name: "Account assets" }).click();
  await expect(usdc).toContainText("25 USDC");
});

async function installWalletFixtures(page: Page, settings: { ethereumChain?: string; bitcoinChain?: string; reject?: boolean; unavailable?: boolean; delay?: boolean } = {}) {
  await page.addInitScript(settings => {
    const w = window as any;
    const handlers = new Map<string, Set<(...args: any[]) => void>>();
    const events = (prefix: string) => ({ on(name: string, fn: (...args: any[]) => void) { const key = prefix + name; if (!handlers.has(key)) handlers.set(key, new Set()); handlers.get(key)!.add(fn); }, removeListener(name: string, fn: (...args: any[]) => void) { handlers.get(prefix + name)?.delete(fn); } });
    w.__walletCalls = [];
    w.__walletEmit = (key: string, value?: unknown) => { for (const fn of handlers.get(key) ?? []) fn(value); };
    const address = "0x1111111111111111111111111111111111111111";
    const eth = { ...events("eth:"), async request({ method, params }: any) { w.__walletCalls.push(method); if (settings.reject && method === "eth_requestAccounts") throw new Error("Connection rejected by the user."); if (method === "eth_requestAccounts" || method === "eth_accounts") return [address]; if (method === "eth_chainId") return settings.ethereumChain ?? "0x1"; if (settings.unavailable) throw new Error("RPC offline"); if (method === "eth_getBalance") { if (settings.delay) await new Promise<void>(resolve => { w.__walletRelease = resolve; }); return "0x" + BigInt("1234567890123456789").toString(16); } if (method === "eth_call") { if (params[0].to === "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48") return "0x" + BigInt("123456789").toString(16); throw new Error("Token read unavailable"); } throw new Error("Unexpected wallet method"); } };
    w.ethereum = eth;
    window.addEventListener("eip6963:requestProvider", () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { uuid: "31e65091-4c52-4d10-97f0-63d4e35d6a5f", name: "Fixture Ethereum", rdns: "untrusted.wallet", icon: 'data:image/svg+xml,<svg onload="window.__unsafeWalletIcon=true"/>' }, provider: eth } })));
    const publicKey = { toString: () => "So11111111111111111111111111111111111111112" };
    w.phantom = { solana: { ...events("sol:"), publicKey, async connect() { w.__walletCalls.push("sol:connect"); return { publicKey }; }, async disconnect() {} } };
    w.unisat = { ...events("btc:"), async requestAccounts() { w.__walletCalls.push("btc:requestAccounts"); return ["1BoatSLRHtKNngkdXEeobR76b53LETtpyT"]; }, async getAccounts() { return ["1BoatSLRHtKNngkdXEeobR76b53LETtpyT"]; }, async getChain() { return { enum: settings.bitcoinChain ?? "BITCOIN_MAINNET", network: "livenet" }; }, async getBalance() { return { confirmed: 100123456, unconfirmed: 1000000, total: 101123456 }; } };
  }, settings);
}
async function chooseWallet(page: Page, name: string) {
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Connect a wallet" });
  await picker.getByRole("button", { name: new RegExp(name) }).click();
  return picker;
}
test("Ethereum discovery, precise separate balances, receive QR, event invalidation and zero signing requests", async ({ page, request }) => {
  await installWalletFixtures(page);
  await owner(page, request);
  expect(await page.evaluate(() => (window as any).__walletCalls)).toEqual([]);
  const picker = await chooseWallet(page, "Fixture Ethereum");
  await expect(picker).toBeHidden();
  const card = page.locator(".cw-wallet-card");
  await expect(card).toContainText("1.234567890123456789");
  await expect(card).toContainText("123.456789");
  await expect(card.locator(".cw-wallet-balances")).toContainText("Unavailable");
  await expect(page.locator(".cw-hero h2")).toHaveText("$0.00");
  await expect(card.locator(".cw-wallet-locked button")).toHaveCount(4);
  for (const button of await card.locator(".cw-wallet-locked button").all()) await expect(button).toBeDisabled();
  await card.getByRole("button", { name: "Receive / QR" }).click();
  const receive = page.getByRole("dialog", { name: "Receive to connected wallet" });
  const image = receive.getByRole("img"); await expect(image).toBeVisible();
  const png = PNG.sync.read(Buffer.from((await image.getAttribute("src"))!.split(",")[1], "base64"));
  expect(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data).toBe("0x1111111111111111111111111111111111111111");
  await expect(receive).toContainText("will not credit Veyra");
  await page.evaluate(() => (window as any).__walletEmit("eth:chainChanged", "0x5"));
  await expect(receive).toBeHidden();
  await expect(card).toContainText("Reconnect to verify");
  await expect(card).not.toContainText("1.234567890123456789");
  expect(await page.evaluate(() => (window as any).__unsafeWalletIcon)).toBeUndefined();
  const calls = await page.evaluate(() => (window as any).__walletCalls as string[]);
  expect(calls.every(method => ["eth_requestAccounts", "eth_accounts", "eth_chainId", "eth_getBalance", "eth_call"].includes(method))).toBe(true);
  expect(await page.evaluate(() => Object.keys(localStorage).some(key => /wallet|private|phrase/.test(key)))).toBe(false);
});

test("Bitcoin confirmed balance and Solana unavailable reader remain separate and truthful", async ({ page, request }) => {
  await installWalletFixtures(page); await owner(page, request);
  await expect(await chooseWallet(page, "UniSat")).toBeHidden();
  const card = page.locator(".cw-wallet-card");
  await expect(card).toContainText("1.00123456");
  await expect(card).toContainText("Pending funds excluded");
  await card.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(await chooseWallet(page, "Phantom")).toBeHidden();
  await expect(card).toContainText("Solana balance reader is not connected yet");
  await expect(card.locator(".cw-wallet-balances b")).toHaveText("Unavailable");
  await page.evaluate(() => (window as any).__walletEmit("sol:accountChanged", null));
  await expect(card.getByRole("button", { name: "Connect wallet" })).toBeVisible();
});
for (const kind of ["Ethereum testnet", "Fractal livenet", "rejected"] as const) test(`wallet connection refuses ${kind} without pretending to connect`, async ({ page, request }) => {
  await installWalletFixtures(page, kind === "Ethereum testnet" ? { ethereumChain: "0x5" } : kind === "Fractal livenet" ? { bitcoinChain: "FRACTAL_BITCOIN_MAINNET" } : { reject: true });
  await owner(page, request);
  const picker = await chooseWallet(page, kind === "Fractal livenet" ? "UniSat" : "Fixture Ethereum");
  await expect(picker.getByRole("alert")).toContainText(kind === "rejected" ? "rejected" : "mainnet");
  await expect(page.locator(".cw-wallet-balances")).toHaveCount(0);
});

test("missing extensions, unavailable account data and responsive review/focus states are explicit", async ({ page, request }) => {
  await owner(page, request);
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); await fits(page); }
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Connect a wallet" });
  await expect(picker).toContainText("No compatible wallet detected");
  await page.setViewportSize({ width: 320, height: 844 }); await fits(page);
  await page.keyboard.press("Escape"); await expect(picker).toBeHidden();
  await expect(page.getByRole("button", { name: "Connect wallet", exact: true })).toBeFocused();
  const dialog = await reviewBuy(page);
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); await fits(page); }
  await dialog.getByRole("button", { name: "Close", exact: true }).focus(); await page.keyboard.press("Tab");
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
  await page.route("**/api/me/holdings", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Balance service unavailable" }) }));
  await page.reload();
  await expect(page.locator(".cw-error")).toContainText("Balances are unavailable, not zero");
  await expect(page.locator(".cw-hero h2")).toHaveText("Unavailable");
  for (const button of await page.locator(".cw-action-bar button").all()) await expect(button).toBeDisabled();
});


test("an account-change event discards a balance read that is still in flight", async ({ page, request }) => {
  await installWalletFixtures(page, { delay: true }); await owner(page, request);
  const picker = await chooseWallet(page, "Fixture Ethereum");
  await expect.poll(() => page.evaluate(() => typeof (window as any).__walletRelease)).toBe("function");
  await page.evaluate(() => { (window as any).__walletEmit("eth:accountsChanged", ["0x2222222222222222222222222222222222222222"]); (window as any).__walletRelease(); });
  await expect.poll(() => page.evaluate(() => (window as any).__walletCalls.filter((method: string) => method === "eth_accounts").length)).toBe(2);
  await expect(picker.getByRole("alert")).toContainText("Reconnect to verify");
  await expect(page.locator(".cw-wallet-balances")).toHaveCount(0);
  await expect(picker.getByRole("button", { name: "Close", exact: true })).toBeEnabled();
});

test("wallet RPC failures display unavailable for every asset, never fabricated zero", async ({ page, request }) => {
  await installWalletFixtures(page, { unavailable: true }); await owner(page, request);
  await expect(await chooseWallet(page, "Fixture Ethereum")).toBeHidden();
  const values = page.locator(".cw-wallet-balances b");
  await expect(values).toHaveText(["Unavailable", "Unavailable", "Unavailable"]);
  await page.setViewportSize({ width: 320, height: 844 }); await fits(page);
});

test("expired reviews cannot confirm and an entirely unpriced portfolio is not shown as zero", async ({ page, request }) => {
  await owner(page, request);
  await page.route("**/api/me/crypto/quote", async route => { const response = await route.fetch(); const body = await response.json(); body.quote.expiresAt = Date.now() - 1; await route.fulfill({ response, json: body }); });
  await page.locator(".cw-action-bar").getByRole("button", { name: /^Buy/ }).click();
  const dialog = page.getByRole("dialog", { name: "Buy crypto", exact: true });
  await dialog.getByLabel("Amount to spend (USD)").fill("10");
  await dialog.getByRole("checkbox").check(); await dialog.getByRole("button", { name: "Review order" }).click();
  await expect(dialog).toContainText("Quote expired");
  await expect(dialog.getByRole("button", { name: "Confirm buy" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Edit / refresh quote" }).click();
  await expect(dialog.getByLabel("Amount to spend (USD)")).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.route("**/api/me/holdings", async route => { const response = await route.fetch(); const body = await response.json(); body.partial = true; body.quoteStatus = "unavailable"; body.totalUsd = "0.00"; body.holdings = body.holdings.map((h: any) => ({ ...h, units: h.asset === "BTC" ? "100000000" : "0", quantity: h.asset === "BTC" ? "1" : "0", valueUsd: null, priceUsd: null })); await route.fulfill({ response, json: body }); });
  await page.getByRole("button", { name: "Refresh account", exact: true }).click();
  await expect(page.locator(".cw-hero h2")).toHaveText("Unavailable");
  await expect(page.locator(".cw-hero")).toContainText("Partial estimated value");
});
