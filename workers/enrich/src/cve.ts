/** CVE enrich worker (OSV.dev).
 *
 *  For top-N packages by popularity (with upstream_url), queries OSV.dev.
 *  Inserts cve_link rows for any returned vulnerabilities. Skips silently
 *  when none found. Throttle to 2 req/s.
 *
 *  Env: LIMIT (default 50), DRY_RUN
 */
import { sql } from 'drizzle-orm';
import { db, schema } from '@linux-meta/db';

const LIMIT = Math.max(1, Number(process.env.LIMIT ?? 50));
const DRY = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

type Candidate = { id: number; name: string; source: string; sourceId: string };

type OsvVuln = {
  id: string;
  summary?: string;
  details?: string;
  database_specific?: { severity?: string };
  severity?: Array<{ type: string; score: string }>;
  affected?: Array<{
    ranges?: Array<{ events?: Array<{ fixed?: string }> }>;
  }>;
};

const ECOSYSTEMS = ['Arch Linux', 'Debian', 'Alpine', 'Ubuntu'];

async function pickCandidates(): Promise<Candidate[]> {
  return db.execute<Candidate>(sql`
    SELECT p.id, p.name, p.source, p.source_id AS "sourceId"
    FROM package p
    WHERE p.upstream_url IS NOT NULL
    ORDER BY p.popularity DESC, p.id ASC
    LIMIT ${LIMIT}
  `);
}

async function osvQuery(name: string): Promise<OsvVuln[]> {
  // Try generic name-only query; OSV will match across ecosystems.
  for (const ecosystem of ECOSYSTEMS) {
    const res = await fetch('https://api.osv.dev/v1/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ package: { ecosystem, name } }),
    });
    if (!res.ok) continue;
    const json = (await res.json()) as { vulns?: OsvVuln[] };
    if (json.vulns?.length) return json.vulns;
  }
  return [];
}

function pickSeverity(v: OsvVuln): 'low' | 'medium' | 'high' | 'critical' | 'unknown' {
  const dsev = v.database_specific?.severity?.toLowerCase();
  if (dsev === 'critical' || dsev === 'high' || dsev === 'medium' || dsev === 'low') return dsev;
  const cvss = v.severity?.find((s) => s.type === 'CVSS_V3')?.score;
  if (cvss) {
    const m = /(\d+(\.\d+)?)/.exec(cvss);
    const n = m ? Number(m[1]) : NaN;
    if (n >= 9) return 'critical';
    if (n >= 7) return 'high';
    if (n >= 4) return 'medium';
    if (n > 0) return 'low';
  }
  return 'unknown';
}

function pickFixedVersion(v: OsvVuln): string | null {
  for (const aff of v.affected ?? []) {
    for (const rng of aff.ranges ?? []) {
      for (const ev of rng.events ?? []) {
        if (ev.fixed) return ev.fixed;
      }
    }
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const startedAt = Date.now();
  const candidates = await pickCandidates();
  process.stderr.write(`[enrich/cve] candidates=${candidates.length} dry=${DRY}\n`);
  if (candidates.length === 0) {
    process.stderr.write(`[enrich/cve] nothing to do.\n`);
    process.exit(0);
  }

  let queried = 0, found = 0, inserted = 0, fail = 0;
  for (const c of candidates) {
    try {
      const vulns = await osvQuery(c.name);
      queried++;
      if (vulns.length === 0) {
        process.stderr.write(`[enrich/cve] · id=${c.id} ${c.name} clean\n`);
      } else {
        found += vulns.length;
        for (const v of vulns) {
          const sev = pickSeverity(v);
          const fixed = pickFixedVersion(v);
          if (!DRY) {
            await db.insert(schema.cveLink).values({
              packageId: c.id, cveId: v.id.slice(0, 32), severity: sev,
              summary: v.summary ?? v.details?.slice(0, 240) ?? null,
              fixedInVersion: fixed,
            });
            inserted++;
          }
        }
        process.stderr.write(`[enrich/cve] ✓ id=${c.id} ${c.name} → ${vulns.length} vuln(s)\n`);
      }
    } catch (e) {
      fail++;
      process.stderr.write(`[enrich/cve] ✗ id=${c.id} ${c.name}: ${(e as Error).message}\n`);
    }
    await sleep(500);
  }

  await db.insert(schema.auditLog).values({
    actor: 'system',
    action: 'enrich_cve_run',
    entityType: 'enrich',
    after: { queried, found, inserted, fail, durationMs: Date.now() - startedAt, dry: DRY },
  });

  process.stderr.write(`[enrich/cve] DONE queried=${queried} found=${found} inserted=${inserted} fail=${fail} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
