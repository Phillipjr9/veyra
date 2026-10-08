import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

test.skip((process.env.ACCOUNT_LEDGER_ENABLED || process.env.DEMO_PAYMENTS_ENABLED) !== '1', 'Zelle page uses the explicit mock payment mode.');
const email = 'demo.personal@veyra.dev';

async function login(page: Page) {
  await page.goto('/#/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('veyra-demo-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/#\/app/);
}

/** Opens the Zelle page the way a member does: from the Transfers screen. */
async function openFromTransfers(page: Page) {
  await page.goto('/#/app/transfers');
  await page.getByRole('link', { name: /Receive Zelle.*QR/ }).click();
  await expect(page).toHaveURL(/#\/app\/zelle$/);
  await expect(page.getByRole('heading', { name: /^Zelle/, level: 1 })).toBeVisible();
}

function decode(data: Buffer) {
  const png = PNG.sync.read(data);
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  expect(result).not.toBeNull();
  return result!.data;
}

async function qrPayload(page: Page) {
  const image = page.getByRole('img', { name: 'Scannable QR for this Veyra payment link' });
  await expect(image).toBeVisible();
  return decode(Buffer.from((await image.getAttribute('src'))!.split(',')[1], 'base64'));
}

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const main = page.locator('.zelle-page');
  expect(await main.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
}

test('Zelle has its own page with a barcode, a QR code and the deposit information', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await login(page);
  await openFromTransfers(page);

  // The identifier is the signup email; the barcode encodes it as Code 128.
  await expect(page.getByTestId('zelle-identifier')).toHaveText(email);
  await expect(page.getByRole('img', { name: `Barcode for ${email}` })).toBeVisible();
  expect(await qrPayload(page)).toContain(encodeURIComponent(email));

  // Deposit information reflects the admin-set Zelle instructions; none are set for the demo member.
  await expect(page.locator('.zelle-deposit')).toContainText('No Zelle deposit instructions are set');
  await expect(page.locator('.zelle-deposit')).toContainText('submitting a request does not start a Zelle payment');

  for (const width of [320, 390, 1440]) { await page.setViewportSize({ width, height: 900 }); await fits(page); }
  expect(errors).toEqual([]);
});

test('the sidebar and Transfers both lead to the Zelle page', async ({ page }) => {
  await login(page);
  await page.goto('/#/app');
  await page.locator('a[href="#/app/zelle"]').first().click();
  await expect(page).toHaveURL(/#\/app\/zelle$/);
});

test('copy and save actions give the selected identifier and payment link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page);
  await openFromTransfers(page);

  await page.getByRole('button', { name: 'Copy identifier', exact: true }).click();
  await expect(page.locator('.zelle-feedback')).toContainText('Email address copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(email);

  await page.getByRole('button', { name: 'Copy payment link', exact: true }).click();
  await expect(page.locator('.zelle-feedback')).toContainText('Payment link copied.');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const payload = await qrPayload(page);
  expect(link).toBe(payload);
  expect(payload).toContain(`#/app/transfers?to=${encodeURIComponent(email)}`);

  const pending = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Save QR', exact: true }).click();
  const saved = await pending;
  expect(saved.suggestedFilename()).toBe('veyra-zelle-qr.png');
  expect(decode(await readFile((await saved.path())!))).toBe(payload);
});

test('the Mobile choice shows the saved phone number in the barcode and QR when one exists', async ({ page }) => {
  await login(page);
  await openFromTransfers(page);
  const mobile = page.getByRole('button', { name: 'Mobile', exact: true });
  if (await mobile.isDisabled()) test.skip(true, 'The demo member has no mobile number saved.');
  await mobile.click();
  await expect(mobile).toHaveAttribute('aria-pressed', 'true');
  const phone = await page.getByTestId('zelle-identifier').innerText();
  await expect(page.getByRole('img', { name: `Barcode for ${phone}` })).toBeVisible();
  expect(await qrPayload(page)).toContain(encodeURIComponent(phone));
});
