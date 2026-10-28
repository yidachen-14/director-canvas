import type { Board } from './board';
import type { RawNode } from '../model/canvas-file';

/**
 * Boardmix-style spacing handles: when the selected cards stand in a row or a column and share
 * an edge (or centre) line, a short mark sits in every gap. Hovering shows the gap; dragging one
 * sets every gap in the row to the same new spacing.
 */

interface Item { id: string; s: number; e: number; cs: number; ce: number }
export interface Run { axis: 'h' | 'v'; items: Item[] }

const TOL = 1.5;

/** The cards as a row ('h') or a column ('v') if they line up that way, else null. */
export function runOf(nodes: { id: string; x: number; y: number; width: number; height: number }[], axis: 'h' | 'v'): Run | null {
  if (nodes.length < 2) return null;
  const items: Item[] = nodes.map(n => axis === 'h'
    ? { id: n.id, s: n.x, e: n.x + n.width, cs: n.y, ce: n.y + n.height }
    : { id: n.id, s: n.y, e: n.y + n.height, cs: n.x, ce: n.x + n.width });
  items.sort((a, b) => a.s - b.s);
  // Side by side without overlapping along the axis.
  for (let i = 1; i < items.length; i++) if (items[i].s < items[i - 1].e - TOL) return null;
  // Sharing one line across: the starts, the ends or the centres.
  const same = (f: (it: Item) => number) => items.every(it => Math.abs(f(it) - f(items[0])) <= TOL);
  if (!same(it => it.cs) && !same(it => it.ce) && !same(it => (it.cs + it.ce) / 2)) return null;
  return { axis, items };
}

/** New starts along the axis when every gap becomes `gap` (the first card stays put). */
export function respace(run: Run, gap: number): Map<string, number> {
  const out = new Map<string, number>();
  let at = run.items[0].s;
  for (const it of run.items) { out.set(it.id, at); at += it.e - it.s + gap; }
  return out;
}

export class SpacingHandles {
  private layer: HTMLElement;
  private dragging = false;
  private raf = 0;

  constructor(private board: Board) {
    this.layer = board.uiEl.createDiv('vc-spacing');
    const schedule = () => { if (this.dragging) return; cancelAnimationFrame(this.raf); this.raf = window.requestAnimationFrame(() => this.refresh()); };
    board.addDisposer(board.on('selection', schedule));
    board.addDisposer(board.on('viewport', schedule));
    board.addDisposer(board.on('tool', schedule));
    board.addDisposer(board.onChange(schedule));
  }

  private selected(): RawNode[] {
    return this.board.selectedNodes().filter(n => n.type !== 'group');
  }

  private refresh(): void {
    this.layer.empty();
    const b = this.board;
    if (b.tool !== 'select' || b.editingId || b.root.hasClass('is-dragging')) return;
    const nodes = this.selected();
    if (nodes.length < 2 || nodes.length !== b.selection.size) return;
    for (const axis of ['h', 'v'] as const) {
      const run = runOf(nodes, axis);
      if (run) this.draw(run);
    }
  }

  private draw(run: Run): void {
    const vp = this.board.vp;
    for (let i = 1; i < run.items.length; i++) {
      const a = run.items[i - 1], c = run.items[i];
      const gap = c.s - a.e;
      const mid = (a.e + c.s) / 2;
      const lo = Math.max(a.cs, c.cs), hi = Math.min(a.ce, c.ce);
      const cross = lo < hi ? (lo + hi) / 2 : (Math.min(a.cs, c.cs) + Math.max(a.ce, c.ce)) / 2;
      const p = run.axis === 'h' ? vp.toScreen(mid, cross) : vp.toScreen(cross, mid);
      // Too narrow on screen to grab without covering the cards.
      if (gap * vp.zoom < 6) continue;
      const h = this.layer.createDiv({ cls: `vc-spacing-handle is-${run.axis}` });
      h.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
      const label = h.createDiv({ cls: 'vc-spacing-label', text: String(Math.round(gap)) });
      h.addEventListener('pointerdown', (e) => this.drag(e, run, i, cross, h, label));
    }
  }

  private drag(e: PointerEvent, run: Run, k: number, cross: number, handle: HTMLElement, label: HTMLElement): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const b = this.board;
    const gaps = run.items.slice(1).map((it, i) => it.s - run.items[i].e);
    const base = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const start = run.axis === 'h' ? e.clientX : e.clientY;
    const gesture = b.model.beginGesture();
    this.dragging = true;
    handle.addClass('is-active');
    handle.setPointerCapture(e.pointerId);
    const nodes = new Map(run.items.map(it => [it.id, b.model.node(it.id)!]));
    const move = (ev: PointerEvent) => {
      // Dragging the mark further along the row opens every gap up (by twice the move: both sides).
      const d = ((run.axis === 'h' ? ev.clientX : ev.clientY) - start) / b.vp.zoom;
      const gap = Math.max(0, Math.round(base + d * 2));
      const at = respace(run, gap);
      for (const [id, s] of at) {
        const n = nodes.get(id);
        if (!n) continue;
        if (run.axis === 'h') n.x = s; else n.y = s;
      }
      gesture.preview([...nodes.keys()]);
      label.setText(String(gap));
      // The mark follows its gap.
      const prev = run.items[k - 1];
      const mid = at.get(prev.id)! + (prev.e - prev.s) + gap / 2;
      const p = run.axis === 'h' ? b.vp.toScreen(mid, cross) : b.vp.toScreen(cross, mid);
      handle.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      this.dragging = false;
      gesture.end();
      this.refresh();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }
}
