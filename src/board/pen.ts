import { setIcon, setTooltip } from 'obsidian';
import type { Board } from './board';
import type { RawNode } from '../model/canvas-file';
import { distanceToStroke, drawingSvg, strokePath, strokesBounds, strokesOf, type Stroke } from '../cards/drawing';
import { t } from '../i18n';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Pen choices last the whole session, across boards. */
const pen = { color: 'currentColor', width: 3, eraser: false };

const COLORS: [string, string][] = [
  ['currentColor', 'Auto (follows the theme)'], ['#e03131', 'Red'], ['#f08c00', 'Orange'], ['#f5c400', 'Yellow'],
  ['#2f9e44', 'Green'], ['#1c7ed6', 'Blue'], ['#7048e8', 'Purple'], ['#868e96', 'Grey'],
];
const WIDTHS = [2, 3, 6, 12];

/** Strokes drawn close together in one pen session go into the same drawing card. */
const JOIN_DISTANCE = 80;

export class PenController {
  private panel: HTMLElement | null = null;
  private sessionId: string | null = null;

  constructor(private board: Board) {
    board.on('tool', () => {
      this.sessionId = null;
      if (board.tool === 'pen') this.openPanel(); else this.closePanel();
      board.root.toggleClass('is-erasing', board.tool === 'pen' && pen.eraser);
    });
    board.addDisposer(() => this.closePanel());
  }

  // ── options panel ───────────────────────────────────────

  private openPanel(): void {
    this.closePanel();
    const p = this.board.uiEl.createDiv('vc-edge-panel vc-pen-panel');
    this.panel = p;
    p.addEventListener('pointerdown', e => e.stopPropagation());
    p.addEventListener('dblclick', e => e.stopPropagation());
    const render = () => {
      p.empty();
      const cg = p.createDiv('vc-ep-group vc-ep-colors');
      for (const [c, label] of COLORS) {
        const sw = cg.createDiv({ cls: 'vc-ep-swatch', attr: { role: 'button', 'aria-label': t(label) } });
        if (c === 'currentColor') sw.addClass('is-auto'); else sw.style.background = c;
        sw.toggleClass('is-active', !pen.eraser && pen.color === c);
        setTooltip(sw, t(label), { placement: 'top' });
        sw.addEventListener('click', () => { pen.color = c; pen.eraser = false; render(); this.syncCursor(); });
      }
      const wg = p.createDiv('vc-ep-group');
      for (const w of WIDTHS) {
        const b = wg.createDiv({ cls: 'vc-ep-btn clickable-icon', attr: { role: 'button', 'aria-label': t('Thickness {n}', { n: w }) } });
        const dot = b.createDiv('vc-pen-dot');
        dot.style.width = dot.style.height = `${Math.min(16, w + 2)}px`;
        b.toggleClass('is-active', !pen.eraser && pen.width === w);
        setTooltip(b, t('Thickness {n}', { n: w }), { placement: 'top' });
        b.addEventListener('click', () => { pen.width = w; pen.eraser = false; render(); this.syncCursor(); });
      }
      const eg = p.createDiv('vc-ep-group');
      const er = eg.createDiv({ cls: 'vc-ep-btn clickable-icon', attr: { role: 'button', 'aria-label': t('Eraser') } });
      setIcon(er, 'eraser');
      er.toggleClass('is-active', pen.eraser);
      setTooltip(er, t('Eraser: drag over strokes to remove them'), { placement: 'top' });
      er.addEventListener('click', () => { pen.eraser = !pen.eraser; render(); this.syncCursor(); });
      const done = eg.createDiv({ cls: 'vc-ep-btn clickable-icon', attr: { role: 'button', 'aria-label': t('Done') } });
      setIcon(done, 'check');
      setTooltip(done, t('Done (Esc)'), { placement: 'top' });
      done.addEventListener('click', () => this.board.setTool('select'));
    };
    render();
  }

  private syncCursor(): void {
    this.board.root.toggleClass('is-erasing', pen.eraser);
  }

  private closePanel(): void {
    this.panel?.remove();
    this.panel = null;
  }

  // ── drawing ─────────────────────────────────────────────

