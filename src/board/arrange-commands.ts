import { Notice, type Menu } from 'obsidian';
import type { Board } from './board';
import type { RawNode } from '../model/canvas-file';
import { cardKindOf } from '../cards/util';
import {
  alignEdges, distribute, normalize, optimalArrange, packToAspect, pushTogether, shuffle, stack,
  type AlignEdge, type Box, type Direction, type Normalize, type Placement,
} from './arrange';
import { t } from '../i18n';

export type ArrangeCommand =
  | 'optimal' | 'by-name' | 'by-added' | 'by-path' | 'random'
  | 'push-left' | 'push-right' | 'push-up' | 'push-down'
  | 'stack'
  | 'same-height' | 'same-width' | 'same-size' | 'same-area'
  | 'row' | 'column'
  | 'align-left' | 'align-hcenter' | 'align-right' | 'align-top' | 'align-vcenter' | 'align-bottom';

export interface ArrangeDef { id: ArrangeCommand; label: string; icon: string; group: 'arrange' | 'push' | 'size' | 'distribute' | 'align'; keys?: string; }

/** Every command, with its label, icon and default keys (shown in menus). */
export const ARRANGE: ArrangeDef[] = [
  { id: 'optimal', label: 'Optimal arrangement', icon: 'layout-grid', group: 'arrange', keys: '⌥⌘P' },
  { id: 'by-name', label: 'Arrange by name', icon: 'a-large-small', group: 'arrange', keys: '⌥⌘N' },
  { id: 'by-added', label: 'Arrange by order added', icon: 'list-ordered', group: 'arrange', keys: '⌥⌘A' },
  { id: 'by-path', label: 'Arrange by folder', icon: 'folder-tree', group: 'arrange', keys: '⌥⌘D' },
  { id: 'random', label: 'Arrange randomly', icon: 'shuffle', group: 'arrange', keys: '⌥⌘R' },
  { id: 'stack', label: 'Stack', icon: 'layers', group: 'arrange', keys: '⌥⌘S' },
  { id: 'push-left', label: 'Push together to the left', icon: 'arrow-left-to-line', group: 'push', keys: '⌘←' },
  { id: 'push-right', label: 'Push together to the right', icon: 'arrow-right-to-line', group: 'push', keys: '⌘→' },
  { id: 'push-up', label: 'Push together upwards', icon: 'arrow-up-to-line', group: 'push', keys: '⌘↑' },
  { id: 'push-down', label: 'Push together downwards', icon: 'arrow-down-to-line', group: 'push', keys: '⌘↓' },
  { id: 'same-height', label: 'Same height', icon: 'move-vertical', group: 'size', keys: '⌥⌘←' },
  { id: 'same-width', label: 'Same width', icon: 'move-horizontal', group: 'size', keys: '⌥⌘→' },
  { id: 'same-size', label: 'Same size', icon: 'maximize-2', group: 'size', keys: '⌥⌘↑' },
  { id: 'same-area', label: 'Same area', icon: 'square', group: 'size' },
  { id: 'row', label: 'Distribute in a row', icon: 'columns-3', group: 'distribute', keys: '⌥⇧⌘→' },
  { id: 'column', label: 'Distribute in a column', icon: 'rows-3', group: 'distribute', keys: '⌥⇧⌘↓' },
  { id: 'align-left', label: 'Align left edges', icon: 'align-start-vertical', group: 'align' },
  { id: 'align-hcenter', label: 'Align centres horizontally', icon: 'align-center-vertical', group: 'align' },
  { id: 'align-right', label: 'Align right edges', icon: 'align-end-vertical', group: 'align' },
  { id: 'align-top', label: 'Align top edges', icon: 'align-start-horizontal', group: 'align' },
  { id: 'align-vcenter', label: 'Align centres vertically', icon: 'align-center-horizontal', group: 'align' },
  { id: 'align-bottom', label: 'Align bottom edges', icon: 'align-end-horizontal', group: 'align' },
];

/** Card kinds whose size follows their text; they are moved but never resized. */
const SELF_SIZED = new Set(['text']);

/**
 * What a command works on: the selected cards (not groups), or with nothing
 * selected, every image and video on the board.
 */
export function arrangeTargets(board: Board): RawNode[] {
  const sel = board.selectedNodes().filter(n => n.type !== 'group');
  if (sel.length) {
    // Keep the order the cards were selected in (the first one is the base for "same size").
    const order = [...board.selection];
    return sel.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }
  return board.model.nodes.filter(n => { const k = cardKindOf(n); return k === 'image' || k === 'video'; });
}

function nameOf(n: RawNode): string {
  if (n.file) return (n.file.split('/').pop() ?? n.file).toLowerCase();
  const text = (n.text ?? n.label ?? n.url ?? '').trim().split('\n')[0];
  return text.toLowerCase();
}

