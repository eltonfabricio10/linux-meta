#!/usr/bin/env node
/**
 * Scaffold a new locale: insert into config.ts, copy JSON dicts with [TODO:<code>] prefix.
 * Usage: node scripts/new-locale.mjs <code> [label] [intl] [dir] [flag]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const I18N = join(__dirname, '..', 'src', 'i18n');

const [, , codeRaw, labelArg, intlArg, dirArg, flagArg] = process.argv;
if (!codeRaw) {
  console.error('usage: new-locale <code> [label] [intl] [dir=ltr] [flag]');
  process.exit(2);
}
const code = codeRaw.toLowerCase().trim();
if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(code)) {
  console.error(`invalid code: ${code}`);
  process.exit(2);
}

const label = labelArg ?? code.toUpperCase();
const intl = intlArg ?? code;
const dir = dirArg ?? 'ltr';
const flag = flagArg ?? '🏳️';
if (dir !== 'ltr' && dir !== 'rtl') {
  console.error(`dir must be ltr or rtl, got: ${dir}`);
  process.exit(2);
}

const configPath = join(I18N, 'config.ts');
let config = readFileSync(configPath, 'utf8');
if (config.includes(`  ${code}: {`)) {
  console.error(`locale '${code}' already present in config.ts`);
  process.exit(1);
}
const insertLine = `  ${code}: { label: '${label}', intl: '${intl}', dir: '${dir}', flag: '${flag}' },`;
const re = /(export const localeConfig = \{[\s\S]*?)(\n\} as const satisfies Record<string, LocaleMeta>;)/;
if (!re.test(config)) {
  console.error('could not locate localeConfig block in config.ts');
  process.exit(1);
}
config = config.replace(re, (_m, body, tail) => `${body.replace(/\s+$/, '')}\n${insertLine}${tail}`);
writeFileSync(configPath, config);
console.log(`✓ config.ts: added '${code}'`);

const defaultCode = 'pt';
function scaffoldJson(src, dst) {
  if (existsSync(dst)) {
    console.log(`- ${dst}: exists, skip`);
    return;
  }
  const data = JSON.parse(readFileSync(src, 'utf8'));
  const todo = (v) => typeof v === 'string' ? `[TODO:${code}] ${v}`
    : Array.isArray(v) ? v.map(todo)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, todo(x)]))
    : v;
  writeFileSync(dst, JSON.stringify(todo(data), null, 2) + '\n');
  console.log(`✓ ${dst}: scaffolded from ${src}`);
}
scaffoldJson(join(I18N, `${defaultCode}.json`), join(I18N, `${code}.json`));
scaffoldJson(join(I18N, `meta-${defaultCode}.json`), join(I18N, `meta-${code}.json`));

console.log(`\nNext:`);
console.log(`  1. Translate strings in src/i18n/${code}.json and meta-${code}.json (remove [TODO:${code}] prefix)`);
console.log(`  2. Add labels[${code}] to categories in src/lib/categories.ts`);
console.log(`  3. Run: pnpm i18n:check`);
console.log(`  4. Smoke: pnpm build && curl -I http://localhost:4410/${code}/`);
