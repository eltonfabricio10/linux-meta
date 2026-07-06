import type { JSX } from 'preact';
import type { Role } from './RoleSelect';

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  banned: boolean;
  emailVerified: boolean;
  sessionCount: number;
  createdAt: string;
};

export type UserTableLabels = {
  name: string;
  email: string;
  role: string;
  status: string;
  sessions: string;
  created: string;
  active: string;
  banned: string;
  unverified: string;
  empty: string;
  detailHref: (id: string) => string;
};

export default function UserTable({
  users,
  labels,
}: {
  users: UserRow[];
  labels: UserTableLabels;
}): JSX.Element {
  if (users.length === 0) {
    return (
      <p class="empty" role="status">
        {labels.empty}
        <style>{`.empty { color: var(--color-fg-muted); margin: 0; padding: var(--space-6); }`}</style>
      </p>
    );
  }
  return (
    <table class="utable">
      <thead>
        <tr>
          <th>{labels.name}</th>
          <th>{labels.email}</th>
          <th>{labels.role}</th>
          <th>{labels.status}</th>
          <th class="n">{labels.sessions}</th>
          <th>{labels.created}</th>
        </tr>
      </thead>
      <tbody>
        {users.map((u) => (
          <tr>
            <td>
              <a href={labels.detailHref(u.id)} class="row-link">
                {u.name || '—'}
              </a>
            </td>
            <td class="mono">{u.email}</td>
            <td><span class={`badge badge-role badge-${u.role}`}>{u.role}</span></td>
            <td>
              {u.banned ? (
                <span class="badge badge-banned">{labels.banned}</span>
              ) : (
                <span class="badge badge-active">{labels.active}</span>
              )}
              {!u.emailVerified && (
                <span class="badge badge-warn">{labels.unverified}</span>
              )}
            </td>
            <td class="n">{u.sessionCount}</td>
            <td class="mono">{formatDate(u.createdAt)}</td>
          </tr>
        ))}
      </tbody>
      <style>{`
        .utable { width: 100%; border-collapse: collapse; }
        .utable th, .utable td {
          text-align: left;
          padding: var(--space-3);
          border-block-end: 1px solid var(--color-border);
          vertical-align: middle;
        }
        .utable th {
          font-size: 0.78rem;
          color: var(--color-fg-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .utable tbody tr:hover { background: var(--color-bg-subtle, transparent); }
        .utable .n { text-align: right; font-variant-numeric: tabular-nums; }
        .utable .mono { font-variant-numeric: tabular-nums; }
        .row-link { color: var(--color-fg); text-decoration: none; font-weight: 600; }
        .row-link:hover { text-decoration: underline; }
        .badge {
          display: inline-block;
          padding: 0.15rem 0.5rem;
          margin-inline-end: 0.25rem;
          border-radius: var(--radius-full);
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .badge-role { background: var(--color-bg-elevated); border: 1px solid var(--color-border); color: var(--color-navy-900); }
        .badge-admin { background: var(--color-navy-900); color: white; }
        .badge-reviewer { background: var(--color-teal-500, #0ea5a3); color: white; }
        .badge-active { background: var(--color-sage-100, #e7f3eb); color: var(--color-sage-700, #1d6b3a); }
        .badge-banned { background: var(--color-terra-100, #fbe7e3); color: var(--color-terra-700, #8a2a1c); }
        .badge-warn { background: #fff7cc; color: #6b5500; }
      `}</style>
    </table>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}
