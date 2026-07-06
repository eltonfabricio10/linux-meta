/** Admin dispute mediation actions.
 *
 *  POST body { action: 'comment'|'status'|'resolve'|'dismiss', ... }
 *
 *  - comment   : append a mediator note (stored in audit_log only — no comment
 *                table exists; the audit log is the authoritative trail).
 *  - status    : { to: 'open'|'reviewing' } — moves the dispute between
 *                triage states.
 *  - resolve   : { reason: string } — sets status='resolved', stamps
 *                resolved_by + resolved_at.
 *  - dismiss   : { reason: string } — sets status='rejected', stamps
 *                resolved_by + resolved_at.
 *
 *  Roles: reviewer, admin.  Every mutation produces an audit entry.
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '~/lib/db';
import { getUserRole, hasRole } from '~/lib/roles';
import { logAdminAction } from '~/lib/audit';

export const prerender = false;

const IdSchema = z.coerce.number().int().positive();

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('comment'), text: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal('status'), to: z.enum(['open', 'reviewing']) }),
  z.object({ action: z.literal('resolve'), reason: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal('dismiss'), reason: z.string().trim().min(1).max(4000) }),
]);

export const POST: APIRoute = async ({ params, request, locals }) => {
  const actor = locals.user?.id;
  const role = await getUserRole(actor);
  if (!hasRole(role, ['reviewer', 'admin']) || !actor) return json({ error: 'forbidden' }, 403);

  const id = IdSchema.safeParse(params.id);
  if (!id.success) return json({ error: 'invalid id' }, 422);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'invalid body', issues: parsed.error.issues }, 422);

  const [existing] = await db
    .select()
    .from(schema.dispute)
    .where(eq(schema.dispute.id, id.data))
    .limit(1);
  if (!existing) return json({ error: 'not found' }, 404);

  if (parsed.data.action === 'comment') {
    await logAdminAction({
      actor,
      action: 'dispute.comment',
      entityType: 'dispute',
      entityId: String(id.data),
      after: { text: parsed.data.text },
    });
    return json({ ok: true });
  }

  if (parsed.data.action === 'status') {
    const before = { status: existing.status };
    await db
      .update(schema.dispute)
      .set({ status: parsed.data.to })
      .where(eq(schema.dispute.id, id.data));
    await logAdminAction({
      actor,
      action: 'dispute.status.update',
      entityType: 'dispute',
      entityId: String(id.data),
      before,
      after: { status: parsed.data.to },
    });
    return json({ ok: true, status: parsed.data.to });
  }

  // resolve | dismiss
  const newStatus = parsed.data.action === 'resolve' ? 'resolved' : 'rejected';
  const now = new Date();
  await db
    .update(schema.dispute)
    .set({ status: newStatus, resolvedBy: actor, resolvedAt: now })
    .where(eq(schema.dispute.id, id.data));
  await logAdminAction({
    actor,
    action: `dispute.${parsed.data.action}`,
    entityType: 'dispute',
    entityId: String(id.data),
    before: { status: existing.status, resolvedBy: existing.resolvedBy },
    after: { status: newStatus, resolvedBy: actor, reason: parsed.data.reason },
  });
  return json({ ok: true, status: newStatus });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
