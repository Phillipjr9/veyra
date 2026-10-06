import { expect, test, type Page } from "@playwright/test";
import { buildCashFlow } from "../../src/lib/dashboardAnalytics";
import type { Txn } from "../../src/lib/store";

type Actor = "personal" | "business" | "admin";
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = []; browserErrors.set(page, errors);
  page.on("pageerror", error => errors.push(error.message));
});
test.afterEach(({ page }) => expect(browserErrors.get(page)).toEqual([]));

async function signIn(page: Page, actor: Actor) {
  await page.goto("/#/login");
  await page.getByLabel("Email", { exact: true }).fill(actor === "admin" ? "admin@veyra.dev" : `demo.${actor}@veyra.dev`);
  await page.getByLabel("Password", { exact: true }).fill(actor === "admin" ? "veyra-admin-2026" : "veyra-demo-2026");
  const response = page.waitForResponse(r => r.url().endsWith("/api/auth/login") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const result = await (await response).json();
  await expect(page).toHaveURL(actor === "admin" ? /#\/app\/superadmin$/ : /#\/app$/);
  await expect(page.locator(".dx-flow")).toBeVisible();
  return result.token as string;
}
async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1).catch(async error => {
    console.log("Overflow diagnostics", await page.evaluate(() => ({ viewport: innerWidth, body: document.body.scrollWidth, doc: document.documentElement.scrollWidth, nodes: [...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 20).map(el => ({ class: el.className, tag: el.tagName, parent: el.parentElement?.className, text: el.textContent?.slice(0, 80), right: el.getBoundingClientRect().right })) })));
    throw error;
  });
  const violations = await page.evaluate(() => {
    const selectors = ".stat,.dx-shortcuts>a,.business-cash-card,.business-metric-card,.admin-kpi-card,.dx-flow,.dx-module-picker,.panel";
    return [...document.querySelectorAll(selectors)].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width && getComputedStyle(el).visibility !== "hidden" && (r.left < -1 || r.right > innerWidth + 1);
    }).map(el => el.className);
  });
  expect(violations, "Panels must fit the viewport, not merely be hidden by clipping").toEqual([]);
}
async function noSiblingOverlap(page: Page, selector: string) {
  const overlaps = await page.locator(selector).evaluateAll(groups => groups.flatMap(group => {
    const children = [...group.children].filter(el => el.getBoundingClientRect().width > 0);
    return children.flatMap((a, index) => children.slice(index + 1).flatMap(b => {
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      const x = Math.min(ar.right, br.right) - Math.max(ar.left, br.left);
      const y = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top);
      return x > 1 && y > 1 ? [`${a.className} overlaps ${b.className}`] : [];
    }));
  }));
  expect(overlaps).toEqual([]);
}

