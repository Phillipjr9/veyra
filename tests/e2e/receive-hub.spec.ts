import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

test.skip((process.env.ACCOUNT_LEDGER_ENABLED || process.env.DEMO_PAYMENTS_ENABLED) !== '1', 'Receive-link tests use the explicit mock payment mode.');
const email = 'demo.personal@veyra.dev';
async function login(page: Page) {
  await page.goto('/#/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('veyra-demo-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/#\/app/);
  await page.goto('/#/app/transfers');
}
async function open(page: Page) {
  await page.getByRole('button', { name: /Receive Zelle.*QR/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Zelle receive hub', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
function decode(data: Buffer) {
  const png = PNG.sync.read(data);
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  expect(result).not.toBeNull();
  return result!.data;
}
async function code(page: Page) {
  const image = page.getByRole('img', { name: 'Scannable QR for this Veyra payment link' });
  await expect(image).toBeVisible();
  return decode(Buffer.from((await image.getAttribute('src'))!.split(',')[1], 'base64'));
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const dialog = page.getByRole('dialog', { name: 'Zelle receive hub' });
  expect(await dialog.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
  // Let dynamic viewport units and the native fixed-layer layout settle after resize.
  await expect.poll(async () => {
    const r = await dialog.boundingBox(), viewport = page.viewportSize()!;
    return !!r && r.x >= 0 && r.y >= 0 && r.x + r.width <= viewport.width && r.y + r.height <= viewport.height;
  }).toBe(true);
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  for (const button of await dialog.locator('button:visible,a:visible').all()) {
    expect(await button.evaluate(e => e.scrollHeight - e.clientHeight)).toBeLessThanOrEqual(1);
  }
}

test('new receive card scans, switches aliases and downloads the selected QR without changing funding', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await login(page); const dialog = await open(page);
  await expect(dialog.getByRole('heading', { name: 'Zelle® Receive Hub' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Email', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const emailUrl = await code(page); expect(emailUrl).toContain(encodeURIComponent(email));
  await dialog.getByRole('button', { name: 'Phone', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Phone', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const phoneUrl = await code(page), phone = await dialog.locator('.demo-contact').innerText();
  expect(phoneUrl).toContain(encodeURIComponent(phone)); expect(phoneUrl).not.toBe(emailUrl);
  const pending = page.waitForEvent('download'); await dialog.getByRole('link', { name: 'Save QR', exact: true }).click();
  const saved = await pending; expect(saved.suggestedFilename()).toBe('veyra-receive-qr.png');
  expect(decode(await readFile((await saved.path())!))).toBe(phoneUrl);
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); await fits(page); }
  await dialog.getByRole('button', { name: 'Close receive hub' }).click();
  await page.getByRole('button', { name: 'Add funds', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Add funds', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Debit card', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('copy, native-share fallback, keyboard trap and restored focus work', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page); const opener = page.getByRole('button', { name: /Receive Zelle.*QR/ }); const dialog = await open(page);
  const url = await code(page);
  await page.keyboard.press('Tab'); await expect(dialog.getByRole('button', { name: 'Close receive hub' })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(dialog.locator('summary')).toBeFocused();
  await dialog.getByRole('button', { name: 'Copy identifier', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Email address copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(email);
  await dialog.getByRole('button', { name: 'Copy payment link', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }));
  await dialog.getByRole('button', { name: 'Share link', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Payment link copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(opener).toBeFocused();
});

test('long contacts and unavailable phone remain readable on small screens', async ({ page }) => {
  await page.route('**/api/me/demo-payments', async route => {
    const response = await route.fetch(); const data = await response.json();
    data.member = { ...data.member, name: 'Alexandra Montgomery International Account', email: 'alexandra.montgomery.receiving.department@long-company-name.example', phoneUsable: false };
    await route.fulfill({ response, json: data });
  });
  await login(page); const dialog = await open(page);
  await expect(dialog.getByRole('button', { name: 'Phone', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Email', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await code(page);
  await dialog.locator('summary').click(); await expect(dialog.getByLabel('Payment link', { exact: true })).toBeVisible();
  for (const width of [320, 390, 768]) { await page.setViewportSize({ width, height: 740 }); await fits(page); }
});

test('sharing failures expose a manual link; disabled receiving never offers a QR or payment link', async ({ page }) => {
  await login(page); let dialog = await open(page); await code(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new Error('Sharing unavailable'); } });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Permission denied'); } } });
  });
  await dialog.getByRole('button', { name: 'Share link', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Sharing is unavailable');
  await expect(dialog.getByLabel('Payment link', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Copy payment link', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Select and copy');
  await page.keyboard.press('Escape');
  await page.route('**/api/me/demo-payments', async route => {
    const response = await route.fetch(); const data = await response.json();
    await route.fulfill({ response, json: { ...data, enabled: false, reason: 'Receiving is not enabled for this account.' } });
  });
  dialog = await open(page); await expect(dialog).toContainText('Receiving is not enabled');
  await expect(dialog.getByRole('img')).toHaveCount(0);
  for (const name of ['Share link', 'Copy payment link', 'Save QR']) await expect(dialog.getByRole('button', { name, exact: true })).toBeDisabled();
});
