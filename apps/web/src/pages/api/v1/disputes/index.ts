import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db, schema } from '~/lib/db';

export const prerender = false;

const BodySchema = z.object({
  packageId: z.number().int().positive(),
  suggestedAge: z.number().int().min(0).max(18),
  reason: z.string().trim().min(10).max(2000),
  reporterEmail: z.email().max(254).optional().or(z.literal('')),
});

export const POST: APIRoute = async ({ request, locals }) => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'invalid body', issues: parsed.error.issues }, 422);
  }

  const reporterUserId = locals.user?.id ?? null;
  const reporterEmail = (parsed.data.reporterEmail || locals.user?.email) ?? null;

  // Anti-spam: anonymous reports require email; authed don't.
  if (!reporterUserId && !reporterEmail) {
    return json({ error: 'email required for anonymous reports' }, 422);
  }

  // Verify package exists.
  const pkg = await db.query.packageTable.findFirst({
    where: (p, { eq }) => eq(p.id, parsed.data.packageId),
    columns: { id: true },
  });
  if (!pkg) return json({ error: 'package not found' }, 404);

  const [row] = await db.insert(schema.dispute).values({
    packageId: parsed.data.packageId,
    suggestedAge: parsed.data.suggestedAge,
    reason: parsed.data.reason,
    reporterEmail,
    reporterUserId,
  }).returning({ id: schema.dispute.id });

  await db.insert(schema.auditLog).values({
    actor: reporterUserId ?? 'anonymous',
    action: 'dispute_open',
    entityType: 'dispute',
    entityId: String(row!.id),
    after: { packageId: parsed.data.packageId, suggestedAge: parsed.data.suggestedAge },
  });

  return json({ id: row!.id, status: 'open' }, 201);
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