function folderOf(n: RawNode): string {
  if (!n.file) return '￿';
  const i = n.file.lastIndexOf('/');
  return i < 0 ? '' : n.file.slice(0, i);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The last arranging command and what it ran on: the same again reverses the order. */
let last: { cmd: ArrangeCommand; key: string; reversed: boolean } | null = null;

export function runArrange(board: Board, cmd: ArrangeCommand): void {
  const nodes = arrangeTargets(board);
  const needs = cmd.startsWith('align-') || cmd.startsWith('same-') ? 2 : 1;
  if (nodes.length < needs) {
    new Notice(needs > 1 ? t('Select at least two cards.') : t('Nothing to arrange: select cards, or add images to the board.'));
    return;
  }
  const boxes: Box[] = nodes.map(n => ({ id: n.id, x: n.x, y: n.y, w: n.width, h: n.height }));
  const gap = board.settings.arrangeGap;
  const origin = { x: Math.min(...boxes.map(b => b.x)), y: Math.min(...boxes.map(b => b.y)) };
  const { width, height } = board.screenSize();
  const aspect = Math.max(0.2, width / Math.max(1, height));

  const key = boxes.map(b => b.id).sort().join(',');
  const reversed = !!last && last.cmd === cmd && last.key === key ? !last.reversed : false;
  const ordered = (cmp: (a: RawNode, b: RawNode) => number): Box[] => {
    const sorted = [...nodes].sort(cmp).map(n => boxes.find(b => b.id === n.id)!);
    return reversed ? sorted.reverse() : sorted;
  };
  const index = new Map(board.model.nodes.map((n, i) => [n.id, i]));

  let placement: Placement;
  switch (cmd) {
    case 'optimal': placement = optimalArrange(boxes, aspect, gap, origin, reversed); break;
    case 'by-name': placement = packToAspect(ordered((a, b) => collator.compare(nameOf(a), nameOf(b))), aspect, gap, origin); break;
    case 'by-added': placement = packToAspect(ordered((a, b) => index.get(a.id)! - index.get(b.id)!), aspect, gap, origin); break;
    case 'by-path': placement = packToAspect(ordered((a, b) => collator.compare(folderOf(a), folderOf(b)) || collator.compare(nameOf(a), nameOf(b))), aspect, gap, origin); break;
    case 'random': placement = packToAspect(shuffle(boxes), aspect, gap, origin); break;
    case 'stack': placement = stack(boxes); break;
    case 'push-left': case 'push-right': case 'push-up': case 'push-down':
      placement = pushTogether(boxes, cmd.slice(5) as Direction, gap); break;
    case 'same-height': case 'same-width': case 'same-size': case 'same-area':
      placement = normalize(boxes.filter(b => !SELF_SIZED.has(cardKindOf(board.model.node(b.id)!))), cmd.slice(5) as Normalize, board.settings.normalizeBase); break;
    case 'row': placement = distribute(boxes, 'h', gap); break;
    case 'column': placement = distribute(boxes, 'v', gap); break;
    default: placement = alignEdges(boxes, cmd.slice(6) as AlignEdge);
  }
  last = { cmd, key, reversed };
  applyPlacement(board, placement, cmd === 'stack' ? nodes.map(n => n.id) : null);
}

function applyPlacement(board: Board, placement: Placement, raise: string[] | null): void {
  if (!placement.size) return;
  board.model.transact(() => {
    for (const [id, p] of placement) {
      const n = board.model.node(id);
      if (!n) continue;
      n.x = Math.round(p.x); n.y = Math.round(p.y);
      if (p.w !== undefined) n.width = Math.max(8, Math.round(p.w));
      if (p.h !== undefined) n.height = Math.max(8, Math.round(p.h));
      board.model.touch(id);
    }
    // A stack keeps its layer order, with the stacked cards above everything else.
    if (raise) board.model.reorder(raise, 'front');
  });
}

/** Arrange entries for a right-click menu. */
export function addArrangeMenu(menu: Menu, board: Board, submenu: (title: string, icon: string, section: string, build: (m: Menu) => void) => void, multi: boolean): void {
  const items = (m: Menu, group: ArrangeDef['group']) => {
    for (const d of ARRANGE.filter(x => x.group === group)) {
      m.addItem(i => {
        i.setTitle(t(d.label)).setIcon(d.icon).onClick(() => runArrange(board, d.id));
      });
    }
  };
  submenu(t('Arrange'), 'layout-grid', 'arrange', (m) => { items(m, 'arrange'); m.addSeparator(); items(m, 'push'); });
  if (multi) {
    submenu(t('Align'), 'align-start-vertical', 'arrange', m => items(m, 'align'));
    submenu(t('Same size'), 'maximize-2', 'arrange', m => items(m, 'size'));
    submenu(t('Distribute'), 'columns-3', 'arrange', m => items(m, 'distribute'));
  }
}
