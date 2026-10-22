import en from './en.json';
import ar from './ar.json';

export type SupportedLanguage = 'en' | 'ar';
export type Direction = 'ltr' | 'rtl';

const translations: Record<SupportedLanguage, typeof en> = {
  en,
  ar: ar as unknown as typeof en,
};

let currentLanguage: SupportedLanguage = 'en';

export function setLanguage(lang: SupportedLanguage) {
  currentLanguage = lang;
}

export function getLanguage(): SupportedLanguage {
  return currentLanguage;
}

export function getDirection(lang?: SupportedLanguage): Direction {
  const target = lang || currentLanguage;
  return target === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Access nested translation key, e.g. t('nav.dashboard')
 */
export function t(path: string, fallback?: string): string {
  const keys = path.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = translations[currentLanguage];

  for (const k of keys) {
    if (current && typeof current === 'object' && k in current) {
      current = current[k];
    } else {
      // Fallback to English
      let enCurrent: any = translations.en;
      for (const ek of keys) {
        if (enCurrent && typeof enCurrent === 'object' && ek in enCurrent) {
          enCurrent = enCurrent[ek];
        } else {
          return fallback || path;
        }
      }
      return typeof enCurrent === 'string' ? enCurrent : fallback || path;
    }
  }

  return typeof current === 'string' ? current : fallback || path;
}
