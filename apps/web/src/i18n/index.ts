import { localeConfig, locales, defaultLocale, type Locale, isLocale, intlTag } from './config';

export { locales, defaultLocale, isLocale, intlTag, localeConfig };
export type { Locale };
export { tt } from './tt';

/** Auto-load every {locale}.json. Adding a new locale only requires dropping
 * the JSON next to this file and adding the code to localeConfig. */
const dictionaryModules = import.meta.glob<true, string, Record<string, unknown>>(
  './*.json',
  { eager: true, import: 'default' },
);

const dictionaries = Object.fromEntries(
  Object.entries(dictionaryModules)
    .map(([path, mod]): [string, Record<string, unknown>] => [path.match(/\.\/([^/.]+)\.json$/)?.[1] ?? '', mod])
    .filter(([code]) => code && !code.startsWith('meta-')),
) as Record<string, Record<string, unknown>>;

// Reference dictionary used for the Dict type — defaultLocale is required to exist.
import ptRef from './pt.json';
type Dict = typeof ptRef;

export function getLocaleFromUrl(url: URL): Locale {
  const seg = url.pathname.split('/').filter(Boolean)[0];
  return isLocale(seg) ? seg : defaultLocale;
}

export function t(locale: Locale): Dict {
  return (dictionaries[locale] ?? dictionaries[defaultLocale]) as Dict;
}

export function localePath(locale: Locale, path: string): string {
  const clean = path.replace(/^\/+/, '');
  return `/${locale}/${clean}`.replace(/\/+$/, '') || `/${locale}`;
}

export function switchLocalePath(url: URL, target: Locale): string {
  const parts = url.pathname.split('/');
  parts[1] = target;
  return parts.join('/') || `/${target}`;
}

/** Replace `{key}` placeholders in a string. */
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}
