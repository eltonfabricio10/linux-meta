/** Admin reviewer onboarding queue.
 *
 * GET  → list users with role in {contributor, translator, reviewer} plus
 *        contribution stats (ratings authored last 90 days, disputes mediated,
 *        last activity timestamp).  Admin-only.
 * POST?action=promote → change a user's role to reviewer|translator.
 *        Audited; cannot self-promote; cannot demote the last admin.
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '~/lib/db';
import { getUserRole, hasRole, type Role } from '~/lib/roles';
import { logAdminAction } from '~/lib/audit';

export const prerender = false;

const CANDIDATE_ROLES = ['contributor', 'translator', 'reviewer'] as const;
const PROMOTABLE = ['contributor', 'translator', 'reviewer'] as const;

interface ReviewerRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  ratingsReviewed90d: number;
  disputesMediated: number;
  lastActivity: string | null;
}

export const GET: APIRoute = async ({ locals }) => {
  const role = await getUserRole(locals.user?.id);
  if (!hasRole(role, ['admin'])) return json({ error: 'forbidden' }, 403);

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const users = await db
    .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email, role: schema.user.role })
    .from(schema.user)
    .where(inArray(schema.user.role, CANDIDATE_ROLES as unknown as string[]))
    .orderBy(desc(schema.user.role), schema.user.email)
    .limit(500);

  if (users.length === 0) return json({ items: [], count: 0 });

  // disputes mediated: status in resolved|rejected and resolvedBy = user.id
  const mediated = await db
    .select({
      userId: schema.dispute.resolvedBy,
      n: sql<number>`count(*)::int`,
      last: sql<Date>`max(${schema.dispute.resolvedAt})`,
    })
    .from(schema.dispute)
    .where(and(isNotNull(schema.dispute.resolvedBy), inArray(schema.dispute.status, ['resolved', 'rejected'])))
    .groupBy(schema.dispute.resolvedBy);

  // ratings reviewed: translations marked reviewed/official in last 90d (proxy via reviewed_by)
  const reviewed = await db
    .select({
      userId: schema.packageTranslation.reviewedBy,
      n: sql<number>`count(*)::int`,
      last: sql<Date>`max(${schema.packageTranslation.updatedAt})`,
    })
    .from(schema.packageTranslation)
    .where(and(
      isNotNull(schema.packageTranslation.reviewedBy),
      gte(schema.packageTranslation.updatedAt, ninetyDaysAgo),
    ))
    .groupBy(schema.packageTranslation.reviewedBy);

  const mediatedByUser = new Map<string, { n: number; last: Date | null }>();
  for (const r of mediated) if (r.userId) mediatedByUser.set(r.userId, { n: r.n, last: r.last });
  const reviewedByUser = new Map<string, { n: number; last: Date | null }>();
  for (const r of reviewed) if (r.userId) reviewedByUser.set(r.userId, { n: r.n, last: r.last });

  const items: ReviewerRow[] = users.map((u) => {
    const m = mediatedByUser.get(u.id);
    const r = reviewedByUser.get(u.id);
    const last = [m?.last ?? null, r?.last ?? null]
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: (u.role as Role) ?? 'visitor',
      ratingsReviewed90d: r?.n ?? 0,
      disputesMediated: m?.n ?? 0,
      lastActivity: last ? last.toISOString() : null,
    };
  });

  return json({ items, count: items.length });
};

const PromoteBody = z.object({
  userId: z.string().min(1).max(128),
  toRole: z.enum(PROMOTABLE),
});

export const POST: APIRoute = async ({ url, request, locals }) => {
  const actor = locals.user?.id;
  const actorRole = await getUserRole(actor);
  if (!hasRole(actorRole, ['admin']) || !actor) return json({ error: 'forbidden' }, 403);

  const action = url.searchParams.get('action');
  if (action !== 'promote') return json({ error: 'unknown action' }, 400);

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const parsed = PromoteBody.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid body', issues: parsed.error.issues }, 422);

  if (parsed.data.userId === actor) return json({ error: 'cannot change own role' }, 409);

  const [target] = await db
    .select({ id: schema.user.id, role: schema.user.role })
    .from(schema.user)
    .where(eq(schema.user.id, parsed.data.userId))
    .limit(1);
  if (!target) return json({ error: 'user not found' }, 404);

  // If demoting an admin, ensure at least one admin remains.
  if (target.role === 'admin') {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.user)
      .where(eq(schema.user.role, 'admin'));
    if ((n ?? 0) <= 1) return json({ error: 'cannot demote last admin' }, 409);
  }

  await db
    .update(schema.user)
    .set({ role: parsed.data.toRole, updatedAt: new Date() })
    .where(eq(schema.user.id, parsed.data.userId));

  await logAdminAction({
    actor,
    action: 'user.role.update',
    entityType: 'user',
    entityId: parsed.data.userId,
    before: { role: target.role },
    after: { role: parsed.data.toRole },
  });

  return json({ ok: true, userId: parsed.data.userId, role: parsed.data.toRole });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
