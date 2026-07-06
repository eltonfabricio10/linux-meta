/** Dispute mediator panel.  Comment, change status, resolve, dismiss. */
import { useState } from 'preact/hooks';

export type DisputeStatus = 'open' | 'reviewing' | 'resolved' | 'rejected';

export interface MediatorLabels {
  currentStatus: string;
  addComment: string;
  commentPlaceholder: string;
  submitComment: string;
  changeStatus: string;
  apply: string;
  reasonLabel: string;
  resolve: string;
  dismiss: string;
  resolveConfirm: string;
  dismissConfirm: string;
  ok: string;
  errorPrefix: string;
  needReason: string;
}

export default function DisputeMediator({
  id,
  status: initialStatus,
  labels,
}: { id: number; status: DisputeStatus; labels: MediatorLabels }) {
  const [status, setStatus] = useState<DisputeStatus>(initialStatus);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [nextStatus, setNextStatus] = useState<'open' | 'reviewing'>(
    initialStatus === 'open' ? 'reviewing' : 'open',
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const closed = status === 'resolved' || status === 'rejected';

  async function send(body: unknown) {
    setBusy(true); setErr(null); setOk(null);
    try {
      const res = await fetch(`/api/v1/admin/disputes/${id}/action`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; status?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      return data;
    } finally { setBusy(false); }
  }

  async function postComment() {
    if (comment.trim().length === 0) return;
    try {
      await send({ action: 'comment', text: comment.trim() });
      setComment(''); setOk(labels.ok);
    } catch (e) { setErr(e instanceof Error ? e.message : 'failed'); }
  }

  async function changeStatus() {
    try {
      const data = await send({ action: 'status', to: nextStatus });
      if (data.status === 'open' || data.status === 'reviewing') {
        setStatus(data.status);
        setNextStatus(data.status === 'open' ? 'reviewing' : 'open');
      }
      setOk(labels.ok);
    } catch (e) { setErr(e instanceof Error ? e.message : 'failed'); }
  }

  async function finalize(kind: 'resolve' | 'dismiss') {
    if (reason.trim().length === 0) { setErr(labels.needReason); return; }
    const msg = kind === 'resolve' ? labels.resolveConfirm : labels.dismissConfirm;
    if (!confirm(msg)) return;
    try {
      const data = await send({ action: kind, reason: reason.trim() });
      if (data.status === 'resolved' || data.status === 'rejected') setStatus(data.status);
      setReason(''); setOk(labels.ok);
    } catch (e) { setErr(e instanceof Error ? e.message : 'failed'); }
  }

  return (
    <div class="med">
      <p class="med-status">
        <strong>{labels.currentStatus}:</strong> <span class={`badge status-${status}`}>{status}</span>
      </p>

      {!closed && (
        <>
          <fieldset disabled={busy}>
            <legend>{labels.addComment}</legend>
            <textarea
              value={comment}
              onInput={(e) => setComment(e.currentTarget.value)}
              placeholder={labels.commentPlaceholder}
              rows={3}
              maxLength={4000}
            />
            <button onClick={postComment} disabled={busy || comment.trim().length === 0}>{labels.submitComment}</button>
          </fieldset>

          <fieldset disabled={busy}>
            <legend>{labels.changeStatus}</legend>
            <select value={nextStatus} onChange={(e) => setNextStatus(e.currentTarget.value as 'open' | 'reviewing')}>
              <option value="open">open</option>
              <option value="reviewing">reviewing</option>
            </select>
            <button onClick={changeStatus} disabled={busy || nextStatus === status}>{labels.apply}</button>
          </fieldset>

          <fieldset disabled={busy}>
            <legend>{labels.reasonLabel}</legend>
            <textarea
              value={reason}
              onInput={(e) => setReason(e.currentTarget.value)}
              rows={3}
              maxLength={4000}
            />
            <div class="row">
              <button class="primary" onClick={() => finalize('resolve')} disabled={busy}>{labels.resolve}</button>
              <button class="ghost" onClick={() => finalize('dismiss')} disabled={busy}>{labels.dismiss}</button>
            </div>
          </fieldset>
        </>
      )}

      {ok && <p class="ok">{ok}</p>}
      {err && <p class="err">{labels.errorPrefix}: {err}</p>}

      <style>{`
        .med { display: flex; flex-direction: column; gap: var(--space-4); }
        .med-status { margin: 0; }
        fieldset { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); }
        legend { font-weight: 600; padding-inline: 0.4rem; font-size: 0.9rem; }
        textarea, select { font: inherit; padding: 0.4rem 0.6rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-bg-elevated); color: var(--color-fg); width: 100%; box-sizing: border-box; }
        textarea { resize: vertical; min-height: 4rem; }
        button { font: inherit; padding: 0.45rem 0.95rem; border-radius: var(--radius-full); border: 1px solid var(--color-border); background: var(--color-bg-elevated); color: var(--color-fg); cursor: pointer; font-weight: 600; align-self: flex-start; }
        button.primary { background: var(--color-cta); color: var(--color-cta-fg); border-color: transparent; }
        button.ghost { background: transparent; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        .row { display: flex; gap: var(--space-3); flex-wrap: wrap; }
        .badge { display: inline-block; padding: 0.15rem 0.55rem; border-radius: var(--radius-full); font-size: 0.78rem; font-weight: 600; }
        .status-open { background: var(--color-amber-100, #fcefc7); color: var(--color-amber-800, #7c4b00); }
        .status-reviewing { background: var(--color-teal-100, #d2efee); color: var(--color-teal-800, #07484a); }
        .status-resolved { background: var(--color-sage-100, #d8e8d4); color: var(--color-sage-700, #355c2b); }
        .status-rejected { background: var(--color-terra-100, #f7e1dc); color: var(--color-terra-800, #6e2a1d); }
        .ok { color: var(--color-sage-600, #4a7a3b); font-weight: 600; margin: 0; }
        .err { color: var(--color-terra-600, #a23b2c); font-weight: 600; margin: 0; }
      `}</style>
    </div>
  );
}
