import { test, expect } from '@playwright/test';

test('signup, promote to reviewer, file a dispute, then resolve via admin API', async ({ page, request, context }) => {
  const email = `e2e-${Date.now()}@example.org`;
  const password = 'playwright-secret-123';

  // Visit signup page (covers UI render path) but signup via API to avoid
  // the bundled auth-client baseURL pointing at the wrong port in dev.
  await page.goto('/pt/auth/signup');
  await expect(page.locator('input[type="email"]')).toBeVisible();

  const signupRes = await request.post('/api/auth/sign-up/email', {
    data: { email, password, name: 'e2e' },
  });
  expect(signupRes.ok(), `signup failed: ${signupRes.status()}`).toBeTruthy();

  // Promote ourselves to reviewer via test-only endpoint
  const promoteRes = await request.post('/api/v1/test-only/promote', {
    data: { email, role: 'reviewer' },
  });
  expect(promoteRes.ok()).toBeTruthy();

  // Carry session cookies from request context into the browser context
  const reqCookies = await request.storageState();
  await context.addCookies(reqCookies.cookies);

  // File a dispute on package id 1572 via the form
  await page.goto('/pt/disputar/1572');
  const textarea = page.locator('textarea');
  await expect(textarea).toBeVisible({ timeout: 10_000 });
  await textarea.fill('Esta classificacao parece inadequada para o conteudo apresentado. Justificativa: teste e2e automatizado para verificacao do fluxo de disputa.');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('[role="status"]').first()).toBeVisible({ timeout: 10_000 });

  // Find the dispute via admin API (uses request context cookies)
  const listRes = await request.get('/api/v1/admin/disputes?status=open');
  expect(listRes.ok(), `list failed: ${listRes.status()}`).toBeTruthy();
  const list = await listRes.json();
  expect(Array.isArray(list.items)).toBeTruthy();
  const mine = list.items.find((d: any) => d.packageId === 1572 && d.reporterEmail === email);
  expect(mine, 'dispute should be findable').toBeTruthy();

  // PATCH to resolved
  const patchRes = await request.patch(`/api/v1/disputes/${mine.id}`, {
    data: { status: 'resolved' },
  });
  expect(patchRes.ok(), `patch failed: ${patchRes.status()}`).toBeTruthy();
  const patched = await patchRes.json();
  expect(patched.status).toBe('resolved');
});
