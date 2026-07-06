import { describe, it, expect } from 'vitest';
import { slugify } from '../src/lib/slug.ts';

describe('ingest/slug', () => {
  it('lowercases and strips accents', () => {
    expect(slugify('Ação')).toBe('acao');
    expect(slugify('Crème Brûlée')).toBe('creme-brulee');
  });

  it('replaces non [a-z0-9] with dashes and trims', () => {
    expect(slugify('  Hello, World!  ')).toBe('hello-world');
    expect(slugify('foo___bar..baz')).toBe('foo-bar-baz');
    expect(slugify('---x---')).toBe('x');
  });

  it('slices to 200 chars', () => {
    const long = 'a'.repeat(300);
    expect(slugify(long).length).toBe(200);
  });
});
