import { expect, type Locator } from "@playwright/test";

export async function confirmFunding(dialog: Locator) {
  await dialog.getByRole("button", { name: "Review deposit", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Review deposit", exact: true })).toBeVisible();
  await dialog.locator(".flow-confirm").click();
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The details picker's own trigger. (A hidden manual-mode select also carries the name "Funding method".) */
const pickerTrigger = (scope: Locator) => scope.locator("button.funding-picker-trigger");
const pickerOptions = (scope: Locator) => scope.locator(".funding-picker-list [role='option']");

/** Opens the funding method picker if it is closed. */
export async function openFundingMethods(scope: Locator) {
  const trigger = pickerTrigger(scope);
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
}

/** The options of the open funding method picker. */
export function fundingMethodOptions(scope: Locator) {
  return pickerOptions(scope);
}

/** Chooses a funding method in the details picker by its visible name. */
export async function chooseFundingMethod(scope: Locator, label: string) {
  await openFundingMethods(scope);
  await pickerOptions(scope).filter({ hasText: new RegExp(`^${escapeRegExp(label)}`) }).first().click();
}
