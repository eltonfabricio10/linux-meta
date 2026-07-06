import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import RoleSelect, { type Role, type RoleSelectLabels } from './RoleSelect';
import AuditTable, { type AuditEntry, type AuditTableLabels } from './AuditTable';

export type SessionRow = {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
};

export type DetailUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  banned: boolean;
  bannedReason: string | null;
  bannedAt: string | null;
  emailVerified: boolean;
  createdAt: string;
};

export type UserDetailLabels = {
  roleLabel: string;
  banLabel: string;
  banReasonLabel: string;
  banReasonPlaceholder: string;
  banToggleOn: string;
  banToggleOff: string;
  saveRole: string;
  saveBan: string;
  revokeSessions: string;
  revokeSessionsConfirm: string;
  banConfirm: string;
  selfDemoteBlocked: string;
  sessionsTitle: string;
  sessionsEmpty: string;
  sessionId: string;
  sessionIp: string;
  sessionAgent: string;
  sessionCreated: string;
  sessionExpires: string;
  auditTitle: string;
  busy: string;
  ok: string;
  fail: string;
  roles: RoleSelectLabels;
  audit: AuditTableLabels;
};

export default function UserDetail({
  user,
  sessions,
  recentAudit,
  labels,
  currentUserId,
}: {
  user: DetailUser;
  sessions: SessionRow[];
  recentAudit: AuditEntry[];
  labels: UserDetailLabels;
  currentUserId: string;
}): JSX.Element {
  const [role, setRole] = useState<Role>(user.role);
  const [banned, setBanned] = useState<boolean>(user.banned);
  const [reason, setReason] = useState<string>(user.bannedReason ?? '');
  const [busy, setBusy] = useState<null | 'role' | 'ban' | 'revoke'>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const isSelf = currentUserId === user.id;
  const selfDemoteBlocked = isSelf && role !== 'admin';

  async function call(method: 'PATCH' | 'POST', body?: unknown, qs?: string): Promise<void> {
    setErr(null);
    setOk(null);
    const url = `/api/v1/admin/users/${encodeURIComponent(user.id)}${qs ?? ''}`;
    const res = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `HTTP ${res.status}`);
    }
  }

  async function saveRole(): Promise<void> {
    if (selfDemoteBlocked) {
      setErr(labels.selfDemoteBlocked);
      return;
    }
    setBusy('role');
    try {
      await call('PATCH', { role });
      setOk(labels.ok);
      setTimeout(() => location.reload(), 400);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveBan(): Promise<void> {
    if (banned && !confirm(labels.banConfirm)) return;
    setBusy('ban');
    try {
      await call('PATCH', {
        banned,
        bannedReason: banned ? (reason.trim() || null) : null,
      });
      setOk(labels.ok);
      setTimeout(() => location.reload(), 400);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function revoke(): Promise<void> {
    if (!confirm(labels.revokeSessionsConfirm)) return;
    setBusy('revoke');
    try {
      await call('POST', undefined, '?action=revoke_sessions');
      setOk(labels.ok);
      setTimeout(() => location.reload(), 400);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div class="udetail">
      <section class="card">
        <h2>{labels.roleLabel}</h2>
        <div class="row">
          <RoleSelect
            value={role}
            onChange={setRole}
            labels={labels.roles}
            disabled={busy !== null}
          />
          <button
            type="button"
            class="primary"
            disabled={busy !== null || role === user.role || selfDemoteBlocked}
            onClick={saveRole}
          >
            {busy === 'role' ? labels.busy : labels.saveRole}
          </button>
        </div>
        {selfDemoteBlocked && (
          <p class="warn" role="alert">{labels.selfDemoteBlocked}</p>
        )}
      </section>

      <section class="card">
        <h2>{labels.banLabel}</h2>
        <label class="toggle">
          <input
            type="checkbox"
            checked={banned}
            disabled={busy !== null}
            onChange={(e) => setBanned((e.target as HTMLInputElement).checked)}
          />
          <span>{banned ? labels.banToggleOn : labels.banToggleOff}</span>
        </label>
        <label class="reason">
          <span>{labels.banReasonLabel}</span>
          <textarea
            rows={2}
            maxLength={1000}
            placeholder={labels.banReasonPlaceholder}
            value={reason}
            disabled={busy !== null || !banned}
            onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)}
          />
        </label>
        <div class="row">
          <button
            type="button"
            class="primary"
            disabled={busy !== null || (banned === user.banned && (reason ?? '') === (user.bannedReason ?? ''))}
            onClick={saveBan}
          >
            {busy === 'ban' ? labels.busy : labels.saveBan}
          </button>
        </div>
      </section>

      <section class="card">
        <h2>{labels.sessionsTitle}</h2>
        {sessions.length === 0 ? (
          <p class="muted">{labels.sessionsEmpty}</p>
        ) : (
          <table class="stable">
            <thead>
              <tr>
                <th>{labels.sessionId}</th>
                <th>{labels.sessionIp}</th>
                <th>{labels.sessionAgent}</th>
                <th>{labels.sessionCreated}</th>
                <th>{labels.sessionExpires}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr>
                  <td class="mono">{s.id.slice(0, 10)}…</td>
                  <td class="mono">{s.ipAddress ?? '—'}</td>
                  <td class="ua">{s.userAgent ?? '—'}</td>
                  <td class="mono">{formatDate(s.createdAt)}</td>
                  <td class="mono">{formatDate(s.expiresAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div class="row">
          <button
            type="button"
            class="danger"
            disabled={busy !== null || sessions.length === 0}
            onClick={revoke}
          >
            {busy === 'revoke' ? labels.busy : labels.revokeSessions}
          </button>
        </div>
      </section>

      <section class="card">
        <h2>{labels.auditTitle}</h2>
        <AuditTable entries={recentAudit} labels={labels.audit} />
      </section>

      {ok && <p class="ok" role="status">{ok}</p>}
      {err && <p class="err" role="alert">{labels.fail}: {err}</p>}

      <style>{`
        .udetail { display: grid; gap: var(--space-6); }
        .card {
          background: var(--color-bg-elevated);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          padding: var(--space-6);
        }
        h2 {
          margin: 0 0 var(--space-4);
          font-size: 1.0rem;
          color: var(--color-navy-900);
        }
        .row { display: flex; gap: var(--space-3); align-items: center; margin-top: var(--space-3); flex-wrap: wrap; }
        .toggle { display: flex; gap: var(--space-2); align-items: center; }
        .reason { display: grid; gap: var(--space-2); margin-top: var(--space-3); }
        .reason span { font-size: var(--text-sm, 0.85rem); color: var(--color-fg-muted); }
        textarea {
          padding: 0.6rem 0.85rem;
          border: 1.5px solid var(--color-border);
          border-radius: var(--radius-md);
          font: inherit;
          background: var(--color-bg);
          color: var(--color-fg);
          resize: vertical;
        }
        textarea:focus { border-color: var(--color-teal-500); outline: none; }
        textarea:disabled { opacity: 0.55; cursor: not-allowed; }
        button {
          padding: 0.55rem 1.1rem;
          border-radius: var(--radius-full);
          font-weight: 700;
          cursor: pointer;
          border: none;
          font: inherit;
        }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        button.primary { background: var(--color-cta); color: var(--color-cta-fg); }
        button.danger { background: var(--color-terra-600, #b03a26); color: white; }
        .stable { width: 100%; border-collapse: collapse; margin-top: var(--space-2); }
        .stable th, .stable td {
          text-align: left;
          padding: var(--space-2) var(--space-3);
          border-block-end: 1px solid var(--color-border);
        }
        .stable th { font-size: 0.78rem; color: var(--color-fg-muted); text-transform: uppercase; letter-spacing: 0.04em; }
        .stable .mono { font-variant-numeric: tabular-nums; font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.85rem; }
        .stable .ua { max-width: 28ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.85rem; }
        .muted { color: var(--color-fg-muted); margin: 0; }
        .warn { color: var(--color-terra-600); margin: var(--space-2) 0 0; font-size: 0.9rem; }
        .err { color: var(--color-terra-600); margin: 0; font-weight: 600; }
        .ok { color: var(--color-sage-600); margin: 0; font-weight: 600; }
      `}</style>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace('T', ' ');
}
