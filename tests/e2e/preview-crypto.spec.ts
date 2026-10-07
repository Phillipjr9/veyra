import { test, expect, type Page } from "@playwright/test";

test.skip(process.env.PREVIEW_CRYPTO_DATA !== "1", "Requires isolated preview crypto fixtures.");
async function login(page: Page, type: string) {
  await page.goto("/#/login");
  await page.getByLabel("Email", { exact: true }).fill(`demo.${type}@veyra.dev`);
  await page.getByLabel("Password", { exact: true }).fill("veyra-demo-2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/#\/app$/);
  await page.goto("/#/app/assets");
  await expect(page.locator(".cw-hero-tag")).toHaveCount(0);
}
async function reviewBuy(page: Page, amount = "10") {
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
async function fits(page: Page) {
  expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
  for (const dialog of await page.getByRole("dialog").all()) expect(await dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
}

test("preview markets render without source labels and keep trades account-scoped", async ({ page, request }) => {
  await login(page, "personal");
  // Generated holdings are shown and tradeable without source labels on the
  // workspace.
  await expect(page.locator(".cw-hero-tag")).toHaveCount(0);
  await expect(page.locator(".preview-crypto-notice")).toHaveCount(0);
  for (const quantity of ["0.01 BTC", "0.25 ETH", "5 SOL", "500 USDC", "250 USDT"]) await expect(page.locator(".cw-asset-list")).toContainText(quantity);
  await expect(page.locator(".cw-action-bar").getByRole("button", { name: /^Buy/ })).toBeEnabled();
  await expect(page.locator(".cw-action-bar").getByRole("button", { name: /^Sell/ })).toBeEnabled();
  await expect(page.locator(".cw-action-bar").getByRole("button", { name: /^Swap/ })).toBeEnabled();

  // A buy must actually execute against the generated feed, not just be enabled.
  const buy = await reviewBuy(page, "10");
  await buy.getByRole("button", { name: "Confirm buy" }).click();
  await expect(buy.getByRole("heading", { name: "Account order completed" })).toBeVisible();
  await buy.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".cw-asset-list")).toContainText("510 USDC");

  await page.goto("/#/app/markets?asset=BTC");
  await expect(page.locator(".preview-crypto-notice")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Markets", exact: true })).toBeVisible();
  await expect(page.locator(".markets-page")).not.toContainText(/test data|not live/i);
  await expect(page.locator(".market-asset")).toHaveCount(24);
  await expect(page.locator(".candle-chart")).toHaveCount(1);
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); await fits(page); }
  const session = await (await request.post("/api/auth/login", { data: { email: "demo.personal@veyra.dev", password: "veyra-demo-2026" } })).json();
  const result = await request.post("/api/me/crypto/quote", { headers: { authorization: `Bearer ${session.token}` }, data: { action: "buy", fromAsset: "USD", toAsset: "USDC", amount: "1" } });
  expect(result.status()).toBe(201); const { quote } = await result.json();
  await page.evaluate(({ id, quoteId }) => sessionStorage.setItem(`veyra.crypto.pending.${id}`, quoteId), { id: session.user.id, quoteId: quote.id });
  await page.goto("/#/app/assets"); await page.getByRole("button", { name: "Check earlier order" }).click();
  // A pending quote on generated data now recovers like any other, without a
  // source badge, and refuses to let the customer start a duplicate order.
  const resumed = page.getByRole("dialog");
  await expect(resumed.locator(".preview-crypto-notice")).toHaveCount(0);
  await expect(resumed).toContainText("Status unconfirmed");
  await expect(resumed.getByRole("button", { name: "Retry same order" })).toBeVisible();
});

test("business preview can use its generated holdings for the animated request", async ({ page }) => {
  await login(page, "business");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".cw-action-bar").getByRole("button", { name: /^Send/ }).click();
  await page.locator(".cw-send-picker").getByRole("button", { name: /USDC/ }).click();
  const send = page.getByRole("dialog", { name: "Send USDC", exact: true });
  await expect(send.locator(".preview-crypto-notice")).toHaveCount(0);
  await send.getByLabel("Destination wallet address").fill("0x1111111111111111111111111111111111111111");
  await send.getByLabel("Quantity (USDC)").fill("10");
  await send.getByRole("button", { name: "Review withdrawal" }).click(); await fits(page);
  await send.getByRole("button", { name: "Confirm withdrawal" }).click();
  await expect(send.locator(".flow-processing")).toBeVisible();
  await expect(send.getByRole("status")).toContainText("Send complete"); await fits(page);
  await send.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.locator(".crypto-request-history")).toContainText("recorded");
  await expect(page.getByRole("button", { name: "Cancel and release units" })).toHaveCount(0);
  await page.getByRole("button", { name: "Account assets", exact: true }).click();
  await expect(page.getByRole("article", { name: "USD Coin account holding" })).toContainText("490 USDC");
});
