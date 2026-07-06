/** Admin ratings — single delete by id.  Audited.  Roles: reviewer, admin. */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '~/lib/db';
import { getUserRole, hasRole } from '~/lib/roles';
import { logAdminAction } from '~/lib/audit';

export const prerender = false;

const IdSchema = z.coerce.number().int().positive();

export const DELETE: APIRoute = async ({ params, locals }) => {
  const actor = locals.user?.id;
  const role = await getUserRole(actor);
  if (!hasRole(role, ['reviewer', 'admin']) || !actor) return json({ error: 'forbidden' }, 403);

  const parsed = IdSchema.safeParse(params.id);
  if (!parsed.success) return json({ error: 'invalid id' }, 422);

  const [existing] = await db
    .select()
    .from(schema.rating)
    .where(eq(schema.rating.id, parsed.data))
    .limit(1);
  if (!existing) return json({ error: 'not found' }, 404);

  await db.delete(schema.rating).where(eq(schema.rating.id, parsed.data));

  await logAdminAction({
    actor,
    action: 'rating.delete',
    entityType: 'rating',
    entityId: String(parsed.data),
    before: existing,
    after: null,
  });

  return json({ ok: true, id: parsed.data });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
