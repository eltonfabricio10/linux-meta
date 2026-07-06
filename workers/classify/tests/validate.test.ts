import { describe, it, expect } from 'vitest';
import { validate } from '../src/validate.ts';

describe('classify/validate', () => {
  it('happy path returns same shape', () => {
    const input = {
      age_min: 13,
      oars: { 'violence-cartoon': 'mild', 'language-profanity': 'moderate' },
      rationale: 'reason',
      confidence: 0.7,
    };
    const r = validate(input) as any;
    expect(r.error).toBeUndefined();
    expect(r.age_min).toBe(13);
    expect(r.oars).toEqual({ 'violence-cartoon': 'mild', 'language-profanity': 'moderate' });
    expect(r.rationale).toBe('reason');
    expect(r.confidence).toBe(0.7);
  });

  it('drops unknown OARS categories silently', () => {
    const r = validate({
      age_min: 7,
      oars: { 'violence-cartoon': 'mild', 'unknown-cat': 'mild' },
      rationale: '',
      confidence: 0.5,
    }) as any;
    expect(r.oars).toEqual({ 'violence-cartoon': 'mild' });
  });

  it('drops invalid levels silently', () => {
    const r = validate({
      age_min: 7,
      oars: { 'violence-cartoon': 'extreme', 'language-humor': 'mild' },
      rationale: '',
      confidence: 0.5,
    }) as any;
    expect(r.oars).toEqual({ 'language-humor': 'mild' });
  });

  it('rejects age_min out of range', () => {
    expect((validate({ age_min: -1, oars: {}, rationale: '', confidence: 0 }) as any).error).toMatch(/age_min/);
    expect((validate({ age_min: 19, oars: {}, rationale: '', confidence: 0 }) as any).error).toMatch(/age_min/);
  });

  it('clamps confidence to [0,1]', () => {
    const lo = validate({ age_min: 0, oars: {}, rationale: '', confidence: -2 }) as any;
    const hi = validate({ age_min: 0, oars: {}, rationale: '', confidence: 5 }) as any;
    expect(lo.confidence).toBe(0);
    expect(hi.confidence).toBe(1);
  });
});
