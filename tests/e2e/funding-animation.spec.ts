import { chooseFundingMethod, confirmFunding, fundingMethodOptions, openFundingMethods } from "./funding-helpers";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { applicationFor } from "../../server/scripts/fixtures";
import { quoteFee } from "../../shared/fees";

test.skip(process.env.ACCOUNT_LEDGER_ENABLED !== "1", "Requires immediate account-ledger funding.");
async function owner(page: Page, request: APIRequestContext, accountType: "personal" | "business" = "personal") {
  const admin = (await (await request.post("/api/auth/login", { data: { email: "admin@veyra.dev", password: "veyra-admin-2026" } })).json()).token;
  const name = "Funding Animation Owner", email = `funding-animation-${crypto.randomUUID()}@veyra.test`;
  const registered = await request.post("/api/auth/register", { data: { name, email, password: "Funding-Animation-2026!", accountType, business: accountType === "business" ? "Animation Studio" : "", profile: applicationFor(accountType, name, "Animation Studio") } });
  expect(registered.status()).toBe(201);
  const user = await registered.json();
  expect((await request.post(`/api/admin/kyc/${user.user.id}/decision`, { headers: { authorization: `Bearer ${admin}` }, data: { decision: "approved" } })).status()).toBe(200);
  await page.addInitScript(token => localStorage.setItem("veyra.token", token), user.token);
  await page.goto("/#/app");
  await expect(page.locator(".dx-kicker")).toHaveText("LEDGER INTELLIGENCE");
  return user.token as string;
}
const state = async (request: APIRequestContext, token: string) => (await (await request.get("/api/me/state", { headers: { authorization: `Bearer ${token}` } })).json()).account;
const cardCredit = (dollars: number) => dollars - quoteFee("card_deposit", Math.round(dollars * 100)).feeCents / 100;
async function form(page: Page, amount = "25.50", quickJump = false) {
  if (quickJump) {
    await page.getByRole("button", { name: "Search or quick jump (Command K)" }).click();
    await page.locator(".command-palette-box").getByRole("button", { name: /^Add Funds/ }).click();
  } else await page.getByRole("button", { name: "Add funds", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add funds", exact: true });
  await chooseFundingMethod(dialog, "Debit card");
  await dialog.getByLabel("Amount (USD)", { exact: true }).fill(amount);
  return dialog;
}
async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
  const dialog = page.getByRole("dialog", { name: "Add funds", exact: true });
  expect(await dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
}

test("money movement waits for confirmation, credits immediately, prevents duplicate clicks and fits mobile", async ({ page, request }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const token = await owner(page, request), dialog = await form(page);
  let release!: () => void, recorded!: () => void, posts = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const committed = new Promise<void>(resolve => { recorded = resolve; });
  await page.route("**/api/me/deposits", async route => {
    posts++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    recorded(); await gate; await route.fulfill({ response });
  });
  try {
    await dialog.getByRole("button", { name: "Review deposit", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Review deposit", exact: true })).toBeVisible();
    expect(posts).toBe(0);
    await dialog.locator(".flow-confirm").evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
    await committed;
    await expect(dialog.getByRole("status")).toContainText("Adding funds…");
    await expect(dialog.locator(".flow-track.is-moving")).toBeVisible();
    await expect(dialog.locator(".flow-dot")).toHaveCount(3);
    await expect(dialog.locator(".flow-progress")).toBeVisible();
    await expect(dialog.locator(".flow-steplist li")).toHaveCount(4);
    await expect(dialog).toHaveClass(/flow-modal/);
    const firstDot = dialog.locator(".flow-dot").first();
    const initialPosition = await firstDot.evaluate(el => getComputedStyle(el).left);
    await expect.poll(() => firstDot.evaluate(el => getComputedStyle(el).left)).not.toBe(initialPosition);
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
    expect(posts).toBe(1);
    const account = await state(request, token);
    expect(account.balance).toBe(cardCredit(25.5)); expect(account.transactions).toHaveLength(1);
    // Deliberately outwait the presentation duration: the timer alone cannot
    // announce success while the actual response is still withheld.
    await page.waitForTimeout(4000);
    await expect(dialog.locator(".funding-animation.is-confirmed")).toHaveCount(0);
    await expect(dialog.locator(".flow-title")).toHaveText("Waiting for confirmation…");
    await expect(dialog.locator(".confetti")).toHaveCount(0);
    for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); await fits(page); }
    await dialog.screenshot({ path: testInfo.outputPath("funding-processing.png") });
    release();
    await expect(dialog.getByRole("status")).toContainText("Funds added to your account immediately");
    await expect(dialog.locator(".funding-animation.is-confirmed")).toBeVisible();
    await expect(dialog.locator(".confetti")).toHaveCount(1);
    await expect(dialog.locator(".flow-success .check-wrap")).toBeVisible();
    await expect(dialog.locator(".receipt")).toContainText("Reference");
    const downloaded = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Receipt", exact: true }).click();
    expect((await downloaded).suggestedFilename()).toMatch(/^veyra-receipt-/);
    await expect(dialog.getByRole("button", { name: "Add funds now", exact: true })).toHaveCount(0);
    for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); await fits(page); }
    await dialog.screenshot({ path: testInfo.outputPath("funding-confirmed.png") });
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect((await state(request, token)).balance).toBe(cardCredit(25.5));
  } finally { release(); }
});

