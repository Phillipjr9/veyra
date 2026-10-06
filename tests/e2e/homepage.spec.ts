import { test, expect } from "@playwright/test";

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`crypto homepage is responsive at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your money.Your Bitcoin.One secure home.");
    await expect(page.getByRole("main").getByRole("link", { name: "Open an account", exact: true })).toBeVisible();
    await expect(page.locator(".vh-vault img")).toBeVisible();
    expect(await page.locator(".vh-vault img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    for (const section of [".vh-hero", ".vh-product-grid", ".vh-asset-tabs", ".vh-security", ".vh-faq", "footer"]) {
      const bounds = await page.locator(section).boundingBox();
      expect(bounds, section).not.toBeNull();
      expect(bounds!.x, section).toBeGreaterThanOrEqual(-1);
      expect(bounds!.x + bounds!.width, section).toBeLessThanOrEqual(width + 1);
    }
    // Check actual text and header controls too: overflow:clip must not mask clipping.
    const headingRight = await page.locator("h1").evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      return range.getBoundingClientRect().right;
    });
    expect(headingRight).toBeLessThanOrEqual(width);
    const menu = page.getByRole("button", { name: "Toggle menu" });
    if (await menu.isVisible()) {
      const bounds = await menu.boundingBox();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}

test("asset explorer supports mouse, keyboard, and risk disclosures", async ({ page }) => {
  await page.goto("/#/");
  await page.getByRole("link", { name: "Explore crypto", exact: true }).click();
  await expect(page).toHaveURL(/#\/#digital-assets$/);
  const tabs = page.getByRole("tablist", { name: "Explore supported digital assets" });
  await tabs.getByRole("tab", { name: "Ethereum ETH" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Discover the asset behind Ethereum");
  await expect(tabs.getByRole("tab", { name: "Ethereum ETH" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Solana SOL" })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toContainText("Get to know Solana");
  await page.keyboard.press("End");
  await expect(page.getByRole("tabpanel")).toContainText("depegging risks");
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: "Bitcoin BTC" })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toContainText("Explore Bitcoin");
  await expect(page.locator(".vh-disclosure")).toContainText("not FDIC insured");
  await page.getByRole("link", { name: "Start your Veyra journey" }).click();
  await expect(page).toHaveURL(/#\/signup$/);
});

test("security panels and FAQs expose the right content", async ({ page }) => {
  await page.goto("/#/");
  const access = page.getByRole("button", { name: "02 Control where it matters" });
  await access.click();
  await expect(access).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#vh-protection-1")).toBeVisible();
  await expect(page.locator("#vh-protection-0")).toBeHidden();
  await expect(page.locator(".vh-security-status")).toHaveText("ACCESS CONTROLLED");
  await page.getByRole("button", { name: "03 Clarity at every step" }).click();
  await expect(page.locator("#vh-protection-2")).toContainText("audit trails");
  const faq = page.locator("details").filter({ hasText: "Are cryptocurrency holdings FDIC insured?" });
  await faq.locator("summary").click();
  await expect(faq.locator("p")).toBeVisible();
  await expect(faq.locator("p")).toContainText("not FDIC insured");
  await faq.locator("summary").click();
  await expect(faq.locator("p")).toBeHidden();
});

test("mobile navigation closes on anchor links and Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/");
  const menu = page.getByRole("button", { name: "Toggle menu" });
  await menu.click();
  const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(mobileNav).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(mobileNav).toBeHidden();
  await expect(menu).toBeFocused();
  await menu.click();
  await mobileNav.getByRole("link", { name: "Digital assets" }).click();
  await expect(mobileNav).toBeHidden();
  await expect(page).toHaveURL(/#\/#digital-assets$/);
  await expect.poll(() => page.locator("#digital-assets").evaluate(el => Math.abs(el.getBoundingClientRect().top - 110))).toBeLessThan(2);
  await page.locator(".vh-faq").scrollIntoViewIfNeeded();
  await menu.click();
  await mobileNav.getByRole("link", { name: "Digital assets" }).click();
  await expect(mobileNav).toBeHidden();
  await expect.poll(() => page.locator("#digital-assets").evaluate(el => Math.abs(el.getBoundingClientRect().top - 110))).toBeLessThan(2);
  await menu.click();
  await mobileNav.getByRole("link", { name: "Personal", exact: true }).click();
  await expect(page).toHaveURL(/#\/personal$/);
  await expect(page.locator(".crypto-site")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("security animation can pause and respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/#/");
  const vault = page.locator(".vh-vault");
  await expect(vault).toHaveClass(/is-moving/);
  await page.getByRole("button", { name: "Pause security animation" }).click();
  await expect(vault).toHaveClass(/is-still/);
  await expect(page.getByRole("button", { name: "Play security animation" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Play security animation" }).click();
  await expect(vault).toHaveClass(/is-moving/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(vault).toHaveClass(/is-still/);
  await expect(page.getByRole("button", { name: "Security animation disabled for reduced motion" })).toBeDisabled();
  expect(await page.locator(".vh-vault-float").evaluate(el => getComputedStyle(el).animationName)).toBe("none");
});

test("homepage links keep the existing signup and login flows", async ({ page }) => {
  await page.goto("/#/");
  await page.getByRole("main").getByRole("link", { name: "Open an account", exact: true }).click();
  await expect(page).toHaveURL(/#\/signup$/);
  await page.goto("/#/");
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/#\/login$/);
});


test("skip link takes keyboard focus into the homepage", async ({ page }) => {
  await page.goto("/#/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
});

// These tests opt into motion (the suite normally uses reduced motion). They
// verify actual rendered frames and lifecycle behavior, not only CSS classes.
test("live orbital field animates, responds to the pointer, and pauses globally", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/#/");
  const field = page.locator(".vh-orbital-field");
  await expect(field).toHaveAttribute("data-running", "true");
  await expect.poll(() => field.evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, index) => index % 4 === 3 && value > 0);
  })).toBe(true);
  const initial = await field.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await expect.poll(() => field.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(initial);
  const bounds = await page.locator(".vh-vault").boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width * .7, bounds!.y + bounds!.height * .4);
  expect(await page.locator(".vh-vault").evaluate(el => el.style.getPropertyValue("--light-x"))).not.toBe("");
  await page.getByRole("button", { name: "Pause page animations" }).click();
  await expect(field).toHaveAttribute("data-running", "false");
  await expect(page.getByRole("main")).toHaveAttribute("data-motion", "paused");
  await expect(page.getByRole("button", { name: "Play security animation" })).toHaveAttribute("aria-pressed", "true");
  const frozen = await field.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  // A deliberate observation window: a disabled renderer must not draw frames.
  await page.waitForTimeout(250);
  expect(await field.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(frozen);
  expect(await page.locator(".vh-vault-float").evaluate(el => getComputedStyle(el).animationPlayState)).toBe("paused");
  await page.getByRole("button", { name: "Play security animation" }).click();
  await expect(page.getByRole("button", { name: "Pause page animations" })).toHaveAttribute("aria-pressed", "false");
  await expect(field).toHaveAttribute("data-running", "true");
  await expect.poll(() => field.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(frozen);
});

test("motion scenes suspend outside the viewport and when the document is hidden", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/#/");
  const field = page.locator(".vh-orbital-field");
  await expect(field).toHaveAttribute("data-running", "true");
  await page.locator(".vh-security").scrollIntoViewIfNeeded();
  await expect(field).toHaveAttribute("data-running", "false");
  await expect(page.locator(".vh-security-art")).toHaveAttribute("data-live", "true");
  const satellite = page.locator(".vh-network-satellite").first();
  expect(await satellite.evaluate(el => getComputedStyle(el).animationPlayState)).toBe("running");
  // Simulate the visibility API notification used when a browser tab sleeps.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("main")).toHaveAttribute("data-motion", "paused");
  expect(await satellite.evaluate(el => getComputedStyle(el).animationPlayState)).toBe("paused");
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "visibilityState");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("main")).toHaveAttribute("data-motion", "running");
  await page.locator(".vh-hero").scrollIntoViewIfNeeded();
  await expect(field).toHaveAttribute("data-running", "true");
  await expect(page.locator(".vh-security-art")).toHaveAttribute("data-live", "false");
  expect(await satellite.evaluate(el => getComputedStyle(el).animationPlayState)).toBe("paused");
});

test("paused motion never strands new asset or security content mid-reveal", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/#/");
  await page.getByRole("button", { name: "Pause page animations" }).click();
  await page.getByRole("tab", { name: "Ethereum ETH" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Discover the asset behind Ethereum");
  await expect(page.locator(".vh-asset-copy")).toHaveCSS("opacity", "1");
  await expect(page.locator(".vh-coin-float img")).toHaveCSS("opacity", "1");
  await page.getByRole("button", { name: "02 Control where it matters" }).click();
  await expect(page.locator("#vh-protection-1 p")).toHaveCSS("opacity", "1");
  await expect(page.locator(".vh-shield-icon")).toHaveCSS("opacity", "1");
  await expect(page.getByRole("main")).toHaveAttribute("data-motion", "paused");
});

test("reduced motion disables new loops and leaves the complete artwork usable", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByRole("button", { name: "Page animations disabled for reduced motion" })).toBeDisabled();
  await expect(page.locator(".vh-orbital-field")).toHaveAttribute("data-running", "false");
  for (const selector of [".vh-vault-float", ".vh-title-luster", ".vh-network-satellite", ".vh-bank-card", ".vh-scout-orb", ".vh-coin-float"]) {
    expect(await page.locator(selector).first().evaluate(el => getComputedStyle(el).animationName), selector).toBe("none");
  }
  await page.getByRole("tab", { name: "USD Coin USDC" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("depegging risks");
  await expect(page.locator(".vh-coin-float img")).toHaveCSS("opacity", "1");
});

test("the homepage remains complete when Canvas is unavailable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => null });
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/#/");
  await expect(page.locator(".vh-vault img")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Your Bitcoin.");
  await page.getByRole("tab", { name: "Ethereum ETH" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Discover the asset behind Ethereum");
  expect(errors).toEqual([]);
});
