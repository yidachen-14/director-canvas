import type { Board } from './board';
import type { RawNode } from '../model/canvas-file';
import { cardKindOf } from '../cards/util';

export const COLUMN_HEADER = 44;
export const COLUMN_PAD = 12;
export const COLUMN_GAP = 10;
const MIN_HEIGHT = 120;

/** Card kinds that keep their own width inside a column (their box follows their text). */
const OWN_WIDTH = new Set(['text']);

export function isColumn(n: RawNode): boolean {
  return n.type === 'group' && n.vc?.kind === 'column';
}

/** The cards a column holds: those whose centre lies inside it, top to bottom. */
export function columnMembers(col: RawNode, nodes: RawNode[]): RawNode[] {
  return nodes.filter((n) => {
    if (n.id === col.id || n.type === 'group') return false;
    const cx = n.x + n.width / 2, cy = n.y + n.height / 2;
    return cx >= col.x && cx <= col.x + col.width && cy >= col.y && cy <= col.y + col.height;
  }).sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2) || a.x - b.x);
}

/** Stack a column's cards under its header and fit its height to them. */
export function layoutColumn(col: RawNode, nodes: RawNode[]): RawNode[] {
  const changed: RawNode[] = [];
  let y = col.y + COLUMN_HEADER;
  for (const n of columnMembers(col, nodes)) {
    const own = OWN_WIDTH.has(cardKindOf(n));
    const x = col.x + COLUMN_PAD;
    const w = own ? n.width : Math.max(40, col.width - COLUMN_PAD * 2);
    if (n.x !== x || n.y !== y || n.width !== w) {
      n.x = x; n.y = y; n.width = w;
      changed.push(n);
    }
    y += n.height + COLUMN_GAP;
  }
  const h = Math.max(MIN_HEIGHT, y - COLUMN_GAP + COLUMN_PAD - col.y);
  if (col.height !== h) { col.height = h; changed.push(col); }
  return changed;
}

/** Columns re-stack their cards after every change. */
export function installColumns(board: Board): void {
  board.addDisposer(board.model.addNormalizer(() => {
    const nodes = board.model.nodes;
    for (const col of nodes.filter(isColumn)) {
      for (const n of layoutColumn(col, nodes)) board.model.touch(n.id);
    }
  }));
}
