import { expect, type Locator } from "@playwright/test";

export async function confirmFunding(dialog: Locator) {
  await dialog.getByRole("button", { name: "Review deposit", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Review deposit", exact: true })).toBeVisible();
  await dialog.locator(".flow-confirm").click();
}
