/** Admin ratings — bulk operations.  Audited per id.  Roles: reviewer, admin. */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { inArray } from 'drizzle-orm';
import { db, schema } from '~/lib/db';
import { getUserRole, hasRole } from '~/lib/roles';
import { logAdminAction } from '~/lib/audit';

export const prerender = false;

const BodySchema = z.object({
  action: z.literal('delete'),
  ids: z.array(z.number().int().positive()).min(1).max(200),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const actor = locals.user?.id;
  const role = await getUserRole(actor);
  if (!hasRole(role, ['reviewer', 'admin']) || !actor) return json({ error: 'forbidden' }, 403);

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid body', issues: parsed.error.issues }, 422);

  const existing = await db
    .select()
    .from(schema.rating)
    .where(inArray(schema.rating.id, parsed.data.ids));
  if (existing.length === 0) return json({ ok: true, deleted: 0 });

  await db.delete(schema.rating).where(inArray(schema.rating.id, existing.map((r) => r.id)));

  for (const row of existing) {
    await logAdminAction({
      actor,
      action: 'rating.delete',
      entityType: 'rating',
      entityId: String(row.id),
      before: row,
      after: null,
    });
  }

  return json({ ok: true, deleted: existing.length });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
