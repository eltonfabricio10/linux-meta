import type { APIRoute } from 'astro';
import { z } from 'zod';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { db, schema } from '~/lib/db';
import { getUserRole, hasRole } from '~/lib/roles';

export const prerender = false;

const QuerySchema = z.object({
  status: z.enum(['running', 'success', 'error']).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const GET: APIRoute = async ({ params, url, locals }) => {
  const role = await getUserRole(locals.user?.id);
  if (!hasRole(role, ['admin'])) return json({ error: 'forbidden' }, 403);

  const name = String(params.name ?? '').trim();
  if (!name) return json({ error: 'missing worker name' }, 422);

  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return json({ error: 'invalid query', issues: parsed.error.issues }, 422);
  const q = parsed.data;

  const filters = [eq(schema.workerRun.worker, name)];
  if (q.status) filters.push(eq(schema.workerRun.status, q.status));
  if (q.from)   filters.push(gte(schema.workerRun.startedAt, new Date(q.from)));
  if (q.to)     filters.push(lte(schema.workerRun.startedAt, new Date(q.to)));

  const offset = (q.page - 1) * q.pageSize;
  const rows = await db
    .select()
    .from(schema.workerRun)
    .where(and(...filters))
    .orderBy(desc(schema.workerRun.startedAt))
    .limit(q.pageSize)
    .offset(offset);

  return json({ items: rows, page: q.page, pageSize: q.pageSize, count: rows.length });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
