import { test, expect } from "@playwright/test";
import { LEGAL_DOCUMENTS, LEGAL_REVISION, type LegalDocumentId } from "../../src/content/legal";

for (const doc of Object.keys(LEGAL_DOCUMENTS) as LegalDocumentId[]) {
  test(`${doc}: substantial current disclosures and responsive, accessible contents`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const policy = LEGAL_DOCUMENTS[doc];
    expect(policy.sections.flatMap(section => section.paragraphs).join(" ").split(/\s+/).length).toBeGreaterThan(1500);
    expect(new Set(policy.sections.map(section => section.id)).size).toBe(policy.sections.length);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/#/legal/${doc}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(policy.title);
      await expect(page.locator("time")).toHaveAttribute("datetime", LEGAL_REVISION);
      await expect(page.locator(".legal-review-notice")).toContainText("Review draft");
      await expect(page.locator(".legal-review-notice")).toContainText("qualified legal review");
      await expect(page.locator(".legal-document-tabs [aria-current=page]")).toHaveText(policy.title);
      await expect(page.locator(".legal-section")).toHaveCount(policy.sections.length);
      await expect(page.locator(".legal-section").last()).toContainText(policy.sections.at(-1)!.paragraphs.at(-1)!);
      await expect(page.locator("footer")).not.toContainText("Members FDIC");
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
      const escaped = await page.locator(".legal-section p,.legal-section h2,.legal-review-notice,.legal-document-tabs a").evaluateAll(elements => elements.filter(el => {
        const r = el.getBoundingClientRect();
        return r.left < -1 || r.right > innerWidth + 1;
      }).map(el => el.textContent?.slice(0, 70)));
      expect(escaped).toEqual([]);
      if (width <= 900) {
        const disclosure = page.locator(".legal-mobile-contents");
        await expect(disclosure).not.toHaveAttribute("open", "");
        await disclosure.locator("summary").focus();
        await page.keyboard.press("Enter");
        await expect(disclosure).toHaveAttribute("open", "");
      }
      const target = policy.sections.at(-1)!;
      await page.locator(".legal-contents:visible").getByRole("link", { name: target.title }).click();
      await expect(page).toHaveURL(new RegExp(`#${target.id}$`));
      await expect(page.locator(`h2#${target.id}`)).toBeFocused();
      await expect.poll(async () => (await page.locator(`h2#${target.id}`).boundingBox())!.y).toBeGreaterThanOrEqual(90);
      if (width <= 900) await expect(page.locator(".legal-mobile-contents")).not.toHaveAttribute("open", "");
    }
    expect(errors).toEqual([]);
  });
}

test("legal navigation, deep links, support and printable copies work", async ({ page }) => {
  await page.goto("/#/legal/terms#monthly-limits");
  await expect(page.locator("#monthly-limits")).toBeFocused();
  await expect(page.locator("#monthly-limits").locator("..")).toContainText("UTC calendar month");
  await expect(page.locator("#monthly-limits").locator("..")).toContainText("zero-dollar cap");
  await expect(page.locator("#legacy-attribution").locator("..")).toContainText("Unattributed historical activity");
  await expect(page.locator("#scout-and-analysis").locator("..")).toContainText("disabled");
  await page.getByRole("navigation", { name: "Legal documents", exact: true }).getByRole("link", { name: "Privacy Policy" }).click();
  await expect(page).toHaveURL(/#\/legal\/privacy$/);
  await expect(page.locator("#browser-storage").locator("..")).toContainText("Google-hosted");
  await expect(page.locator("#retention").locator("..")).toContainText("self-service account-erasure");
  await page.getByRole("navigation", { name: "Related legal documents" }).getByRole("link", { name: "Disclosures" }).click();
  await expect(page).toHaveURL(/#\/legal\/disclosures$/);
  await expect(page.locator("#banking-insurance").locator("..")).toContainText("No FDIC, NDIC, FSCS");

  await page.evaluate(() => { (window as unknown as { printCalls: number }).printCalls = 0; window.print = () => { (window as unknown as { printCalls: number }).printCalls += 1; }; });
  await page.getByRole("button", { name: "Print or save a copy" }).click();
  expect(await page.evaluate(() => (window as unknown as { printCalls: number }).printCalls)).toBe(1);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".site-header")).toBeHidden();
  await expect(page.locator(".legal-sidebar")).toBeHidden();
  await expect(page.locator(".legal-review-notice")).toBeVisible();
  await expect(page.locator(".legal-section").last()).toBeVisible();
  await page.emulateMedia({ media: "screen" });

  await page.locator(".legal-contact").getByRole("link", { name: "Contact support" }).click();
  await expect(page).toHaveURL(/#\/support#support-form$/);
  await expect(page.locator("#support-form")).toBeVisible();
});
