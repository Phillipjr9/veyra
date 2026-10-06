import { test, expect, type Page } from "@playwright/test";

// Explicit, synthetic provider fixtures. Production never supplies these results.
test.use({ hasTouch: true });
const suggestion = { placeId: "test-place", label: "1841 Maple Grove Avenue, Austin, Texas, United States" };
const address = { street: "1841 Maple Grove Avenue", city: "Austin", state: "TX", postalCode: "78701-1234", country: "United States", unit: "Provider unit" };
async function configure(page: Page, enabled = true) {
  await page.route("**/api/auth/config", route => route.fulfill({ json: { addresses: { enabled, countries: ["us"] } } }));
}
async function fits(page: Page) {
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
  expect(await page.locator(".address-field,.address-results,.address-results li").evaluateAll(elements => elements.filter(el => {
    const rect = el.getBoundingClientRect(); return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
  }).length)).toBe(0);
}

test("home and business suggestions autofill independently, preserve units and support keyboard/touch", async ({ page }) => {
  await configure(page);
  const queries: any[] = [], selections: any[] = [];
  await page.route("**/api/address/autocomplete", async route => { queries.push(route.request().postDataJSON()); await route.fulfill({ json: { suggestions: [suggestion] } }); });
  await page.route("**/api/address/details", async route => { selections.push(route.request().postDataJSON()); await route.fulfill({ json: { address, attributions: [{ name: "Test attribution", url: "https://example.com/" }] } }); });
  await page.goto("/#/signup?type=business");
  for (const [index, prefix] of ["su-", "su-biz"].entries()) {
    const field = page.locator(`#${prefix}addressLine1`.replace("bizaddress", "bizAddress"));
    const id = (name: string) => `#${prefix}${prefix === "su-biz" ? name[0].toUpperCase() + name.slice(1) : name}`;
    await page.locator(id("addressLine2")).fill(index ? "Suite 900" : "Apartment 7");
    await field.fill("18"); await page.waitForTimeout(450); expect(queries.length).toBe(index);
    await field.fill("1841");
    await expect(page.getByRole("listbox", { name: "Address suggestions" }).getByRole("option")).toHaveText(suggestion.label);
    await expect(page.locator(".address-attribution")).toHaveText("Google Maps");
    expect(Object.keys(queries[index]).sort()).toEqual(["input", "sessionToken"]);
    for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); await fits(page); }
    if (index === 0) { await field.press("ArrowDown"); await expect(page.getByRole("listbox", { name: "Address suggestions" }).getByRole("option")).toHaveAttribute("aria-selected", "true"); await field.press("Enter"); }
    else { await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole("listbox", { name: "Address suggestions" }).getByRole("option").tap(); }
    await expect(field).toHaveValue(address.street);
    await expect(page.locator(id("city"))).toHaveValue(address.city);
    await expect(page.locator(id("state"))).toHaveValue(address.state);
    await expect(page.locator(id("postalCode"))).toHaveValue(address.postalCode);
    await expect(page.locator(id("addressLine2"))).toHaveValue(index ? "Suite 900" : "Apartment 7");
    await expect(page.locator(id("addressLine2"))).toBeFocused();
    expect(selections[index].sessionToken).toBe(queries[index].sessionToken);
    await expect(page.locator(id("city"))).toBeEditable();
  }
  expect(queries[0].sessionToken).not.toBe(queries[1].sessionToken);
  await expect(page.locator("#su-city")).toHaveValue("Austin");
  await expect(page.locator(".address-providers")).toHaveCount(2);
});

test("manual mode, absent configuration and provider failure leave ordinary address entry usable", async ({ page }) => {
  await configure(page, false);
  let calls = 0;
  await page.route("**/api/address/autocomplete", async route => { calls++; await route.fulfill({ status: 503, json: { error: "Provider unavailable" } }); });
  await page.goto("/#/signup?type=personal");
  await page.locator("#su-addressLine1").fill("Manual street"); await page.waitForTimeout(450);
  expect(calls).toBe(0); await expect(page.locator(".address-help")).toContainText("not enabled");
  await configure(page); await page.reload();
  const field = page.locator("#su-addressLine1");
  await expect(page.getByRole("button", { name: "Enter address manually" })).toBeVisible();
  await page.getByRole("button", { name: "Enter address manually" }).click();
  await field.fill("Manual street"); await page.waitForTimeout(450); expect(calls).toBe(0);
  await page.getByRole("button", { name: "Use Google suggestions" }).click(); await field.focus();
  await expect(page.locator(".address-status")).toContainText("unavailable"); expect(calls).toBe(1);
  await page.locator("#su-city").fill("Austin"); await page.locator("#su-state").selectOption("TX"); await page.locator("#su-postalCode").fill("78701");
  await expect(field).toHaveValue("Manual street"); await expect(page.locator("#su-city")).toHaveValue("Austin");
  await fits(page);
});

test("empty results and Escape do not trap focus or submit the signup form", async ({ page }) => {
  await configure(page);
  let empty = true;
  await page.route("**/api/address/autocomplete", route => route.fulfill({ json: { suggestions: empty ? [] : [suggestion] } }));
  await page.goto("/#/signup?type=personal");
  const field = page.locator("#su-addressLine1");
  await field.fill("Unmatched street"); await expect(page.locator(".address-status")).toContainText("No matching");
  empty = false; await field.fill("1841"); await expect(page.getByRole("listbox", { name: "Address suggestions" }).getByRole("option")).toBeVisible();
  await field.press("Escape"); await expect(page.getByRole("listbox")).toHaveCount(0); await expect(field).toBeFocused();
  await field.press("Tab"); await expect(page.getByRole("button", { name: "Enter address manually" })).toBeFocused();
  await expect(page).toHaveURL(/signup/);
});

test("late details never overwrite a newly edited address", async ({ page }) => {
  await configure(page);
  await page.route("**/api/address/autocomplete", route => route.fulfill({ json: { suggestions: [suggestion] } }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/address/details", async route => { await gate; await route.fulfill({ json: { address, attributions: [] } }).catch(() => {}); });
  await page.goto("/#/signup?type=personal");
  const field = page.locator("#su-addressLine1");
  await field.fill("1841"); await page.getByRole("listbox", { name: "Address suggestions" }).getByRole("option").click();
  await expect(page.locator(".address-status")).toContainText("Looking up");
  await field.fill("A different street"); release(); await page.waitForTimeout(500);
  await expect(field).toHaveValue("A different street"); await expect(page.locator("#su-city")).toHaveValue("");
});
