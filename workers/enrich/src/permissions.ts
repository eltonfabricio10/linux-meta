/** Permissions enrich worker (Flathub).
 *
 *  Picks Flathub packages without a permission_analysis row, fetches
 *  https://flathub.org/api/v2/appstream/<app-id> which includes a
 *  `permissions` block parsed from the manifest, classifies risk, upserts.
 *
 *  Env: LIMIT (default 200), DRY_RUN
 */
import { sql } from 'drizzle-orm';
import { db, schema } from '@linux-meta/db';

const LIMIT = Math.max(1, Number(process.env.LIMIT ?? 200));
const DRY = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

type Candidate = { id: number; name: string; sourceId: string };

type FlathubPerms = {
  shared?: string[];
  sockets?: string[];
  devices?: string[];
  filesystems?: string[];
  'session-bus'?: Record<string, unknown>;
  'system-bus'?: Record<string, unknown>;
  [k: string]: unknown;
};

function classify(p: FlathubPerms): { risk: 'low' | 'medium' | 'high' | 'unknown'; summary: string } {
  const fs = (p.filesystems ?? []).map(String);
  const devs = (p.devices ?? []).map(String);
  const socks = (p.sockets ?? []).map(String);
  const shared = (p.shared ?? []).map(String);
  const bits: string[] = [];

  const hostFs = fs.some((x) => x === 'host' || x === 'home' || x.startsWith('host:'));
  const allDev = devs.includes('all');
  const sessionBus = socks.includes('session-bus') || socks.includes('system-bus');
  const network = shared.includes('network');

  if (hostFs) bits.push('host-fs');
  if (allDev) bits.push('all-devices');
  if (sessionBus) bits.push('bus-access');
  if (network) bits.push('network');

  let risk: 'low' | 'medium' | 'high' | 'unknown' = 'unknown';
  if (hostFs || allDev || (sessionBus && network)) risk = 'high';
  else if (network || sessionBus) risk = 'medium';
  else if (fs.length || devs.length || socks.length || shared.length) risk = 'low';

  const summary = bits.length ? bits.join(', ') : 'sandboxed';
  return { risk, summary };
}

async function pickCandidates(): Promise<Candidate[]> {
  return db.execute<Candidate>(sql`
    SELECT p.id, p.name, p.source_id AS "sourceId"
    FROM package p
    LEFT JOIN permission_analysis pa
      ON pa.package_id = p.id AND pa.source = 'flathub'
    WHERE p.source = 'flathub'
      AND pa.package_id IS NULL
    ORDER BY p.popularity DESC, p.id ASC
    LIMIT ${LIMIT}
  `);
}

async function fetchPerms(appId: string): Promise<FlathubPerms | null> {
  const url = `https://flathub.org/api/v2/appstream/${encodeURIComponent(appId)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) return null;
  const json = (await res.json()) as Record<string, unknown>;
  const meta = (json['metadata'] as Record<string, unknown> | undefined) ?? {};
  // Flathub api exposes `permissions` directly under metadata in recent versions
  const perms = (meta['permissions'] as FlathubPerms | undefined)
    ?? (json['permissions'] as FlathubPerms | undefined)
    ?? null;
  return perms;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const candidates = await pickCandidates();
  process.stderr.write(`[enrich/perm] candidates=${candidates.length} dry=${DRY}\n`);
  if (candidates.length === 0) {
    process.stderr.write(`[enrich/perm] nothing to do.\n`);
    process.exit(0);
  }

  let ok = 0, fail = 0, skip = 0;
  for (const c of candidates) {
    try {
      const perms = await fetchPerms(c.sourceId);
      if (!perms || Object.keys(perms).length === 0) {
        skip++;
        process.stderr.write(`[enrich/perm] · id=${c.id} ${c.name} no perms\n`);
        if (!DRY) {
          await db.insert(schema.permissionAnalysis).values({
            packageId: c.id, source: 'flathub', perms: {}, riskLevel: 'unknown',
            summary: 'no manifest perms',
          }).onConflictDoNothing();
        }
        continue;
      }
      const { risk, summary } = classify(perms);
      if (!DRY) {
        await db.insert(schema.permissionAnalysis).values({
          packageId: c.id, source: 'flathub', perms, riskLevel: risk, summary,
        }).onConflictDoUpdate({
          target: [schema.permissionAnalysis.packageId, schema.permissionAnalysis.source],
          set: {
            perms, riskLevel: risk, summary,
            analyzedAt: sql`now()`,
          },
        });
      }
      ok++;
      process.stderr.write(`[enrich/perm] ✓ id=${c.id} ${c.name} → ${risk} (${summary})\n`);
    } catch (e) {
      fail++;
      process.stderr.write(`[enrich/perm] ✗ id=${c.id} ${c.name}: ${(e as Error).message}\n`);
    }
  }

  await db.insert(schema.auditLog).values({
    actor: 'system',
    action: 'enrich_permissions_run',
    entityType: 'enrich',
    after: { attempted: candidates.length, ok, fail, skip, durationMs: Date.now() - startedAt, dry: DRY },
  });

  process.stderr.write(`[enrich/perm] DONE ok=${ok} skip=${skip} fail=${fail} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
