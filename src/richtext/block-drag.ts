import { setIcon } from 'obsidian';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import type { Transaction } from 'prosemirror-state';
import { schema } from './schema';
import { blockMarkdown, parseMarkdown } from './markdown';
import { richRegistry, type RichText } from './editor';
import { t } from '../i18n';

/** A draggable unit: a top-level block, or one list item. */
export interface Block { pos: number; node: PMNode; dom: HTMLElement; listType: PMNode['type'] | null; }

function blockFromPos(view: EditorView, pos: number): Block | null {
  const doc = view.state.doc;
  const $pos = doc.resolve(Math.min(Math.max(pos, 0), doc.content.size));
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type === schema.nodes.list_item) {
      const dom = view.nodeDOM($pos.before(d)) as HTMLElement | null;
      return dom ? { pos: $pos.before(d), node, dom, listType: $pos.node(d - 1).type } : null;
    }
  }
  if ($pos.depth >= 1) {
    const dom = view.nodeDOM($pos.before(1)) as HTMLElement | null;
    return dom ? { pos: $pos.before(1), node: $pos.node(1), dom, listType: null } : null;
  }
  // Between blocks or on an atom block at the top level.
  const after = $pos.nodeAfter;
  if (after && after.isBlock) {
    const dom = view.nodeDOM($pos.pos) as HTMLElement | null;
    return dom ? { pos: $pos.pos, node: after, dom, listType: null } : null;
  }
  return null;
}

/** The block under a screen point, looking from the content's left edge so margins still hit. */
export function blockAtPoint(view: EditorView, clientX: number, clientY: number): Block | null {
  const r = view.dom.getBoundingClientRect();
  const x = Math.min(Math.max(clientX, r.left + 24), r.right - 4);
  const hit = view.posAtCoords({ left: x, top: clientY });
  if (!hit) return null;
  if (hit.inside >= 0) {
    const node = view.state.doc.nodeAt(hit.inside);
    if (node && node.isBlock && node.isAtom) {
      const b = blockFromPos(view, hit.inside + 1);
      if (b && b.node === node) return b;
      const dom = view.nodeDOM(hit.inside) as HTMLElement | null;
      if (dom) {
        const $p = view.state.doc.resolve(hit.inside);
        void $p;
        return { pos: hit.inside, node, dom, listType: null };
      }
    }
  }
  return blockFromPos(view, hit.pos);
}

export interface BlockDragHost {
  /** Run several card changes as one undo step. */
  batch(fn: () => void): void;
  /** Create a card on the board from a dropped block. Returns false when the point is not on the board. */
  dropOnBoard(clientX: number, clientY: number, markdown: string): boolean;
  /** Screen-space layer the handle lives in (so it keeps its size at any zoom). */
  overlay(): HTMLElement;
}

/** Adds the ⋮⋮ handle beside the block under the pointer, and dragging from it. */
export function attachBlockHandles(rich: RichText, host: HTMLElement, dragHost: BlockDragHost): () => void {
  const overlay = dragHost.overlay();
  const handle = overlay.createDiv({ cls: 'vc-block-handle vc-interactive', attr: { 'aria-label': t('Drag to move') } });
  setIcon(handle, 'grip-vertical');
  handle.hide();
  let current: Block | null = null;

  const place = (b: Block) => {
    const or = overlay.getBoundingClientRect();
    const br = b.dom.getBoundingClientRect();
    const cr = host.getBoundingClientRect();
    // In a column just left of the card, level with the block's first line.
    const lineH = Math.min(br.height, 26);
    handle.style.top = `${br.top - or.top + lineH / 2 - 11}px`;
    handle.style.left = `${cr.left - 18 - or.left}px`;
    handle.show();
  };

  const onMove = (e: PointerEvent) => {
    if (e.buttons) return;
    const b = blockAtPoint(rich.view, e.clientX, e.clientY);
    if (!b) { handle.hide(); current = null; return; }
    current = b;
    place(b);
  };
  const onLeave = (e: PointerEvent) => {
    const to = e.relatedTarget as Node | null;
    if (to && (host.contains(to) || handle.contains(to))) return;
    handle.hide();
  };
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerleave', onLeave);
  handle.addEventListener('pointerleave', (e) => {
    const to = e.relatedTarget as Node | null;
    if (to && host.contains(to)) return;
    handle.hide();
  });

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !current) return;
    e.preventDefault();
    e.stopPropagation();
    new BlockDrag(rich, current, dragHost, e);
    handle.hide();
  });
  handle.addEventListener('dblclick', e => e.stopPropagation());

  return () => {
    host.removeEventListener('pointermove', onMove);
    host.removeEventListener('pointerleave', onLeave);
    handle.remove();
  };
}

