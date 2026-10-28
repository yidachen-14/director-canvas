import type { Language } from '../index';
import { ZH_CN } from './zh-cn';

/** Translations other than Traditional Chinese (which lives next door), keyed by English text. */
export const LOCALES: Partial<Record<Language, Record<string, string>>> = {
  'zh-CN': ZH_CN,
};
