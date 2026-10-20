import { setIcon, setTooltip } from 'obsidian';
import type { Board } from './board';
import type { RawNode } from '../model/canvas-file';
import {
  DEFAULT_PEN_SHAPE, distanceToStroke, drawingHit, penShape, rerenderDrawings, strokeOutline, strokesOnBoard, writeDrawing,
  type PenShape, type Stroke,
} from '../cards/drawing';
import { t } from '../i18n';

const SVG_NS = 'http://www.w3.org/2000/svg';

type Instrument = 'pen' | 'highlighter' | 'eraser';

/** Pen choices last the whole session, across boards. */
const state = { tool: 'pen' as Instrument, color: 'currentColor', hlColor: '#ffeb3b', width: 1 };

const PEN_COLORS: [string, string][] = [
  ['currentColor', 'Auto (follows the theme)'], ['#ef4444', 'Red'], ['#f97316', 'Orange'], ['#eab308', 'Yellow'],
  ['#22c55e', 'Green'], ['#3b82f6', 'Blue'], ['#a855f7', 'Purple'], ['#ffffff', 'White'],
];
const HL_COLORS: [string, string][] = [
  ['#ffeb3b', 'Yellow'], ['#b2ff59', 'Green'], ['#ff80ab', 'Pink'], ['#ffb74d', 'Orange'], ['#81d4fa', 'Blue'], ['#ce93d8', 'Purple'],
];
const WIDTHS: [number, string][] = [[4, 'Thin'], [8, 'Medium'], [14, 'Thick']];

/** A new pen stroke joins the sketch being drawn when it starts this close to it (board units). */
const JOIN_DISTANCE = 48;

export class PenController {
  private picker: HTMLElement | null = null;
  private banner: HTMLElement | null = null;
  private options: HTMLElement | null = null;
  private sessionId: string | null = null;

  constructor(private board: Board) {
    Object.assign(penShape, board.settings.penShape ?? DEFAULT_PEN_SHAPE);
    board.on('tool', () => {
      this.sessionId = null;
      if (board.tool === 'pen') this.open(); else this.close();
    });
    board.addDisposer(() => this.close());
  }

  // ── panels ─────────────────────────────────────────────

  private open(): void {
    this.close();
    this.banner = this.board.uiEl.createDiv('vc-pen-banner');
    setIcon(this.banner.createDiv('vc-pen-banner-icon'), 'pencil');
    this.banner.createSpan({ text: t('Drawing — hold Shift for straight lines') });
    const done = this.banner.createDiv({ cls: 'vc-pen-banner-done', text: t('Done (Enter)') });
    done.addEventListener('click', () => this.board.setTool('select'));
    this.banner.addEventListener('pointerdown', e => e.stopPropagation());
    this.renderPicker();
    this.syncCursor();
  }

  private close(): void {
    this.picker?.remove(); this.picker = null;
    this.banner?.remove(); this.banner = null;
    this.options?.remove(); this.options = null;
    this.board.root.removeClass('is-erasing');
  }

  private syncCursor(): void {
    this.board.root.toggleClass('is-erasing', this.board.tool === 'pen' && state.tool === 'eraser');
  }

