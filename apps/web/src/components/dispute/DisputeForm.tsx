import { useState } from 'preact/hooks';

type Labels = {
  intro: string;
  suggestedAge: string;
  reason: string;
  reasonHint: string;
  email: string;
  emailHint: string;
  submit: string;
  successTitle: string;
  successBody: string;
  ageOptions: { value: number; label: string }[];
};

export default function DisputeForm({
  packageId,
  loggedEmail,
  labels,
}: {
  packageId: number;
  loggedEmail: string | null;
  labels: Labels;
}) {
  const [suggestedAge, setAge] = useState(13);
  const [reason, setReason] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/disputes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packageId, suggestedAge, reason, reporterEmail: email || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `HTTP ${res.status}`);
      } else {
        setDone(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unexpected');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div class="success" role="status">
        <strong>{labels.successTitle}</strong>
        <p>{labels.successBody}</p>
        <style>{successCss}</style>
      </div>
    );
  }

  return (
    <form class="dform" onSubmit={onSubmit} noValidate>
      <p class="intro">{labels.intro}</p>

      <label>
        <span>{labels.suggestedAge}</span>
        <select
          value={suggestedAge}
          onChange={(e) => setAge(Number((e.target as HTMLSelectElement).value))}
        >
          {labels.ageOptions.map((o) => (
            <option value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>

      <label>
        <span>{labels.reason}</span>
        <textarea
          required
          minLength={10}
          maxLength={2000}
          rows={5}
          value={reason}
          onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)}
        />
        <small>{labels.reasonHint}</small>
      </label>

      {!loggedEmail && (
        <label>
          <span>{labels.email}</span>
          <input
            type="email"
            value={email}
            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
            autoComplete="email"
            required
          />
          <small>{labels.emailHint}</small>
        </label>
      )}

      {error && <p class="err" role="alert">{error}</p>}

      <button type="submit" disabled={busy || reason.trim().length < 10}>
        {busy ? '…' : labels.submit}
      </button>

      <style>{`
        .dform { display: grid; gap: var(--space-5); max-inline-size: 560px; }
        .intro { color: var(--color-fg-muted); margin: 0; }
        label { display: grid; gap: var(--space-2); }
        label span { font-size: var(--text-sm); color: var(--color-fg-muted); }
        select, input, textarea {
          padding: 0.75rem 1rem;
          border: 1.5px solid var(--color-border);
          border-radius: var(--radius-md);
          font: inherit;
          background: var(--color-bg-elevated);
          color: var(--color-fg);
        }
        select:focus, input:focus, textarea:focus { border-color: var(--color-teal-500); outline: none; }
        small { color: var(--color-fg-muted); font-size: 0.78rem; }
        button {
          margin-block-start: var(--space-2);
          padding: 0.9rem 1.4rem;
          border: none;
          border-radius: var(--radius-full);
          background: var(--color-cta);
          color: var(--color-cta-fg);
          font-weight: 700;
          cursor: pointer;
        }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        .err {
          background: color-mix(in srgb, var(--color-terra-400) 18%, transparent);
          color: var(--color-terra-600);
          padding: var(--space-3) var(--space-4);
          border-radius: var(--radius-md);
          margin: 0;
        }
      `}</style>
    </form>
  );
}

const successCss = `
  .success {
    padding: var(--space-6);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-sage-400) 18%, transparent);
    border: 1.5px solid var(--color-sage-400);
    max-inline-size: 560px;
  }
  .success strong { font-size: 1.15rem; color: var(--color-sage-600); }
  .success p { margin: var(--space-2) 0 0; }
`;
