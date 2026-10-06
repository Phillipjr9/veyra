import { confirmFunding } from "./funding-helpers";
import { test, expect, type Page } from "@playwright/test";
import { applicationFor } from "../../server/scripts/fixtures";
import { FUNDING_OPTIONS } from "../../shared/funding";

test.skip((process.env.ACCOUNT_LEDGER_ENABLED || process.env.DEMO_PAYMENTS_ENABLED) !== "1", "Requires account-ledger funding.");
const password = "Account-Interface-2026!";
async function ordinaryInterface(page: Page) {
  await expect(page.locator("body")).not.toContainText(/\bdemo\b|mock funds|payment playground/i);
}
for (const type of ["personal", "business"] as const) test(`${type}: available funding methods credit the account; unconfigured bank methods stay blocked and only the existing ledger chart updates`, async ({ page, request }) => {
  const admin = (await (await request.post("/api/auth/login", { data: { email: "admin@veyra.dev", password: "veyra-admin-2026" } })).json()).token;
  const email = `account-${crypto.randomUUID()}@veyra.test`, name = "Account Owner";
  const created = await request.post("/api/auth/register", { data: { name, email, password, accountType: type, business: type === "business" ? "Harbor Studio" : "", profile: applicationFor(type, name, "Harbor Studio") } });
  expect(created.status()).toBe(201);
  const user = await created.json();
  expect((await request.post(`/api/admin/kyc/${user.user.id}/decision`, { headers: { authorization: `Bearer ${admin}` }, data: { decision: "approved" } })).status()).toBe(200);
  await page.goto("/#/login");
  await ordinaryInterface(page);
  await expect(page.locator(".auth-demo,.demo-logins")).toHaveCount(0);
  expect((await request.get("/api/demo/accounts")).status()).toBe(404);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".dx-kicker")).toHaveText("LEDGER INTELLIGENCE");
  await page.getByRole("button", { name: "7D", exact: true }).click();
  await page.getByRole("button", { name: "Bar chart", exact: true }).click();
  let total = 0;
  for (const option of FUNDING_OPTIONS) {
    await page.getByRole("button", { name: "Add funds", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add funds", exact: true });
    await expect(dialog.getByLabel("Funding method", { exact: true }).locator("option")).toHaveCount(8);
    await ordinaryInterface(page);
    await dialog.getByLabel("Funding method", { exact: true }).selectOption({ label: option.label });
    await dialog.getByLabel("Amount (USD)", { exact: true }).fill("14.25");
    if (option.kind === "ach" || option.kind === "direct_deposit") {
      await expect(dialog.getByRole("button", { name: "Review deposit", exact: true })).toBeDisabled();
      if (option.kind === "ach") await expect(dialog.getByRole("link", { name: "Link an external account" })).toBeVisible();
      else await expect(dialog).toContainText("has not configured Direct Deposit");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      continue;
    }
    const posted = page.waitForRequest(req => req.url().endsWith("/api/me/deposits") && req.method() === "POST");
    await confirmFunding(dialog);
    const payload = (await posted).postDataJSON();
    expect(payload.accountEntry).toBe(true);
    expect(payload.demo).toBeUndefined();
    await expect(dialog.getByRole("status")).toContainText("Funds added to your account immediately");
    await expect(dialog.getByRole("button", { name: "Add funds now", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeEnabled();
    await ordinaryInterface(page);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    total += 14.25;
    await expect(page.locator('[data-flow="in"]')).toHaveText(`$${total.toFixed(2)}`);
    await expect(page.locator('[data-flow="out"]')).toHaveText("$0.00");
    await expect(page.locator(".dx-flow")).toHaveCount(1);
    await expect(page.locator(".dx-flow .recharts-wrapper")).toHaveCount(1);
    await expect(page.locator(".dx-breakdown")).toHaveCount(0);
  }
  const account = (await (await request.get("/api/me/state", { headers: { authorization: `Bearer ${user.token}` } })).json()).account;
  expect(account.balance).toBe(85.5);
  expect(account.transactions).toHaveLength(6);
  for (const row of account.transactions) { expect(row.status).toBe("cleared"); expect(row.reference).toMatch(/^VYR-/); expect(row.merchant).not.toMatch(/\bdemo\b/i); }
  await expect(page.getByRole("button", { name: "7D", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Bar chart", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
  await page.goto("/#/app/transfers");
  await ordinaryInterface(page);
  await page.getByRole("button", { name: /Receive Zelle.*QR/ }).click();
  const receive = page.getByRole("dialog", { name: "Zelle receive hub" });
  await expect(receive.getByRole("img", { name: "Scannable QR for this Veyra payment link" })).toBeVisible();
  await ordinaryInterface(page);
  await expect(receive.locator(".receive-demo-pill")).toHaveCount(0);
  await receive.getByRole("button", { name: "Close receive hub" }).click();
  await page.goto("/#/app");
  await expect(page.locator('[data-flow="in"]')).toHaveText("$85.50");
});
