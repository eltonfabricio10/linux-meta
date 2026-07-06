import { test, expect } from '@playwright/test';

test('search firefox yields hits and opens a package page', async ({ page }) => {
  await page.goto('/pt/browse?q=firefox');
  const hits = page.locator('a.hit-link');
  await expect(hits.first()).toBeVisible({ timeout: 10_000 });
  const count = await hits.count();
  expect(count).toBeGreaterThanOrEqual(1);

  await hits.first().click();
  await expect(page).toHaveURL(/\/p\//);

  // Version row visible: page renders a <code> with version text
  await expect(page.locator('code').first()).toBeVisible();
});
