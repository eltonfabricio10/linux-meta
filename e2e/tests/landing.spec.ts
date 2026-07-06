import { test, expect } from '@playwright/test';

test('root redirects to a locale and h1 contains Linux', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/(pt|en)\/?$/);
  await expect(page.locator('h1').first()).toContainText(/Linux/i);
});

test('pt landing', async ({ page }) => {
  await page.goto('/pt/');
  await expect(page).toHaveURL(/\/pt\/?$/);
  await expect(page.locator('h1').first()).toContainText(/Linux/i);
});

test('en landing', async ({ page }) => {
  await page.goto('/en/');
  await expect(page).toHaveURL(/\/en\/?$/);
  await expect(page.locator('h1').first()).toContainText(/Linux/i);
});

test('mobile navigation exposes primary links without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/pt/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('nav.primary')).toBeHidden();
  await page.getByLabel('Menu').click();
  await expect(page.getByRole('navigation', { name: 'Navegação' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explorar' }).last()).toBeVisible();

  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewport);
});

test('legacy localized aliases redirect to current routes', async ({ page }) => {
  await page.goto('/pt/buscar?q=firefox');
  await expect(page).toHaveURL(/\/pt\/browse\?q=firefox$/);

  await page.goto('/pt/transparencia');
  await expect(page).toHaveURL(/\/pt\/transparency$/);
});
