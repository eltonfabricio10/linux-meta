/** Rating moderation table.
 *
 *  Hydrated from server-rendered initialItems (Astro passes them in as a prop)
 *  to avoid double round-trips.  Supports per-row delete and bulk delete with
 *  checkbox selection.  Optimistic updates with rollback on failure.
 */
import { useMemo, useState } from 'preact/hooks';

export interface RatingItem {
  id: number;
  packageId: number;
  packageName: string;
  packageSlug: string;
  source: string;
  ageMin: number;
  confidence: number;
  classifierVersion: string | null;
  rationale: string | null;
  createdAt: string;
}

export interface RatingLabels {
  empty: string;
  errorPrefix: string;
  pkg: string;
  age: string;
  source: string;
  reason: string;
  created: string;
  actions: string;
  delete: string;
  deleteSelected: string;
  confirmDelete: string;
  confirmBulk: string;
  selected: string;
  sourceImported: string;
  sourceAi: string;
  sourceHuman: string;
}

export default function RatingTable({ initialItems, labels }: { initialItems: RatingItem[]; labels: RatingLabels }) {
  const [items, setItems] = useState<RatingItem[]>(initialItems);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const allSelected = useMemo(
    () => items.length > 0 && items.every((i) => selected.has(i.id)),
    [items, selected],
  );

  function toggle(id: number) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.id)));
  }

  async function delOne(id: number) {
    if (!confirm(labels.confirmDelete)) return;
    setBusy(true); setErr(null);
    const prev = items;
    setItems(items.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/v1/admin/ratings/${id}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
    } catch (e) {
      setItems(prev);
      setErr(e instanceof Error ? e.message : 'delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function delBulk() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(labels.confirmBulk.replace('{n}', String(ids.length)))) return;
    setBusy(true); setErr(null);
    const prev = items;
    setItems(items.filter((i) => !selected.has(i.id)));
    try {
      const res = await fetch('/api/v1/admin/ratings/bulk', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'delete', ids }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSelected(new Set());
    } catch (e) {
      setItems(prev);
      setErr(e instanceof Error ? e.message : 'bulk delete failed');
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) return <p class="rmt-msg">{labels.empty}</p>;

  return (
    <div class="rmt-wrap">
      <div class="rmt-bar">
        <button disabled={busy || selected.size === 0} onClick={delBulk} class="danger">
          {labels.deleteSelected} ({selected.size})
        </button>
        {err && <span class="rmt-err">{labels.errorPrefix}: {err}</span>}
      </div>
      <table class="rmt">
        <thead>
          <tr>
            <th><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={labels.selected} /></th>
            <th>{labels.pkg}</th>
            <th class="num">{labels.age}</th>
            <th>{labels.source}</th>
            <th>{labels.reason}</th>
            <th>{labels.created}</th>
            <th>{labels.actions}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id}>
              <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`${labels.selected} #${r.id}`} /></td>
              <td><a href={`/p/${r.packageSlug}`}>{r.packageName}</a></td>
              <td class="num">{r.ageMin}+</td>
              <td><ProvenanceBadge source={r.source} version={r.classifierVersion} labels={labels} /></td>
              <td class="snippet" title={r.rationale ?? ''}>{snippet(r.rationale, 100)}</td>
              <td>{new Date(r.createdAt).toLocaleDateString()}</td>
              <td>
                <button disabled={busy} onClick={() => delOne(r.id)} class="danger small">{labels.delete}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <style>{`
        .rmt-wrap { overflow-x: auto; }
        .rmt-bar { display: flex; gap: var(--space-3); align-items: center; margin-block-end: var(--space-3); flex-wrap: wrap; }
        .rmt { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
        .rmt th, .rmt td { text-align: left; padding: var(--space-2) var(--space-3); border-block-end: 1px solid var(--color-border); vertical-align: middle; }
        .rmt th { font-size: 0.78rem; color: var(--color-fg-muted); text-transform: uppercase; letter-spacing: 0.04em; }
        .rmt .num { text-align: right; font-variant-numeric: tabular-nums; }
        .snippet { max-width: 36ch; color: var(--color-fg-muted); }
        button { font: inherit; padding: 0.35rem 0.7rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-bg-elevated); color: var(--color-fg); cursor: pointer; }
        button.small { padding: 0.2rem 0.55rem; font-size: 0.85em; }
        button.danger { background: var(--color-terra-100, #f7e1dc); color: var(--color-terra-800, #6e2a1d); border-color: var(--color-terra-300, #e6b4a8); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        .rmt-msg { color: var(--color-fg-muted); }
        .rmt-err { color: var(--color-terra-600, #a23b2c); }
      `}</style>
    </div>
  );
}

function snippet(s: string | null, n: number): string {
  if (!s) return '—';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function ProvenanceBadge({ source, version, labels }: { source: string; version: string | null; labels: RatingLabels }) {
  const kind = classifySource(source);
  const text = kind === 'imported' ? labels.sourceImported : kind === 'ai' ? labels.sourceAi : labels.sourceHuman;
  const title = version ? `${source} · ${version}` : source;
  return (
    <span class={`prov prov-${kind}`} title={title}>
      <span class="prov-dot" aria-hidden="true" />
      <span class="prov-text">{text}</span>
      <span class="prov-src">{source}</span>
      <style>{`
        .prov { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.15rem 0.55rem; border-radius: var(--radius-full); font-size: 0.78rem; font-weight: 600; background: var(--color-bg-subtle, #f0eee9); }
        .prov-dot { width: 0.55rem; height: 0.55rem; border-radius: 50%; background: currentColor; }
        .prov-text { text-transform: uppercase; letter-spacing: 0.03em; }
        .prov-src { color: var(--color-fg-muted); font-weight: 400; font-size: 0.85em; }
        .prov-imported { color: var(--color-teal-700, #086a6c); background: var(--color-teal-100, #d2efee); }
        .prov-ai { color: var(--color-amber-700, #8a5a00); background: var(--color-amber-100, #fcefc7); }
        .prov-human { color: var(--color-sage-700, #355c2b); background: var(--color-sage-100, #d8e8d4); }
      `}</style>
    </span>
  );
}

export function classifySource(source: string): 'imported' | 'ai' | 'human' {
  const s = source.toLowerCase();
  if (s.startsWith('ai_') || s.includes('claude') || s.includes('codex') || s.includes('gpt') || s.includes('llm')) return 'ai';
  if (s === 'human' || s.startsWith('human_') || s.includes('reviewer') || s.includes('user')) return 'human';
  return 'imported';
}