  pointerDown(e: PointerEvent): void {
    if (pen.eraser) { this.erase(e); return; }
    const board = this.board;
    const pts: number[] = [];
    const start = board.clientToWorld(e.clientX, e.clientY);
    pts.push(start.x, start.y);
    const g = document.createElementNS(SVG_NS, 'path');
    g.classList.add('vc-pen-preview');
    g.setAttribute('stroke', pen.color);
    g.setAttribute('stroke-width', String(pen.width));
    g.setAttribute('fill', 'none');
    g.setAttribute('stroke-linecap', 'round');
    g.setAttribute('stroke-linejoin', 'round');
    board.edgeLayer.appendChild(g);
    const draw = () => g.setAttribute('d', strokePath(pts));
    draw();
    const minStep = 1.5 / board.vp.zoom;
    const doc = board.root.ownerDocument;
    const move = (ev: PointerEvent) => {
      const events = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [ev];
      for (const ce of events.length ? events : [ev]) {
        const w = board.clientToWorld(ce.clientX, ce.clientY);
        const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
        if (Math.hypot(w.x - lx, w.y - ly) < minStep) continue;
        pts.push(w.x, w.y);
      }
      draw();
    };
    const up = () => {
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      g.remove();
      this.commitStroke({ c: pen.color, w: pen.width, p: pts.map(v => Math.round(v * 10) / 10) });
    };
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
  }

  /** Add a finished stroke (in board coordinates) to a drawing card. */
  private commitStroke(stroke: Stroke): void {
    const board = this.board;
    const sb = strokesBounds([stroke]);
    if (!sb) return;
    const near = (n: RawNode) => sb.x < n.x + n.width + JOIN_DISTANCE && sb.x + sb.w > n.x - JOIN_DISTANCE
      && sb.y < n.y + n.height + JOIN_DISTANCE && sb.y + sb.h > n.y - JOIN_DISTANCE;
    const current = this.sessionId ? board.model.node(this.sessionId) : undefined;
    board.model.transact(() => {
      if (current && near(current)) {
        // Back to board coordinates, add, and refit the card around everything.
        const kx = current.width / (Number(current.vc?.vw) || current.width);
        const ky = current.height / (Number(current.vc?.vh) || current.height);
        const all = strokesOf(current).map(s => ({ ...s, w: s.w * kx, p: s.p.map((v, i) => (i % 2 ? current.y + v * ky : current.x + v * kx)) }));
        all.push(stroke);
        this.writeDrawing(current, all);
        board.model.touch(current.id);
      } else {
        const node = board.model.addNode({ type: 'text', text: '', x: 0, y: 0, width: 1, height: 1, vc: { kind: 'drawing' } } as unknown as RawNode);
        this.writeDrawing(node, [stroke]);
        this.sessionId = node.id;
      }
    });
  }

  /** Store strokes given in board coordinates: the card wraps them exactly. */
  private writeDrawing(n: RawNode, strokes: Stroke[]): void {
    const b = strokesBounds(strokes)!;
    const pad = 4;
    const x = b.x - pad, y = b.y - pad, w = b.w + pad * 2, h = b.h + pad * 2;
    const local = strokes.map(s => ({ c: s.c, w: Math.round(s.w * 10) / 10, p: s.p.map((v, i) => Math.round((i % 2 ? v - y : v - x) * 10) / 10) }));
    n.x = Math.round(x); n.y = Math.round(y);
    n.width = Math.max(8, Math.round(w)); n.height = Math.max(8, Math.round(h));
    n.vc = { ...(n.vc ?? {}), kind: 'drawing', strokes: local, vw: n.width, vh: n.height };
    n.text = drawingSvg(local, n.width, n.height);
  }

  /** Drag over strokes to remove them (one undo step per drag). */
  private erase(e: PointerEvent): void {
    const board = this.board;
    const gesture = board.model.beginGesture();
    let changed = false;
    const hit = (cx: number, cy: number) => {
      const w = board.clientToWorld(cx, cy);
      const tol = 6 / board.vp.zoom;
      for (const n of [...board.model.nodes]) {
        if (n.vc?.kind !== 'drawing') continue;
        if (w.x < n.x - tol || w.x > n.x + n.width + tol || w.y < n.y - tol || w.y > n.y + n.height + tol) continue;
        const kx = n.width / (Number(n.vc?.vw) || n.width), ky = n.height / (Number(n.vc?.vh) || n.height);
        const lx = (w.x - n.x) / kx, ly = (w.y - n.y) / ky;
        const strokes = strokesOf(n);
        const keep = strokes.filter(s => distanceToStroke(s, lx, ly) > s.w / 2 + tol / Math.min(kx, ky));
        if (keep.length === strokes.length) continue;
        changed = true;
        if (!keep.length) { board.model.removeNodes([n.id]); gesture.preview([n.id]); continue; }
        const vw = Number(n.vc?.vw) || n.width, vh = Number(n.vc?.vh) || n.height;
        n.vc = { ...(n.vc ?? {}), strokes: keep };
        n.text = drawingSvg(keep, vw, vh);
        gesture.preview([n.id]);
      }
    };
    hit(e.clientX, e.clientY);
    const doc = board.root.ownerDocument;
    const move = (ev: PointerEvent) => hit(ev.clientX, ev.clientY);
    const up = () => {
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      if (changed) gesture.end(); else gesture.cancel();
    };
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
  }
}
