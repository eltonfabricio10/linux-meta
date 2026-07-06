#!/usr/bin/env node
/**
 * Validate locale dictionaries: missing keys vs default, leftover [TODO:<code>] markers.
 * Exit 1 if non-default locales have gaps.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const I18N = join(__dirname, '..', 'src', 'i18n');
const DEFAULT = 'pt';

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, key));
    else out[key] = v;
  }
  return out;
}

function load(file) { return JSON.parse(readFileSync(join(I18N, file), 'utf8')); }

const files = readdirSync(I18N).filter((f) => f.endsWith('.json'));
const bases = ['', 'meta-'];
let fail = 0;

for (const prefix of bases) {
  const defFile = `${prefix}${DEFAULT}.json`;
  if (!files.includes(defFile)) { console.error(`missing default: ${defFile}`); fail++; continue; }
  const defKeys = new Set(Object.keys(flatten(load(defFile))));
  const locales = files
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json') && f !== defFile)
    .filter((f) => prefix === '' ? !f.startsWith('meta-') : true)
    .map((f) => f.slice(prefix.length, -'.json'.length));

  for (const code of locales) {
    const dict = flatten(load(`${prefix}${code}.json`));
    const have = new Set(Object.keys(dict));
    const missing = [...defKeys].filter((k) => !have.has(k));
    const extra = [...have].filter((k) => !defKeys.has(k));
    const todos = Object.entries(dict).filter(([, v]) => typeof v === 'string' && v.includes(`[TODO:${code}]`));

    console.log(`\n[${prefix}${code}] missing=${missing.length} extra=${extra.length} todo=${todos.length}`);
    if (missing.length) {
      missing.slice(0, 10).forEach((k) => console.log(`  - missing: ${k}`));
      if (missing.length > 10) console.log(`  ... +${missing.length - 10}`);
      fail++;
    }
    if (todos.length) {
      todos.slice(0, 5).forEach(([k]) => console.log(`  ! TODO: ${k}`));
      if (todos.length > 5) console.log(`  ... +${todos.length - 5}`);
    }
    if (extra.length) extra.slice(0, 5).forEach((k) => console.log(`  ? extra: ${k}`));
  }
}

// Category labels coverage
try {
  const cats = readFileSync(join(__dirname, '..', 'src', 'lib', 'categories.ts'), 'utf8');
  const codes = new Set();
  for (const m of cats.matchAll(/\blabels:\s*\{([^}]*)\}/g)) {
    for (const k of m[1].matchAll(/(\w+):\s*['"]/g)) codes.add(k[1]);
  }
  console.log(`\n[categories.ts] locale keys seen: ${[...codes].join(', ')}`);
} catch {}

if (fail) { console.error(`\n✗ ${fail} locale(s) with gaps`); process.exit(1); }
console.log('\n✓ all locales complete');
