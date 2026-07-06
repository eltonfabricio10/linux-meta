/** Project health enrich worker.
 *
 *  For packages with upstream_url on GitHub/GitLab/Codeberg, hits forge API,
 *  records last push, open issues, status.
 *
 *  Env: LIMIT (default 50), GH_TOKEN, DRY_RUN
 */
import { sql } from 'drizzle-orm';
import { db, schema } from '@linux-meta/db';

const LIMIT = Math.max(1, Number(process.env.LIMIT ?? 50));
const DRY = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const GH_TOKEN = process.env.GH_TOKEN ?? '';

type Candidate = { id: number; name: string; upstreamUrl: string };

type HostInfo = { host: 'github' | 'gitlab' | 'codeberg'; slug: string };

function parseHost(url: string): HostInfo | null {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (path.length < 2) return null;
    const slug = `${path[0]}/${path[1]!.replace(/\.git$/, '')}`;
    if (u.hostname === 'github.com' || u.hostname === 'www.github.com') return { host: 'github', slug };
    if (u.hostname === 'gitlab.com' || u.hostname === 'www.gitlab.com') return { host: 'gitlab', slug };
    if (u.hostname === 'codeberg.org') return { host: 'codeberg', slug };
    return null;
  } catch {
    return null;
  }
}

type HealthData = {
  lastCommitAt: Date | null;
  issuesOpen: number | null;
  issuesClosed: number | null;
};

async function fetchGitHub(slug: string): Promise<HealthData | null> {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
  if (GH_TOKEN) headers.authorization = `Bearer ${GH_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${slug}`, { headers });
  if (!res.ok) return null;
  const j = (await res.json()) as { pushed_at?: string; open_issues_count?: number };
  return {
    lastCommitAt: j.pushed_at ? new Date(j.pushed_at) : null,
    issuesOpen: j.open_issues_count ?? null,
    issuesClosed: null,
  };
}

async function fetchGitLab(slug: string): Promise<HealthData | null> {
  const enc = encodeURIComponent(slug);
  const res = await fetch(`https://gitlab.com/api/v4/projects/${enc}`);
  if (!res.ok) return null;
  const j = (await res.json()) as { last_activity_at?: string; open_issues_count?: number };
  return {
    lastCommitAt: j.last_activity_at ? new Date(j.last_activity_at) : null,
    issuesOpen: j.open_issues_count ?? null,
    issuesClosed: null,
  };
}

async function fetchCodeberg(slug: string): Promise<HealthData | null> {
  const res = await fetch(`https://codeberg.org/api/v1/repos/${slug}`);
  if (!res.ok) return null;
  const j = (await res.json()) as { updated_at?: string; open_issues_count?: number };
  return {
    lastCommitAt: j.updated_at ? new Date(j.updated_at) : null,
    issuesOpen: j.open_issues_count ?? null,
    issuesClosed: null,
  };
}

function classifyStatus(lastCommit: Date | null): 'active' | 'maintained' | 'abandoned' | 'unknown' {
  if (!lastCommit) return 'unknown';
  const days = (Date.now() - lastCommit.getTime()) / 86400000;
  if (days <= 90) return 'active';
  if (days <= 365) return 'maintained';
  return 'abandoned';
}

async function pickCandidates(): Promise<Candidate[]> {
  return db.execute<Candidate>(sql`
    SELECT p.id, p.name, p.upstream_url AS "upstreamUrl"
    FROM package p
    LEFT JOIN project_health ph ON ph.package_id = p.id
    WHERE p.upstream_url IS NOT NULL
      AND ph.package_id IS NULL
      AND (
        p.upstream_url ILIKE '%github.com/%'
        OR p.upstream_url ILIKE '%gitlab.com/%'
        OR p.upstream_url ILIKE '%codeberg.org/%'
      )
    ORDER BY p.popularity DESC, p.id ASC
    LIMIT ${LIMIT}
  `);
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const candidates = await pickCandidates();
  process.stderr.write(`[enrich/health] candidates=${candidates.length} dry=${DRY} gh_token=${GH_TOKEN ? 'yes' : 'no'}\n`);
  if (candidates.length === 0) {
    process.stderr.write(`[enrich/health] nothing to do.\n`);
    process.exit(0);
  }

  let ok = 0, fail = 0, skip = 0;
  for (const c of candidates) {
    const host = parseHost(c.upstreamUrl);
    if (!host) { skip++; continue; }
    try {
      let data: HealthData | null = null;
      if (host.host === 'github') data = await fetchGitHub(host.slug);
      else if (host.host === 'gitlab') data = await fetchGitLab(host.slug);
      else data = await fetchCodeberg(host.slug);
      if (!data) {
        skip++;
        process.stderr.write(`[enrich/health] · id=${c.id} ${c.name} ${host.host}:${host.slug} no data\n`);
        continue;
      }
      const status = classifyStatus(data.lastCommitAt);
      if (!DRY) {
        await db.insert(schema.projectHealth).values({
          packageId: c.id,
          lastCommitAt: data.lastCommitAt,
          issuesOpen: data.issuesOpen,
          issuesClosed: data.issuesClosed,
          status,
          host: host.host,
          repoSlug: host.slug,
        }).onConflictDoUpdate({
          target: schema.projectHealth.packageId,
          set: {
            lastCommitAt: data.lastCommitAt,
            issuesOpen: data.issuesOpen,
            issuesClosed: data.issuesClosed,
            status, host: host.host, repoSlug: host.slug,
            checkedAt: sql`now()`,
          },
        });
      }
      ok++;
      process.stderr.write(`[enrich/health] ✓ id=${c.id} ${c.name} ${host.host}:${host.slug} → ${status}\n`);
    } catch (e) {
      fail++;
      process.stderr.write(`[enrich/health] ✗ id=${c.id} ${c.name}: ${(e as Error).message}\n`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  await db.insert(schema.auditLog).values({
    actor: 'system',
    action: 'enrich_health_run',
    entityType: 'enrich',
    after: { attempted: candidates.length, ok, skip, fail, durationMs: Date.now() - startedAt, dry: DRY },
  });

  process.stderr.write(`[enrich/health] DONE ok=${ok} skip=${skip} fail=${fail} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
