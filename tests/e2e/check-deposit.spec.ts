import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { applicationFor } from "../../server/scripts/fixtures";

const password = "Check-Deposit-Browser-2026!";
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function signIn(page: Page, email: string) {
  await page.goto("/#/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const wait = page.waitForResponse(r => r.url().endsWith("/api/auth/login") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const r = await wait;
  expect(r.status()).toBe(200);
  await expect(page).toHaveURL(/#\/app/);
}

async function fixture(request: APIRequestContext) {
  const admin = await (await request.post("/api/auth/login", { data: { email: "admin@veyra.dev", password: "veyra-admin-2026" } })).json();
  const name = `Check ${Date.now()}`;
  const email = `check-deposit-${Date.now()}@veyra.test`;
  const r = await request.post("/api/auth/register", { data: { name, email, password, accountType: "personal", business: "", profile: applicationFor("personal", name, "") } });
  expect(r.status()).toBe(201);
  const u = await r.json();
  expect((await request.post(`/api/admin/kyc/${u.user.id}/decision`, { headers: { authorization: `Bearer ${admin.token}` }, data: { decision: "approved" } })).status()).toBe(200);
  return { email, token: u.token as string };
}

function photo() {
  return { name: "check.png", mimeType: "image/png", buffer: PIXEL };
}

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const main = page.locator(".check-deposit-page");
  expect(await main.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
}

test("mobile check deposit is its own page with front, back, instructions and a pending submit", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const u = await fixture(request);
  await signIn(page, u.email);

  await page.goto("/#/app/transfers");
  await page.getByRole("link", { name: /Deposit Check/ }).click();
  await expect(page).toHaveURL(/#\/app\/check-deposit$/);
  await expect(page.getByRole("heading", { name: "Mobile check deposit", level: 1 })).toBeVisible();
  await expect(page.getByText(/Endorse the back/)).toBeVisible();
  await expect(page.getByText(/MICR/)).toBeVisible();
  await expect(page.getByText(/Images stay on this device/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit check for review" })).toBeDisabled();

  await page.getByLabel("Photo of check front").setInputFiles(photo());
  await page.getByLabel("Photo of check back").setInputFiles(photo());
  await expect(page.getByAltText("Front of check")).toBeVisible();
  await expect(page.getByAltText("Back of check")).toBeVisible();

  await page.getByLabel("Amount (USD)").fill("25.00");
  const wait = page.waitForResponse(r => r.url().endsWith("/api/me/check-deposits") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Submit check for review" }).click();
  const posted = await wait;
  expect(posted.status()).toBe(201);
  const body = await posted.json();
  expect(body.request.status).toBe("pending");
  await expect(page.getByRole("heading", { name: "Submitted for review" })).toBeVisible();
  await expect(page.getByText("Pending review · not credited")).toBeVisible();
  await expect(page.getByText(body.request.reference)).toBeVisible();

  const state = await (await request.get("/api/me/state", { headers: { authorization: `Bearer ${u.token}` } })).json();
  expect(state.account.balance).toBe(0);

  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await fits(page);
  }
  expect(errors).toEqual([]);
});

test("the sidebar and Transfers both lead to the check deposit page", async ({ page, request }) => {
  const u = await fixture(request);
  await signIn(page, u.email);
  await page.goto("/#/app");
  await page.locator('a[href="#/app/check-deposit"]').first().click();
  await expect(page).toHaveURL(/#\/app\/check-deposit$/);
});
