/** Checkbox-driven bulk delete for translation rows. */
import { useState } from 'preact/hooks';

export interface BulkRow {
  packageId: number;
  locale: string;
  packageName: string;
  status: string;
}

export interface BulkLabels {
  selectAll: string;
  selected: string;
  bulkDelete: string;
  confirmDelete: (n: number) => string;
  empty: string;
  package: string;
  locale: string;
  status: string;
  saved: (n: number) => string;
  error: string;
  detailHref: (packageId: number, locale: string) => string;
}

export default function BulkTranslationActions({
  rows,
  labels,
}: {
  rows: BulkRow[];
  labels: BulkLabels;
}) {
  const [items, setItems] = useState(rows);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const key = (r: BulkRow) => `${r.packageId}:${r.locale}`;
  const allSelected = items.length > 0 && items.every((r) => selected.has(key(r)));

  function toggle(r: BulkRow) {
    const k = key(r);
    const next = new Set(selected);
    if (next.has(k)) next.delete(k); else next.add(k);
    setSelected(next);
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map(key)));
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    // eslint-disable-next-line no-alert
    if (!confirm(labels.confirmDelete(selected.size))) return;

    setBusy(true); setErr(null); setMsg(null);
    try {
      const ids = items
        .filter((r) => selected.has(key(r)))
        .map((r) => ({ packageId: r.packageId, locale: r.locale }));
      const res = await fetch('/api/v1/admin/translations/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'delete', ids }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr((body as { error?: string }).error ?? `HTTP ${res.status}`);
      } else {
        const body = await res.json() as { deleted: number };
        setMsg(labels.saved(body.deleted));
        setItems((prev) => prev.filter((r) => !selected.has(key(r))));
        setSelected(new Set());
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unexpected');
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return <p class="empty">{labels.empty}</p>;
  }

  return (
    <div class="wrap">
      <div class="bar">
        <label class="sel">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          <span>{labels.selectAll}</span>
        </label>
        <span class="count">{labels.selected}: {selected.size}</span>
        <button type="button" class="danger" disabled={busy || selected.size === 0} onClick={bulkDelete}>
          {labels.bulkDelete}
        </button>
      </div>

      {msg && <p class="ok" role="status">{msg}</p>}
      {err && <p class="err" role="alert">{labels.error}: {err}</p>}

      <table>
        <thead>
          <tr>
            <th />
            <th>{labels.package}</th>
            <th>{labels.locale}</th>
            <th>{labels.status}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const k = key(r);
            return (
              <tr key={k} class={selected.has(k) ? 'sel-row' : undefined}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(k)}
                    onChange={() => toggle(r)}
                    aria-label={`${r.packageName} ${r.locale}`}
                  />
                </td>
                <td>
                  <a class="link" href={labels.detailHref(r.packageId, r.locale)}>{r.packageName}</a>
                </td>
                <td><code>{r.locale}</code></td>
                <td><span class={`chip status-${r.status}`}>{r.status}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <style>{`
        .wrap { display: grid; gap: var(--space-3); }
        .bar { display: flex; gap: var(--space-4); align-items: center; padding: var(--space-3); background: var(--color-bg-elevated); border-radius: var(--radius-md); border: 1px solid var(--color-border); }
        .sel { display: flex; gap: var(--space-2); align-items: center; }
        .count { color: var(--color-fg-muted); font-size: 0.85rem; margin-inline-end: auto; }
        button { padding: 0.5rem 1rem; border-radius: var(--radius-full); border: none; font: inherit; font-weight: 600; cursor: pointer; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        button.danger { background: transparent; border: 1.5px solid var(--color-terra-600); color: var(--color-terra-600); }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: var(--space-2) var(--space-3); border-block-end: 1px solid var(--color-border); }
        th { font-size: 0.78rem; color: var(--color-fg-muted); text-transform: uppercase; letter-spacing: 0.04em; }
        .sel-row { background: var(--color-bg-elevated); }
        .link { color: var(--color-cta); text-decoration: none; font-weight: 600; }
        .link:hover { text-decoration: underline; }
        .chip { display: inline-block; padding: 0.15rem 0.55rem; border-radius: var(--radius-full); font-size: 0.75rem; font-weight: 600; }
        .status-draft    { background: #fef3c7; color: #92400e; }
        .status-reviewed { background: #ccfbf1; color: #115e59; }
        .status-official { background: #dcfce7; color: #166534; }
        .empty { color: var(--color-fg-muted); padding: var(--space-6); text-align: center; }
        .ok { color: var(--color-sage-600); margin: 0; }
        .err { color: var(--color-terra-600); margin: 0; }
      `}</style>
    </div>
  );
}
