import { getLanguage as appLanguage } from 'obsidian';
import { ZH_TW } from './zh-tw';
import { LOCALES } from './locales';

/** Interface languages, with their own names (the picker reads well in any language). */
export const LANGUAGE_OPTIONS = {
  en: 'English',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  ja: '日本語',
  ko: '한국어',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  'pt-BR': 'Português (Brasil)',
  ru: 'Русский',
  uk: 'Українська',
  nl: 'Nederlands',
  pl: 'Polski',
  tr: 'Türkçe',
  id: 'Bahasa Indonesia',
  vi: 'Tiếng Việt',
  th: 'ไทย',
} as const;

export type Language = keyof typeof LANGUAGE_OPTIONS;
/** The setting: a language, or "auto" to follow Obsidian's own. */
export type LanguageSetting = Language | 'auto';

const TABLES: Partial<Record<Language, Record<string, string>>> = { 'zh-TW': ZH_TW, ...LOCALES };

let current: Language = 'en';

/** Obsidian's interface language, as one of ours (English when we don't have it). */
export function obsidianLanguage(): Language {
  let code = 'en';
  try { code = appLanguage() || 'en'; } catch { /* default (tests, no Obsidian) */ }
  const c = code.toLowerCase();
  if (c === 'zh-tw' || c === 'zh-hk' || c === 'zh-hant') return 'zh-TW';
  if (c.startsWith('zh')) return 'zh-CN';
  if (c === 'pt' || c.startsWith('pt-')) return 'pt-BR';
  const hit = (Object.keys(LANGUAGE_OPTIONS) as Language[]).find(l => l.toLowerCase() === c || l.toLowerCase() === c.split('-')[0]);
  return hit ?? 'en';
}

export function setLanguage(lang: LanguageSetting): void {
  current = lang === 'auto' ? obsidianLanguage() : lang;
}

export function getLanguage(): Language {
  return current;
}

export function isLanguageSetting(v: unknown): v is LanguageSetting {
  return v === 'auto' || (typeof v === 'string' && Object.prototype.hasOwnProperty.call(LANGUAGE_OPTIONS, v));
}

/**
 * Strings are keyed by their English text. `{name}` placeholders are filled
 * from `vars`. A missing translation falls back to the English key.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = TABLES[current]?.[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