for (const actor of ["personal", "business", "admin"] as const) {
  test(`${actor} overview fits phones, tablets and desktops without overlapping panels`, async ({ page }) => {
    await signIn(page, actor);
    for (const width of [1440, 1200, 1101, 1100, 1024, 768, 600, 390, 360, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await fits(page);
      await noSiblingOverlap(page, ".stat-row,.dx-shortcuts,.admin-kpi-grid,.business-metric-grid,.dx-flow-stats,.app-topbar,.admin-topbar");
      const escapedNumbers = await page.locator(".stat-value,.kpi-val,.business-cash-value").evaluateAll(elements => elements.filter(el => {
        const range = document.createRange(); range.selectNodeContents(el);
        const r = range.getBoundingClientRect(); const card = el.closest(".stat,.admin-kpi-card,.business-cash-card")!.getBoundingClientRect();
        return r.right > card.right || r.left < card.left;
      }).map(el => el.textContent));
      expect(escapedNumbers, "Currency labels must stay inside their cards").toEqual([]);
      if (actor === "personal") {
        const positions = await page.locator(".stat-balance").evaluate(el => ({
          metadata: el.querySelector(".stat-meta")!.getBoundingClientRect().bottom,
          chart: el.querySelector(".stat-spark")!.getBoundingClientRect().top,
        }));
        expect(positions.chart).toBeGreaterThanOrEqual(positions.metadata);
      }
    }
  });

  test(`${actor} cash explorer uses the real ledger and changes period and presentation`, async ({ page, request }) => {
    const token = await signIn(page, actor);
    const response = await request.get(actor === "admin" ? "/api/admin/state" : "/api/me/state", { headers: { authorization: `Bearer ${token}` } });
    const snapshot = await response.json();
    const transactions: Txn[] = actor === "admin" ? snapshot.transactions : snapshot.account.transactions;
    const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
    for (const days of [7, 90, 30] as const) {
      await page.getByRole("group", { name: "Cash flow period" }).getByRole("button", { name: `${days}D`, exact: true }).click();
      const totals = buildCashFlow(transactions, days);
      await expect(page.locator('[data-flow="in"]')).toHaveText(usd(totals.inflow));
      await expect(page.locator('[data-flow="out"]')).toHaveText(usd(totals.outflow));
      await expect(page.locator('[data-flow="net"]')).toHaveText(`${totals.net > 0 ? "+" : ""}${usd(totals.net)}`);
    }
    await page.getByRole("button", { name: "Bar chart", exact: true }).click();
    await expect(page.getByRole("button", { name: "Bar chart", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Area chart", exact: true }).click();
    await page.locator(".dx-flow-data summary").click();
    await expect(page.getByRole("region", { name: "Cash flow data table" })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 844 });
    await fits(page);
  });
}

for (const actor of ["personal", "business"] as const) {
  test(`${actor} mobile navigation, notifications and add-funds dialog remain usable`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await signIn(page, actor);
    const menu = page.getByRole("button", { name: "Open menu", exact: true });
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(await page.evaluate(() => document.body.style.position)).toBe("fixed");
    const aside = page.locator(".app-nav");
    const bounds = await aside.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.width).toBeLessThanOrEqual(320);
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await expect(aside).toBeHidden();
    expect(await page.evaluate(() => document.body.style.position)).not.toBe("fixed");
    await menu.click();
    await aside.getByRole("link", { name: "Cards", exact: true }).click();
    await expect(aside).toBeHidden();
    await expect(page).toHaveURL(/#\/app\/cards$/);
    await fits(page);
    await page.goto("/#/app");
    await page.getByRole("button", { name: "Add funds", exact: true }).filter({ visible: true }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const modal = await dialog.boundingBox();
    expect(modal!.x).toBeGreaterThanOrEqual(0);
    expect(modal!.x + modal!.width).toBeLessThanOrEqual(320);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    const notifications = page.getByRole("button", { name: /notifications/i }).first();
    await notifications.click();
    const popup = await page.locator(".notif-panel").boundingBox();
    expect(popup!.x).toBeGreaterThanOrEqual(0);
    expect(popup!.x + popup!.width).toBeLessThanOrEqual(320);
    await page.keyboard.press("Escape");
  });

  test(`${actor} banking pages have no horizontal body overflow at 320px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 320, height: 844 });
    await signIn(page, actor);
    const routes = ["accounts", "cards", "transactions", "transfers", "bills", "markets", "plan", "scout", "rewards", "perks", "statements", "disputes", "kyc", "security", "settings", "support-desk", ...(actor === "business" ? ["invoices", "team"] : [])];
    for (const route of routes) {
      await test.step(route, async () => {
        await page.goto(`/#/app/${route}`);
        await expect(page.locator("h1").first()).toBeVisible();
        await fits(page);
      });
    }
  });
}

test("every admin module is reachable from the mobile selector without overflow", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 320, height: 844 });
  await signIn(page, "admin");
  const picker = page.getByRole("combobox", { name: "Open admin module" });
  const options = await picker.locator("option").evaluateAll(items => items.map(item => (item as HTMLOptionElement).value));
  expect(options.length).toBe(14);
  for (const value of options) {
    await test.step(value, async () => {
      await picker.selectOption(value);
      await expect(picker).toHaveValue(value);
      await expect(page.locator(".admin-tab-pane")).toBeVisible();
      await fits(page);
    });
  }
});

test("empty and pending-only ledgers never show manufactured activity", async ({ page }) => {
  let pendingOnly = false;
  await page.route("**/api/me/state", async route => {
    const response = await route.fetch();
    const body = await response.json();
    const template = body.account.transactions[0];
    body.account.transactions = pendingOnly ? [{ ...template, date: Date.now(), amount: 500, status: "pending" }] : [];
    await route.fulfill({ response, json: body });
  });
  await signIn(page, "personal");
  await expect(page.getByText("No cleared activity in this period")).toBeVisible();
  await expect(page.locator('[data-flow="in"]')).toHaveText("$0.00");
  pendingOnly = true;
  await page.reload();
  await expect(page.getByText("No cleared activity in this period")).toBeVisible();
  await expect(page.locator(".dx-flow-foot")).toContainText("0 movements · 1 pending excluded");
  await expect(page.locator('[data-flow="net"]')).toHaveText("$0.00");
});

test("personal shortcuts navigate to real savings, markets, planning and security screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "personal");
  for (const route of ["accounts", "markets", "plan", "security"]) {
    await page.locator(`.dx-shortcuts a[href$="/app/${route}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#/app/${route}$`));
    await expect(page.locator("h1").first()).toBeVisible();
    await page.goto("/#/app");
    await expect(page.locator(".dx-flow")).toBeVisible();
  }
});

