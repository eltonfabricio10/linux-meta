/** Reviewer onboarding queue table.
 *
 *  Fetches `/api/v1/admin/reviewers` on mount, renders a list with a role
 *  selector + promote action per row.  Optimistic UI; rolls back on failure.
 *  Admin-only — server already gates; this component trusts that contract.
 */
import { useEffect, useState } from 'preact/hooks';

type Role = 'visitor' | 'contributor' | 'translator' | 'reviewer' | 'admin';

interface Row {
  id: string;
  name: string;
  email: string;
  role: Role;
  ratingsReviewed90d: number;
  disputesMediated: number;
  lastActivity: string | null;
}

export interface Labels {
  loading: string;
  empty: string;
  errorPrefix: string;
  name: string;
  email: string;
  currentRole: string;
  ratingsReviewed: string;
  disputesMediated: string;
  lastActivity: string;
  changeRole: string;
  apply: string;
  promoted: string;
  never: string;
  confirmDemote: string;
}

const ROLE_OPTIONS: Role[] = ['contributor', 'translator', 'reviewer'];

export default function ReviewerTable({ labels }: { labels: Labels }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, Role>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [okFor, setOkFor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/admin/reviewers', { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { items: Row[] };
        if (!cancelled) setRows(body.items);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'fetch failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function apply(userId: string) {
    const target = pending[userId];
    if (!target) return;
    const current = rows.find((r) => r.id === userId);
    if (!current || current.role === target) return;
    const isDemotion = roleRank(target) < roleRank(current.role);
    if (isDemotion && !confirm(labels.confirmDemote)) return;
    setBusy(userId); setErr(null);
    const prev = rows;
    setRows(rows.map((r) => (r.id === userId ? { ...r, role: target } : r)));
    try {
      const res = await fetch('/api/v1/admin/reviewers?action=promote', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, toRole: target }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setOkFor(userId);
      setTimeout(() => setOkFor((u) => (u === userId ? null : u)), 2000);
    } catch (e) {
      setRows(prev);
      setErr(e instanceof Error ? e.message : 'update failed');
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p class="rt-msg">{labels.loading}</p>;
  if (err && rows.length === 0) return <p class="rt-err">{labels.errorPrefix}: {err}</p>;
  if (rows.length === 0) return <p class="rt-msg">{labels.empty}</p>;

  return (
    <div class="rt-wrap">
      {err && <p class="rt-err">{labels.errorPrefix}: {err}</p>}
      <table class="rt">
        <thead>
          <tr>
            <th>{labels.name}</th>
            <th>{labels.email}</th>
            <th>{labels.currentRole}</th>
            <th class="num">{labels.ratingsReviewed}</th>
            <th class="num">{labels.disputesMediated}</th>
            <th>{labels.lastActivity}</th>
            <th>{labels.changeRole}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const selected = pending[r.id] ?? r.role;
            return (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td class="mono">{r.email}</td>
                <td><span class={`badge role-${r.role}`}>{r.role}</span></td>
                <td class="num">{r.ratingsReviewed90d}</td>
                <td class="num">{r.disputesMediated}</td>
                <td>{r.lastActivity ? new Date(r.lastActivity).toLocaleDateString() : labels.never}</td>
                <td>
                  <div class="row-actions">
                    <select
                      value={selected}
                      disabled={busy === r.id}
                      onChange={(e) => {
                        const v = (e.currentTarget.value || r.role) as Role;
                        setPending((p) => ({ ...p, [r.id]: v }));
                      }}
                    >
                      {ROLE_OPTIONS.map((o) => (<option value={o} key={o}>{o}</option>))}
                    </select>
                    <button
                      disabled={busy === r.id || selected === r.role}
                      onClick={() => apply(r.id)}
                    >{labels.apply}</button>
                    {okFor === r.id && <span class="ok">{labels.promoted}</span>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <style>{`
        .rt-wrap { overflow-x: auto; }
        .rt { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
        .rt th, .rt td { text-align: left; padding: var(--space-2) var(--space-3); border-block-end: 1px solid var(--color-border); vertical-align: middle; }
        .rt th { font-size: 0.78rem; color: var(--color-fg-muted); text-transform: uppercase; letter-spacing: 0.04em; }
        .rt .num { text-align: right; font-variant-numeric: tabular-nums; }
        .rt .mono { font-family: var(--font-mono, monospace); font-size: 0.85em; }
        .row-actions { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }
        select, button { font: inherit; padding: 0.35rem 0.6rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-bg-elevated); color: var(--color-fg); }
        button { cursor: pointer; }
        button:disabled, select:disabled { opacity: 0.5; cursor: not-allowed; }
        .badge { display: inline-block; padding: 0.15rem 0.55rem; border-radius: var(--radius-full); font-size: 0.78rem; font-weight: 600; background: var(--color-bg-subtle, #eee); color: var(--color-fg); }
        .badge.role-reviewer { background: var(--color-sage-100, #d8e8d4); color: var(--color-sage-700, #355c2b); }
        .badge.role-translator { background: var(--color-amber-100, #fcefc7); color: var(--color-amber-800, #7c4b00); }
        .badge.role-contributor { background: var(--color-teal-100, #d2efee); color: var(--color-teal-800, #07484a); }
        .ok { color: var(--color-sage-600, #4a7a3b); font-weight: 600; }
        .rt-msg { color: var(--color-fg-muted); }
        .rt-err { color: var(--color-terra-600, #a23b2c); }
      `}</style>
    </div>
  );
}

function roleRank(r: Role): number {
  const order: Record<Role, number> = { visitor: 0, contributor: 1, translator: 2, reviewer: 3, admin: 4 };
  return order[r] ?? 0;
}
