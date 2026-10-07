import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { applicationFor } from "../../server/scripts/fixtures";
import { quoteFee } from "../../shared/fees";

type Actor = "personal" | "business" | "admin";
const credentials = (actor: Actor) => ({
  email: actor === "admin" ? "admin@veyra.dev" : `demo.${actor}@veyra.dev`,
  password: actor === "admin" ? "veyra-admin-2026" : "veyra-demo-2026",
});
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on("pageerror", error => list.push(error.message));
});
test.afterEach(({ page }) => { expect(errors.get(page) || [], "Unhandled browser errors").toEqual([]); });

async function login(page: Page, actor: Actor, override?: { email: string; password: string }) {
  await page.goto("/#/login");
  const user = override || credentials(actor);
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  const response = page.waitForResponse(r => r.url().endsWith("/api/auth/login") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const res = await response;
  expect(res.status()).toBe(200);
  const session = await res.json();
  await expect(page).toHaveURL(actor === "admin" ? /#\/app\/superadmin$/ : /#\/app$/);
  await expect(page.locator("h1").first()).toBeVisible();
  return session as { token: string; user: { id: string; role: string } };
}
async function account(request: APIRequestContext, token: string) {
  const res = await request.get("/api/me/state", { headers: { authorization: `Bearer ${token}` } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).account;
}
const cash = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth),
    { message: "The page must fit its viewport without horizontal body scrolling" }).toBeLessThanOrEqual(2);
}
async function authenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
}

const memberRoutes = [
  ["accounts", "Accounts & savings"], ["cards", "Cards"], ["transactions", "Transactions"],
  ["transfers", "Transfers"], ["bills", "Bills & scheduled payments"], ["scout", "Scout AI"],
  ["assets", "Crypto, on your terms."], ["markets", "Markets"], ["rewards", "Rewards"], ["perks", "Perks"],
  ["statements", "Official Statements & Reports"], ["disputes", "Disputes & Fraud Resolution"],
  ["kyc", "Identity verification"], ["security", "Security center"],
  ["support-desk", "Support & messages"], ["settings", "Settings"],
];

test("built app, API, and asset files work from one origin", async ({ request }) => {
  const home = await request.get("/");
  expect(home.status()).toBe(200);
  expect((await request.head("/")).status()).toBe(200);
  expect(home.headers()["content-type"]).toContain("text/html");
  expect(await home.text()).toContain('id="root"');
  const health = await request.get("/api/health");
  expect((await health.json()).ok).toBe(true);
  expect(health.headers()["cache-control"]).toContain("no-store");
  for (const file of ["avatar-3d-default.svg", "icon-btc-3d.webp", "icon-passkey-3d.webp", "auth-signin.jpg"]) {
    expect((await request.get(`/images/${file}`)).status()).toBe(200);
  }
  const missing = await request.get("/api/not-a-route");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-type"]).toContain("application/json");
});

test("public marketing, legal, and auth pages render without runtime errors", async ({ page }) => {
  for (const path of ["", "platform", "personal", "business-account", "cards", "rewards", "payments",
    "invoicing", "integrations", "analytics", "ai-cfo", "scout", "pricing", "security", "support",
    "help-center", "concierge", "perks", "email-templates", "contact", "about", "careers",
    "legal/privacy", "legal/terms", "legal/disclosures", "login", "signup", "forgot-password"]) {
    await test.step(path || "home", async () => {
      await page.goto(`/#/${path}`);
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.locator("h1").first()).not.toContainText(/not found/i);
    });
  }
});

