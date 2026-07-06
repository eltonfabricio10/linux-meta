import { test, expect } from '@playwright/test';

test('GET /api/v1/packages/search?q=firefox returns results with firefox', async ({ request }) => {
  const res = await request.get('/api/v1/packages/search?q=firefox');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.count).toBeGreaterThanOrEqual(1);
  expect(String(body.results[0].slug)).toContain('firefox');
});
