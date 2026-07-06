/**
 * Admin happy-path: signs up a fresh user, promotes to admin via the
 * test-only endpoint (see /api/v1/test-only/promote.ts), then asserts every
 * admin page renders without runtime errors and the users API enforces zod.
 *
 * Test-only promote endpoint returns 404 in NODE_ENV=production; these tests
 * skip gracefully when it is unavailable.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

type AdminFixture = {
  email: string;
  password: string;
};

async function seedAdmin(request: APIRequestContext): Promise<AdminFixture | null> {
  const email = `admin-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.org`;
  const password = 'playwright-admin-secret-123';

  const signup = await request.post('/api/auth/sign-up/email', {
    data: { email, password, name: 'admin-e2e' },
  });
  if (!signup.ok()) return null;

  const promote = await request.post('/api/v1/test-only/promote', {
    data: { email, role: 'admin' },
  });
  if (!promote.ok()) return null;

  return { email, password };
}

const ADMIN_PAGES: readonly string[] = [
  '/pt/admin',
  '/pt/admin/users',
  '/pt/admin/audit',
  '/pt/admin/packages',
  '/pt/admin/translations',
  '/pt/admin/reviewers',
  '/pt/admin/ratings',
  '/pt/admin/disputes',
  '/pt/admin/workers',
];

test.describe.serial('admin happy-path (with seeded admin)', () => {
  let admin: AdminFixture | null = null;

  test.beforeAll(async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL });
    try {
      admin = await seedAdmin(ctx);
    } finally {
      await ctx.dispose();
    }
  });

  test.beforeEach(async ({ context, request }) => {
    test.skip(!admin, 'admin seeding unavailable (test-only endpoint disabled?)');
    // Re-sign-in on this request context to obtain fresh cookies, then carry
    // them into the browser context so page.goto() is authenticated.
    const signin = await request.post('/api/auth/sign-in/email', {
      data: { email: admin!.email, password: admin!.password },
    });
    expect(signin.ok(), `sign-in failed: ${signin.status()}`).toBeTruthy();
    const state = await request.storageState();
    await context.addCookies(state.cookies);
  });

  for (const path of ADMIN_PAGES) {
    test(`renders ${path} without page errors`, async ({ page }) => {
      const errors: Error[] = [];
      page.on('pageerror', (e) => errors.push(e));

      const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
      expect(res?.status(), `${path} should respond 200`).toBe(200);
      // Wait a beat for any client hydration to throw.
      await page.waitForLoadState('networkidle').catch(() => undefined);
      expect(errors, `page errors on ${path}: ${errors.map((e) => e.message).join('; ')}`).toEqual([]);
    });
  }

  test('PATCH /api/v1/admin/users/[id] with invalid body returns 422', async ({ request }) => {
    // List users to find any id (avoid hardcoding).
    const list = await request.get('/api/v1/admin/users');
    expect(list.ok(), `list users: ${list.status()}`).toBeTruthy();
    const body = await list.json();
    const items: Array<{ id: string | number }> = body.items ?? body.users ?? body.data ?? [];
    test.skip(!items.length, 'no users returned to PATCH');
    const targetId = items[0].id;

    const bad = await request.patch(`/api/v1/admin/users/${targetId}`, {
      data: { role: 'not-a-real-role', email: 'not-an-email' },
    });
    expect(bad.status(), 'invalid zod body must yield 422').toBe(422);
  });

  test('PATCH /api/v1/admin/users/[id] with valid body returns 200', async ({ request }) => {
    const list = await request.get('/api/v1/admin/users');
    expect(list.ok()).toBeTruthy();
    const body = await list.json();
    const items: Array<{ id: string | number; role?: string }> = body.items ?? body.users ?? body.data ?? [];
    test.skip(!items.length, 'no users returned to PATCH');
    const target = items.find((u) => u.role !== 'admin') ?? items[0];

    const ok = await request.patch(`/api/v1/admin/users/${target.id}`, {
      data: { role: 'contributor' },
    });
    expect(ok.status(), `valid PATCH should 200, got ${ok.status()}`).toBe(200);
    // Audit log verification is intentionally skipped: no public read endpoint
    // is part of this milestone. Re-add once /api/v1/admin/audit exposes a list.
  });

  // Suppress unused-var lint of `page` parameter helper.
  test.skip('placeholder for future audit-log read', async ({ page }: { page: Page }) => {
    void page;
  });
});
