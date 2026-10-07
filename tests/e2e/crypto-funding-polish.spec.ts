import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { quoteFee } from "../../shared/fees";

test.skip(process.env.E2E_LINKED_ACCOUNTS !== "1", "Uses a trusted provider link in the disposable browser fixture only.");
async function login(page: Page, request: APIRequestContext, type = "personal") {
  const res = await request.post("/api/auth/login", { data: { email: `demo.${type}@veyra.dev`, password: "veyra-demo-2026" } });
  const user = await res.json(); expect(res.status()).toBe(200);
  await page.addInitScript(token => localStorage.setItem("veyra.token", token), user.token);
  await page.goto("/#/app/assets"); await expect(page.locator(".cw-asset-row")).toHaveCount(24);
  return user;
}
async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
  for (const modal of await page.getByRole("dialog").all()) expect(await modal.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
}
async function review(page: Page, action: "buy" | "sell" | "swap", amount: string) {
  await page.locator(".cw-action-bar").getByRole("button", { name: new RegExp(`^${action}`, "i") }).click();
  const dialog = page.getByRole("dialog");
  if (action !== "buy") await dialog.getByLabel("From", { exact: true }).selectOption("USDC");
  if (action !== "sell") await dialog.getByLabel("To", { exact: true }).selectOption(action === "buy" ? "USDC" : "SOL");
  await dialog.getByLabel(action === "buy" ? "Amount to spend (USD)" : "Quantity (USDC)").fill(amount);
  await dialog.getByRole("checkbox").check(); await dialog.getByRole("button", { name: "Review order" }).click();
  await expect(dialog.getByRole("button", { name: `Confirm ${action}` })).toBeEnabled();
  return dialog;
}
test("three distinct responsive trade presentations wait for real confirmation, including a delayed server", async ({ page, request }, info) => {
  const session = await login(page, request);
  const balance = async () => (await (await request.get("/api/me/state", { headers: { authorization: `Bearer ${session.token}` } })).json()).account.balance;
  let posts = 0; page.on("request", r => { if (r.url().endsWith("/api/me/crypto/confirm") && r.method() === "POST") posts++; });
  for (const [action, width] of [["buy", 390], ["swap", 320], ["sell", 1440]] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ reducedMotion: action === "sell" ? "no-preference" : "reduce" });
    const before = await balance();
    const dialog = await review(page, action, action === "buy" ? "20" : "2");
    let release: (() => void) | undefined;
    if (action === "swap") await page.route("**/api/me/crypto/confirm", async route => { const response = await route.fetch(); await new Promise<void>(resolve => { release = resolve; }); await route.fulfill({ response }); });
    const at = Date.now(); await dialog.getByRole("button", { name: `Confirm ${action}` }).click();
    const animation = dialog.locator(`.crypto-trade-animation.trade-${action}`);
    await expect(animation).toBeVisible(); await expect(animation.locator(".flow-orbit-progress circle").first()).toHaveCSS("fill", "none"); await expect(animation.locator(".flow-steplist li")).toHaveCount(4);
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeDisabled(); await fits(page);
    await expect(animation).toContainText(action === "swap" ? "swap fee is debited from checking" : action === "buy" ? "checking debit" : "checking credit");
    if (action === "sell") { await expect(animation.locator(".trade-cash-mark")).toBeVisible(); await page.screenshot({ path: info.outputPath("sell-desktop.png") }); }
    if (action === "swap") {
      await expect(animation.getByRole("heading", { name: "Waiting for account confirmation…" })).toBeVisible();
      await expect(dialog.getByText("Recorded once in your account")).toHaveCount(0);
      await page.screenshot({ path: info.outputPath("swap-mobile.png") }); release!();
    }
    await expect(dialog.getByText("Recorded once in your account")).toBeVisible();
    expect(Date.now() - at).toBeGreaterThanOrEqual(action === "sell" ? 3500 : 2400);
    const fee = action === "buy" ? quoteFee("crypto_buy", 2000).feeCents / 100 : action === "sell" ? quoteFee("crypto_sell", 200).feeCents / 100 : quoteFee("crypto_swap", 200).feeCents / 100;
    expect(await balance()).toBe(before + (action === "buy" ? -20 - fee : action === "sell" ? 2 - fee : -fee));
    await dialog.getByRole("button", { name: "Done" }).click(); await page.unroute("**/api/me/crypto/confirm");
  }
  expect(posts).toBe(3);
  const notifications = (await (await request.get("/api/me/notifications", { headers: { authorization: `Bearer ${session.token}` } })).json()).notifications;
  expect(notifications.filter((n: {type: string}) => n.type === "crypto")).toHaveLength(3);
  await page.goto("/#/app"); await page.getByRole("button", { name: /Notifications/ }).first().click();
  await expect(page.getByText("Crypto sale completed", { exact: true })).toBeVisible();
});

