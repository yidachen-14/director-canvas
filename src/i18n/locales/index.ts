import type { Language } from '../index';
import { ZH_CN } from './zh-cn';
import { JA } from './ja';
import { KO } from './ko';
import { DE } from './de';
import { ES } from './es';
import { FR } from './fr';
import { IT } from './it';
import { PT_BR } from './pt-br';
import { RU } from './ru';
import { UK } from './uk';
import { NL } from './nl';
import { PL } from './pl';
import { TR } from './tr';
import { ID } from './id';
import { VI } from './vi';
import { TH } from './th';

/** Translations other than Traditional Chinese (which lives next door), keyed by English text. */
export const LOCALES: Partial<Record<Language, Record<string, string>>> = {
  'zh-CN': ZH_CN,
  'ja': JA,
  'ko': KO,
  'de': DE,
  'es': ES,
  'fr': FR,
  'it': IT,
  'pt-BR': PT_BR,
  'ru': RU,
  'uk': UK,
  'nl': NL,
  'pl': PL,
  'tr': TR,
  'id': ID,
  'vi': VI,
  'th': TH,
};
