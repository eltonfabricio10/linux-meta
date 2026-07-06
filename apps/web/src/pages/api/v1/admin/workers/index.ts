import type { APIRoute } from 'astro';
import { sql } from 'drizzle-orm';
import { db } from '~/lib/db';
import { getUserRole, hasRole } from '~/lib/roles';

export const prerender = false;

type AggRow = {
  worker: string;
  last_run: string | null;
  last_status: string | null;
  runs_24h: number;
  items_24h: number;
  errors_24h: number;
  currently_running: number;
  [k: string]: unknown;
};

export const GET: APIRoute = async ({ locals }) => {
  const role = await getUserRole(locals.user?.id);
  if (!hasRole(role, ['admin'])) return json({ error: 'forbidden' }, 403);

  const rows = await db.execute<AggRow>(sql`
    WITH last_run AS (
      SELECT DISTINCT ON (worker) worker, started_at, status
      FROM worker_run
      ORDER BY worker, started_at DESC
    ),
    agg24 AS (
      SELECT worker,
             COUNT(*)::int                                         AS runs_24h,
             COALESCE(SUM(items_processed), 0)::int                AS items_24h,
             COALESCE(SUM(errors_count), 0)::int                   AS errors_24h
      FROM worker_run
      WHERE started_at > NOW() - INTERVAL '24 hours'
      GROUP BY worker
    ),
    running AS (
      SELECT worker, COUNT(*)::int AS currently_running
      FROM worker_run
      WHERE status = 'running'
      GROUP BY worker
    ),
    workers AS (
      SELECT DISTINCT worker FROM worker_run
    )
    SELECT w.worker,
           lr.started_at  AS last_run,
           lr.status      AS last_status,
           COALESCE(a.runs_24h, 0)            AS runs_24h,
           COALESCE(a.items_24h, 0)           AS items_24h,
           COALESCE(a.errors_24h, 0)          AS errors_24h,
           COALESCE(r.currently_running, 0)   AS currently_running
    FROM workers w
    LEFT JOIN last_run lr USING (worker)
    LEFT JOIN agg24 a    USING (worker)
    LEFT JOIN running r  USING (worker)
    ORDER BY w.worker
  `);

  return json({ items: rows as unknown as AggRow[], count: (rows as unknown as AggRow[]).length });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
