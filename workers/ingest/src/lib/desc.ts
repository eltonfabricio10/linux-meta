/** Parse Arch/Manjaro `desc` file format into key→string|string[] map.
 *
 * Format:
 *   %KEY%
 *   value
 *   [more values]
 *
 *   %NEXT_KEY%
 *   ...
 */
export type DescRecord = Record<string, string | string[]>;

const MULTI_KEYS = new Set([
  'GROUPS', 'LICENSE', 'REPLACES', 'DEPENDS', 'OPTDEPENDS',
  'CONFLICTS', 'PROVIDES', 'MAKEDEPENDS', 'CHECKDEPENDS',
  'FILES', 'BACKUP',
]);

export function parseDesc(text: string): DescRecord {
  const rec: DescRecord = {};
  const lines = text.split(/\r?\n/);
  let key: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (!key) return;
    const trimmed = buf.filter((l) => l.length > 0);
    if (MULTI_KEYS.has(key)) {
      rec[key] = trimmed;
    } else {
      rec[key] = trimmed.join('\n');
    }
    key = null;
    buf = [];
  };

  for (const line of lines) {
    const m = /^%([A-Z0-9_]+)%$/.exec(line);
    if (m) {
      flush();
      key = m[1] ?? null;
      buf = [];
    } else if (key !== null) {
      buf.push(line);
    }
  }
  flush();
  return rec;
}

export function getString(r: DescRecord, k: string): string | null {
  const v = r[k];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) return v[0] ?? null;
  return null;
}

export function getArray(r: DescRecord, k: string): string[] {
  const v = r[k];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.length > 0) return [v];
  return [];
}

export function getNumber(r: DescRecord, k: string): number | null {
  const s = getString(r, k);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