  private renderPicker(): void {
    this.picker?.remove();
    const p = this.board.uiEl.createDiv('vc-pen-picker');
    this.picker = p;
    p.addEventListener('pointerdown', e => e.stopPropagation());
    p.addEventListener('dblclick', e => e.stopPropagation());

    const tools = p.createDiv('vc-pen-row');
    const instruments: [Instrument, string, string][] = [['pen', 'pencil', 'Pen'], ['highlighter', 'highlighter', 'Highlighter'], ['eraser', 'eraser', 'Eraser']];
    for (const [tool, icon, label] of instruments) {
      const b = tools.createDiv({ cls: 'vc-pen-tool', attr: { role: 'button', 'aria-label': t(label) } });
      setIcon(b, icon);
      setTooltip(b, t(label), { placement: 'top' });
      b.toggleClass('is-active', state.tool === tool);
      b.addEventListener('click', () => { state.tool = tool; if (tool !== 'pen') { this.options?.remove(); this.options = null; } this.renderPicker(); this.syncCursor(); });
    }
    {
      // Always present (hidden for the other instruments) so the buttons never shift.
      const gear = tools.createDiv({ cls: 'vc-pen-tool', attr: { role: 'button', 'aria-label': t('Pen options') } });
      if (state.tool !== 'pen') gear.addClass('is-placeholder');
      setIcon(gear, 'settings-2');
      setTooltip(gear, t('Pen options'), { placement: 'top' });
      gear.toggleClass('is-active', !!this.options);
      gear.addEventListener('click', () => { if (this.options) { this.options.remove(); this.options = null; this.renderPicker(); } else this.openOptions(); });
    }
    if (state.tool !== 'eraser') {
      const hl = state.tool === 'highlighter';
      const colors = p.createDiv('vc-pen-row');
      for (const [c, label] of hl ? HL_COLORS : PEN_COLORS) {
        const sw = colors.createDiv({ cls: 'vc-pen-swatch', attr: { role: 'button', 'aria-label': t(label) } });
        if (c === 'currentColor') sw.addClass('is-auto'); else sw.style.background = c;
        setTooltip(sw, t(label), { placement: 'top' });
        sw.toggleClass('is-active', (hl ? state.hlColor : state.color) === c);
        sw.addEventListener('click', () => { if (hl) state.hlColor = c; else state.color = c; this.renderPicker(); });
      }
      const widths = p.createDiv('vc-pen-row');
      WIDTHS.forEach(([, label], i) => {
        const b = widths.createDiv({ cls: 'vc-pen-width', text: t(label) });
        b.toggleClass('is-active', state.width === i);
        b.addEventListener('click', () => { state.width = i; this.renderPicker(); });
      });
    }
    if (state.tool === 'eraser') p.createDiv({ cls: 'vc-pen-hint', text: t('Click or drag across ink to erase it.') });
    if (this.options) this.placeOptions();
  }

  /** perfect-freehand's own shape controls; changes redraw every pen stroke at once. */
  private openOptions(): void {
    const o = this.board.uiEl.createDiv('vc-pen-options');
    this.options = o;
    o.addEventListener('pointerdown', e => e.stopPropagation());
    const head = o.createDiv('vc-pen-options-head');
    head.createSpan({ text: t('Pen options') });
    const reset = head.createDiv({ cls: 'vc-pen-options-reset', text: t('Reset') });
    const save = () => {
      this.board.settings.penShape = { ...penShape };
      void this.board.plugin.saveSettings();
      for (const v of this.board.plugin.app.workspace.getLeavesOfType('visual-canvas')) {
        const b = (v.view as unknown as { board?: Board }).board;
        if (b) rerenderDrawings(b.cards.values());
      }
    };
    reset.addEventListener('click', () => { Object.assign(penShape, DEFAULT_PEN_SHAPE); save(); o.remove(); this.options = null; this.openOptions(); });
    const slider = (label: string, key: keyof PenShape, min: number, max: number, step: number) => {
      const row = o.createDiv('vc-pen-options-row');
      row.createSpan({ cls: 'vc-pen-options-label', text: t(label) });
      const input = row.createEl('input', { type: 'range' });
      input.min = String(min); input.max = String(max); input.step = String(step);
      input.value = String(penShape[key]);
      const val = row.createSpan({ cls: 'vc-pen-options-value', text: String(penShape[key]) });
      input.addEventListener('input', () => {
        penShape[key] = Number(input.value);
        val.setText(input.value);
        rerenderDrawings(this.board.cards.values());
      });
      input.addEventListener('change', save);
    };
    slider('Thinning (pressure)', 'thinning', -1, 1, 0.05);
    slider('Streamline', 'streamline', 0, 1, 0.05);
    slider('Smoothing', 'smoothing', 0, 1, 0.05);
    slider('Taper at start', 'taperStart', 0, 200, 1);
    slider('Taper at end', 'taperEnd', 0, 200, 1);
    this.renderPicker();
  }

  private placeOptions(): void {
    /* Positioned by CSS next to the picker. */
  }

  // ── drawing ─────────────────────────────────────────────

