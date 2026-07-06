import { useState } from 'preact/hooks';

type Labels = { approve: string; reject: string; actionOk: string; actionFailed: string };

export default function DisputeActions({ id, labels }: { id: number; labels: Labels }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function patch(status: 'resolved' | 'rejected') {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/v1/disputes/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr((body as { error?: string }).error ?? `HTTP ${res.status}`);
      } else {
        setDone(status);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unexpected');
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p class="ok">{labels.actionOk}: {done}</p>;

  return (
    <div class="actions">
      <button disabled={busy} onClick={() => patch('resolved')} class="primary">{labels.approve}</button>
      <button disabled={busy} onClick={() => patch('rejected')} class="ghost">{labels.reject}</button>
      {err && <span class="err">{labels.actionFailed}: {err}</span>}
      <style>{`
        .actions { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
        button { padding: 0.5rem 1rem; border-radius: var(--radius-full); font-weight: 600; cursor: pointer; border: none; font: inherit; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        button.primary { background: var(--color-cta); color: var(--color-cta-fg); }
        button.ghost { background: transparent; border: 1.5px solid var(--color-border); color: var(--color-fg); }
        .err { color: var(--color-terra-600); font-size: var(--text-sm); }
        .ok { color: var(--color-sage-600); font-weight: 600; }
      `}</style>
    </div>
  );
}
