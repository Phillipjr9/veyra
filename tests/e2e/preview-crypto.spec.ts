import { test, expect, type Page } from "@playwright/test";

test.skip(process.env.PREVIEW_CRYPTO_DATA !== "1", "Requires isolated preview crypto fixtures.");
async function login(page: Page, type: string) {
  await page.goto("/#/login");
  await page.getByLabel("Email", { exact: true }).fill(`demo.${type}@veyra.dev`);
  await page.getByLabel("Password", { exact: true }).fill("veyra-demo-2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/#\/app$/);
  await page.goto("/#/app/assets");
  await expect(page.locator(".cw-hero")).toContainText("Unavailable");
}
async function fits(page: Page) {
  expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
  for (const dialog of await page.getByRole("dialog").all()) expect(await dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
}

test("customer UI never relabels generated fixtures as live prices", async ({ page, request }) => {
  await login(page, "personal");
  await expect(page.locator(".preview-crypto-notice")).toHaveCount(0);
  await expect(page.locator(".cw-hero-tag")).toHaveText("Quotes unavailable");
  for (const quantity of ["0.01 BTC", "0.25 ETH", "5 SOL", "500 USDC", "250 USDT"]) await expect(page.locator(".cw-asset-list")).toContainText(quantity);
  await expect(page.locator(".cw-action-bar").getByRole("button", { name: /^Buy/ })).toBeDisabled();
  await page.goto("/#/app/markets?asset=BTC");
  await expect(page.locator(".market-asset")).toHaveCount(0);
  await expect(page.locator(".candle-chart")).toHaveCount(0);
  await expect(page.getByText(/Test crypto data|Sample prices|test holdings/)).toHaveCount(0);
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); await fits(page); }
  const session = await (await request.post("/api/auth/login", { data: { email: "demo.personal@veyra.dev", password: "veyra-demo-2026" } })).json();
  const result = await request.post("/api/me/crypto/quote", { headers: { authorization: `Bearer ${session.token}` }, data: { action: "buy", fromAsset: "USD", toAsset: "USDC", amount: "1" } });
  expect(result.status()).toBe(201); const { quote } = await result.json();
  await page.evaluate(({ id, quoteId }) => sessionStorage.setItem(`veyra.crypto.pending.${id}`, quoteId), { id: session.user.id, quoteId: quote.id });
  await page.goto("/#/app/assets"); await page.getByRole("button", { name: "Check earlier order" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("This price quote is unavailable");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm buy" })).toHaveCount(0);
  await expect(page.getByRole("dialog").getByRole("button", { name: "Check order status" })).toBeVisible();
});

test("business preview can use its test holdings for the animated request and cancel", async ({ page }) => {
  await login(page, "business");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".cw-action-bar").getByRole("button", { name: /^Send/ }).click();
  await page.locator(".cw-send-picker").getByRole("button", { name: /USDC/ }).click();
  const send = page.getByRole("dialog", { name: "Send USDC", exact: true });
  await expect(send.locator(".preview-crypto-notice")).toHaveCount(0);
  await send.getByLabel("Destination wallet address").fill("0x1111111111111111111111111111111111111111");
  await send.getByLabel("Quantity (USDC)").fill("10");
  await send.getByRole("button", { name: "Review withdrawal" }).click(); await fits(page);
  await send.getByRole("button", { name: "Confirm pending withdrawal" }).click();
  await expect(send.locator(".flow-processing")).toBeVisible();
  await expect(send.getByRole("status")).toContainText("Pending · not broadcast"); await fits(page);
  await send.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByRole("button", { name: "Cancel and release units" }).click();
  await expect(page.locator(".crypto-request-history")).toContainText("cancelled");
  await page.getByRole("button", { name: "Account assets", exact: true }).click();
  await expect(page.getByRole("article", { name: "USD Coin account holding" })).toContainText("500 USDC");
});
