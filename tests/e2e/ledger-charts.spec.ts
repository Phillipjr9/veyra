import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { applicationFor } from "../../server/scripts/fixtures";
import { buildLedgerAnalytics } from "../../shared/ledgerAnalytics";

test.skip((process.env.ACCOUNT_LEDGER_ENABLED || process.env.DEMO_PAYMENTS_ENABLED) !== "1", "Live chart changes use explicit demo funding, never real payment rails.");
const password = "Ledger-Charts-2026!";
const headers = (token: string) => ({ authorization: `Bearer ${token}` });
async function member(request: APIRequestContext, type: "personal" | "business" = "personal") {
  const admin = (await (await request.post("/api/auth/login", { data: { email: "admin@veyra.dev", password: "veyra-admin-2026" } })).json()).token;
  const name = `Chart ${type}`, email = `chart-${crypto.randomUUID()}@veyra.test`;
  const result = await request.post("/api/auth/register", { data: { name, email, password, accountType: type, business: type === "business" ? "Chart Studio" : "", profile: applicationFor(type, name, "Chart Studio") } });
  expect(result.status()).toBe(201);
  const body = await result.json();
  expect((await request.post(`/api/admin/kyc/${body.user.id}/decision`, { headers: headers(admin), data: { decision: "approved" } })).status()).toBe(200);
  return { token: body.token as string, email };
}
async function login(page: Page, email: string) {
  await page.goto("/#/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".dx-flow")).toBeVisible();
}
async function fund(request: APIRequestContext, token: string, amount: string) {
  const methods = (await (await request.get("/api/me/funding", { headers: headers(token) })).json()).methods;
  expect((await request.post("/api/me/deposits", { headers: headers(token), data: { demo: true, methodId: methods[0].id, amount, requestKey: crypto.randomUUID() } })).status()).toBe(201);
}
async function send(request: APIRequestContext, token: string, identifier: string, amount: string, method = "Zelle") {
  const review = await request.post("/api/me/demo-payments/action", { headers: headers(token), data: { action: "preview_transfer", identifier, method, amount, category: "Operations" } });
  expect(review.status()).toBe(200);
  const id = (await review.json()).preview.id;
  expect((await request.post("/api/me/demo-payments/action", { headers: headers(token), data: { action: "confirm_transfer", id, decision: "completed" } })).status()).toBe(200);
}
async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
  for (const selector of [".dx-flow"]) {
    const box = await page.locator(selector).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 1440) + 1);
  }
}
for (const type of ["personal", "business"] as const) test(`${type}: funding and outgoing payments update the existing Ledger Intelligence chart without reload`, async ({ page, request }) => {
  const user = await member(request, type);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await login(page, user.email);
  await expect(page.getByText("No cleared activity in this period")).toBeVisible();
  await page.getByRole("button", { name: "90D", exact: true }).click();
  await page.getByRole("button", { name: "Bar chart", exact: true }).click();
  let reloads = 0;
  page.on("framenavigated", frame => { if (frame === page.mainFrame()) reloads++; });
  await page.getByRole("button", { name: "Add funds", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add funds", exact: true });
  await dialog.getByRole("button", { name: "Debit card", exact: true }).click();
  await dialog.getByLabel("Amount (USD)", { exact: true }).fill("125.50");
  await dialog.getByRole("button", { name: "Add funds now", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Funds added");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator('[data-flow="in"]')).toHaveText("$125.50");
  await send(request, user.token, "Ledger vendor", "31.25", "ACH");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator('[data-flow="out"]')).toHaveText("$31.25");
  await expect(page.locator('[data-flow="net"]')).toHaveText("+$94.25");
  await expect(page.getByRole("button", { name: "90D", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Bar chart", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(reloads).toBe(0);
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); await fits(page); }
  await expect(page.locator(".dx-breakdown")).toHaveCount(0);
  await expect(page.locator(".dx-flow .recharts-wrapper")).toHaveCount(1);
  await page.goto("/#/app/scout");
  await expect(page.getByRole("heading", { name: "Balance trend", exact: true })).toBeVisible();
  await expect(page.locator(".dx-flow")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("an incoming payment from another session appears on the existing receiver chart through polling", async ({ page, request }) => {
  const receiver = await member(request), sender = await member(request);
  await fund(request, sender.token, "100");
  await login(page, receiver.email);
  await expect(page.locator('[data-flow="in"]')).toHaveText("$0.00");
  await page.getByRole("button", { name: "7D", exact: true }).click();
  await send(request, sender.token, receiver.email, "19.75");
  // No navigation, visibility event or manual refresh: the background timer
  // must pick up the paired incoming ledger entry from another session.
  await expect(page.locator('[data-flow="in"]')).toHaveText("$19.75", { timeout: 22_000 });
  await expect(page.locator('[data-flow="out"]')).toHaveText("$0.00");
  await expect(page.getByRole("button", { name: "7D", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.route("**/api/me/state", route => route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } }));
  const failedRead = page.waitForResponse(r => r.url().endsWith("/api/me/state") && r.status() === 503);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await failedRead;
  await expect(page.locator('[data-flow="in"]')).toHaveText("$19.75");
  await page.unroute("**/api/me/state");
  await fund(request, receiver.token, "10");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator('[data-flow="in"]')).toHaveText("$29.75");
});

test("admin payment channels honor the explorer period, retain every rail and have an honest empty state", async ({ page }) => {
  const now = Date.now(), day = 86_400_000;
  let empty = false;
  const rows = ["ACH", "Wire", "Zelle", "Card", "Internal", "Check", "Transfer", "Other"].map((method, i) => ({ date: now - (i + 1) * day, amount: (i + 1) * 10, status: "cleared", method, category: "Operations" }));
  await page.route("**/api/admin/state", async route => {
    const response = await route.fetch(), body = await response.json();
    body.analytics = buildLedgerAnalytics(empty ? [] : rows, now);
    await route.fulfill({ response, json: body });
  });
  await page.goto("/#/login");
  await page.getByLabel("Email", { exact: true }).fill("admin@veyra.dev");
  await page.getByLabel("Password", { exact: true }).fill("veyra-admin-2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".admin-mix-item")).toHaveCount(8);
  await page.getByRole("button", { name: "7D", exact: true }).click();
  await expect(page.locator(".admin-mix-item")).toHaveCount(6);
  await expect(page.locator('[data-flow="in"]')).toHaveText("$210.00");
  await page.setViewportSize({ width: 320, height: 844 }); await fits(page);
  empty = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".admin-mix-item")).toHaveCount(0);
  await expect(page.locator(".admin-chart-empty")).toBeVisible();
});

test("failed, pending and future entries do not masquerade as cleared activity in charts or ledger totals", async ({ page, request }) => {
  const user = await member(request);
  const now = Date.now();
  await page.route("**/api/me/state", async route => {
    const response = await route.fetch(), body = await response.json();
    body.account.transactions = [
      { id: "cleared", merchant: "Cleared grocery", amount: -12.34, date: now, status: "cleared", category: "Groceries", method: "Card", reward: 0 },
      { id: "pending", merchant: "Pending grocery", amount: -50, date: now, status: "pending", category: "Groceries", method: "Card", reward: 0 },
      { id: "failed", merchant: "Failed deposit", amount: 1000, date: now, status: "failed", category: "Operations", method: "ACH", reward: 0 },
      { id: "future", merchant: "Future movement", amount: 5000, date: now + 86400000, status: "cleared", category: "Operations", method: "ACH", reward: 0 },
    ];
    body.account.analytics = buildLedgerAnalytics(body.account.transactions, now);
    await route.fulfill({ response, json: body });
  });
  await login(page, user.email);
  await expect(page.locator('[data-flow="in"]')).toHaveText("$0.00");
  await expect(page.locator('[data-flow="out"]')).toHaveText("$12.34");
  await expect(page.locator(".balance-bar")).toHaveCount(1);
  await page.goto("/#/app/transactions");
  await expect(page.locator(".txn-trow").filter({ hasText: "Failed deposit" }).locator(".tcol-status")).toHaveText("Failed");
  await expect(page.locator(".txn-trow").filter({ hasText: "Pending grocery" }).locator(".tcol-status")).toHaveText("Pending");
  await expect(page.locator(".summary-strip")).toContainText("$12.34");
  await expect(page.locator(".summary-strip")).not.toContainText("$1,000.00");
  await page.goto("/#/app/plan");
  await expect(page.locator(".money-plan-kpi").filter({ hasText: "Month-to-date outflow" })).toContainText("$12.34");
});

test("a slow background snapshot cannot overwrite a newer confirmed funding refresh", async ({ page, request }) => {
  const user = await member(request);
  await login(page, user.email);
  let held = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/me/state", async route => {
    if (!held) {
      const response = await route.fetch();
      held = true;
      await gate;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => held).toBe(true);
  try {
    await page.getByRole("button", { name: "Add funds", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add funds", exact: true });
    await dialog.getByRole("button", { name: "Debit card", exact: true }).click();
    await dialog.getByLabel("Amount (USD)", { exact: true }).fill("125.50");
    await dialog.getByRole("button", { name: "Add funds now", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("Funds added");
    await expect(page.locator('[data-flow="in"]')).toHaveText("$125.50");
    const oldRead = page.waitForResponse(r => r.url().endsWith("/api/me/state"));
    release();
    await oldRead;
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.locator('[data-flow="in"]')).toHaveText("$125.50");
  } finally { release(); }
});
