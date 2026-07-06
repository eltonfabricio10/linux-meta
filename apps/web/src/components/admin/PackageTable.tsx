/** Pure presentational table of packages for the admin list page. */

export interface PackageRow {
  id: number;
  name: string;
  slug: string;
  source: string;
  license: string | null;
  popularity: number;
  ptStatus: string | null;
  ptTranslatedBy: string | null;
  ptUpdatedAt: string | null;
}

export interface PackageTableLabels {
  name: string;
  source: string;
  license: string;
  popularity: string;
  ptStatus: string;
  translatedBy: string;
  updatedAt: string;
  empty: string;
  noTranslation: string;
  detailHref: (id: number) => string;
}

export default function PackageTable({
  packages,
  labels,
}: {
  packages: PackageRow[];
  labels: PackageTableLabels;
}) {
  if (packages.length === 0) {
    return <p class="empty">{labels.empty}</p>;
  }

  return (
    <div class="tbl">
      <table>
        <thead>
          <tr>
            <th>{labels.name}</th>
            <th>{labels.source}</th>
            <th>{labels.license}</th>
            <th class="num">{labels.popularity}</th>
            <th>{labels.ptStatus}</th>
            <th>{labels.translatedBy}</th>
            <th>{labels.updatedAt}</th>
          </tr>
        </thead>
        <tbody>
          {packages.map((p) => (
            <tr key={p.id}>
              <td>
                <a href={labels.detailHref(p.id)} class="link">{p.name}</a>
                <div class="muted">{p.slug}</div>
              </td>
              <td><span class={`badge src-${p.source}`}>{p.source}</span></td>
              <td class="muted">{p.license ?? '—'}</td>
              <td class="num">{p.popularity.toLocaleString()}</td>
              <td>
                {p.ptStatus
                  ? <span class={`chip status-${p.ptStatus}`}>{p.ptStatus}</span>
                  : <span class="chip status-none">{labels.noTranslation}</span>}
              </td>
              <td class="muted">{p.ptTranslatedBy ?? '—'}</td>
              <td class="muted">{p.ptUpdatedAt ? new Date(p.ptUpdatedAt).toISOString().slice(0, 10) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <style>{`
        .tbl { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: var(--space-2) var(--space-3); border-block-end: 1px solid var(--color-border); vertical-align: top; }
        th { font-size: 0.78rem; color: var(--color-fg-muted); text-transform: uppercase; letter-spacing: 0.04em; }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .muted { color: var(--color-fg-muted); font-size: 0.85rem; }
        .link { color: var(--color-cta); text-decoration: none; font-weight: 600; }
        .link:hover { text-decoration: underline; }
        .badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: var(--radius-full); background: var(--color-bg-elevated); border: 1px solid var(--color-border); font-size: 0.75rem; }
        .chip { display: inline-block; padding: 0.15rem 0.55rem; border-radius: var(--radius-full); font-size: 0.75rem; font-weight: 600; }
        .status-draft    { background: #fef3c7; color: #92400e; }
        .status-reviewed { background: #ccfbf1; color: #115e59; }
        .status-official { background: #dcfce7; color: #166534; }
        .status-none     { background: var(--color-bg-elevated); color: var(--color-fg-muted); border: 1px dashed var(--color-border); }
        .empty { color: var(--color-fg-muted); padding: var(--space-6); text-align: center; }
      `}</style>
    </div>
  );
}
