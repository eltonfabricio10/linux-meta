/** OARS 1.x → minimum recommended age, per category and intensity.
 *  Source: derived from libappstream's age table (matches GNOME Software / Discover behavior).
 *  All values are conservative lower bounds; product UI may surface a localized rating. */

export type OarsLevel = 'none' | 'mild' | 'moderate' | 'intense';

const TABLE: Record<string, Partial<Record<OarsLevel, number>>> = {
  'violence-cartoon':       { none: 0, mild: 9,  moderate: 13, intense: 15 },
  'violence-fantasy':       { none: 0, mild: 9,  moderate: 13, intense: 18 },
  'violence-realistic':     { none: 0, mild: 13, moderate: 15, intense: 18 },
  'violence-bloodshed':     { none: 0, mild: 13, moderate: 15, intense: 18 },
  'violence-sexual':        { none: 0, mild: 18, moderate: 18, intense: 18 },
  'violence-desecration':   { none: 0, mild: 13, moderate: 15, intense: 18 },
  'violence-slavery':       { none: 0, mild: 15, moderate: 18, intense: 18 },
  'violence-worship':       { none: 0, mild: 13, moderate: 15, intense: 18 },
  'drugs-alcohol':          { none: 0, mild: 15, moderate: 18, intense: 18 },
  'drugs-narcotics':        { none: 0, mild: 18, moderate: 18, intense: 18 },
  'drugs-tobacco':          { none: 0, mild: 15, moderate: 18, intense: 18 },
  'sex-nudity':             { none: 0, mild: 13, moderate: 15, intense: 18 },
  'sex-themes':             { none: 0, mild: 13, moderate: 15, intense: 18 },
  'sex-homosexuality':      { none: 0, mild: 0,  moderate: 0,  intense: 0 },
  'sex-prostitution':       { none: 0, mild: 15, moderate: 18, intense: 18 },
  'sex-adultery':           { none: 0, mild: 15, moderate: 18, intense: 18 },
  'sex-appearance':         { none: 0, mild: 9,  moderate: 13, intense: 15 },
  'language-profanity':     { none: 0, mild: 9,  moderate: 13, intense: 15 },
  'language-humor':         { none: 0, mild: 9,  moderate: 13, intense: 15 },
  'language-discrimination':{ none: 0, mild: 13, moderate: 15, intense: 18 },
  'social-chat':            { none: 0, mild: 9,  moderate: 13, intense: 15 },
  'social-info':            { none: 0, mild: 9,  moderate: 13, intense: 15 },
  'social-audio':           { none: 0, mild: 9,  moderate: 13, intense: 15 },
  'social-location':        { none: 0, mild: 9,  moderate: 13, intense: 15 },
  'social-contacts':        { none: 0, mild: 9,  moderate: 13, intense: 15 },
  'money-purchasing':       { none: 0, mild: 13, moderate: 15, intense: 18 },
  'money-advertising':      { none: 0, mild: 9,  moderate: 13, intense: 15 },
  'money-gambling':         { none: 0, mild: 18, moderate: 18, intense: 18 },
};

export type OarsMap = Record<string, OarsLevel>;

export function computeAgeFromOars(oars: OarsMap): number {
  let max = 0;
  for (const [cat, lvl] of Object.entries(oars)) {
    const row = TABLE[cat];
    if (!row) continue;
    const age = row[lvl] ?? 0;
    if (age > max) max = age;
  }
  return max;
}

const VALID = new Set<OarsLevel>(['none', 'mild', 'moderate', 'intense']);
export function isOarsLevel(v: string): v is OarsLevel {
  return VALID.has(v as OarsLevel);
}
