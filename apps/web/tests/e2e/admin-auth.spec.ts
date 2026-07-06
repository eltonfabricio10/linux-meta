/**
 * Admin auth gate: unauthenticated requests to any admin page or admin API
 * must be redirected to /auth/login OR rejected with 401/403.
 *
 * Uses a fresh request context per test (no shared cookies) and disables
 * automatic redirect following so we can assert the redirect itself.
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';

const ADMIN_PAGES: readonly string[] = [
  '/pt/admin',
  '/pt/admin/users',
  '/pt/admin/users/1',
  '/pt/admin/audit',
  '/pt/admin/packages',
  '/pt/admin/packages/1',
  '/pt/admin/translations',
  '/pt/admin/reviewers',
  '/pt/admin/ratings',
  '/pt/admin/disputes',
  '/pt/admin/disputes/1',
  '/pt/admin/workers',
  '/pt/admin/workers/ingest',
];

const ADMIN_APIS: readonly string[] = [
  '/api/v1/admin/users',
  '/api/v1/admin/users/1',
  '/api/v1/admin/packages',
  '/api/v1/admin/packages/1',
  '/api/v1/admin/translations/1/pt',
  '/api/v1/admin/ratings',
  '/api/v1/admin/ratings/1',
  '/api/v1/admin/reviewers',
  '/api/v1/admin/workers',
  '/api/v1/admin/workers/ingest',
];

function isAuthRejection(status: number, location: string | null): boolean {
  if (status === 401 || status === 403) return true;
  if (status >= 300 && status < 400 && location) {
    return /\/auth\/login/.test(location);
  }
  return false;
}

test.describe('admin auth gate (unauthenticated)', () => {
  for (const path of ADMIN_PAGES) {
    test(`page ${path} requires auth`, async ({ baseURL }) => {
      const ctx = await playwrightRequest.newContext({ baseURL });
      try {
        const res = await ctx.get(path, { maxRedirects: 0 });
        const status = res.status();
        const location = res.headers()['location'] ?? null;
        expect(
          isAuthRejection(status, location),
          `expected redirect to /auth/login or 401/403, got status=${status} location=${location ?? ''}`,
        ).toBeTruthy();
      } finally {
        await ctx.dispose();
      }
    });
  }

  for (const path of ADMIN_APIS) {
    test(`api ${path} requires auth`, async ({ baseURL }) => {
      const ctx = await playwrightRequest.newContext({ baseURL });
      try {
        const res = await ctx.get(path, { maxRedirects: 0 });
        const status = res.status();
        const location = res.headers()['location'] ?? null;
        expect(
          isAuthRejection(status, location),
          `expected 401/403 (or redirect), got status=${status} location=${location ?? ''}`,
        ).toBeTruthy();
      } finally {
        await ctx.dispose();
      }
    });
  }
});
