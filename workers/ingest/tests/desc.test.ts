import { describe, it, expect } from 'vitest';
import { parseDesc, getString, getArray, getNumber } from '../src/lib/desc.ts';

describe('ingest/desc parser', () => {
  it('parses multi-line and multi-key blocks; arrays vs strings for MULTI_KEYS', () => {
    const text = [
      '%NAME%',
      'firefox',
      '',
      '%DESC%',
      'line 1',
      'line 2',
      '',
      '%DEPENDS%',
      'gtk3',
      'glib2',
      '',
      '%CSIZE%',
      '12345',
      '',
    ].join('\n');

    const r = parseDesc(text);
    expect(r['NAME']).toBe('firefox');
    expect(r['DESC']).toBe('line 1\nline 2');
    expect(Array.isArray(r['DEPENDS'])).toBe(true);
    expect(r['DEPENDS']).toEqual(['gtk3', 'glib2']);

    expect(getString(r, 'NAME')).toBe('firefox');
    expect(getArray(r, 'DEPENDS')).toEqual(['gtk3', 'glib2']);
    expect(getNumber(r, 'CSIZE')).toBe(12345);
    expect(getNumber(r, 'MISSING')).toBeNull();
  });
});
