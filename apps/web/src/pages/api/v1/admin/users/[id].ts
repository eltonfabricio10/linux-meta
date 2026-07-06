import type { APIRoute } from 'astro';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '~/lib/db';
import { getUserRole, hasRole, type Role } from '~/lib/roles';
import { logAdminAction } from '~/lib/audit';

export const prerender = false;

const RoleEnum = z.enum(['visitor', 'contributor', 'translator', 'reviewer', 'admin']);

const PatchSchema = z
  .object({
    role: RoleEnum.optional(),
    banned: z.boolean().optional(),
    bannedReason: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((v) => v.role !== undefined || v.banned !== undefined || v.bannedReason !== undefined, {
    message: 'at least one of role/banned/bannedReason is required',
  });

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  bannedReason: string | null;
  bannedAt: Date | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
};

async function loadUser(id: string): Promise<UserRow | null> {
  const [row] = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      role: schema.user.role,
      banned: schema.user.banned,
      bannedReason: schema.user.bannedReason,
      bannedAt: schema.user.bannedAt,
      emailVerified: schema.user.emailVerified,
      createdAt: schema.user.createdAt,
      updatedAt: schema.user.updatedAt,
    })
    .from(schema.user)
    .where(eq(schema.user.id, id))
    .limit(1);
  return row ?? null;
}

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const actorId = locals.user?.id;
  const actorRole = await getUserRole(actorId);
  if (!hasRole(actorRole, ['admin'])) return json({ error: 'forbidden' }, 403);

  const targetId = params.id;
  if (!targetId || typeof targetId !== 'string') return json({ error: 'invalid id' }, 422);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 422);
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid body', issues: parsed.error.issues }, 422);
  }

  const before = await loadUser(targetId);
  if (!before) return json({ error: 'not found' }, 404);

  // Self-demote guard: an admin cannot remove their own admin role.
  if (
    actorId === targetId &&
    parsed.data.role !== undefined &&
    parsed.data.role !== 'admin'
  ) {
    return json({ error: 'cannot demote self below admin' }, 403);
  }

  const patch: Partial<{
    role: Role;
    banned: boolean;
    bannedReason: string | null;
    bannedAt: Date | null;
    updatedAt: Date;
  }> = { updatedAt: new Date() };

  if (parsed.data.role !== undefined) patch.role = parsed.data.role;
  if (parsed.data.banned !== undefined) {
    patch.banned = parsed.data.banned;
    if (parsed.data.banned) {
      patch.bannedAt = new Date();
      // banReason may also be in this same patch; otherwise leave existing
      if (parsed.data.bannedReason !== undefined) patch.bannedReason = parsed.data.bannedReason;
    } else {
      patch.bannedAt = null;
      patch.bannedReason = null;
    }
  } else if (parsed.data.bannedReason !== undefined) {
    patch.bannedReason = parsed.data.bannedReason;
  }

  await db.update(schema.user).set(patch).where(eq(schema.user.id, targetId));

  // When banning, terminate all active sessions immediately.
  let revokedSessions = 0;
  if (parsed.data.banned === true) {
    const res = await db.execute<{ id: string }>(
      sql`delete from ${schema.session} where ${schema.session.userId} = ${targetId} returning id`,
    );
    revokedSessions = (res as unknown as Array<{ id: string }>).length;
  }

  const after = await loadUser(targetId);

  const diff = computeDiff(before, after);
  await logAdminAction({
    actor: actorId ?? 'system',
    action: parsed.data.role !== undefined
      ? 'user.role.update'
      : parsed.data.banned === true
        ? 'user.ban'
        : parsed.data.banned === false
          ? 'user.unban'
          : 'user.update',
    entityType: 'user',
    entityId: targetId,
    before: diff.before,
    after: { ...diff.after, ...(revokedSessions > 0 ? { revokedSessions } : {}) },
  });

  return json({ user: after, revokedSessions });
};

const ActionSchema = z.enum(['revoke_sessions']);

export const POST: APIRoute = async ({ params, url, locals }) => {
  const actorId = locals.user?.id;
  const actorRole = await getUserRole(actorId);
  if (!hasRole(actorRole, ['admin'])) return json({ error: 'forbidden' }, 403);

  const targetId = params.id;
  if (!targetId || typeof targetId !== 'string') return json({ error: 'invalid id' }, 422);

  const actionParsed = ActionSchema.safeParse(url.searchParams.get('action'));
  if (!actionParsed.success) return json({ error: 'invalid action' }, 422);

  const target = await loadUser(targetId);
  if (!target) return json({ error: 'not found' }, 404);

  if (actionParsed.data === 'revoke_sessions') {
    const res = await db.execute<{ id: string }>(
      sql`delete from ${schema.session} where ${schema.session.userId} = ${targetId} returning id`,
    );
    const revoked = (res as unknown as Array<{ id: string }>).length;
    await logAdminAction({
      actor: actorId ?? 'system',
      action: 'user.sessions.revoke',
      entityType: 'user',
      entityId: targetId,
      before: { activeSessions: revoked },
      after: { activeSessions: 0 },
    });
    return json({ revokedSessions: revoked });
  }

  return json({ error: 'unsupported action' }, 422);
};

function computeDiff(
  before: UserRow | null,
  after: UserRow | null,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const beforeOut: Record<string, unknown> = {};
  const afterOut: Record<string, unknown> = {};
  if (!before || !after) {
    return { before: before ?? {}, after: after ?? {} };
  }
  const keys: (keyof UserRow)[] = ['role', 'banned', 'bannedReason', 'bannedAt'];
  for (const k of keys) {
    const a = serialise(before[k]);
    const b = serialise(after[k]);
    if (a !== b) {
      beforeOut[k as string] = before[k];
      afterOut[k as string] = after[k];
    }
  }
  return { before: beforeOut, after: afterOut };
}

function serialise(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
