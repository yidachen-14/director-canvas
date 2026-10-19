import { ZH_TW } from './zh-tw';

export type Language = 'zh-TW' | 'en';

let current: Language = 'zh-TW';

export function setLanguage(lang: Language): void {
  current = lang;
}

export function getLanguage(): Language {
  return current;
}

/**
 * Strings are keyed by their English text. `{name}` placeholders are filled
 * from `vars`. A missing translation falls back to the English key.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = current === 'zh-TW' ? (ZH_TW[key] ?? key) : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
