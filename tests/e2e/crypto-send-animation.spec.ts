import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { applicationFor } from "../../server/scripts/fixtures";

const destination = "0x1111111111111111111111111111111111111111";
async function fixture(page: Page, request: APIRequestContext, asset = "USDC", amount = "10.123456") {
  const admin = (await (await request.post("/api/auth/login", { data: { email: "admin@veyra.dev", password: "veyra-admin-2026" } })).json()).token;
  const name = "Crypto Animation Owner", email = `crypto-animation-${crypto.randomUUID()}@veyra.test`;
  const created = await request.post("/api/auth/register", { data: { name, email, password: "Crypto-Animation-2026!", accountType: "personal", profile: applicationFor("personal", name, "") } });
  expect(created.status()).toBe(201);
  const session = await created.json(), headers = { authorization: `Bearer ${session.token}` };
  expect((await request.post(`/api/admin/kyc/${session.user.id}/decision`, { headers: { authorization: `Bearer ${admin}` }, data: { decision: "approved" } })).status()).toBe(200);
  expect((await request.post(`/api/admin/members/${session.user.id}/adjust`, { headers: { authorization: `Bearer ${admin}` }, data: { direction: "credit", amount: 100, memo: "Crypto animation fixture" } })).status()).toBe(200);
  const quoted = await request.post("/api/me/crypto/quote", { headers, data: { action: "buy", fromAsset: "USD", toAsset: asset, amount: "25" } });
  expect(quoted.status()).toBe(201);
  expect((await request.post("/api/me/crypto/confirm", { headers, data: { quoteId: (await quoted.json()).quote.id } })).status()).toBe(200);
  await page.addInitScript(token => localStorage.setItem("veyra.token", token), session.token);
  await page.goto("/#/app/accounts");
  await page.locator(".holding-card").filter({ has: page.locator(".holding-code", { hasText: new RegExp(`^${asset}$`) }) }).getByRole("button", { name: "Send", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Send ${asset}`, exact: true });
  await dialog.getByLabel("Destination wallet address").fill(destination);
  await dialog.getByLabel(`Quantity (${asset})`).fill(amount);
  return { dialog, headers };
}
async function fits(page: Page) {
  expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
  const dialog = page.getByRole("dialog");
  expect(await dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
}
async function withdrawals(request: APIRequestContext, headers: Record<string, string>) {
  return (await (await request.get("/api/me/crypto-withdrawals", { headers })).json()).withdrawals;
}

test("shared send animation has real movement, waits for response, debits once and fits mobile", async ({ page, request }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const { dialog, headers } = await fixture(page, request);
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 844 }); await fits(page); }
  await dialog.getByRole("button", { name: "Review withdrawal" }).click();
  await expect(dialog.locator(".crypto-send-destination code")).toHaveText(destination);
  expect(await withdrawals(request, headers)).toHaveLength(0);
  let release!: () => void, committed!: () => void, posts = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const recorded = new Promise<void>(resolve => { committed = resolve; });
  await page.route("**/api/me/crypto-withdrawals", async route => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    const response = await route.fetch(); expect(response.status()).toBe(201);
    committed(); await gate; await route.fulfill({ response });
  });
  try {
    await dialog.locator(".flow-confirm").evaluate(el => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
    await recorded;
    await expect(dialog.locator(".flow-processing")).toBeVisible();
    await expect(dialog.locator(".flow-processing .flow-sub b")).toHaveText("10.123456 USDC");
    await expect(dialog.locator(".flow-steplist li")).toHaveCount(4);
    await expect(dialog.locator(".flow-dot")).toHaveCount(3);
    const token = dialog.locator(".flow-travelling-token");
    await expect(token).toBeVisible();
    const tokenStart = await token.evaluate(el => getComputedStyle(el).left);
    await expect.poll(() => token.evaluate(el => getComputedStyle(el).left)).not.toBe(tokenStart);
    const ring = dialog.locator(".flow-orbit-progress-fill");
    await expect(ring).toBeVisible();
    const ringStart = await ring.evaluate(el => getComputedStyle(el).strokeDasharray);
    await expect.poll(() => ring.evaluate(el => getComputedStyle(el).strokeDasharray)).not.toBe(ringStart);
    await dialog.screenshot({ path: testInfo.outputPath("crypto-active-animation.png") });
    const dot = dialog.locator(".flow-dot").first(), before = await dot.evaluate(el => getComputedStyle(el).left);
    await expect.poll(() => dot.evaluate(el => getComputedStyle(el).left)).not.toBe(before);
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
    const rows = await withdrawals(request, headers);
    expect(rows).toHaveLength(1); expect(rows[0].quantity).toBe("10.123456"); expect(rows[0].status).toBe("recorded"); expect(posts).toBe(1);
    await page.waitForTimeout(4000);
    await expect(dialog.getByRole("heading", { name: "Waiting for request confirmation…" })).toBeVisible();
    await expect(dialog.locator(".crypto-send-recorded")).toHaveCount(0);
    for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 844 }); await fits(page); }
    await dialog.screenshot({ path: testInfo.outputPath("crypto-processing-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.screenshot({ path: testInfo.outputPath("crypto-processing-mobile.png") });
    release();
    await expect(dialog.getByRole("status")).toContainText("Request recorded · not broadcast");
    await expect(dialog.locator(".crypto-send-recorded .crypto-send-quantity")).toHaveText("10.123456 USDC");
    await expect(dialog.locator(".confetti,.check-wrap")).toHaveCount(0);
    await expect(dialog.locator(".receipt")).toContainText(rows[0].reference);
    for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 844 }); await fits(page); }
    await dialog.screenshot({ path: testInfo.outputPath("crypto-recorded-desktop.png") });
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Request record" }).click();
    const file = await download;
    const text = await readFile((await file.path())!, "utf8");
    expect(text).toContain(destination); expect(text).toContain("10.123456 USDC"); expect(text).toContain("Not broadcast");
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.locator(".crypto-request-history")).toContainText("recorded");
    await expect(page.locator(".holding-card")).toContainText("Available: 14.876544 USDC");
    await expect(page.getByRole("button", { name: "Cancel and release units" })).toHaveCount(0);
  } finally { release(); }
});

test("reduced motion remains visible and preserves all eighteen ETH decimal places", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const amount = "0.000000000000000123";
  const { dialog, headers } = await fixture(page, request, "ETH", amount);
  await dialog.getByRole("button", { name: "Review withdrawal" }).click();
  const start = Date.now();
  await dialog.locator(".flow-confirm").click();
  await expect(dialog).toHaveAttribute("data-motion", "reduced");
  await expect(dialog.locator(".flow-processing .flow-sub b")).toHaveText(`${amount} ETH`);
  await expect(dialog.locator(".flow-dot,.flow-travelling-token")).toHaveCount(0);
  expect(await dialog.locator(".flow-orbit > img").evaluate(el => getComputedStyle(el).animationName)).toBe("none");
  await expect(dialog.getByRole("status")).toContainText("Request recorded · not broadcast");
  expect(Date.now() - start).toBeGreaterThanOrEqual(2300);
  await expect(dialog.locator(".crypto-send-quantity")).toHaveText(`${amount} ETH`);
  expect((await withdrawals(request, headers))[0].units).toBe("123");
  await dialog.getByRole("button", { name: "Done" }).focus(); await page.keyboard.press("Tab");
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
});

test("refusal and lost response are retryable without a second debit", async ({ page, request }) => {
  const { dialog, headers } = await fixture(page, request);
  let calls = 0; const keys: string[] = [];
  await page.route("**/api/me/crypto-withdrawals", async route => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().postDataJSON().requestKey); calls++;
    if (calls === 1) return route.fulfill({ status: 400, json: { error: "Request refused for this fixture." } });
    if (calls === 2) { const response = await route.fetch(); expect(response.status()).toBe(201); return route.abort("failed"); }
    await route.continue();
  });
  await dialog.getByRole("button", { name: "Review withdrawal" }).click();
  await dialog.locator(".flow-confirm").click();
  await expect(dialog.getByRole("alert")).toContainText("Request refused");
  expect(await withdrawals(request, headers)).toHaveLength(0);
  await expect(dialog.locator(".crypto-send-recorded,.confetti")).toHaveCount(0);
  await dialog.locator(".flow-confirm").click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.locator(".flow-confirm")).toBeVisible();
  expect(await withdrawals(request, headers)).toHaveLength(1);
  await dialog.locator(".flow-confirm").click();
  await expect(dialog.getByRole("status")).toContainText("Request recorded · not broadcast");
  expect(new Set(keys).size).toBe(1); expect(calls).toBe(3);
  expect(await withdrawals(request, headers)).toHaveLength(1);
});

test("a lost response replay debits the units exactly once", async ({ page, request }) => {
  const { dialog, headers } = await fixture(page, request);
  const usdc = page.locator(".holding-card").filter({ has: page.locator(".holding-code", { hasText: /^USDC$/ }) });
  let first = true;
  await page.route("**/api/me/crypto-withdrawals", async route => {
    if (route.request().method() !== "POST" || !first) return route.continue();
    first = false;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await dialog.getByRole("button", { name: "Review withdrawal" }).click();
  await dialog.locator(".flow-confirm").click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.locator(".flow-confirm").click();
  await expect(dialog.getByRole("status")).toContainText("Request recorded · not broadcast");
  expect(await withdrawals(request, headers)).toHaveLength(1);
  await dialog.getByRole("button", { name: "Done" }).click();
  // 25 USDC held, 10.123456 requested once — the replay must not debit twice.
  await expect(usdc).toContainText("Available: 14.876544 USDC");
});
