import { test, expect, type Page } from "@playwright/test";
import { applicationFor } from "../../server/scripts/fixtures";
import { totpCode } from "../../server/src/totp";

async function fits(page: Page) {
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
  const escaped = await page.locator('.auth-card input,.auth-card button,.signup-section,.auth-card select').evaluateAll(elements => elements.filter(el => {
    const r = el.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > innerWidth + 1);
  }).map(el => el.id || el.textContent));
  expect(escaped).toEqual([]);
}

for (const actor of ["personal", "business"] as const) {
  test(`${actor} signup masks and formats SSNs without accepting letters`, async ({ page }) => {
    await page.goto(`/#/signup?type=${actor}`);
    const ids = actor === "business" ? ["su-ssn", "su-ownerSsn"] : ["su-ssn"];
    for (const id of ids) {
      const input = page.locator(`#${id}`);
      await expect(input).toHaveAttribute("type", "password");
      await expect(input).toHaveAttribute("inputmode", "numeric");
      await input.pressSequentially("123abc456789");
      await expect(input).toHaveValue("123-45-6789");
      const toggle = page.locator(`button[aria-controls="${id}"]`);
      await toggle.click();
      await expect(input).toHaveAttribute("type", "text");
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      // Delete through a separator and edit in the middle without jumping to the end.
      await input.evaluate((el: HTMLInputElement) => { el.focus(); el.setSelectionRange(4, 4); });
      await input.press("Backspace");
      await expect(input).toHaveValue("124-56-789");
      expect(await input.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(2);
      await input.fill("");
      await input.evaluate(el => {
        const clipboardData = new DataTransfer(); clipboardData.setData("text/plain", "abc 001-02-3456 extra 99");
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
      });
      await expect(input).toHaveValue("001-02-3456");
      await toggle.click();
      await expect(input).toHaveAttribute("type", "password");
      await expect(input).toHaveValue("001-02-3456");
      await input.fill("12345");
      expect(await input.evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(false);
      await input.fill("527448213");
      expect(await input.evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(true);
    }
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await fits(page);
    }
    await page.reload();
    await expect(page.locator("#su-ssn")).toHaveValue("");
    await expect(page.locator("#su-ssn")).toHaveAttribute("type", "password");
  });
}

test("login keeps verification methods off the initial screen and only enables advertised social providers", async ({ page }) => {
  let enabled: string[] = [];
  let unavailable = false;
  await page.route("**/api/auth/config", route => route.fulfill({ status: unavailable ? 503 : 200, json: {
    federated: { enabled: enabled.length > 0, providers: enabled.map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) })), firebase: { apiKey: "fixture-only", projectId: "fixture", authDomain: "fixture.example" } },
  } }));
  for (const choices of [[], ["google"], ["google", "apple", "microsoft"]]) {
    enabled = choices;
    await page.goto("/#/login"); await page.reload();
    for (const name of ["Google", "Apple", "Microsoft"]) {
      const button = page.getByRole("button", { name: new RegExp(`Continue with ${name}`) });
      if (choices.includes(name.toLowerCase())) await expect(button).toBeEnabled();
      else await expect(button).toBeDisabled();
    }
    await expect(page.getByRole("button", { name: "Authenticator app", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Recovery code", exact: true })).toHaveCount(0);
    await expect(page.locator("#authenticator-code")).toHaveCount(0);
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Forgot?", exact: true })).toHaveAttribute("href", "#/forgot-password");
    await expect(page.getByRole("button", { name: "Use passkey", exact: true })).toBeEnabled();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 }); await fits(page);
    }
  }
  unavailable = true; await page.reload();
  await expect(page.getByRole("button", { name: /Continue with Google/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
});

test("real authenticator and single-use recovery sign-in require the password challenge", async ({ page, browser, request }) => {
  const email = `mfa.${Date.now()}@veyra.test`, password = "Auth-Refresh-2026!";
  const registration = await request.post("/api/auth/register", { data: { name: "Mfa Tester", email, password, accountType: "personal", plan: "Starter", profile: applicationFor("personal", "Mfa Tester") } });
  expect(registration.status()).toBe(201);
  const member = await registration.json();
  const admin = await (await request.post("/api/auth/login", { data: { email: "admin@veyra.dev", password: "veyra-admin-2026" } })).json();
  expect((await request.post(`/api/admin/kyc/${member.user.id}/decision`, { headers: { authorization: `Bearer ${admin.token}` }, data: { decision: "approved" } })).ok()).toBe(true);
  const headers = { authorization: `Bearer ${member.token}` };
  const setup = await (await request.post("/api/me/security/two-factor/setup", { headers, data: { password } })).json();
  const confirmation = await (await request.post("/api/me/security/two-factor/confirm", { headers, data: { password, code: totpCode(setup.secret) } })).json();
  expect(confirmation.recoveryCodes).toHaveLength(10);
  async function begin(p: Page, method: string) {
    await p.goto("/#/login");
    await expect(p.getByRole("button", { name: "Authenticator app", exact: true })).toHaveCount(0);
    await expect(p.getByRole("button", { name: "Recovery code", exact: true })).toHaveCount(0);
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p.getByLabel("Password", { exact: true }).fill(password);
    const pending = p.waitForResponse(r => r.url().endsWith("/api/auth/login"));
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    const challenge = await (await pending).json();
    expect(challenge.twoFactorRequired).toBe(true); expect(challenge.token).toBeUndefined();
    await expect(p.locator("#authenticator-code")).toBeVisible();
    await expect(p.getByRole("button", { name: "Authenticator app", exact: true })).toHaveAttribute("aria-pressed", "true");
    await p.getByRole("button", { name: method, exact: true }).click();
    return challenge.challengeId;
  }
  await page.setViewportSize({ width: 320, height: 900 });
  await begin(page, "Recovery code");
  await page.getByRole("button", { name: "Use a different account", exact: true }).click();
  await expect(page.locator("#authenticator-code")).toHaveCount(0);
  await begin(page, "Authenticator app");
  await expect(page.locator("#authenticator-code")).toHaveAttribute("inputmode", "numeric");
  await page.locator("#authenticator-code").evaluate(el => {
    const clipboardData = new DataTransfer(); clipboardData.setData("text/plain", "123 456");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect(page.locator("#authenticator-code")).toHaveValue("123456");
  const wrong = String((Number(totpCode(setup.secret)) + 1) % 1_000_000).padStart(6, "0");
  await page.getByLabel("Authenticator code", { exact: true }).fill(wrong);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/#\/login$/);
  await fits(page);
  await page.getByLabel("Authenticator code", { exact: true }).fill(totpCode(setup.secret));
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page).toHaveURL(/#\/app$/);

  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 320, height: 900 } });
  try {
    const recoveryPage = await context.newPage();
    await begin(recoveryPage, "Recovery code");
    await recoveryPage.getByLabel("Recovery code", { exact: true }).fill(confirmation.recoveryCodes[0]);
    await fits(recoveryPage);
    await recoveryPage.getByRole("button", { name: "Verify and sign in" }).click();
    await expect(recoveryPage).toHaveURL(/#\/app$/);
    const next = await (await request.post("/api/auth/login", { data: { email, password } })).json();
    const reused = await request.post("/api/auth/login/verify", { data: { challengeId: next.challengeId, code: confirmation.recoveryCodes[0] } });
    expect(reused.ok()).toBe(false);
    expect((await reused.json()).token).toBeUndefined();
  } finally { await context.close(); }
});
