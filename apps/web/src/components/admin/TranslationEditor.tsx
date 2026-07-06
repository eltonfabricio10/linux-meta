import { useState } from 'preact/hooks';
import { validateTranslation } from '~/lib/review-validation';

type Labels = {
  summary: string;
  description: string;
  plainExplanation: string;
  source: string;
  target: string;
  saveDraft: string;
  saveDraftHint: string;
  markReviewed: string;
  markReviewedHint: string;
  publish: string;
  publishHint: string;
  copyToTarget: string;
  empty: string;
  actionOk: string;
  actionFailed: string;
  next: string;
  skip: string;
  suggest?: string;
  suggesting?: string;
};

export default function TranslationEditor({
  packageId,
  locale,
  initial,
  source,
  canPublish,
  labels,
  nextUrl,
  validate = false,
  canSuggest = false,
}: {
  packageId: number;
  locale: string;
  initial: { summary: string; description: string; plainExplanation: string };
  source: { summary: string; description: string; plainExplanation: string; locale: string };
  canPublish: boolean;
  labels: Labels;
  nextUrl: string | null;
  validate?: boolean;
  canSuggest?: boolean;
}) {
  const [summary, setSummary] = useState(initial.summary);
  const [description, setDescription] = useState(initial.description);
  const [plain, setPlain] = useState(initial.plainExplanation);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);

  async function suggest() {
    setSuggesting(true); setSuggestNote(null); setErr(null);
    try {
      const res = await fetch('/api/v1/translate/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packageId, locale }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr((body as { message?: string; error?: string }).message
          ?? (body as { error?: string }).error ?? `HTTP ${res.status}`);
      } else {
        const b = body as {
          summary?: string; description?: string; plainExplanation?: string | null;
          issues?: string[]; refined?: boolean; usage?: { costUsd?: number };
        };
        if (b.summary !== undefined) setSummary(b.summary);
        if (b.description !== undefined) setDescription(b.description);
        if (b.plainExplanation) setPlain(b.plainExplanation);
        const cost = b.usage?.costUsd != null ? `$${b.usage.costUsd.toFixed(4)}` : '';
        const refined = b.refined ? ' · refinado' : '';
        const warn = b.issues && b.issues.length ? ` · ${b.issues.length} aviso(s)` : '';
        setSuggestNote(`DeepSeek ${cost}${refined}${warn}`.trim());
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unexpected');
    } finally {
      setSuggesting(false);
    }
  }

  /* Live quality floor (review queue only): block publish/review on filler or
   * too-short text, mirroring the workbench rules. Saving a draft is allowed. */
  const issues = validate ? validateTranslation(summary, description, locale) : [];
  const blocked = issues.length > 0;

  async function submit(status: 'draft' | 'reviewed' | 'official') {
    setBusy(true); setErr(null); setDone(null);
    try {
      const res = await fetch(`/api/v1/translations/${packageId}/${locale}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, summary, description, plainExplanation: plain }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr((body as { error?: string }).error ?? `HTTP ${res.status}`);
      } else {
        setDone(status);
        if (status !== 'draft' && nextUrl) {
          setTimeout(() => { window.location.href = nextUrl; }, 600);
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unexpected');
    } finally {
      setBusy(false);
    }
  }

  function Row({
    field, label, src, val, set, multi,
  }: {
    field: string; label: string; src: string;
    val: string; set: (v: string) => void; multi?: boolean;
  }) {
    return (
      <div class="row" data-field={field}>
        <div class="col src">
          <div class="head">
            <span class="lbl">{label} <span class="loc">[{source.locale}]</span></span>
            <button type="button" class="ghost-sm"
              disabled={!src}
              onClick={() => set(src)}>
              {labels.copyToTarget}
            </button>
          </div>
          <div class="srcbox">{src || <em class="muted">{labels.empty}</em>}</div>
        </div>
        <div class="col tgt">
          <div class="head">
            <span class="lbl">{label} <span class="loc">[{locale}]</span></span>
            <span class="counter">{val.length}</span>
          </div>
          {multi ? (
            <textarea rows={5} value={val} onInput={(e) => set((e.target as HTMLTextAreaElement).value)} maxLength={20000} />
          ) : (
            <input value={val} onInput={(e) => set((e.target as HTMLInputElement).value)} maxLength={4000} />
          )}
        </div>
      </div>
    );
  }

  return (
    <form class="tform" onSubmit={(e) => { e.preventDefault(); submit('draft'); }}>
      <Row field="summary" label={labels.summary} src={source.summary} val={summary} set={setSummary} />
      <Row field="description" label={labels.description} src={source.description} val={description} set={setDescription} multi />
      <Row field="plain" label={labels.plainExplanation} src={source.plainExplanation} val={plain} set={setPlain} multi />

      {canSuggest && (
        <div class="suggestbar">
          <button type="button" class="suggest" disabled={suggesting || busy} onClick={suggest}>
            {suggesting ? (labels.suggesting ?? 'Traduzindo…') : (labels.suggest ?? 'Traduzir com IA (DeepSeek)')}
          </button>
          {suggestNote && <span class="suggest-note">{suggestNote}</span>}
        </div>
      )}

      {blocked && (
        <ul class="issues" role="alert">
          {issues.map((i) => <li>{i.message}</li>)}
        </ul>
      )}
      {done && <p class="ok" role="status">{labels.actionOk}: <strong>{done}</strong></p>}
      {err && <p class="err" role="alert">{labels.actionFailed}: {err}</p>}

      <div class="actions">
        <div class="btnstack">
          <button type="button" disabled={busy} class="ghost" onClick={() => submit('draft')}>
            {labels.saveDraft}
          </button>
          <small>{labels.saveDraftHint}</small>
        </div>
        <div class="btnstack">
          <button type="button" disabled={busy || blocked} class="primary" onClick={() => submit('reviewed')}>
            {labels.markReviewed}
          </button>
          <small>{labels.markReviewedHint}</small>
        </div>
        {canPublish && (
          <div class="btnstack">
            <button type="button" disabled={busy || blocked} class="publish" onClick={() => submit('official')}>
              {labels.publish}
            </button>
            <small>{labels.publishHint}</small>
          </div>
        )}
        {nextUrl && (
          <div class="btnstack right">
            <a class="skip" href={nextUrl}>{labels.skip} →</a>
            <small>&nbsp;</small>
          </div>
        )}
      </div>

      <style>{`
        .tform { display: grid; gap: var(--space-5); }
        .row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); align-items: stretch; }
        @media (max-width: 900px) { .row { grid-template-columns: 1fr; } }
        .col { display: grid; gap: var(--space-2); }
        .head { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-2); }
        .lbl { font-size: var(--text-sm); font-weight: 600; color: var(--color-fg-muted); }
        .loc { font-family: var(--font-mono); font-weight: 500; font-size: 0.7rem; padding: 1px 6px; background: var(--color-stone-100); border-radius: 999px; }
        .counter { font-family: var(--font-mono); font-size: 0.7rem; color: var(--color-fg-muted); }
        .srcbox {
          padding: 0.7rem 0.9rem; border: 1px dashed var(--color-border);
          border-radius: var(--radius-md); background: var(--color-stone-50, #f8f7f4);
          white-space: pre-wrap; min-height: 2.4rem; font-size: 0.92rem; line-height: 1.45;
          color: var(--color-fg);
        }
        .srcbox .muted { color: var(--color-fg-muted); }
        input, textarea {
          padding: 0.7rem 0.9rem; border: 1.5px solid var(--color-border);
          border-radius: var(--radius-md); font: inherit;
          background: var(--color-bg-elevated); color: var(--color-fg);
          width: 100%; box-sizing: border-box;
        }
        input:focus, textarea:focus { border-color: var(--color-teal-500); outline: none; }
        textarea { resize: vertical; min-height: 6rem; }
        .actions { display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: flex-start; padding-top: var(--space-4); border-top: 1px solid var(--color-border); }
        .btnstack { display: grid; gap: var(--space-1); max-width: 220px; }
        .btnstack.right { margin-left: auto; }
        .btnstack small { font-size: 0.72rem; color: var(--color-fg-muted); line-height: 1.3; }
        button, a.skip { padding: 0.65rem 1.1rem; border-radius: var(--radius-full); font-weight: 600; cursor: pointer; border: 1.5px solid transparent; font: inherit; text-decoration: none; display: inline-block; text-align: center; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        button.ghost { background: transparent; border-color: var(--color-border); color: var(--color-fg); }
        button.primary { background: var(--color-cta); color: var(--color-cta-fg); }
        button.publish { background: var(--color-sage-600, #2a7a48); color: white; }
        a.skip { background: transparent; color: var(--color-fg-muted); border-color: var(--color-border); }
        .ghost-sm { padding: 0.15rem 0.55rem; font-size: 0.72rem; background: transparent; border: 1px solid var(--color-border); border-radius: 999px; color: var(--color-fg-muted); cursor: pointer; }
        .ghost-sm:disabled { opacity: 0.4; cursor: not-allowed; }
        .err { color: var(--color-terra-600); margin: 0; }
        .ok { color: var(--color-sage-600); margin: 0; font-weight: 600; }
        .suggestbar { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
        button.suggest {
          background: color-mix(in srgb, var(--age-18) 14%, transparent);
          border-color: color-mix(in srgb, var(--age-18) 40%, transparent);
          color: var(--age-18);
        }
        button.suggest:hover:not(:disabled) { background: color-mix(in srgb, var(--age-18) 22%, transparent); }
        .suggest-note { font-family: var(--font-mono); font-size: 0.74rem; color: var(--color-fg-muted); }
        .issues { margin: 0; padding: var(--space-3) var(--space-4); list-style: disc inside;
          background: color-mix(in srgb, var(--color-terracotta) 8%, transparent);
          border-inline-start: 3px solid var(--color-terracotta); border-radius: var(--radius-sm);
          color: var(--color-terracotta-hover); font-size: 0.85rem; line-height: 1.5; }
        .issues li { margin: 2px 0; }
      `}</style>
    </form>
  );
}
