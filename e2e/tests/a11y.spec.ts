import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const publicRoutes = [
  '/pt/',
  '/pt/browse',
  '/pt/lists',
  '/pt/p/firefox',
  '/pt/status',
  '/pt/transparency',
] as const;

const blockingImpacts = new Set(['serious', 'critical']);

for (const route of publicRoutes) {
  test(`a11y smoke: ${route} has no serious or critical axe violations`, async ({ page }) => {
    const response = await page.goto(route, { waitUntil: 'networkidle' });
    expect(response, `no response for ${route}`).not.toBeNull();
    expect(response!.ok(), `bad status for ${route}: ${response!.status()}`).toBeTruthy();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter((v) =>
      blockingImpacts.has(String(v.impact ?? '')),
    );

    expect(
      blocking,
      blocking.map((v) => `${v.impact}: ${v.id} - ${v.help}`).join('\n'),
    ).toEqual([]);
  });
}