for (const actor of ["personal", "business"] as const) {
  if (actor === "personal") {
    test("personal overview sends Manage assets to the Crypto workspace", async ({ page }) => {
      await login(page, actor);
      await page.getByRole("link", { name: "Manage assets", exact: true }).click();
      await expect(page).toHaveURL(/#\/app\/assets$/);
      await expect(page.getByRole("heading", { name: "Crypto, on your terms.", exact: true })).toBeVisible();
    });
  }

  for (const width of [1440, 768, 390]) {
    test(`${actor} navigation works at ${width}px, including the merged features`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await login(page, actor);
      const routes = actor === "business"
        ? [...memberRoutes, ["invoices", "Invoicing"], ["team", "Team"], ["plan", "Operate with a clear cash runway."]]
        : [...memberRoutes, ["plan", "Know what you can safely use."]];
      for (const [path, heading] of routes) {
        await test.step(path, async () => {
          await page.goto(`/#/app/${path}`);
          await expect(page).toHaveURL(new RegExp(`#/app/${path}$`));
          await expect(page.locator("h1").first()).toHaveText(heading);
          if (path === "accounts") {
            await expect(page.getByRole("heading", { name: "Recent pocket activity", exact: true })).toBeVisible();
            await expect(page.locator(".cw-asset-row")).toHaveCount(0);
          }
          if (path === "assets") {
            await expect(page.getByRole("heading", { name: "Your asset directory", exact: true })).toBeVisible();
            await expect(page.locator(".cw-asset-row")).toHaveCount(24);
            await expect(page.locator(".app-nav a[href=\"#/app/assets\"]")).toHaveCount(1);
          }
          if (path === "security") await expect(page.getByRole("heading", { name: "Passkeys", exact: true })).toBeVisible();
          await noOverflow(page);
        });
      }
    });
  }

  test(`${actor} markets search, filters, deep links, and responsive candlesticks work`, async ({ page }) => {
    await login(page, actor);
    await page.getByRole("link", { name: "Markets", exact: true }).click();
    await expect(page.locator("h1")).toHaveText("Markets");
    await expect(page.locator(".market-table tbody > tr")).toHaveCount(5);
    await page.getByRole("button", { name: "Tradeable on Veyra", exact: true }).click();
    await expect(page.locator(".market-table tbody > tr")).toHaveCount(5);
    await page.getByRole("button", { name: "Tradeable on Veyra", exact: true }).click();
    await page.getByRole("textbox", { name: "Search markets" }).fill("USDT");
    await expect(page.locator(".market-table tbody > tr")).toHaveCount(1);
    await page.getByRole("button", { name: "Chart", exact: true }).click();
    await expect(page.getByRole("link", { name: "Buy USDT", exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Search markets" }).fill("");
    await page.goto("/#/app/markets?asset=BTC");
    await expect(page.getByRole("img", { name: /Bitcoin price history/ })).toBeVisible();
    for (const range of ["7D", "30D", "90D", "24H"]) {
      await page.getByRole("group", { name: "Chart range" }).getByRole("button", { name: range, exact: true }).click();
      await expect(page.getByRole("img", { name: /Bitcoin price history/ })).toBeVisible();
    }
    await page.reload();
    await expect(page.getByRole("img", { name: /Bitcoin price history/ })).toBeVisible();
    for (const width of [768, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(page);
      const box = await page.locator(".candle-svg").boundingBox();
      expect(box?.width).toBeGreaterThan(200);
      expect(box?.width).toBeLessThanOrEqual(width);
    }
  });

  test(`${actor} cash plans persist and immediate removal resolves the server ID`, async ({ page, request }) => {
    const { token } = await login(page, actor);
    await page.locator('.app-nav a[href="#/app/plan"]').click();
    await expect(page).toHaveURL(/#\/app\/plan$/);
    const savedName = `Persistent ${actor} plan`;
    const form = async (name: string) => {
      await page.getByRole("button", { name: "Add plan", exact: true }).click();
      await page.getByLabel("Plan name", { exact: true }).fill(name);
      await page.getByLabel("Monthly limit", { exact: true }).fill("400");
      await page.getByRole("button", { name: "Save plan", exact: true }).click();
    };
    await form(savedName);
    await expect.poll(async () => (await account(request, token)).budgets.some((b: { name: string }) => b.name === savedName)).toBe(true);
    await page.reload();
    await expect(page.locator(".money-plan-budget").filter({ hasText: savedName })).toBeVisible();

    // Hold a successful create response so removal happens while the UI still
    // holds its optimistic ID. Releasing it must make DELETE use the server ID.
    const fastName = `Immediate ${actor} plan`;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let created!: (id: string) => void;
    const savedId = new Promise<string>(resolve => { created = resolve; });
    await page.route("**/api/me/budgets", async route => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      created((await response.json()).budget.id);
      await gate;
      await route.fulfill({ response });
    });
    try {
      await form(fastName);
      const id = await savedId;
      const removed = page.waitForResponse(r => r.request().method() === "DELETE" && r.url().endsWith(`/api/me/budgets/${id}`));
      await page.getByRole("button", { name: `Remove ${fastName}`, exact: true }).click();
      release();
      expect((await removed).status()).toBe(200);
      await expect.poll(async () => (await account(request, token)).budgets.some((b: { name: string }) => b.name === fastName)).toBe(false);
      await page.reload();
      await expect(page.locator(".money-plan-budget").filter({ hasText: fastName })).toHaveCount(0);
      await expect(page.locator(".money-plan-budget").filter({ hasText: savedName })).toBeVisible();
    } finally { release(); }
  });

  test(`${actor} crypto trades reconcile checking, holdings, and persisted transactions`, async ({ page, request }) => {
    const { token } = await login(page, actor);
    await page.goto("/#/app/accounts");
    await expect(page.getByRole("heading", { name: "Recent pocket activity", exact: true })).toBeVisible();
    await expect(page.locator(".cw-asset-row")).toHaveCount(0);

    await page.goto("/#/app/assets");
    const usdc = page.getByRole("article", { name: "USD Coin account holding" });
    await expect(usdc).toBeVisible();
    const before = await account(request, token);
    await usdc.getByRole("button", { name: "Buy", exact: true }).click();
    const buy = page.getByRole("dialog", { name: "Buy crypto", exact: true });
    await buy.getByLabel("Amount to spend (USD)", { exact: true }).fill("25.50");
    await buy.getByRole("checkbox").check();
    await buy.getByRole("button", { name: "Review order" }).click();
    await buy.getByRole("button", { name: "Confirm buy" }).click();
    await buy.getByRole("button", { name: "Done" }).click();
    await expect(buy).toBeHidden();
    await expect(usdc).toContainText("25.5 USDC");

    await page.goto("/#/app/accounts");
    // Confirm the persisted checking balance without showing holdings here.
    const buyFee = quoteFee("crypto_buy", 2550).feeCents / 100;
    await expect(page.locator(".checking-account-card .account-big-money")).toHaveText(cash(before.balance - 25.50 - buyFee));
    await expect(page.locator(".cw-asset-row")).toHaveCount(0);
    await expect.poll(async () => (await account(request, token)).balance).toBeCloseTo(before.balance - 25.50 - buyFee, 2);

    await page.goto("/#/app/assets");
    const heldUsdc = page.getByRole("article", { name: "USD Coin account holding" });
    await expect(heldUsdc).toContainText("25.5 USDC");
    await heldUsdc.getByRole("button", { name: "Sell", exact: true }).click();
    const sell = page.getByRole("dialog", { name: "Sell crypto", exact: true });
    await sell.getByLabel("From", { exact: true }).selectOption("USDC");
    await sell.getByRole("button", { name: "Use available amount", exact: true }).click();
    await sell.getByRole("checkbox").check();
    await sell.getByRole("button", { name: "Review order" }).click();
    await sell.getByRole("button", { name: "Confirm sell" }).click();
    await sell.getByRole("button", { name: "Done" }).click();
    await expect(sell).toBeHidden();
    await expect(heldUsdc.getByRole("button", { name: "Buy", exact: true })).toBeEnabled();
    await page.goto("/#/app/accounts");
    const sellFee = quoteFee("crypto_sell", 2550).feeCents / 100;
    await expect(page.locator(".checking-account-card .account-big-money")).toHaveText(cash(before.balance - buyFee - sellFee));
    await expect(page.locator(".cw-asset-row")).toHaveCount(0);
    await expect.poll(async () => (await account(request, token)).balance).toBeCloseTo(before.balance - buyFee - sellFee, 2);
    await page.goto("/#/app/transactions");
    await expect(page.getByText(/USDC/).first()).toBeVisible();
  });

  test(`${actor} enrolls a real browser passkey, signs in, and removes it`, async ({ page }) => {
    await authenticator(page);
    await login(page, actor);
    await page.goto("/#/app/security");
    await page.getByRole("button", { name: "Add passkey", exact: true }).click();
    const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Passkeys", exact: true }) });
    await expect(panel.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
    await page.reload();
    await expect(panel.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
    await page.locator(".app-nav").getByRole("button", { name: "Sign out", exact: true }).click();
    await page.goto("/#/login");
    await page.getByRole("button", { name: /passkey/i }).click();
    await expect(page).toHaveURL(/#\/app$/);
    await page.goto("/#/app/security");
    await panel.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Remove", exact: true })).toBeHidden();
    await expect(panel).toContainText("No passkeys yet");
  });

  test(`${actor} statements export real CSV and PDF files`, async ({ page }) => {
    await login(page, actor);
    await page.goto("/#/app/statements");
    const csvEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Full Ledger (CSV)", exact: true }).click();
    const csv = await csvEvent;
    expect(csv.suggestedFilename()).toMatch(/\.csv$/);
    const csvBody = await readFile((await csv.path())!, "utf8");
    expect(csvBody.length).toBeGreaterThan(100);
    expect(csvBody).toContain(actor === "personal" ? "Whole Foods" : "Northwind");
    const pdfEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download Statement PDF", exact: true }).click();
    const pdf = await pdfEvent;
    expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
    const bytes = await readFile((await pdf.path())!);
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(bytes.length).toBeGreaterThan(1000);
  });

  test(`${actor} signup and admin approval connect to the real member dashboard`, async ({ page, browser, request }) => {
    const name = actor === "personal" ? "Jordan Personal" : "Jordan Business";
    const email = `qa.${actor}@veyra.test`;
    await page.goto(`/#/signup?type=${actor}`);
    // The built SPA can dispatch `load` just before React mounts; wait for the
    // application form instead of silently skipping fields on an early count.
    await page.locator("#su-firstName").waitFor({ state: "visible" });
    for (const [key, value] of Object.entries(applicationFor(actor, name, "QA Studio LLC"))) {
      const input = page.locator(`#su-${key}`);
      if (await input.count()) {
        if (await input.evaluate(el => el.tagName === "SELECT")) await input.selectOption(String(value));
        else await input.fill(String(value));
      }
    }
    await page.locator("#su-email").fill(email);
    await page.locator("#su-pw").fill("Browser-QA-2026!");
    await page.getByRole("checkbox").check();
    const registered = page.waitForResponse(r => r.url().endsWith("/api/auth/register") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    const response = await registered;
    expect(response.status()).toBe(201);
    const session = await response.json();
    await expect(page).toHaveURL(/#\/application$/);
    await page.goto("/#/app");
    await expect(page).toHaveURL(/#\/application$/);
    const blocked = await request.post("/api/me/deposits", { headers: { authorization: `Bearer ${session.token}` }, data: { amount: 1, source: "QA" } });
    expect(blocked.status()).toBe(403);
    const adminContext = await browser.newContext({ baseURL: test.info().project.use.baseURL, reducedMotion: "reduce" });
    try {
      const adminPage = await adminContext.newPage();
      adminPage.on("pageerror", error => errors.get(page)?.push(error.message));
      await login(adminPage, "admin");
      await adminPage.getByRole("tab", { name: /^KYC/ }).click();
      const row = adminPage.locator("tr").filter({ hasText: email });
      await row.getByRole("button", { name: "Review", exact: true }).click();
      const decision = adminPage.waitForResponse(r => r.url().endsWith(`/api/admin/kyc/${session.user.id}/decision`));
      await adminPage.getByRole("button", { name: "Approve verification", exact: true }).click();
      expect((await decision).status()).toBe(200);
    } finally { await adminContext.close().catch(() => undefined); }
    // Complete the handoff in the same tab, without a reload or second login.
    await page.getByRole("button", { name: "Check for updates", exact: true }).click();
    await expect(page).toHaveURL(/#\/app$/);
    await expect(page.locator("h1").first()).toBeVisible();
    expect((await account(request, session.token)).kyc.review.state).toBe("approved");
  });
}

test("business invoices persist and can be paid using their server-issued IDs", async ({ page, request }) => {
  const { token } = await login(page, "business");
  await page.goto("/#/app/invoices");
  await page.locator("#inv-client").fill("Browser QA Client");
  await page.locator("#inv-email").fill("billing@veyra.test");
  await page.locator("#inv-amount").fill("125.75");
  await page.getByRole("button", { name: "Send invoice", exact: true }).click();
  const row = page.locator(".inv-row").filter({ hasText: "Browser QA Client" });
  await row.getByRole("button", { name: "Mark paid", exact: true }).click();
  await expect.poll(async () => (await account(request, token)).invoices.find((i: { client: string }) => i.client === "Browser QA Client")?.status).toBe("paid");
  await page.reload();
  await expect(row).toContainText(/paid/i);
});

test("staff passkey sign-in returns to the real admin console", async ({ page, request }) => {
  await authenticator(page);
  const original = await login(page, "admin");
  const headers = { authorization: `Bearer ${original.token}` };
  const challenge = await request.post("/api/me/passkeys/challenge", { headers });
  expect(challenge.status()).toBe(200);
  // Staff have no member Security page. Enroll through the real management API
  // with a browser credential, then exercise the shared public sign-in UI.
  const payload = await page.evaluate(async options => {
    const credential = await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options) }) as PublicKeyCredential;
    const response = credential.toJSON().response as { clientDataJSON: string; attestationObject: string; transports?: string[] };
    return { ...response, label: "Browser QA staff key" };
  }, await challenge.json());
  const enrolled = await request.post("/api/me/passkeys", { headers, data: payload });
  expect(enrolled.status()).toBe(201);
  const id = (await enrolled.json()).passkey.id;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto("/#/login");
  const signedIn = page.waitForResponse(r => r.url().endsWith("/api/auth/passkey/login") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Use passkey", exact: true }).click();
  const response = await signedIn;
  expect(response.status()).toBe(200);
  const session = await response.json();
  expect(session.user.role).toBe(original.user.role);
  await expect(page).toHaveURL(/#\/app\/superadmin$/);
  await expect(page.locator("h1").first()).toBeVisible();
  const removed = await request.delete(`/api/me/passkeys/${id}`, { headers: { authorization: `Bearer ${session.token}` } });
  expect(removed.status()).toBe(200);
});

test("all admin modules render and authenticated CSV export succeeds", async ({ page }) => {
  await login(page, "admin");
  for (const name of ["Dashboard", "Operations", "Customers", "Accounts", "Transactions", "KYC", "Risk & Fraud",
    "Staff", "Roles & Permissions", "Reports", "Notifications", "Audit Logs", "Banking Settings", "Admin Profile"]) {
    await test.step(name, async () => {
      await page.getByRole("tab", { name: new RegExp(`^${name}(?:\\s|$)`) }).click();
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.getByText("We couldn't load", { exact: false })).toBeHidden();
      if (name === "KYC") {
        // Old applications can legitimately lack a `documents` key. Opening
        // one used to throw in the admin UI and prevent the whole module from
        // rendering; review and approve that fixture through the real API.
        const legacy = page.locator("tr").filter({ hasText: "legacy@veyra.test" });
        await expect(legacy).toBeVisible();
        await legacy.getByRole("button", { name: "Review", exact: true }).click();
        const review = page.locator(".modal").filter({ hasText: "Verification review: Legacy Applicant" });
        await expect(review).toBeVisible();
        await expect(review).toContainText("Legacy Applicant");
        await expect(review).not.toContainText("Submitted documents");
        const decision = page.waitForResponse(r => r.url().includes("/api/admin/kyc/") && r.url().endsWith("/decision"));
        await review.getByRole("button", { name: "Approve verification", exact: true }).click();
        expect((await decision).status()).toBe(200);
      }
    });
  }
  await page.getByRole("tab", { name: /^Transactions(?:\s|$)/ }).click();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const download = await event;
  const content = await readFile((await download.path())!, "utf8");
  expect(content.length).toBeGreaterThan(100);
  expect(content).toContain("Maya");
  expect(content).not.toContain("Authentication required");
});

test("a revoked session returns to sign-in instead of an account error screen", async ({ page, request }) => {
  const { token } = await login(page, "personal");
  const logout = await request.post("/api/auth/logout", { headers: { authorization: `Bearer ${token}` } });
  expect(logout.status()).toBe(200);
  await page.reload();
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByText("We couldn't load your account", { exact: false })).toBeHidden();
});

test("sign-in survives a reload when browser storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    for (const storage of ["localStorage", "sessionStorage"]) {
      Object.defineProperty(window, storage, { configurable: true, get() { throw new DOMException("Storage blocked", "SecurityError"); } });
    }
  });
  await login(page, "personal");
  await page.reload();
  await expect(page).toHaveURL(/#\/app$/);
  await expect(page.locator("h1").first()).toContainText("Maya");
});

test("missing history and unavailable markets are shown honestly and recover", async ({ page }) => {
  await login(page, "personal");
  await page.route("**/api/me/holdings/BTC/candles?*", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"No history","code":"crypto_no_history"}' }));
  await page.goto("/#/app/markets?asset=BTC");
  await expect(page.getByText("No price history available for BTC right now.")).toBeVisible();
  await expect(page.locator(".candle-svg")).toBeHidden();
  await page.unroute("**/api/me/holdings/BTC/candles?*");
  await page.route("**/api/me/markets", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Feed unavailable"}' }));
  await page.reload();
  await expect(page.getByText("Market data is unavailable right now.", { exact: false })).toBeVisible();
  await page.unroute("**/api/me/markets");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.locator(".market-table tbody > tr")).toHaveCount(6); // five quotes plus the open BTC chart
  await expect(page.getByText("Market data is unavailable right now.", { exact: false })).toBeHidden();
});

test("support is a real conversation: member → staff Operations queue → member, plus the public form", async ({ page, browser }) => {
  const subject = `E2E support ${Date.now()}`;
  await login(page, "personal");
  await page.goto("/#/app/support-desk");
  await expect(page.locator("h1").first()).toHaveText("Support & messages");
  await page.getByRole("button", { name: "New support case" }).click();
  await page.getByLabel("Subject").fill(subject);
  await page.getByLabel("Message").fill("My card was declined at a merchant.");
  const created = page.waitForResponse(r => r.url().endsWith("/api/me/support") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Open case" }).click();
  expect((await created).status()).toBe(201);
  await expect(page.locator(".conversation-header h3")).toHaveText(subject);

  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await login(staff, "admin");
  await staff.getByRole("tab", { name: /^Operations(?:\s|$)/ }).click();
  await staff.getByText(subject).first().click();
  await staff.getByLabel(/Reply to customer/).fill("We've reviewed it — please try the card again.");
  const replied = staff.waitForResponse(r => r.url().endsWith("/reply"));
  await staff.getByRole("button", { name: "Send reply", exact: true }).click();
  expect((await replied).status()).toBe(201);
  await staffContext.close();

  await page.getByRole("button", { name: "Refresh conversations" }).click();
  await expect(page.locator(".support-msg-bubble-wrap.specialist")).toContainText("please try the card again");

  const visitor = await browser.newPage();
  await visitor.goto("/#/support");
  await visitor.getByLabel("Name", { exact: true }).fill("Website Visitor");
  await visitor.getByLabel("Email", { exact: true }).fill("visitor@example.com");
  await visitor.getByLabel("How can we help?").fill("How long do wires take?");
  await visitor.getByRole("button", { name: "Send message" }).click();
  await expect(visitor.locator(".form-success")).toContainText(/reference is VS-[0-9A-F]{8}/);
  await visitor.close();
});

test("team invite: owner invites from Team, invitee accepts and lands in the shared business", async ({ page, browser }) => {
  await login(page, "business");
  await page.goto("/#/app/team");
  await page.getByRole("button", { name: "Invite member" }).click();
  const email = `teammate.${Date.now()}@veyra.test`;
  await page.locator("#tm-name").fill("Tess Mate");
  await page.locator("#tm-email").fill(email);
  await page.locator("#tm-role").selectOption("Member");
  const sent = page.waitForResponse(r => r.url().endsWith("/api/me/team") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Send invite" }).click();
  const res = await sent;
  expect(res.status()).toBe(201);
  const { inviteUrl } = await res.json() as { inviteUrl: string };
  expect(inviteUrl).toMatch(/^\/#\/invite\/accept\?token=[a-f0-9]+$/);
  await expect(page.getByRole("button", { name: "Copy invite link for Tess Mate" })).toBeVisible();

  const ctx = await browser.newContext();
  const guest = await ctx.newPage();
  await guest.goto(inviteUrl);
  await expect(guest.getByRole("heading", { name: /^Join .+ on Veyra$/ })).toBeVisible();
  await expect(guest.locator(".invite-summary")).toContainText(email);
  await guest.locator("#inv-pass").fill("teammate-pass-1");
  await guest.getByRole("button", { name: "Accept invitation" }).click();
  await expect(guest).toHaveURL(/#\/app$/);
  await expect(guest.locator("h1").first()).toBeVisible();
  await guest.goto("/#/app/team");
  await expect(guest.locator(".team-row").filter({ hasText: email })).toContainText(/active/i);
  // A Member can't manage the team.
  await expect(guest.getByRole("button", { name: "Invite member" })).toHaveCount(0);
  await ctx.close();
});