export interface Drop { rich: RichText; pos: number; asItem: boolean; line: DOMRect; }

/** How far (screen px) outside its card a block must be dragged before it becomes a card of its own. */
export const DRAG_OUT_DISTANCE = 56;

/** Distance from a point to a rect (0 inside). */
export function distanceToRect(r: DOMRect, x: number, y: number): number {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

/**
 * Where in `rich` something dropped at (x, y) lands: before or after the
 * block under the pointer. Only a list item being moved goes between items;
 * anything else goes before/after the whole list.
 */
export function findBlockDrop(rich: RichText, x: number, y: number, o: { movingItem: boolean; src?: RichText; block?: Block }): Drop | null {
  const view = rich.view;
  let b = blockAtPoint(view, x, y);
  const docRect = view.dom.getBoundingClientRect();
  if (!b) {
    // Below the last block: append at the end.
    const last = view.state.doc.lastChild;
    if (!last) return null;
    const dom = view.nodeDOM(view.state.doc.content.size - last.nodeSize) as HTMLElement | null;
    if (!dom) return null;
    const r = dom.getBoundingClientRect();
    return { rich, pos: view.state.doc.content.size, asItem: false, line: new DOMRect(docRect.left, r.bottom, docRect.width, 0) };
  }
  if (b.listType && !o.movingItem) {
    const $p = view.state.doc.resolve(b.pos);
    const top = $p.before(1);
    const node = view.state.doc.nodeAt(top)!;
    const dom = view.nodeDOM(top) as HTMLElement;
    b = { pos: top, node, dom, listType: null };
  }
  const r = b.dom.getBoundingClientRect();
  const after = y > r.top + r.height / 2;
  const pos = after ? b.pos + b.node.nodeSize : b.pos;
  // Not into itself.
  if (o.src && o.block && rich === o.src && pos >= o.block.pos && pos <= o.block.pos + o.block.node.nodeSize) {
    if (b.pos === o.block.pos) return null;
  }
  return { rich, pos, asItem: !!b.listType && o.movingItem, line: new DOMRect(r.left, after ? r.bottom : r.top, r.width, 0) };
}

/** The rich text under a screen point (ignoring `skip` and drag decorations). */
export function richAt(x: number, y: number, skip?: Element | null): RichText | null {
  const under = document.elementsFromPoint(x, y).find(el => !el.closest('.vc-block-ghost, .vc-drop-line, .vc-tool-ghost') && !(skip && skip.contains(el))) as HTMLElement | undefined;
  const richEl = under?.closest<HTMLElement>('.vc-rich');
  return (richEl && richRegistry.get(richEl)) || null;
}

/** Insert Markdown as blocks at a top-level position of `rich`, and store it. */
export function insertMarkdownAt(rich: RichText, pos: number, markdown: string): void {
  const doc = parseMarkdown(markdown);
  rich.applyAndCommit(s => s.tr.insert(Math.min(pos, s.doc.content.size), doc.content));
}

/** The blue line showing where a drop lands. */
export class DropLine {
  private el: HTMLElement;
  constructor() { this.el = document.body.createDiv('vc-drop-line'); this.el.hide(); }
  show(l: DOMRect): void {
    this.el.style.left = `${l.left}px`;
    this.el.style.top = `${l.top - 1}px`;
    this.el.style.width = `${l.width}px`;
    this.el.show();
  }
  hide(): void { this.el.hide(); }
  remove(): void { this.el.remove(); }
}

class BlockDrag {
  private ghost: HTMLElement;
  private line: HTMLElement;
  private drop: Drop | null = null;
  private overBoard = false;

  constructor(private src: RichText, private block: Block, private host: BlockDragHost, e: PointerEvent) {
    const doc = src.view.dom.ownerDocument;
    this.ghost = doc.body.createDiv('vc-block-ghost');
    this.ghost.setText(block.node.textContent.slice(0, 80) || '…');
    this.line = doc.body.createDiv('vc-drop-line');
    this.line.hide();
    block.dom.addClass('vc-block-dragging');
    doc.body.addClass('vc-block-drag-active');
    const move = (ev: PointerEvent) => this.move(ev);
    const up = (ev: PointerEvent) => {
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      doc.removeEventListener('keydown', key, true);
      this.finish(ev, ev.altKey);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      doc.removeEventListener('keydown', key, true);
      this.cleanup();
    };
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
    doc.addEventListener('keydown', key, true);
    this.move(e);
  }

  private move(e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 8}px)`;
    const doc = this.src.view.dom.ownerDocument;
    const under = doc.elementsFromPoint(e.clientX, e.clientY).find(el => !el.closest('.vc-block-ghost, .vc-drop-line')) as HTMLElement | undefined;
    const richEl = under?.closest<HTMLElement>('.vc-rich');
    const target = richEl ? richRegistry.get(richEl) : undefined;
    this.drop = target ? this.findDrop(target, e.clientX, e.clientY) : null;
    // Becoming a card of its own needs a clear move away from the source card.
    const srcCard = this.src.view.dom.closest('.vc-node') ?? this.src.view.dom;
    const away = distanceToRect(srcCard.getBoundingClientRect(), e.clientX, e.clientY) >= DRAG_OUT_DISTANCE;
    this.overBoard = !target && away && !!under?.closest('.vc-board') && !under.closest('.vc-ui');
    this.ghost.toggleClass('is-new-card', this.overBoard);
    if (this.drop) {
      const l = this.drop.line;
      this.line.style.left = `${l.left}px`;
      this.line.style.top = `${l.top - 1}px`;
      this.line.style.width = `${l.width}px`;
      this.line.show();
    } else {
      this.line.hide();
    }
  }

  private findDrop(rich: RichText, x: number, y: number): Drop | null {
    return findBlockDrop(rich, x, y, { movingItem: this.block.listType !== null, src: this.src, block: this.block });
  }

  private finish(e: PointerEvent, copy: boolean): void {
    const drop = this.drop, overBoard = this.overBoard;
    this.cleanup();
    const src = this.src, block = this.block;
    // What is inserted: the block itself, or a list item wrapped in its own list.
    const asBlock = (): PMNode => block.listType
      ? block.listType.create(block.listType === schema.nodes.ordered_list ? { order: 1 } : null, Fragment.from(block.node))
      : block.node;

    if (drop) {
      let insert = drop.asItem ? block.node : asBlock();
      if (drop.asItem) {
        // An item takes on its new list's kind: a task among tasks, plain among plain.
        const $d = drop.rich.view.state.doc.resolve(drop.pos);
        const sibling = $d.nodeAfter ?? $d.nodeBefore;
        if (sibling && sibling.type === schema.nodes.list_item) {
          const wantTask = sibling.attrs.checked !== null;
          const isTask = insert.attrs.checked !== null;
          if (wantTask !== isTask) insert = insert.type.create({ checked: wantTask ? ' ' : null }, insert.content, insert.marks);
        }
      }
      this.host.batch(() => {
        if (drop.rich === src) {
          src.applyAndCommit((s) => {
            const tr = s.tr;
            if (!copy) removeBlock(tr, block, false);
            tr.insert(tr.mapping.map(drop.pos), insert);
            return tr;
          });
        } else {
          drop.rich.applyAndCommit(s => s.tr.insert(drop.pos, insert));
          if (!copy) src.applyAndCommit(s => removeBlock(s.tr, block));
        }
      });
      return;
    }
    if (overBoard) {
      const md = blockMarkdown(asBlock());
      this.host.batch(() => {
        if (this.host.dropOnBoard(e.clientX, e.clientY, md) && !copy) src.applyAndCommit(s => removeBlock(s.tr, block));
      });
    }
  }

  private cleanup(): void {
    this.ghost.remove();
    this.line.remove();
    this.block.dom.removeClass('vc-block-dragging');
    this.src.view.dom.ownerDocument.body.removeClass('vc-block-drag-active');
  }
}

/** Remove a block; a list left empty goes too, and the doc keeps one paragraph. */
function removeBlock(tr: Transaction, block: Block, fill = true): Transaction {
  const $p = tr.doc.resolve(block.pos);
  let from = block.pos, to = block.pos + block.node.nodeSize;
  if (block.listType && $p.parent.childCount === 1) { from = $p.before(); to = $p.after(); }
  tr.delete(from, to);
  if (fill && tr.doc.childCount === 0) tr.insert(0, schema.nodes.paragraph.create());
  return tr;
}
