import { defaultLocale, type Locale } from './config';

/** Pick locale-specific value with safe fallback chain.
 *
 * tt(locale, { pt: 'Olá', en: 'Hi' }, 'Hi')
 *
 * Returns map[locale] if defined, else map[defaultLocale], else fallback.
 * Fallback is mandatory to force the author to handle locales missing from the map.
 */
export function tt<T>(locale: Locale, map: Partial<Record<Locale, T>>, fallback: T): T {
  return map[locale] ?? map[defaultLocale] ?? fallback;
}
