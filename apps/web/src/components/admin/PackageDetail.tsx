/** Inline editor for narrow per-package metadata overrides. */
import { useEffect, useRef, useState } from 'preact/hooks';

export type PackageDetailFocus = 'license' | 'upstreamUrl' | 'popularity';

export interface PackageDetailLabels {
  license: string;
  upstreamUrl: string;
  popularity: string;
  save: string;
  saved: string;
  error: string;
}

export interface PackageDetailInitial {
  license: string | null;
  upstreamUrl: string | null;
  popularity: number;
}

export default function PackageDetail({
  packageId,
  initial,
  labels,
  autoFocus,
}: {
  packageId: number;
  initial: PackageDetailInitial;
  labels: PackageDetailLabels;
  autoFocus?: PackageDetailFocus | null;
}) {
  const [license, setLicense] = useState(initial.license ?? '');
  const [upstreamUrl, setUpstreamUrl] = useState(initial.upstreamUrl ?? '');
  const [popularity, setPopularity] = useState(String(initial.popularity));
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const licenseRef = useRef<HTMLInputElement | null>(null);
  const upstreamRef = useRef<HTMLInputElement | null>(null);
  const popularityRef = useRef<HTMLInputElement | null>(null);
  const refs: Record<PackageDetailFocus, typeof licenseRef> = {
    license: licenseRef,
    upstreamUrl: upstreamRef,
    popularity: popularityRef,
  };

  useEffect(() => {
    if (!autoFocus) return;
    const el = refs[autoFocus].current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus();
    el.classList.add('flash');
    const tid = setTimeout(() => el.classList.remove('flash'), 2000);
    return () => clearTimeout(tid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  async function onSubmit(e: Event) {
    e.preventDefault();
    setBusy(true); setOk(false); setErr(null);
    try {
      const res = await fetch(`/api/v1/admin/packages/${packageId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          license: license.trim() === '' ? null : license.trim(),
          upstreamUrl: upstreamUrl.trim() === '' ? null : upstreamUrl.trim(),
          popularity: Number.parseInt(popularity, 10) || 0,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr((body as { error?: string }).error ?? `HTTP ${res.status}`);
      } else {
        setOk(true);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unexpected');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="pform" onSubmit={onSubmit}>
      <label>
        <span>{labels.license}</span>
        <input ref={refs.license} value={license} onInput={(e) => setLicense((e.target as HTMLInputElement).value)} maxLength={200} />
      </label>
      <label>
        <span>{labels.upstreamUrl}</span>
        <input ref={refs.upstreamUrl} type="url" value={upstreamUrl} onInput={(e) => setUpstreamUrl((e.target as HTMLInputElement).value)} maxLength={2000} />
      </label>
      <label>
        <span>{labels.popularity}</span>
        <input ref={refs.popularity} type="number" min={0} value={popularity} onInput={(e) => setPopularity((e.target as HTMLInputElement).value)} />
      </label>
      <div class="row">
        <button type="submit" disabled={busy} class="primary">{labels.save}</button>
        {ok && <span class="ok" role="status">{labels.saved}</span>}
        {err && <span class="err" role="alert">{labels.error}: {err}</span>}
      </div>
      <style>{`
        .pform { display: grid; gap: var(--space-3); max-inline-size: 560px; }
        label { display: grid; gap: var(--space-1); }
        label span { font-size: 0.78rem; color: var(--color-fg-muted); text-transform: uppercase; letter-spacing: 0.04em; }
        input { padding: 0.55rem 0.8rem; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); font: inherit; background: var(--color-bg-elevated); color: var(--color-fg); }
        input:focus { border-color: var(--color-teal-500); outline: none; }
        input.flash { animation: flash 1.6s ease-out 1; box-shadow: 0 0 0 3px var(--color-teal-500); }
        @keyframes flash { 0%,60% { box-shadow: 0 0 0 3px var(--color-teal-500); } 100% { box-shadow: 0 0 0 0 transparent; } }
        .row { display: flex; gap: var(--space-3); align-items: center; }
        button { padding: 0.55rem 1rem; border-radius: var(--radius-full); border: none; font: inherit; font-weight: 700; cursor: pointer; }
        button.primary { background: var(--color-cta); color: var(--color-cta-fg); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        .ok { color: var(--color-sage-600); font-weight: 600; }
        .err { color: var(--color-terra-600); }
      `}</style>
    </form>
  );
}
