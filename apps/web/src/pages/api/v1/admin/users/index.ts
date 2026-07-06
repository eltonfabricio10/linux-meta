import type { APIRoute } from 'astro';
import { z } from 'zod';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db, schema } from '~/lib/db';
import { getUserRole, hasRole, type Role } from '~/lib/roles';

export const prerender = false;

const RoleEnum = z.enum(['visitor', 'contributor', 'translator', 'reviewer', 'admin']);

const QuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  role: RoleEnum.optional(),
  banned: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const GET: APIRoute = async ({ url, locals }) => {
  const role = await getUserRole(locals.user?.id);
  if (!hasRole(role, ['admin'])) return json({ error: 'forbidden' }, 403);

  const parsed = QuerySchema.safeParse({
    q: url.searchParams.get('q') ?? undefined,
    role: url.searchParams.get('role') ?? undefined,
    banned: url.searchParams.get('banned') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });
  if (!parsed.success) {
    return json({ error: 'invalid query', issues: parsed.error.issues }, 422);
  }
  const { q, role: roleFilter, banned, limit, offset } = parsed.data;

  const filters = [];
  if (q) {
    const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    filters.push(or(ilike(schema.user.name, pattern), ilike(schema.user.email, pattern))!);
  }
  if (roleFilter) filters.push(eq(schema.user.role, roleFilter));
  if (banned) filters.push(eq(schema.user.banned, banned === 'true'));
  const whereExpr = filters.length > 0 ? and(...filters) : undefined;

  const sessionCountSql = sql<number>`(
    select count(*)::int from ${schema.session}
    where ${schema.session.userId} = ${schema.user.id}
      and ${schema.session.expiresAt} > now()
  )`;

  const rowsQuery = db
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
      sessionCount: sessionCountSql,
    })
    .from(schema.user)
    .orderBy(desc(schema.user.createdAt))
    .limit(limit)
    .offset(offset);

  const totalQuery = db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.user);

  const rows = await (whereExpr ? rowsQuery.where(whereExpr) : rowsQuery);
  const totalRow = await (whereExpr ? totalQuery.where(whereExpr) : totalQuery);
  const total = totalRow[0]?.n ?? 0;

  return json({
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role as Role,
      banned: r.banned,
      bannedReason: r.bannedReason,
      bannedAt: r.bannedAt,
      emailVerified: r.emailVerified,
      createdAt: r.createdAt,
      sessionCount: r.sessionCount,
    })),
    total,
    limit,
    offset,
  });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
