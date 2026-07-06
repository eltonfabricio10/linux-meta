import pt from './meta-pt.json';
import en from './meta-en.json';
import type { Locale } from './index';

const dicts = { pt, en } as const;
export function meta(locale: Locale): typeof pt {
  return dicts[locale];
}
