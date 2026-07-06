import type { JSX } from 'preact';

export type AuditEntry = {
  id: number;
  actor: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  at: string;
};

export type AuditTableLabels = {
  when: string;
  actor: string;
  action: string;
  entity: string;
  changes: string;
  empty: string;
  before: string;
  after: string;
};

export default function AuditTable({
  entries,
  labels,
}: {
  entries: AuditEntry[];
  labels: AuditTableLabels;
}): JSX.Element {
  if (entries.length === 0) {
    return (
      <p class="empty" role="status">
        {labels.empty}
        <style>{`.empty { color: var(--color-fg-muted); margin: 0; padding: var(--space-4) 0; }`}</style>
      </p>
    );
  }
  return (
    <table class="atable">
      <thead>
        <tr>
          <th>{labels.when}</th>
          <th>{labels.actor}</th>
          <th>{labels.action}</th>
          <th>{labels.entity}</th>
          <th>{labels.changes}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr>
            <td class="mono">{formatDate(e.at)}</td>
            <td class="mono">{e.actorEmail ?? e.actor ?? '—'}</td>
            <td><code class="action">{e.action}</code></td>
            <td class="mono">
              {e.entityType}
              {e.entityId ? <span class="muted">:{e.entityId.slice(0, 8)}</span> : null}
            </td>
            <td>
              <details>
                <summary>{summarise(e.before, e.after)}</summary>
                <div class="diff">
                  <pre><strong>{labels.before}</strong>{'\n'}{formatJson(e.before)}</pre>
                  <pre><strong>{labels.after}</strong>{'\n'}{formatJson(e.after)}</pre>
                </div>
              </details>
            </td>
          </tr>
        ))}
      </tbody>
      <style>{`
        .atable { width: 100%; border-collapse: collapse; }
        .atable th, .atable td {
          text-align: left;
          padding: var(--space-2) var(--space-3);
          border-block-end: 1px solid var(--color-border);
          vertical-align: top;
        }
        .atable th {
          font-size: 0.78rem;
          color: var(--color-fg-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .atable .mono {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-size: 0.85rem;
        }
        .action {
          background: var(--color-bg-elevated);
          padding: 0.1rem 0.4rem;
          border-radius: var(--radius-sm, 4px);
          font-size: 0.8rem;
        }
        .muted { color: var(--color-fg-muted); }
        details summary {
          cursor: pointer;
          color: var(--color-fg-muted);
          font-size: 0.85rem;
        }
        .diff { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); margin-top: var(--space-2); }
        .diff pre {
          background: var(--color-bg-elevated);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          padding: var(--space-3);
          margin: 0;
          font-size: 0.78rem;
          overflow: auto;
          max-block-size: 200px;
          white-space: pre-wrap;
          word-break: break-word;
        }
        @media (max-width: 700px) { .diff { grid-template-columns: 1fr; } }
      `}</style>
    </table>
  );
}

function summarise(before: unknown, after: unknown): string {
  const keys = new Set<string>([
    ...Object.keys((before ?? {}) as object),
    ...Object.keys((after ?? {}) as object),
  ]);
  if (keys.size === 0) return '—';
  return Array.from(keys).slice(0, 4).join(', ') + (keys.size > 4 ? '…' : '');
}

function formatJson(v: unknown): string {
  try {
    return JSON.stringify(v ?? null, null, 2);
  } catch {
    return String(v);
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
