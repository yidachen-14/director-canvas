import type { Board } from './board';
import { getCardType } from '../cards/registry';

/**
 * A toolbar tool. Mode tools (select, hand, connect, card kinds) stay active
 * until used; action tools (pick an image, a note) run once.
 */
export interface Tool {
  id: string;
  label: string;
  icon: string;
  /** Run instead of switching mode. */
  run?(board: Board): void;
  /** Hidden until the feature lands. */
  available?(): boolean;
}

const cardTool = (id: string): Tool => ({
  id,
  get label() { return getCardType(id)?.label ?? id; },
  get icon() { return getCardType(id)?.icon ?? 'square'; },
  available: () => !!getCardType(id),
});

export const TOOLS: Tool[] = [
  { id: 'select', label: 'Select', icon: 'mouse-pointer-2' },
  { id: 'hand', label: 'Hand', icon: 'hand' },
  cardTool('text'),
  cardTool('note'),
  cardTool('sticky'),
  cardTool('callout'),
  cardTool('kanban'),
  cardTool('column'),
  cardTool('group'),
  { id: 'connect', label: 'Connect', icon: 'spline' },
  { id: 'pen', label: 'Pen', icon: 'pen-line', available: () => !!getCardType('drawing') },
  cardTool('swatch'),
  cardTool('bookmark'),
  cardTool('mindmap'),
  cardTool('calendar'),
];

/** Always at the start of the toolbar, before the first divider. */
export const FIXED_TOOLS = ['select', 'hand'];

export function toolById(id: string): Tool | undefined {
  return TOOLS.find(x => x.id === id);
}

export function availableTools(): Tool[] {
  return TOOLS.filter(x => !x.available || x.available());
}

/**
 * Every tool except Select and Hand, in the order the user arranged them (settings), the ones
 * never arranged after: first those on the toolbar, then the rest in their usual order.
 */
export function orderedTools(s: { toolbarTools: string[]; toolbarOrder: string[] }): Tool[] {
  const tools = availableTools().filter(x => !FIXED_TOOLS.includes(x.id));
  const order = [...s.toolbarOrder, ...s.toolbarTools];
  const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? order.length + tools.findIndex(x => x.id === id) : i; };
  return [...tools].sort((a, b) => rank(a.id) - rank(b.id));
}
