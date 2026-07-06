import type { APIRoute } from 'astro';
import { searchPackages } from '~/lib/packages';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get('q') ?? '';
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 25)));
  if (q.trim().length === 0) {
    return json({ query: q, count: 0, results: [] });
  }
  const hits = await searchPackages(q, limit);
  return json(
    { query: q, count: hits.length, results: hits },
    { 'cache-control': 'public, max-age=60, s-maxage=600' },
  );
};

function json(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}
