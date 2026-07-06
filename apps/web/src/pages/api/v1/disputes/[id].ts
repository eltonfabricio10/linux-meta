import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db, schema } from '~/lib/db';
import { eq } from 'drizzle-orm';
import { getUserRole, hasRole } from '~/lib/roles';

export const prerender = false;

const BodySchema = z.object({
  status: z.enum(['reviewing', 'resolved', 'rejected']),
  resolutionNote: z.string().trim().max(2000).optional(),
});

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  const role = await getUserRole(locals.user?.id);
  if (!hasRole(role, ['reviewer', 'admin'])) return json({ error: 'forbidden' }, 403);

  const idRaw = params.id;
  const id = idRaw ? Number(idRaw) : NaN;
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'invalid id' }, 422);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'invalid body', issues: parsed.error.issues }, 422);

  const existing = await db.query.dispute.findFirst({ where: (d, { eq }) => eq(d.id, id) });
  if (!existing) return json({ error: 'not found' }, 404);

  const now = new Date();
  const terminal = parsed.data.status === 'resolved' || parsed.data.status === 'rejected';
  const userId = locals.user!.id;

  const [updated] = await db
    .update(schema.dispute)
    .set({
      status: parsed.data.status,
      resolvedBy: terminal ? userId : null,
      resolvedAt: terminal ? now : null,
    })
    .where(eq(schema.dispute.id, id))
    .returning();

  await db.insert(schema.auditLog).values({
    actor: userId,
    action: 'dispute_status',
    entityType: 'dispute',
    entityId: String(id),
    before: { status: existing.status },
    after: { status: parsed.data.status, resolutionNote: parsed.data.resolutionNote ?? null },
  });

  return json({ id, status: updated!.status });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
