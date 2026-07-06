import type { APIRoute } from 'astro';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '~/lib/db';
import { logAdminAction } from '~/lib/audit';

export const prerender = false;

const BodySchema = z.object({
  requestedRole: z.enum(['reviewer', 'translator', 'contributor']),
  bio: z.string().trim().min(40).max(4000),
  areas: z.string().trim().max(500).optional(),
  languages: z.string().trim().max(200).optional(),
  links: z.string().trim().max(1000).optional(),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'login required' }, 401);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'invalid body', issues: parsed.error.issues }, 422);

  const [pending] = await db.select({ id: schema.volunteerApplication.id })
    .from(schema.volunteerApplication)
    .where(and(
      eq(schema.volunteerApplication.userId, user.id),
      eq(schema.volunteerApplication.status, 'pending'),
    ))
    .limit(1);
  if (pending) return json({ error: 'pending application exists', id: pending.id }, 409);

  const [row] = await db.insert(schema.volunteerApplication).values({
    userId: user.id,
    requestedRole: parsed.data.requestedRole,
    bio: parsed.data.bio,
    areas: parsed.data.areas ?? null,
    languages: parsed.data.languages ?? null,
    links: parsed.data.links ?? null,
  }).returning({ id: schema.volunteerApplication.id });

  await logAdminAction({
    actor: user.id,
    action: 'application.create',
    entityType: 'volunteer_application',
    entityId: String(row.id),
    after: { requestedRole: parsed.data.requestedRole },
  });

  return json({ ok: true, id: row.id }, 201);
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
