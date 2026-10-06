import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email = "demo.personal@veyra.dev", password = "veyra-demo-2026") {
  await page.goto("/#/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const response = page.waitForResponse(r => r.url().endsWith("/api/auth/login") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const session = await (await response).json();
  await expect(page).toHaveURL(/#\/app$/);
  await expect(page.locator(".dx-flow")).toBeVisible();
  return session.token as string;
}
async function reviewPayment(page: Page, amount: string, payee = "Control test vendor") {
  await page.goto("/#/app/transfers");
  await page.locator("#pay-to").fill(payee);
  await page.locator("#pay-amount").fill(amount);
  await page.locator(".dash-submit").click();
  await expect(page.getByRole("heading", { name: "Review payment", exact: true })).toBeVisible();
  await page.locator(".flow-confirm").click();
}
async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
}

test("Scout estimates are read-only, with no credit request or balance change", async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.route("**/api/me/state", async route => {
    const response = await route.fetch(); const body = await response.json();
    body.account.transactions.unshift({ id: "read-only-scout-fixture", merchant: "Example Software", category: "Software", amount: -100, reward: 0, date: Date.now(), note: "Monthly subscription", status: "cleared" });
    await route.fulfill({ response, json: body });
  });
  const token = await login(page);
  const headers = { authorization: `Bearer ${token}` };
  const before = (await (await request.get("/api/me/state", { headers })).json()).account;
  let creditCalls = 0;
  page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/api/me/scout/apply")) creditCalls++; });
  await page.goto("/#/app/scout");
  await page.getByRole("button", { name: "Review Example Software estimate", exact: true }).click();
  await expect(page.getByText("Planning estimate only", { exact: true })).toBeVisible();
  await expect(page.locator(".toast-body")).toContainText("no money was credited");
  await fits(page);
  const after = (await (await request.get("/api/me/state", { headers })).json()).account;
  expect(creditCalls).toBe(0);
  expect([after.balance, after.scoutSaved, after.scoutApplied, after.transactions]).toEqual([before.balance, before.scoutSaved, before.scoutApplied, before.transactions]);
});

test("payment waits for server confirmation and never renders success on a decline", async ({ page, request }) => {
  const token = await login(page);
  const headers = { authorization: `Bearer ${token}` };
  const before = (await (await request.get("/api/me/state", { headers })).json()).account;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let received = false;
  await page.route("**/api/me/transfers", async route => {
    received = true; await held;
    await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Monthly team spending limit exceeded. $0.00 remains.", code: "team_monthly_limit" }) });
  });
  await reviewPayment(page, "12");
  await expect.poll(() => received).toBe(true);
  await expect(page.locator(".flow-success")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Wrapping up…" })).toBeVisible();
  release();
  await expect(page.getByText("Transfer blocked", { exact: true })).toBeVisible();
  await expect(page.locator(".toast-body")).toContainText("Monthly team spending limit exceeded");
  await expect(page.locator(".flow-success")).toHaveCount(0);
  await expect(page.locator("#pay-to")).toHaveValue("Control test vendor");
  await expect(page.locator("#pay-amount")).toHaveValue("12");
  const after = (await (await request.get("/api/me/state", { headers })).json()).account;
  expect([after.balance, after.transactions]).toEqual([before.balance, before.transactions]);
});

test("confirmed debit survives a failed balance refresh without a false decline or duplicate send", async ({ page, request }) => {
  const token = await login(page);
  let failRefresh = false, sends = 0;
  await page.route("**/api/me/state", async route => {
    if (failRefresh) await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Fixture refresh unavailable"}' });
    else await route.continue();
  });
  await page.route("**/api/me/transfers", async route => {
    sends++;
    const response = await route.fetch(); failRefresh = true;
    await route.fulfill({ response });
  });
  await reviewPayment(page, "1.23", "Confirmed fixture payment");
  await expect(page.getByRole("heading", { name: "Payment sent", exact: true })).toBeVisible();
  await expect(page.getByText("Payment confirmed; balance refresh pending", { exact: true })).toBeVisible();
  expect(sends).toBe(1);
  const state = (await (await request.get("/api/me/state", { headers: { authorization: `Bearer ${token}` } })).json()).account;
  const ledger = state.transactions.find((t: { merchant: string }) => t.merchant === "Confirmed fixture payment");
  await expect(page.locator(".receipt")).toContainText(ledger.reference);
  await expect(page.getByText("Transfer blocked", { exact: true })).toHaveCount(0);
});

test("real teammate limit and remaining usage are enforced and visible on mobile, including bills", async ({ page, request }) => {
  const ownerLogin = await request.post("/api/auth/login", { data: { email: "demo.business@veyra.dev", password: "veyra-demo-2026" } });
  const owner = (await ownerLogin.json()).token;
  const headers = { authorization: `Bearer ${owner}` };
  const email = `limited.${Date.now()}@veyra.test`;
  const invited = await request.post("/api/me/team", { headers, data: { name: "Limited Teammate", email, role: "Member", monthlyLimit: 1 } });
  expect(invited.status()).toBe(201);
  const invite = await invited.json();
  const inviteToken = new URL(`http://fixture${invite.inviteUrl.replace('/#', '')}`).searchParams.get("token");
  const accepted = await request.post(`/api/invites/${inviteToken}/accept`, { data: { name: "Limited Teammate", password: "limited-teammate-pass" } });
  expect(accepted.status()).toBe(201);
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, email, "limited-teammate-pass");
  await reviewPayment(page, "2");
  await expect(page.getByText("Transfer blocked", { exact: true })).toBeVisible();
  await expect(page.locator(".flow-success")).toHaveCount(0);
  await reviewPayment(page, "1");
  await expect(page.getByRole("heading", { name: "Payment sent", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.goto("/#/app/team");
  const member = page.locator(".team-row").filter({ hasText: email });
  await expect(member.locator(".team-limit")).toBeVisible();
  await expect(member).toContainText("$1.00 used · $0.00 left");
  await expect(member).toContainText("Resets on the 1st · UTC");
  await fits(page);
  const scheduled = await request.post("/api/me/scheduled", { headers, data: { payeeName: "Limited teammate bill", amount: .5, nextDate: Date.now(), frequency: "once", category: "Operations" } });
  expect(scheduled.status()).toBe(201);
  const billId = (await scheduled.json()).payment.id;
  await page.goto("/#/app/bills");
  await page.reload(); // owner created the schedule in another session
  const bill = page.locator(".bill-row").filter({ hasText: "Limited teammate bill" });
  await bill.getByRole("button", { name: "Pay now", exact: true }).click();
  await expect(page.getByText("Payment could not be sent", { exact: true })).toBeVisible();
  await expect(page.locator(".toast-body").filter({ hasText: "Payment could not be sent" })).toContainText("Monthly team spending limit exceeded");
  await expect(bill.getByRole("button", { name: "Pay now", exact: true })).toBeEnabled();
  const state = (await (await request.get("/api/me/state", { headers })).json()).account;
  expect(state.scheduledPayments.find((p: { id: string }) => p.id === billId).status).toBe("active");
  expect(state.transactions.some((t: { merchant: string }) => t.merchant === "Limited teammate bill")).toBe(false);
  await fits(page);
});
