/** Public provenance metrics endpoint (Fase 5).
 *
 * No auth. Cache 5 min in-memory inside getProvenanceBreakdown() and 5 min
 * downstream via cache-control. Honest by default: every count is a SQL
 * COUNT(*) FILTER(...) against the live DB; no derivation invented.
 */
import type { APIRoute } from 'astro';
import { getProvenanceBreakdown } from '~/lib/stats';

export const prerender = false;

export const GET: APIRoute = async () => {
  const data = await getProvenanceBreakdown();
  const body = JSON.stringify({ version: 1, generated_at: data.generated_at, data });
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
};
