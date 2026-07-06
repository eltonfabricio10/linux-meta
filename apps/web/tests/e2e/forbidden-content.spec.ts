/**
 * Public pages must not contain forbidden marketing claims. These assertions
 * encode constitutional limits: no SLA promises, no "first to integrate"
 * branding, no implied BigLinux partnership, no pricing claims.
 */
import { test, expect } from '@playwright/test';

const PUBLIC_PAGES: readonly string[] = [
  '/',
  '/pt',
  '/pt/transparencia',
  '/pt/governanca',
  '/pt/status',
  '/en',
  '/en/transparencia',
  '/en/governanca',
  '/en/governance',
  '/en/status',
];

const FORBIDDEN: ReadonlyArray<RegExp> = [
  /SLA/i,
  /first to integrate/i,
  /in partnership with BigLinux/i,
  /Plans from R\$\s*50/i,
];

for (const path of PUBLIC_PAGES) {
  test(`public page ${path} contains no forbidden marketing claims`, async ({ request }) => {
    const res = await request.get(path);
    // Some locale aliases (e.g. /en/governance vs /en/governanca) may legitimately
    // 404; only enforce content rules where the page actually renders.
    if (res.status() === 404) {
      test.skip(true, `${path} not implemented (404)`);
      return;
    }
    expect(res.status(), `${path} should respond 2xx`).toBeLessThan(400);
    const body = await res.text();
    for (const rx of FORBIDDEN) {
      expect(body, `${path} must not match ${rx}`).not.toMatch(rx);
    }
  });
}
