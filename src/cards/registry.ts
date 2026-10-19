import type { CardType } from './types';
import { fallbackCardType } from './basic';

const TYPES = new Map<string, CardType>();

export function registerCard(type: CardType): void {
  TYPES.set(type.id, type);
}

export function getCardType(kind: string): CardType | undefined {
  return TYPES.get(kind);
}

export function allCardTypes(): CardType[] {
  return [...TYPES.values()];
}

export const fallbackCard: CardType = fallbackCardType;