test("a fast response still gets a visible animation and adding more uses a new request key", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const token = await owner(page, request), dialog = await form(page, "10");
  const keys: string[] = [];
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/api/me/deposits")) keys.push(request.postDataJSON().requestKey); });
  const started = Date.now();
  await confirmFunding(dialog);
  await expect(dialog.locator(".funding-animation.is-processing")).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText("Funds added to your account immediately");
  expect(Date.now() - started).toBeGreaterThanOrEqual(2300);
  await dialog.getByRole("button", { name: "Add more funds", exact: true }).click();
  await openFundingMethods(dialog); await expect(fundingMethodOptions(dialog)).toHaveCount(7);
  await chooseFundingMethod(dialog, "Debit card");
  await dialog.getByLabel("Amount (USD)").fill("15");
  await confirmFunding(dialog);
  await expect(dialog.getByRole("status")).toContainText("Funds added to your account immediately");
  expect(keys).toHaveLength(2); expect(keys[0]).not.toBe(keys[1]);
  expect((await state(request, token)).balance).toBe(cardCredit(10) + cardCredit(15));
});

test("reduced motion uses a quiet confirmation without moving particles or confetti", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await owner(page, request); const dialog = await form(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/me/deposits", async route => { const response = await route.fetch(); await gate; await route.fulfill({ response }); });
  try {
    const started = Date.now();
    await confirmFunding(dialog);
    await expect(dialog.locator(".funding-animation")).toHaveAttribute("data-motion", "reduced");
    await expect(dialog.locator(".flow-dot,.funding-animation-ring")).toHaveCount(0);
    await expect(dialog).toContainText("Reduced motion is enabled");
    release();
    await expect(dialog.getByRole("status")).toContainText("Funds added to your account immediately");
    expect(Date.now() - started).toBeGreaterThanOrEqual(2300);
    await expect(dialog.locator(".confetti")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Done", exact: true }).focus();
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
  } finally { release(); }
});

test("a refusal restores the editable form without celebrating or crediting funds", async ({ page, request }) => {
  const token = await owner(page, request), dialog = await form(page);
  await page.route("**/api/me/deposits", route => route.fulfill({ status: 400, json: { error: "Account cannot accept this credit." } }));
  await confirmFunding(dialog);
  await expect(dialog.getByRole("alert")).toContainText("Account cannot accept this credit");
  await expect(dialog.locator(".funding-animation,.confetti")).toHaveCount(0);
  await expect(dialog.getByLabel("Amount (USD)")).toHaveValue("25.50");
  await expect(dialog.getByRole("button", { name: "Review deposit", exact: true })).toBeEnabled();
  expect((await state(request, token)).balance).toBe(0);
  await page.unroute("**/api/me/deposits");
  const started = Date.now();
  await confirmFunding(dialog);
  await expect(dialog.locator(".funding-animation.is-processing")).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText("Funds added to your account immediately");
  expect(Date.now() - started).toBeGreaterThanOrEqual(2300);
  expect((await state(request, token)).balance).toBe(cardCredit(25.5));
});


test("business overview and quick-jump funding on accounts/transfers share the visible transition", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const token = await owner(page, request, "business");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/app", "/app/accounts", "/app/transfers"]) {
    await page.goto(`/#${route}`);
    const dialog = await form(page, "10", route !== "/app");
    const started = Date.now();
    await confirmFunding(dialog);
    await expect(dialog.locator(".funding-animation.is-processing")).toBeVisible();
    await fits(page);
    await expect(dialog.getByRole("status")).toContainText("Funds added to your account immediately");
    expect(Date.now() - started).toBeGreaterThanOrEqual(2300);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
  }
  const account = await state(request, token);
  expect(Math.round(account.balance * 100)).toBe(Math.round(cardCredit(10) * 100) * 3);
  expect(account.transactions).toHaveLength(3);
});

