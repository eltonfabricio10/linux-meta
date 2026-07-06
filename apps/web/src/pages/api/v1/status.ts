import type { APIRoute } from 'astro';
import { sql } from 'drizzle-orm';
import { db } from '~/lib/db';

export const prerender = false;

type StatusRow = {
  worker: string;
  last_run_at: string | null;
  last_status: string | null;
  items_24h: number;
  [k: string]: unknown;
};

/** Public, unauthenticated status endpoint. Aggregates per-worker last run
 * + 24h item count. Cached for 60s at the edge. */
export const GET: APIRoute = async () => {
  const rows = await db.execute<StatusRow>(sql`
    WITH last_run AS (
      SELECT DISTINCT ON (worker) worker, started_at, status
      FROM worker_run
      ORDER BY worker, started_at DESC
    ),
    agg24 AS (
      SELECT worker, COALESCE(SUM(items_processed), 0)::int AS items_24h
      FROM worker_run
      WHERE started_at > NOW() - INTERVAL '24 hours'
      GROUP BY worker
    )
    SELECT lr.worker,
           lr.started_at  AS last_run_at,
           lr.status      AS last_status,
           COALESCE(a.items_24h, 0) AS items_24h
    FROM last_run lr
    LEFT JOIN agg24 a USING (worker)
    ORDER BY lr.worker
  `);

  const body = {
    version: 1,
    generated_at: new Date().toISOString(),
    workers: (rows as unknown as StatusRow[]).map((r) => ({
      name: r.worker,
      last_run_at: r.last_run_at,
      last_status: r.last_status,
      items_24h: r.items_24h,
    })),
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60',
    },
  });
};