test("larger personal balances and cash totals stay readable on narrow phones", async ({ page }) => {
  await page.route("**/api/me/state", async route => {
    const response = await route.fetch(); const body = await response.json();
    body.account.balance = 1_250_000.25;
    body.account.rewards = 123_456.78;
    body.account.transactions = [{ ...body.account.transactions[0], amount: 1_250_000.25, date: Date.now(), status: "cleared" }];
    await route.fulfill({ response, json: body });
  });
  await signIn(page, "personal");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await fits(page);
    await noSiblingOverlap(page, ".app-topbar,.stat-row,.dx-flow-stats > div");
    const clipped = await page.locator(".stat-value,.dx-flow-stats strong").evaluateAll(elements => elements.filter(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      const text = range.getBoundingClientRect(), box = el.getBoundingClientRect();
      return text.right > box.right + 1 || text.left < box.left - 1 || text.height > box.height + 1;
    }).map(el => el.textContent));
    expect(clipped).toEqual([]);
    await expect(page.locator(".stat-balance .stat-value")).toHaveText("$1,250,000.25");
    await expect(page.locator('[data-flow="in"]')).toHaveText("$1,250,000.25");
  }
});

test("admin total balances use the full mobile row instead of splitting currency digits", async ({ page }) => {
  await page.route("**/api/admin/state", async route => {
    const response = await route.fetch(); const body = await response.json();
    body.accounts.forEach((account: { balance: number }, index: number) => { account.balance = index === 0 ? 12_345_678 : 0; });
    await route.fulfill({ response, json: body });
  });
  await page.setViewportSize({ width: 320, height: 844 });
  await signIn(page, "admin");
  const balance = page.locator(".admin-kpi-card.featured .kpi-val");
  await expect(balance).toHaveText("$12,345,678");
  const oneLine = await balance.evaluate(el => {
    const text = document.createRange(); text.selectNodeContents(el);
    return text.getBoundingClientRect().height < parseFloat(getComputedStyle(el).fontSize) * 1.6;
  });
  expect(oneLine).toBe(true);
  await fits(page);
});


for (const actor of ["personal", "business"] as const) {
  test(`${actor} balances use a moderate scale and keep every digit on one line`, async ({ page }) => {
    let balance = 12_345.67;
    await page.route("**/api/me/state", async route => {
      const response = await route.fetch(); const body = await response.json();
      body.account.balance = balance;
      await route.fulfill({ response, json: body });
    });
    await signIn(page, actor);
    const hero = actor === "personal" ? ".stat-balance .stat-value" : ".business-cash-value";
    for (const amount of [12_345.67, 1_250_000.25, -12_345_678.9, 1_234_567_890.12]) {
      balance = amount;
      await page.reload();
      const expected = amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
      await expect(page.locator(hero)).toHaveText(expected);
      await page.evaluate(() => document.fonts.ready);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await fits(page);
        await noSiblingOverlap(page, ".app-topbar,.topbar-left,.topbar-right");
        for (const selector of [hero, ".topbar-amount"]) {
          const amountElement = page.locator(selector);
          await expect(amountElement).toHaveText(expected);
          const metrics = await amountElement.evaluate(el => {
            const range = document.createRange(); range.selectNodeContents(el);
            const text = range.getBoundingClientRect(), box = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return {
              fits: text.left >= box.left - 1 && text.right <= box.right + 1 && text.height <= box.height + 1,
              lines: range.getClientRects().length,
              size: parseFloat(style.fontSize),
            };
          });
          expect(metrics.fits, `${actor} ${selector}: ${expected} at ${width}px`).toBe(true);
          expect(metrics.lines).toBe(1);
          if (amount === 12_345.67) expect(metrics.size).toBeCloseTo(selector === hero ? (width <= 600 ? 24 : 28) : 18, 0);
        }
      }
    }
  });
}


for (const actor of ["personal", "business"] as const) {
  test(`${actor} balance cards share the same moderate typography`, async ({ page }) => {
    await signIn(page, actor);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [route, selector] of [
        ["", actor === "personal" ? ".stat-value:not(.crypto-muted)" : ".business-cash-value,.business-metric-value"],
        ["accounts", ".account-big-money,.account-summary-value,.pocket-balance"],
        ["rewards", ".reward-big,.side-value"],
      ]) {
        await page.goto(`/#/app${route ? `/${route}` : ""}`);
        await expect(page.locator(selector).first()).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const sizes = await page.locator(selector).evaluateAll(elements => elements.map(el => ({
          size: parseFloat(getComputedStyle(el).fontSize),
          weight: getComputedStyle(el).fontWeight,
        })));
        expect(sizes.length).toBeGreaterThan(1);
        for (const style of sizes) {
          expect(style.size).toBeCloseTo(width <= 600 ? 24 : 28, 0);
          expect(style.weight).toBe("600");
        }
        await fits(page);
      }
    }
  });
}
