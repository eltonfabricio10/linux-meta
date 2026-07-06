/** Admin-side per-package translations grid with row-level edit + delete. */
import { useEffect, useState } from 'preact/hooks';

export type TranslationFocusField = 'summary' | 'description' | 'plainExplanation';

export type TStatus = 'draft' | 'reviewed' | 'official';

export interface TranslationRow {
  locale: string;
  status: TStatus | string;
  translatedBy: string | null;
  summary: string | null;
  description: string | null;
  plainExplanation: string | null;
  updatedAt: string | null;
}

export interface TranslationEditPanelLabels {
  locale: string;
  status: string;
  translatedBy: string;
  summary: string;
  description: string;
  plainExplanation: string;
  updatedAt: string;
  edit: string;
  save: string;
  cancel: string;
  delete: string;
  confirmDelete: string;
  empty: string;
  saved: string;
  error: string;
}

const STATUSES: TStatus[] = ['draft', 'reviewed', 'official'];

export default function TranslationEditPanel({
  packageId,
  translations,
  labels,
  autoOpenLocale,
  autoFocusField,
}: {
  packageId: number;
  translations: TranslationRow[];
  labels: TranslationEditPanelLabels;
  autoOpenLocale?: string | null;
  autoFocusField?: TranslationFocusField | null;
}) {
  const [rows, setRows] = useState(translations);
  const [editingLocale, setEditingLocale] = useState<string | null>(null);
  const [draft, setDraft] = useState<TranslationRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!autoOpenLocale) return;
    const row = translations.find((r) => r.locale === autoOpenLocale);
    if (!row) return;
    setEditingLocale(row.locale);
    setDraft({ ...row });
    if (autoFocusField) {
      setTimeout(() => {
        const el = document.querySelector<HTMLElement>(`[data-tfield="${autoFocusField}"]`);
        if (el) {
          el.focus();
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenLocale, autoFocusField]);

  function startEdit(row: TranslationRow) {
    setEditingLocale(row.locale);
    setDraft({ ...row });
    setMsg(null); setErr(null);
  }

  function cancel() { setEditingLocale(null); setDraft(null); }

  async function save() {
    if (!draft) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch(`/api/v1/admin/translations/${packageId}/${draft.locale}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          summary: draft.summary,
          description: draft.description,
          plain_explanation: draft.plainExplanation,
          status: draft.status,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr((body as { error?: string }).error ?? `HTTP ${res.status}`);
      } else {
        const body = await res.json() as { translation: TranslationRow };
        setRows((prev) => prev.map((r) => r.locale === draft.locale ? body.translation : r));
        setMsg(labels.saved);
        cancel();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unexpected');
    } finally {
      setBusy(false);
    }
  }

  async function remove(locale: string) {
    // eslint-disable-next-line no-alert
    if (!confirm(labels.confirmDelete)) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch(`/api/v1/admin/translations/${packageId}/${locale}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        setErr((body as { error?: string }).error ?? `HTTP ${res.status}`);
      } else {
        setRows((prev) => prev.filter((r) => r.locale !== locale));
        setMsg(labels.saved);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unexpected');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="panel">
      {rows.length === 0 ? (
        <p class="empty">{labels.empty}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{labels.locale}</th>
              <th>{labels.status}</th>
              <th>{labels.translatedBy}</th>
              <th>{labels.summary}</th>
              <th>{labels.updatedAt}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.locale}>
                <td><code>{r.locale}</code></td>
                <td><span class={`chip status-${r.status}`}>{r.status}</span></td>
                <td class="muted">{r.translatedBy ?? '—'}</td>
                <td class="prev">{r.summary ?? '—'}</td>
                <td class="muted">{r.updatedAt ? new Date(r.updatedAt).toISOString().slice(0, 10) : '—'}</td>
                <td class="actions">
                  <button type="button" class="ghost" onClick={() => startEdit(r)} disabled={busy}>{labels.edit}</button>
                  <button type="button" class="danger" onClick={() => remove(r.locale)} disabled={busy}>{labels.delete}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {msg && <p class="ok" role="status">{msg}</p>}
      {err && <p class="err" role="alert">{labels.error}: {err}</p>}

      {editingLocale && draft && (
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-body">
            <h3>{draft.locale}</h3>
            <label>
              <span>{labels.status}</span>
              <select
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: (e.target as HTMLSelectElement).value as TStatus })}
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>
              <span>{labels.summary}</span>
              <input
                data-tfield="summary"
                value={draft.summary ?? ''}
                onInput={(e) => setDraft({ ...draft, summary: (e.target as HTMLInputElement).value })}
                maxLength={4000}
              />
            </label>
            <label>
              <span>{labels.description}</span>
              <textarea
                data-tfield="description"
                rows={6}
                value={draft.description ?? ''}
                onInput={(e) => setDraft({ ...draft, description: (e.target as HTMLTextAreaElement).value })}
                maxLength={20000}
              />
            </label>
            <label>
              <span>{labels.plainExplanation}</span>
              <textarea
                data-tfield="plainExplanation"
                rows={3}
                value={draft.plainExplanation ?? ''}
                onInput={(e) => setDraft({ ...draft, plainExplanation: (e.target as HTMLTextAreaElement).value })}
                maxLength={20000}
              />
            </label>
            <div class="row">
              <button type="button" class="primary" onClick={save} disabled={busy}>{labels.save}</button>
              <button type="button" class="ghost" onClick={cancel} disabled={busy}>{labels.cancel}</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .panel { display: grid; gap: var(--space-3); }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: var(--space-2) var(--space-3); border-block-end: 1px solid var(--color-border); vertical-align: top; }
        th { font-size: 0.78rem; color: var(--color-fg-muted); text-transform: uppercase; letter-spacing: 0.04em; }
        .muted { color: var(--color-fg-muted); font-size: 0.85rem; }
        .prev { max-inline-size: 480px; overflow: hidden; text-overflow: ellipsis; }
        .actions { display: flex; gap: var(--space-2); justify-content: flex-end; }
        .chip { display: inline-block; padding: 0.15rem 0.55rem; border-radius: var(--radius-full); font-size: 0.75rem; font-weight: 600; }
        .status-draft    { background: #fef3c7; color: #92400e; }
        .status-reviewed { background: #ccfbf1; color: #115e59; }
        .status-official { background: #dcfce7; color: #166534; }
        button { padding: 0.4rem 0.9rem; border-radius: var(--radius-full); border: none; font: inherit; font-weight: 600; cursor: pointer; font-size: 0.85rem; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        button.primary { background: var(--color-cta); color: var(--color-cta-fg); }
        button.ghost { background: transparent; border: 1.5px solid var(--color-border); color: var(--color-fg); }
        button.danger { background: transparent; border: 1.5px solid var(--color-terra-600); color: var(--color-terra-600); }
        .empty { color: var(--color-fg-muted); margin: 0; padding: var(--space-4); }
        .ok { color: var(--color-sage-600); margin: 0; }
        .err { color: var(--color-terra-600); margin: 0; }
        .modal { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: grid; place-items: center; z-index: 50; padding: var(--space-4); }
        .modal-body { background: var(--color-bg); border-radius: var(--radius-lg); padding: var(--space-6); inline-size: min(720px, 96vw); max-block-size: 90vh; overflow: auto; display: grid; gap: var(--space-3); }
        .modal-body h3 { margin: 0; }
        .modal-body label { display: grid; gap: var(--space-1); }
        .modal-body label span { font-size: 0.78rem; color: var(--color-fg-muted); text-transform: uppercase; letter-spacing: 0.04em; }
        .modal-body input, .modal-body textarea, .modal-body select {
          padding: 0.55rem 0.8rem; border: 1.5px solid var(--color-border); border-radius: var(--radius-md);
          font: inherit; background: var(--color-bg-elevated); color: var(--color-fg);
        }
        .row { display: flex; gap: var(--space-3); justify-content: flex-end; }
      `}</style>
    </div>
  );
}
