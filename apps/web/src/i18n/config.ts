export type LocaleMeta = {
  label: string;
  intl: string;
  dir: 'ltr' | 'rtl';
  flag: string;
};

export const localeConfig = {
  pt: { label: 'Português', intl: 'pt-BR', dir: 'ltr', flag: '🇧🇷' },
  en: { label: 'English', intl: 'en-US', dir: 'ltr', flag: '🇺🇸' },
} as const satisfies Record<string, LocaleMeta>;

export type Locale = keyof typeof localeConfig;
export const locales = Object.keys(localeConfig) as Locale[];
export const defaultLocale: Locale = 'pt';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && value in localeConfig;
}

export function intlTag(locale: Locale): string {
  return localeConfig[locale].intl;
}