  pointerDown(e: PointerEvent): void {
    if (state.tool === 'eraser') { this.erase(e); return; }
    const board = this.board;
    const hl = state.tool === 'highlighter';
    const width = WIDTHS[state.width][0];
    const stroke: Stroke = { c: hl ? state.hlColor : state.color, s: hl ? width * 3.2 : width, p: [], h: hl || undefined };
    const add = (cx: number, cy: number, pressure: number) => {
      const w = board.clientToWorld(cx, cy);
      // Mouse and touch report 0.5 or 0: no real pressure.
      const pr = pressure > 0 && pressure !== 0.5 ? Math.round(pressure * 100) / 100 : 0;
      stroke.p.push(w.x, w.y, pr);
    };
    add(e.clientX, e.clientY, e.pressure);
    const first = stroke.p.slice(0, 3);

    const live = document.createElementNS(SVG_NS, 'path');
    live.classList.add('vc-pen-live');
    live.style.fill = stroke.c;
    if (hl) live.style.fillOpacity = '0.45';
    board.edgeLayer.appendChild(live);
    let raf = 0;
    const redraw = () => { raf = 0; live.setAttribute('d', strokeOutline(stroke, true)); };
    redraw();

    const doc = board.root.ownerDocument;
    const pid = e.pointerId;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      if (ev.shiftKey) {
        // Straight line from where the stroke began.
        const w = board.clientToWorld(ev.clientX, ev.clientY);
        stroke.p = [...first, w.x, w.y, 0];
      } else {
        const evs = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
        for (const ce of evs.length ? evs : [ev]) add(ce.clientX, ce.clientY, ce.pressure);
      }
      if (!raf) raf = requestAnimationFrame(redraw);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      doc.removeEventListener('pointercancel', cancel, true);
      if (raf) cancelAnimationFrame(raf);
      live.remove();
      this.commit(stroke);
    };
    const cancel = () => {
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      doc.removeEventListener('pointercancel', cancel, true);
      live.remove();
    };
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
    doc.addEventListener('pointercancel', cancel, true);
  }

  /** Add a finished stroke: to the sketch it starts near, or as a new drawing card. */
  private commit(stroke: Stroke): void {
    const board = this.board;
    const sx = stroke.p[0], sy = stroke.p[1];
    const current = this.sessionId ? board.model.node(this.sessionId) : undefined;
    const joins = !stroke.h && current && drawingHit(current, sx, sy, JOIN_DISTANCE);
    board.model.transact(() => {
      if (joins && current) {
        writeDrawing(current, [...strokesOnBoard(current), stroke]);
        board.model.touch(current.id);
      } else {
        const node = board.model.addNode({ type: 'text', text: '', x: 0, y: 0, width: 1, height: 1, vc: { kind: 'drawing' } } as unknown as RawNode);
        writeDrawing(node, [stroke]);
        board.model.touch(node.id);
        // Highlighter swipes stay separate; pen strokes gather into one sketch.
        if (!stroke.h) this.sessionId = node.id;
      }
    });
  }

  /** Scrub over ink to remove whole strokes (one undo step per scrub). */
  private erase(e: PointerEvent): void {
    const board = this.board;
    const gesture = board.model.beginGesture();
    let changed = false;
    let prev: { x: number; y: number } | null = null;
    const cross = (o: { x: number; y: number }, p: { x: number; y: number }, q: { x: number; y: number }) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
    const segHit = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }) => {
      const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
      return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0);
    };
    const scrub = (cx: number, cy: number) => {
      const cur = board.clientToWorld(cx, cy);
      const from = prev ?? cur;
      prev = cur;
      const radius = 10 / board.vp.zoom;
      for (const n of [...board.model.nodes]) {
        if (n.vc?.kind !== 'drawing') continue;
        const minX = Math.min(from.x, cur.x) - radius, maxX = Math.max(from.x, cur.x) + radius;
        const minY = Math.min(from.y, cur.y) - radius, maxY = Math.max(from.y, cur.y) + radius;
        if (maxX < n.x || minX > n.x + n.width || maxY < n.y || minY > n.y + n.height) continue;
        const strokes = strokesOnBoard(n);
        const keep = strokes.filter((s) => {
          if (distanceToStroke(s, cur.x, cur.y) <= radius + s.s / 2) return false;
          for (let i = 0; i + 4 < s.p.length; i += 3) {
            if (segHit(from, cur, { x: s.p[i], y: s.p[i + 1] }, { x: s.p[i + 3], y: s.p[i + 4] })) return false;
          }
          return true;
        });
        if (keep.length === strokes.length) continue;
        changed = true;
        if (!keep.length) { board.model.removeNodes([n.id]); gesture.preview([n.id]); continue; }
        writeDrawing(n, keep);
        gesture.preview([n.id]);
      }
    };
    scrub(e.clientX, e.clientY);
    const doc = board.root.ownerDocument;
    const move = (ev: PointerEvent) => scrub(ev.clientX, ev.clientY);
    const up = () => {
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      if (changed) gesture.end(); else gesture.cancel();
    };
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
  }
}
