import type { APIRoute } from 'astro';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '~/lib/db';
import { getUserRole, hasRole } from '~/lib/roles';
import { logAdminAction } from '~/lib/audit';

export const prerender = false;

const IdSchema = z.coerce.number().int().positive();
const BodySchema = z.object({
  action: z.enum(['approve', 'reject']),
  note: z.string().trim().max(2000).optional(),
});

export const POST: APIRoute = async ({ params, request, locals }) => {
  const actor = locals.user?.id;
  const role = await getUserRole(actor);
  if (!hasRole(role, ['admin']) || !actor) return json({ error: 'forbidden' }, 403);

  const id = IdSchema.safeParse(params.id);
  if (!id.success) return json({ error: 'invalid id' }, 422);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'invalid body', issues: parsed.error.issues }, 422);

  const [app] = await db.select().from(schema.volunteerApplication)
    .where(eq(schema.volunteerApplication.id, id.data)).limit(1);
  if (!app) return json({ error: 'not found' }, 404);
  if (app.status !== 'pending') return json({ error: 'already decided', status: app.status }, 409);

  const newStatus = parsed.data.action === 'approve' ? 'approved' : 'rejected';
  const now = new Date();

  await db.update(schema.volunteerApplication).set({
    status: newStatus,
    decidedBy: actor,
    decidedAt: now,
    decisionNote: parsed.data.note ?? null,
  }).where(eq(schema.volunteerApplication.id, id.data));

  if (parsed.data.action === 'approve') {
    const newRole = app.requestedRole === 'translator' ? 'translator'
      : app.requestedRole === 'reviewer' ? 'reviewer'
      : 'contributor';
    const [prev] = await db.select({ role: schema.user.role }).from(schema.user)
      .where(eq(schema.user.id, app.userId)).limit(1);
    await db.update(schema.user).set({ role: newRole })
      .where(eq(schema.user.id, app.userId));
    await logAdminAction({
      actor, action: 'user.role.update', entityType: 'user', entityId: app.userId,
      before: { role: prev?.role ?? null }, after: { role: newRole, via: 'application' },
    });
  }

  await logAdminAction({
    actor, action: `application.${parsed.data.action}`,
    entityType: 'volunteer_application', entityId: String(id.data),
    before: { status: 'pending' },
    after: { status: newStatus, note: parsed.data.note ?? null },
  });

  return json({ ok: true, status: newStatus });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
