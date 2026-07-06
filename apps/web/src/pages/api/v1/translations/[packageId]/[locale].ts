import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db, schema } from '~/lib/db';
import { and, eq } from 'drizzle-orm';
import { getUserRole, hasRole } from '~/lib/roles';

export const prerender = false;

const BodySchema = z.object({
  status: z.enum(['draft', 'reviewed', 'official']),
  summary: z.string().trim().max(4000).optional(),
  description: z.string().trim().max(20000).optional(),
  plainExplanation: z.string().trim().max(20000).optional(),
});

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  const role = await getUserRole(locals.user?.id);
  if (!hasRole(role, ['translator', 'reviewer', 'admin'])) {
    return json({ error: 'forbidden' }, 403);
  }

  const pkgId = params.packageId ? Number(params.packageId) : NaN;
  const locale = params.locale;
  if (!Number.isInteger(pkgId) || pkgId <= 0) return json({ error: 'invalid packageId' }, 422);
  if (!locale || locale.length < 2 || locale.length > 8) return json({ error: 'invalid locale' }, 422);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'invalid body', issues: parsed.error.issues }, 422);

  // Translators can only set status=reviewed; only reviewer/admin can publish 'official'.
  if (parsed.data.status === 'official' && !hasRole(role, ['reviewer', 'admin'])) {
    return json({ error: 'forbidden' }, 403);
  }

  const existing = await db.query.packageTranslation.findFirst({
    where: (t, { eq, and }) => and(eq(t.packageId, pkgId), eq(t.locale, locale)),
  });
  if (!existing) return json({ error: 'not found' }, 404);

  const userId = locals.user!.id;
  const patch: Record<string, unknown> = {
    status: parsed.data.status,
    reviewedBy: userId,
    updatedAt: new Date(),
  };
  if (parsed.data.summary !== undefined) patch.summary = parsed.data.summary;
  if (parsed.data.description !== undefined) patch.description = parsed.data.description;
  if (parsed.data.plainExplanation !== undefined) patch.plainExplanation = parsed.data.plainExplanation;

  /* Provenance correctness: a human editing content and marking it reviewed/official
   * makes this a human-authored row. Without this, getProvenanceBreakdown keeps
   * counting AI-drafted-then-edited rows as AI and undercounts human work. */
  const editedContent =
    parsed.data.summary !== undefined ||
    parsed.data.description !== undefined ||
    parsed.data.plainExplanation !== undefined;
  if (editedContent && parsed.data.status !== 'draft') {
    patch.translatedBy = 'human';
    if (parsed.data.summary !== undefined) patch.summarySource = 'human';
    if (parsed.data.description !== undefined) patch.descriptionSource = 'human';
    if (parsed.data.plainExplanation !== undefined) patch.plainExplanationSource = 'human';
  }

  await db
    .update(schema.packageTranslation)
    .set(patch)
    .where(and(
      eq(schema.packageTranslation.packageId, pkgId),
      eq(schema.packageTranslation.locale, locale),
    ));

  await db.insert(schema.auditLog).values({
    actor: userId,
    action: 'translation_review',
    entityType: 'package_translation',
    entityId: `${pkgId}:${locale}`,
    before: { status: existing.status, translatedBy: existing.translatedBy },
    after: { status: parsed.data.status, translatedBy: patch.translatedBy ?? existing.translatedBy },
  });

  return json({ packageId: pkgId, locale, status: parsed.data.status });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
