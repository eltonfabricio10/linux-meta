import { describe, it, expect } from 'vitest';
import { validate } from '../src/validate.ts';

describe('translate/validate', () => {
  it('keeps only requested locales (new shape)', () => {
    const r = validate(
      {
        source_quality: 'adequate',
        expanded_en: null,
        translations: {
          pt: { summary: 'oi', description: null, plain: null },
          en: { summary: 'hi', description: null, plain: null },
          fr: { summary: 'salut', description: null, plain: null },
        },
      },
      ['pt', 'en'],
    ) as any;
    expect(r.error).toBeUndefined();
    expect(Object.keys(r.translations).sort()).toEqual(['en', 'pt']);
    expect(r.sourceQuality).toBe('adequate');
    expect(r.expandedEn).toBeNull();
  });

  it('accepts expanded_en when long enough', () => {
    const long = 'A'.repeat(500);
    const r = validate(
      {
        source_quality: 'insufficient',
        expanded_en: long,
        translations: { pt: { summary: 'oi', description: 'descrição em pt', plain: 'explica' } },
      },
      ['pt'],
    ) as any;
    expect(r.error).toBeUndefined();
    expect(r.expandedEn).toBe(long);
    expect(r.sourceQuality).toBe('insufficient');
  });

  it('drops expanded_en when too short (likely garbage)', () => {
    const r = validate(
      {
        source_quality: 'insufficient',
        expanded_en: 'too short',
        translations: { pt: { summary: 'oi', description: null, plain: null } },
      },
      ['pt'],
    ) as any;
    expect(r.expandedEn).toBeNull();
  });

  it('still accepts legacy flat shape (backward-compat)', () => {
    const r = validate(
      {
        pt: { summary: 'oi', description: null, plain: null },
        en: { summary: 'hi', description: null, plain: null },
      },
      ['pt', 'en'],
    ) as any;
    expect(r.error).toBeUndefined();
    expect(Object.keys(r.translations).sort()).toEqual(['en', 'pt']);
    expect(r.sourceQuality).toBe('unknown');
    expect(r.expandedEn).toBeNull();
  });

  it('truncates long strings to caps', () => {
    const big = 'a'.repeat(10000);
    const r = validate(
      { translations: { pt: { summary: big, description: big, plain: big } } },
      ['pt'],
    ) as any;
    expect(r.translations.pt.summary.length).toBe(400);
    expect(r.translations.pt.description.length).toBe(8000);
    expect(r.translations.pt.plain.length).toBe(280);
  });

  it('rejects when no usable locale present', () => {
    const r = validate({ translations: { fr: { summary: 'x', description: null, plain: null } } }, ['pt', 'en']) as any;
    expect(r.error).toMatch(/no usable locales/);
  });
});