test("every supported coin has a distinct loaded mark and clean customer copy", async ({ page, request }) => {
  await login(page, request);
  const images = page.locator(".cw-asset-name img");
  await expect(images).toHaveCount(24);
  expect(new Set(await images.evaluateAll(els => els.map(el => (el as HTMLImageElement).src))).size).toBe(24);
  await expect.poll(() => images.evaluateAll(els => els.every(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await expect(page.getByText(/test data|test holdings|sample prices|development preview/i)).toHaveCount(0);
  for (const width of [320, 390, 768]) { await page.setViewportSize({ width, height: 900 }); await fits(page); }
});

test("funding lists the real linked account; Direct Deposit displays only admin-configured owner details", async ({ page, request }, info) => {
  const session = await login(page, request);
  const admin = (await (await request.post("/api/auth/login", { data: { email: "admin@veyra.dev", password: "veyra-admin-2026" } })).json()).token;
  expect((await request.patch(`/api/admin/members/${session.user.id}/account-details`, { headers: { authorization: `Bearer ${admin}` }, data: {
    accountNumber: "777123456789", routingNumber: "021000021", bankName: "User Specific Payroll Bank", bankAccountType: "Savings", accountType: "personal", business: "", reason: "Receiving details browser coverage",
  } })).status()).toBe(200);
  await page.goto("/#/app"); await page.getByRole("button", { name: "Add funds", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add funds", exact: true });
  await expect(dialog.getByLabel("Funding method", { exact: true }).locator("option").filter({ hasText: "Connected Bank Checking •••• 7890" })).toHaveCount(1);
  await dialog.getByLabel("Funding method", { exact: true }).selectOption({ label: "Direct deposit" });
  const details = dialog.getByRole("region", { name: "Direct Deposit banking details" });
  await expect(details).toContainText("User Specific Payroll Bank"); await expect(details).toContainText("021000021"); await expect(details).toContainText("Savings");
  await expect(details).not.toContainText("777123456789"); await details.getByRole("button", { name: "Show account number" }).click(); await expect(details).toContainText("777123456789");
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); await fits(page); }
  await page.setViewportSize({ width: 390, height: 900 }); await page.screenshot({ path: info.outputPath("funding-mobile.png") });
  await expect(dialog.getByText("Recent deposits", { exact: true })).toHaveCount(0);
  await dialog.getByRole("link", { name: "Manage linked accounts" }).click(); await expect(page).toHaveURL(/external-accounts/);
  await expect(page.getByRole("heading", { name: "Your linked accounts" })).toBeVisible(); await expect(page.getByRole("region", { name: "Available bank accounts" })).toContainText("7890"); await fits(page);
  await page.goto("/#/app"); await expect(page.getByRole("heading", { name: "Recent deposits", exact: true })).toBeVisible();
});

test("no linked account has a direct linking action, no fake bank, and no generic payroll details", async ({ page, request }) => {
  await login(page, request, "business"); await page.goto("/#/app");
  await expect(page.getByRole("heading", { name: "Recent deposits", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add funds", exact: true }).first().click(); const dialog = page.getByRole("dialog", { name: "Add funds", exact: true });
  await expect(dialog.getByRole("link", { name: "Link an external account" })).toBeVisible();
  await dialog.getByLabel("Funding method", { exact: true }).selectOption({ label: "Link a bank (ACH)" });
  await dialog.getByLabel("Amount (USD)", { exact: true }).fill("25"); await expect(dialog.getByRole("button", { name: "Review deposit" })).toBeDisabled();
  await dialog.getByLabel("Funding method", { exact: true }).selectOption({ label: "Direct deposit" });
  await expect(dialog).toContainText("has not configured Direct Deposit"); await expect(dialog.locator(".direct-deposit-details")).not.toContainText("Northfield");
  await dialog.getByRole("link", { name: "Link an external account" }).click(); await expect(page).toHaveURL(/external-accounts/);
  await expect(page.getByRole("heading", { name: "Link an external account" })).toBeVisible(); await expect(page.getByRole("region", { name: "Available bank accounts" })).toContainText("No verified external accounts");
  await page.setViewportSize({ width: 320, height: 900 }); await fits(page);
});

test("failed trade returns to review without a success receipt", async ({ page, request }) => {
  await login(page, request);
  const dialog = await review(page, "buy", "5");
  await page.route("**/api/me/crypto/confirm", route => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "The quote expired. Review a new quote." }) }));
  await dialog.getByRole("button", { name: "Confirm buy" }).click();
  await expect(dialog.getByRole("alert")).toContainText("quote expired"); await expect(dialog.getByText("Recorded once in your account")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Edit / refresh quote" })).toBeEnabled(); await expect(dialog.locator(".crypto-trade-animation")).toHaveCount(0);
});

test("an owner submits a reference, staff review it, and only then can it be selected for funding", async ({ page, request, browser }, info) => {
  const session = await login(page, request, "business");
  await page.goto("/#/app/external-accounts"); await page.setViewportSize({ width: 320, height: 850 });
  let calls = 0;
  await page.route("**/api/me/external-accounts", async route => {
    if (route.request().method() !== "POST") return route.continue();
    calls++;
    if (calls === 1) { const result = await route.fetch(); expect(result.status()).toBe(201); await route.abort("failed"); }
    else await route.continue();
  });
  await page.getByLabel("Bank name", { exact: true }).fill("Harbor External Bank");
  await page.getByLabel("Account display name").fill("Operations checking");
  await page.getByLabel("Last four account digits").fill("8765");
  await page.getByRole("checkbox").check(); await fits(page);
  await page.getByRole("button", { name: "Submit account for review" }).click();
  await expect(page.getByRole("button", { name: "Retry same request" })).toBeVisible();
  await expect(page.getByLabel("Bank name", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Retry same request" }).click();
  await expect(page.getByRole("article", { name: "Harbor External Bank ending 8765" })).toContainText("Awaiting review");
  expect(calls).toBe(2);
  const ownerHeaders = { authorization: `Bearer ${session.token}` };
  const before = (await (await request.get("/api/me/funding", { headers: ownerHeaders })).json()).methods;
  expect(before.some((method: {label: string}) => method.label.includes("Harbor External Bank"))).toBe(false);
  await page.screenshot({ path: info.outputPath("reference-pending-mobile.png"), fullPage: true });
  const admin = (await (await request.post("/api/auth/login", { data: { email: "admin@veyra.dev", password: "veyra-admin-2026" } })).json()).token;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  try {
    const staff = await context.newPage(); await staff.addInitScript(token => localStorage.setItem("veyra.token", token),admin);
    await staff.goto("/#/app/superadmin");
    await staff.getByRole("combobox", { name: "Open admin module" }).selectOption("customers");
    await staff.locator("tr").filter({ hasText: "demo.business@veyra.dev" }).getByRole("button", { name: "Funding", exact: true }).click();
    const review = staff.getByRole("region", { name: "External account reference reviews" });
    await review.getByRole("button", { name: "Review account reference" }).click();
    await review.getByLabel("Ownership review note").fill("Independently checked owner evidence. Reference REVIEW-209.");
    await expect(review.getByRole("button", { name: "Save reference review" })).toBeDisabled();
    await review.getByRole("checkbox").check(); await fits(staff);
    await review.getByRole("button", { name: "Save reference review" }).click();
    await expect(review).toContainText("Staff-approved reference");
    await expect(review.getByRole("button", { name: "Review account reference" })).toHaveCount(0);
  } finally { await context.close(); }
  await page.getByRole("button", { name: "Refresh account status" }).click();
  await expect(page.getByRole("article", { name: "Harbor External Bank ending 8765" })).toContainText("Staff-approved reference");
  await page.getByRole("button", { name: "Continue to Add funds" }).click();
  const funding = page.getByRole("dialog", { name: "Add funds", exact: true });
  await funding.getByLabel("Funding method", { exact: true }).selectOption({ label: "Harbor External Bank Checking •••• 8765 · Account reference" });
  await funding.getByLabel("Amount (USD)", { exact: true }).fill("25");
  await expect(funding.getByRole("button", { name: "Review deposit" })).toBeEnabled();
  await expect(funding).toContainText("External bank and card processing is not connected"); await fits(page);
  await funding.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("from/to rows stay aligned and readable across selection, review and mobile sizes", async ({ page, request }, info) => {
  await login(page, request);
  await page.locator(".cw-action-bar").getByRole("button", { name: /^Buy/ }).click();
  const dialog = page.getByRole("dialog", { name: "Buy crypto", exact: true });
  await expect(dialog.getByLabel("From", { exact: true })).toHaveValue("Veyra checking");
  await expect(dialog.getByLabel("From", { exact: true })).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await dialog.getByLabel("To", { exact: true }).selectOption("ICP");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await fits(page);
    const marks = dialog.locator(".cw-route-mark"), rows = dialog.locator(".cw-route-field");
    const a = await marks.first().boundingBox(), b = await marks.last().boundingBox();
    expect(Math.abs(a!.x - b!.x)).toBeLessThanOrEqual(1);
    const first = await rows.first().boundingBox(), second = await rows.last().boundingBox();
    expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height);
    expect(await dialog.locator(".cw-route").evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await dialog.getByLabel("To", { exact: true }).selectOption("ETH");
  await dialog.getByLabel("Amount to spend (USD)").fill("25");
  await dialog.screenshot({ path: info.outputPath("from-to-selection-mobile.png") });
  await dialog.getByRole("checkbox").check(); await dialog.getByRole("button", { name: "Review order" }).click();
  await expect(dialog.locator(".cw-route-quantity").last()).toHaveText(/0\.\d{15,18} ETH/);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await fits(page);
    for (const button of await dialog.locator(".modal-actions button").all()) expect((await button.boundingBox())!.height).toBeLessThanOrEqual(64);
    const amount = dialog.locator(".cw-route-quantity").last();
    expect(await amount.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await dialog.screenshot({ path: info.outputPath("from-to-review-mobile.png") });
  await dialog.getByRole("button", { name: "Edit / refresh quote" }).click();
  await expect(dialog.getByLabel("To", { exact: true })).toHaveValue("ETH");
  await expect(dialog.getByLabel("Amount to spend (USD)")).toHaveValue("25");
});
