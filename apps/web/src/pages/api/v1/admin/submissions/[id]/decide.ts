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

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200);
}

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

  const [sub] = await db.select().from(schema.packageSubmission)
    .where(eq(schema.packageSubmission.id, id.data)).limit(1);
  if (!sub) return json({ error: 'not found' }, 404);
  if (sub.status !== 'pending') return json({ error: 'already decided', status: sub.status }, 409);

  const newStatus = parsed.data.action === 'approve' ? 'approved' : 'rejected';
  const now = new Date();
  let createdPackageId: number | null = sub.packageId;

  if (parsed.data.action === 'approve') {
    const slug = slugify(sub.name);
    const [pkg] = await db.insert(schema.packageTable).values({
      source: 'user',
      sourceId: `user-${sub.id}`,
      name: sub.name,
      slug,
      upstreamUrl: sub.upstreamUrl,
      rawMetadata: {
        desc: sub.summary ?? sub.description ?? null,
        submitted_by: sub.submitterUserId,
        submission_id: sub.id,
      } as unknown as Record<string, unknown>,
    }).returning({ id: schema.packageTable.id });
    createdPackageId = pkg.id;
    /* moderation_status defaults to 'approved' on package; for user submissions,
     * publication only happens after admin click. The submission row carries
     * the gate, the package row is published immediately on approve. */
  }

  await db.update(schema.packageSubmission).set({
    status: newStatus,
    decidedBy: actor,
    decidedAt: now,
    decisionNote: parsed.data.note ?? null,
    packageId: createdPackageId,
  }).where(eq(schema.packageSubmission.id, id.data));

  await logAdminAction({
    actor, action: `submission.${parsed.data.action}`,
    entityType: 'package_submission', entityId: String(id.data),
    before: { status: 'pending' },
    after: { status: newStatus, packageId: createdPackageId, note: parsed.data.note ?? null },
  });

  return json({ ok: true, status: newStatus, packageId: createdPackageId });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
