export type TranslationOut = {
  summary: string | null;
  description: string | null;
  plain: string | null;
};

export type Validated = {
  sourceQuality: 'adequate' | 'insufficient' | 'unknown';
  expandedEn: string | null;
  translations: Record<string, TranslationOut>;
};

/* Validate AI translator output.
 *
 * Accepts either the new shape:
 *   { source_quality, expanded_en, translations: { locale: {summary, description, plain} } }
 * or the legacy flat shape (backward-compat with old prompt runs):
 *   { locale: {summary, description, plain}, ... }
 */
export function validate(raw: unknown, requestedLocales: readonly string[]): Validated | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'not an object' };
  const r = raw as Record<string, unknown>;
  const allow = new Set(requestedLocales);

  /* Detect shape: new shape has a `translations` object. */
  const hasNew = r['translations'] && typeof r['translations'] === 'object';
  const rawTranslations = (hasNew ? r['translations'] : raw) as Record<string, unknown>;

  const sq = r['source_quality'];
  const sourceQuality: Validated['sourceQuality'] =
    sq === 'adequate' || sq === 'insufficient' ? sq : 'unknown';

  const expandedEnRaw = r['expanded_en'];
  const expandedEn =
    typeof expandedEnRaw === 'string' && expandedEnRaw.trim().length >= 200
      ? expandedEnRaw.slice(0, 8000)
      : null;

  const translations: Record<string, TranslationOut> = {};
  for (const [loc, val] of Object.entries(rawTranslations)) {
    if (!allow.has(loc)) continue;
    if (!val || typeof val !== 'object') continue;
    const v = val as Record<string, unknown>;
    const summary = typeof v['summary'] === 'string' ? (v['summary'] as string).slice(0, 400) : null;
    const description = typeof v['description'] === 'string' ? (v['description'] as string).slice(0, 8000) : null;
    const plain = typeof v['plain'] === 'string' ? (v['plain'] as string).slice(0, 280) : null;
    if (!summary && !description && !plain) continue;
    translations[loc] = { summary, description, plain };
  }

  if (Object.keys(translations).length === 0) return { error: 'no usable locales in response' };
  return { sourceQuality, expandedEn, translations };
}
