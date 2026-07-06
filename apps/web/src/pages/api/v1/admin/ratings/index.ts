/** Admin ratings management — list + filters.
 *  Roles allowed: reviewer, admin.
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { and, desc, eq, gte, ilike, lte, type SQL } from 'drizzle-orm';
import { db, schema } from '~/lib/db';
import { getUserRole, hasRole } from '~/lib/roles';

export const prerender = false;

const QuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  source: z.string().trim().max(32).optional(),
  min_age: z.coerce.number().int().min(0).max(18).optional(),
  max_age: z.coerce.number().int().min(0).max(18).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const GET: APIRoute = async ({ url, locals }) => {
  const role = await getUserRole(locals.user?.id);
  if (!hasRole(role, ['reviewer', 'admin'])) return json({ error: 'forbidden' }, 403);

  const raw = Object.fromEntries(url.searchParams.entries());
  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'invalid query', issues: parsed.error.issues }, 422);
  const { q, source, min_age, max_age, limit, offset } = parsed.data;

  const conds: SQL[] = [];
  if (q && q.length > 0) conds.push(ilike(schema.packageTable.name, `%${q}%`));
  if (source) conds.push(eq(schema.rating.source, source));
  if (typeof min_age === 'number') conds.push(gte(schema.rating.ageMin, min_age));
  if (typeof max_age === 'number') conds.push(lte(schema.rating.ageMin, max_age));

  const where = conds.length > 0 ? and(...conds) : undefined;

  const rows = await db
    .select({
      id: schema.rating.id,
      packageId: schema.rating.packageId,
      packageName: schema.packageTable.name,
      packageSlug: schema.packageTable.slug,
      source: schema.rating.source,
      ageMin: schema.rating.ageMin,
      confidence: schema.rating.confidence,
      classifierVersion: schema.rating.classifierVersion,
      rationale: schema.rating.rationale,
      createdAt: schema.rating.createdAt,
    })
    .from(schema.rating)
    .innerJoin(schema.packageTable, eq(schema.rating.packageId, schema.packageTable.id))
    .where(where)
    .orderBy(desc(schema.rating.createdAt))
    .limit(limit)
    .offset(offset);

  return json({ items: rows, count: rows.length, limit, offset });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
