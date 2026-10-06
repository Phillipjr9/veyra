import { expect, test } from "@playwright/test";

test.skip(process.env.PREVIEW_LOGIN_SHORTCUTS !== "1", "Requires development fixture shortcuts to be enabled.");

for (const fixture of [
  { label: "Personal", email: "demo.personal@veyra.dev", password: "veyra-demo-2026", destination: /#\/app$/ },
  { label: "Business", email: "demo.business@veyra.dev", password: "veyra-demo-2026", destination: /#\/app$/ },
  { label: "Super Admin", email: "admin@veyra.dev", password: "veyra-admin-2026", destination: /#\/app\/superadmin$/ },
]) test(`${fixture.label} credentials fill the form and authenticate through normal sign-in`, async ({ page }) => {
  const loginRequests: string[] = [];
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/api/auth/login")) loginRequests.push(request.url()); });
  await page.goto("/#/login");
  const panel = page.getByRole("region", { name: "Quick access accounts" });
  await expect(panel).toContainText("Development preview only");
  await expect(panel).toContainText(fixture.email);
  await expect(panel).toContainText(fixture.password);
  await panel.getByRole("button", { name: `Use ${fixture.label} account`, exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(fixture.email);
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(fixture.password);
  await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  expect(loginRequests).toHaveLength(0);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(fixture.destination);
  expect(loginRequests).toHaveLength(1);
});

test("quick-access credentials fit mobile and desktop without covering other sign-in methods", async ({ page }) => {
  await page.goto("/#/login");
  const panel = page.getByRole("region", { name: "Quick access accounts" });
  await expect(panel.locator("article")).toHaveCount(3);
  expect(await panel.evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector(".auth-form")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
    expect(await panel.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    for (const button of await panel.getByRole("button").all()) await expect(button).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /passkey/i })).toBeVisible();
});

test("disabled or unreachable server configuration hides credentials", async ({ page }) => {
  await page.route("**/api/auth/config", route => route.fulfill({ status: 200, json: { previewLogins: [] } }));
  await page.goto("/#/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Quick access accounts" })).toHaveCount(0);
  await page.unroute("**/api/auth/config");
  await page.route("**/api/auth/config", route => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Quick access accounts" })).toHaveCount(0);
});
