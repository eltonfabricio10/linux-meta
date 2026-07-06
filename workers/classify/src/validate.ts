export type OarsLevel = 'none' | 'mild' | 'moderate' | 'intense';

export type ClassifyResult = {
  age_min: number;
  oars: Record<string, OarsLevel>;
  rationale: string;
  confidence: number;
};

const OARS_LEVELS = new Set<OarsLevel>(['none', 'mild', 'moderate', 'intense']);
const OARS_CATS = new Set([
  'violence-cartoon','violence-fantasy','violence-realistic','violence-bloodshed',
  'violence-sexual','violence-desecration','violence-slavery','violence-worship',
  'drugs-alcohol','drugs-narcotics','drugs-tobacco',
  'sex-nudity','sex-themes','sex-homosexuality','sex-prostitution','sex-adultery','sex-appearance',
  'language-profanity','language-humor','language-discrimination',
  'social-chat','social-info','social-audio','social-location','social-contacts',
  'money-purchasing','money-advertising','money-gambling',
]);

export function validate(raw: unknown): ClassifyResult | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'not an object' };
  const r = raw as Record<string, unknown>;

  const age = Number(r['age_min']);
  if (!Number.isInteger(age) || age < 0 || age > 18) return { error: `bad age_min=${r['age_min']}` };

  const oarsRaw = r['oars'];
  if (oarsRaw == null || typeof oarsRaw !== 'object') return { error: 'oars missing/not object' };

  const oars: Record<string, OarsLevel> = {};
  for (const [k, v] of Object.entries(oarsRaw as Record<string, unknown>)) {
    if (!OARS_CATS.has(k)) continue;       // silently drop unknown cats
    if (typeof v !== 'string') continue;
    if (!OARS_LEVELS.has(v as OarsLevel)) continue;
    oars[k] = v as OarsLevel;
  }

  const rationale = typeof r['rationale'] === 'string' ? (r['rationale'] as string).slice(0, 1000) : '';
  const confidence = Math.max(0, Math.min(1, Number(r['confidence']) || 0));

  return { age_min: age, oars, rationale, confidence };
}
