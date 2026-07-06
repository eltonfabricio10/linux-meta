import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db, schema } from '~/lib/db';
import { logAdminAction } from '~/lib/audit';

export const prerender = false;

const BodySchema = z.object({
  name: z.string().trim().min(2).max(160),
  upstreamUrl: z.url().trim().max(2000).optional(),
  summary: z.string().trim().max(500).optional(),
  description: z.string().trim().max(8000).optional(),
  justification: z.string().trim().min(20).max(2000),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'login required' }, 401);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'invalid body', issues: parsed.error.issues }, 422);

  const [row] = await db.insert(schema.packageSubmission).values({
    submitterUserId: user.id,
    name: parsed.data.name,
    upstreamUrl: parsed.data.upstreamUrl ?? null,
    summary: parsed.data.summary ?? null,
    description: parsed.data.description ?? null,
    justification: parsed.data.justification,
  }).returning({ id: schema.packageSubmission.id });

  await logAdminAction({
    actor: user.id,
    action: 'submission.create',
    entityType: 'package_submission',
    entityId: String(row.id),
    after: { name: parsed.data.name },
  });

  return json({ ok: true, id: row.id }, 201);
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
