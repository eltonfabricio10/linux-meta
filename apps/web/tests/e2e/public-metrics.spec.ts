/**
 * Public metrics & transparency surfaces. No auth required.
 *
 * Asserts JSON shape of /api/v1/metrics and /api/v1/status, plus that the
 * Portuguese transparency / governance / status pages render the right
 * provenance-flavoured copy (and not forbidden marketing claims).
 */
import { test, expect } from '@playwright/test';

test('GET /api/v1/metrics returns provenance breakdown', async ({ request }) => {
  const res = await request.get('/api/v1/metrics');
  expect(res.status(), 'metrics should be public').toBe(200);
  expect(res.headers()['cache-control'], 'metrics must declare cache-control').toBeTruthy();

  const body = await res.json();
  expect(body.version).toBe(1);
  expect(typeof body.generated_at).toBe('string');
  expect(body.data).toBeTruthy();
  expect(body.data.translations).toBeTruthy();
});

test('GET /api/v1/status returns worker array', async ({ request }) => {
  const res = await request.get('/api/v1/status');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.workers), 'workers must be an array').toBeTruthy();
});

test('pt/transparencia renders provenance language', async ({ request }) => {
  const res = await request.get('/pt/transparencia');
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toMatch(/import(ed|adas|ado)/i);
  expect(body).not.toMatch(/SLA/i);
  expect(body).not.toMatch(/first to integrate/i);
});

test('pt/governanca describes contestation and governance', async ({ request }) => {
  const res = await request.get('/pt/governanca');
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toMatch(/contestar|governan(c|ç)a/i);
});

test('pt/status renders worker-related text', async ({ request }) => {
  const res = await request.get('/pt/status');
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toMatch(/worker|fila|queue|ingest|classify|translate/i);
});
