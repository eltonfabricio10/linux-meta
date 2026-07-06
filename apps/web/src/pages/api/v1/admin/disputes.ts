import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db, schema } from '~/lib/db';
import { eq, desc } from 'drizzle-orm';
import { getUserRole, hasRole } from '~/lib/roles';

export const prerender = false;

const StatusSchema = z.enum(['open', 'reviewing', 'resolved', 'rejected']).default('open');

export const GET: APIRoute = async ({ url, locals }) => {
  const role = await getUserRole(locals.user?.id);
  if (!hasRole(role, ['reviewer', 'admin'])) return json({ error: 'forbidden' }, 403);

  const parsed = StatusSchema.safeParse(url.searchParams.get('status') ?? 'open');
  if (!parsed.success) return json({ error: 'invalid status' }, 422);

  const rows = await db
    .select({
      id: schema.dispute.id,
      packageId: schema.dispute.packageId,
      packageName: schema.packageTable.name,
      packageSlug: schema.packageTable.slug,
      suggestedAge: schema.dispute.suggestedAge,
      reason: schema.dispute.reason,
      status: schema.dispute.status,
      reporterEmail: schema.dispute.reporterEmail,
      createdAt: schema.dispute.createdAt,
    })
    .from(schema.dispute)
    .innerJoin(schema.packageTable, eq(schema.dispute.packageId, schema.packageTable.id))
    .where(eq(schema.dispute.status, parsed.data))
    .orderBy(desc(schema.dispute.createdAt))
    .limit(200);

  return json({ items: rows, count: rows.length });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