test("details and review match the send flow; edit and cancel never submit a deposit", async ({ page, request }, testInfo) => {
  const token = await owner(page, request), dialog = await form(page, "40");
  let posts = 0;
  page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/api/me/deposits")) posts++; });
  await expect(dialog).toHaveClass(/flow-modal/);
  await expect(dialog.locator(".funding-choice-grid,.funding-instructions")).toHaveCount(0);
  await dialog.getByLabel("Memo (optional)", { exact: true }).fill("My account top-up");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 720 }); await fits(page);
    await expect(dialog.getByRole("button", { name: "Review deposit", exact: true })).toBeInViewport();
  }
  await dialog.screenshot({ path: testInfo.outputPath("funding-details.png") });
  await dialog.getByRole("button", { name: "Review deposit", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Review deposit", exact: true })).toBeVisible();
  await expect(dialog.locator(".flow-rows")).toContainText("Debit card");
  await expect(dialog.locator(".flow-rows")).toContainText("My account top-up");
  await expect(dialog.locator(".flow-confirm")).toHaveText("Add $40.00");
  expect(posts).toBe(0); expect((await state(request, token)).balance).toBe(0);
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 720 }); await fits(page); }
  await dialog.screenshot({ path: testInfo.outputPath("funding-review.png") });
  await dialog.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(dialog.getByLabel("Amount (USD)")).toHaveValue("40");
  await expect(dialog.getByLabel("Memo (optional)")).toHaveValue("My account top-up");
  await chooseFundingMethod(dialog, "Debit card");
  await dialog.getByLabel("Amount (USD)").fill("50");
  await dialog.getByRole("button", { name: "Review deposit", exact: true }).click();
  await expect(dialog.locator(".flow-rows")).toContainText("Debit card");
  await expect(dialog.locator(".flow-confirm")).toHaveText("Add $50.00");
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
  expect(posts).toBe(0); expect((await state(request, token)).balance).toBe(0);
});

test("invalid deposit amounts cannot reach review or credit an account", async ({ page, request }) => {
  const token = await owner(page, request), dialog = await form(page, "0");
  let posts = 0;
  page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/api/me/deposits")) posts++; });
  for (const amount of ["", "0", "-10", "9.99", "100000.01", "10.001", "1e2"]) {
    await dialog.getByLabel("Amount (USD)").fill(amount);
    await dialog.getByRole("button", { name: "Review deposit", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Enter $10–$100,000");
    await expect(dialog.locator(".flow-confirm")).toHaveCount(0);
  }
  await dialog.getByLabel("Amount (USD)").fill("100000");
  await dialog.getByRole("button", { name: "Review deposit", exact: true }).click();
  await expect(dialog.locator(".flow-confirm")).toHaveText("Add $100,000.00");
  expect(posts).toBe(0); expect((await state(request, token)).balance).toBe(0);
});
