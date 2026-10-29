import { setIcon, setTooltip } from 'obsidian';
import { VIEW_TYPE } from '../takeover';
import type { Board } from './board';
import {
  DEFAULT_PEN_SHAPE, distanceToStroke, ensurePencilFilter, PENCIL_FILTER_ID, drawingHit, penShape, rerenderDrawings, strokeOutline, strokesOnBoard, writeDrawing,
  type PenShape, type Stroke,
} from '../cards/drawing';
import { t } from '../i18n';

const SVG_NS = 'http://www.w3.org/2000/svg';

type Instrument = 'pen' | 'monoline' | 'highlighter' | 'pencil' | 'eraser';

/** Pen choices last the whole session, across boards. */
const state = { tool: 'pen' as Instrument, color: 'currentColor', hlColor: '#ffeb3b', width: 2, custom: '#7c5cff', hlCustom: '#ffcc80' };

const PEN_COLORS: [string, string][] = [
  ['currentColor', 'Auto (follows the theme)'], ['#ef4444', 'Red'], ['#f97316', 'Orange'], ['#eab308', 'Yellow'],
  ['#22c55e', 'Green'], ['#3b82f6', 'Blue'], ['#a855f7', 'Purple'], ['#ffffff', 'White'],
];
const HL_COLORS: [string, string][] = [
  ['#ffeb3b', 'Yellow'], ['#b2ff59', 'Green'], ['#ff80ab', 'Pink'], ['#ffb74d', 'Orange'], ['#81d4fa', 'Blue'], ['#ce93d8', 'Purple'],
];
/** Five thicknesses, like Freeform's (board units for the pen; the other instruments scale them). */
const WIDTHS = [2, 4, 7, 11, 16];

/**
 * The instruments drawn upright like Freeform's: an outline body, with the part that touches the
 * paper painted in the ink colour (`--ink`).
 */
const INSTRUMENT_SVG: Record<Instrument, string> = {
  pen: '<path d="M6 40V17l4-13 4 13v23" class="b"/><path d="M6 17h8" class="l"/><path d="M8.6 8.6 10 4l1.4 4.6z" class="i"/><path d="M6 21h8v3H6z" class="i"/>',
  monoline: '<path d="M5.5 40V18h9v22" class="b"/><path d="M8 18v-6h4v6" class="b"/><path d="M9.3 12V3.5h1.4V12z" class="i"/><path d="M5.5 22h9v3h-9z" class="i"/>',
  highlighter: '<path d="M4 40V18h12v22" class="b"/><path d="M5.5 18v-5h9v5" class="b"/><path d="M6.5 13V8l7-3v8z" class="i"/>',
  pencil: '<path d="M6 40V16h8v24" class="b"/><path d="M8.7 16v24M11.3 16v24" class="l"/><path d="M6 16 10 3.5 14 16z" class="w"/><path d="M8.6 8 10 3.5 11.4 8z" class="i"/>',
  eraser: '<path d="M5 40V18h10v22" class="b"/><path d="M5 18v-6a5 5 0 0 1 10 0v6z" class="e"/><path d="M5 22h10" class="l"/>',
};

/** A new pen stroke joins the sketch being drawn when it starts this close to it (board units). */
const JOIN_DISTANCE = 48;

/** One instrument's drawing, parsed from the fixed markup above (no user input in it). */
function instrumentSvg(tool: Instrument): SVGElement {
  const doc = new DOMParser().parseFromString(`<svg xmlns="${SVG_NS}" viewBox="0 0 20 40" aria-hidden="true">${INSTRUMENT_SVG[tool]}</svg>`, 'image/svg+xml');
  return document.importNode(doc.documentElement, true) as unknown as SVGElement;
}

export class PenController {
  /** Banner, picker and options, stacked just off the toolbar (the banner nearest to it). */
  private dock: HTMLElement | null = null;
  private main: HTMLElement | null = null;
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
    this.dock = this.board.uiEl.createDiv('vc-pen-dock');
    this.banner = this.dock.createDiv('vc-pen-banner');
    setIcon(this.banner.createDiv('vc-pen-banner-icon'), 'pencil');
    this.banner.createSpan({ text: t('Drawing — hold Shift for straight lines') });
    const done = this.banner.createDiv({ cls: 'vc-pen-banner-done', text: t('Done (Enter)') });
    done.addEventListener('click', () => this.board.setTool('select'));
    this.banner.addEventListener('pointerdown', e => e.stopPropagation());
    this.main = this.dock.createDiv('vc-pen-main');
    this.renderPicker();
    this.syncCursor();
  }

  private close(): void {
    this.dock?.remove();
    this.dock = this.main = this.picker = this.banner = this.options = null;
    this.board.root.removeClass('is-erasing');
  }

  private syncCursor(): void {
    this.board.root.toggleClass('is-erasing', this.board.tool === 'pen' && state.tool === 'eraser');
  }

  private renderPicker(): void {
    const old = this.picker;
    const p = createDiv('vc-pen-picker');
    if (old) old.replaceWith(p); else this.main?.prepend(p);
    this.picker = p;
    p.addEventListener('pointerdown', e => e.stopPropagation());
    p.addEventListener('dblclick', e => e.stopPropagation());
    const hl = state.tool === 'highlighter';
    const ink = state.tool === 'eraser' ? '' : hl ? state.hlColor : state.color;

    const tools = p.createDiv('vc-pen-row vc-pen-instruments');
    const instruments: [Instrument, string][] = [
      ['pen', 'Ink pen'], ['monoline', 'Fineliner'], ['highlighter', 'Highlighter'], ['pencil', 'Pencil'], ['eraser', 'Eraser'],
    ];
    for (const [tool, label] of instruments) {
      const b = tools.createDiv({ cls: `vc-pen-instrument is-${tool}`, attr: { role: 'button', 'aria-label': t(label) } });
      b.appendChild(instrumentSvg(tool));
      // Each instrument shows the colour it would draw with.
      const own = tool === 'highlighter' ? state.hlColor : tool === 'eraser' ? '' : state.color;
      if (own && own !== 'currentColor') b.style.setProperty('--ink', own);
      setTooltip(b, t(label), { placement: 'top' });
      b.toggleClass('is-active', state.tool === tool);
      b.addEventListener('click', () => {
        state.tool = tool;
        if (tool === 'eraser' || tool === 'highlighter') { this.options?.remove(); this.options = null; }
        this.renderPicker(); this.syncCursor();
      });
    }
    {
      // Always present (hidden where it doesn't apply) so the instruments never shift.
      const gear = tools.createDiv({ cls: 'vc-pen-tool', attr: { role: 'button', 'aria-label': t('Pen options') } });
      if (state.tool === 'eraser' || hl) gear.addClass('is-placeholder');
      setIcon(gear, 'settings-2');
      setTooltip(gear, t('Pen options'), { placement: 'top' });
      gear.toggleClass('is-active', !!this.options);
      gear.addEventListener('click', () => { if (this.options) { this.options.remove(); this.options = null; this.renderPicker(); } else this.openOptions(); });
    }
    if (state.tool === 'eraser') {
      p.createDiv({ cls: 'vc-pen-hint', text: t('Click or drag across ink to erase it.') });
      return;
    }

    const colors = p.createDiv('vc-pen-row vc-pen-colors');
    const list = hl ? HL_COLORS : PEN_COLORS;
    for (const [c, label] of list) {
      const sw = colors.createDiv({ cls: 'vc-pen-swatch', attr: { role: 'button', 'aria-label': t(label) } });
      if (c === 'currentColor') sw.addClass('is-auto'); else sw.style.background = c;
      setTooltip(sw, t(label), { placement: 'top' });
      sw.toggleClass('is-active', ink === c);
      sw.addEventListener('click', () => { if (hl) state.hlColor = c; else state.color = c; this.renderPicker(); });
    }
    // Any colour: the rainbow well opens the system picker; the chosen colour stays in it.
    const custom = hl ? state.hlCustom : state.custom;
    const isCustom = !list.some(([c]) => c === ink);
    const well = colors.createEl('label', { cls: 'vc-pen-swatch vc-pen-custom', attr: { 'aria-label': t('Custom colour') } });
    well.toggleClass('is-active', isCustom);
    well.style.setProperty('--custom', isCustom ? ink : custom);
    setTooltip(well, t('Custom colour'), { placement: 'top' });
    const input = well.createEl('input', { type: 'color' });
    input.value = /^#[0-9a-f]{6}$/i.test(isCustom ? ink : custom) ? (isCustom ? ink : custom) : '#7c5cff';
    input.addEventListener('input', () => {
      if (hl) { state.hlColor = state.hlCustom = input.value; } else { state.color = state.custom = input.value; }
      well.style.setProperty('--custom', input.value);
      well.addClass('is-active');
      colors.querySelectorAll('.vc-pen-swatch:not(.vc-pen-custom)').forEach(x => x.removeClass('is-active'));
      tools.querySelectorAll<HTMLElement>(hl ? '.is-highlighter' : '.vc-pen-instrument:not(.is-highlighter):not(.is-eraser)').forEach(x => x.style.setProperty('--ink', input.value));
    });
    input.addEventListener('change', () => this.renderPicker());

    const widths = p.createDiv('vc-pen-row vc-pen-widths');
    WIDTHS.forEach((w, i) => {
      const b = widths.createDiv({ cls: 'vc-pen-width', attr: { role: 'button', 'aria-label': t('Thickness {n}', { n: i + 1 }) } });
      const dot = b.createDiv('vc-pen-width-dot');
      const shown = Math.max(2, Math.min(18, (hl ? w * 1.6 : w) * 0.9 + 1));
      dot.setCssStyles({ width: `${shown}px`, height: `${shown}px` });
      if (ink && ink !== 'currentColor') dot.style.background = ink;
      b.toggleClass('is-active', state.width === i);
      b.addEventListener('click', () => { state.width = i; this.renderPicker(); });
    });
  }

  /** perfect-freehand's own shape controls; changes redraw every pen stroke at once. */
  private openOptions(): void {
    const o = (this.main ?? this.board.uiEl).createDiv('vc-pen-options');
    this.options = o;
    o.addEventListener('pointerdown', e => e.stopPropagation());
    const head = o.createDiv('vc-pen-options-head');
    head.createSpan({ text: t('Pen options') });
    const reset = head.createDiv({ cls: 'vc-pen-options-reset', text: t('Reset') });
    const save = () => {
      this.board.settings.penShape = { ...penShape };
      void this.board.plugin.saveSettings();
      for (const v of this.board.plugin.app.workspace.getLeavesOfType(VIEW_TYPE)) {
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


  // ── drawing ─────────────────────────────────────────────

  pointerDown(e: PointerEvent): void {
    if (state.tool === 'eraser') { this.erase(e); return; }
    const board = this.board;
    const hl = state.tool === 'highlighter';
    const width = WIDTHS[Math.min(WIDTHS.length - 1, state.width)] * 1.15;
    const mono = state.tool === 'monoline';
    const pencil = state.tool === 'pencil';
    // A monoline pen draws at the width a pressure pen reaches at medium pressure; a pencil is finer.
    const stroke: Stroke = {
      c: hl ? state.hlColor : state.color,
      s: hl ? width * 3.2 : mono ? Math.max(2, width * 0.6) : pencil ? Math.max(1.5, width * 0.9) : width,
      p: [], h: hl || undefined, m: mono || undefined, g: pencil || undefined,
    };
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
    if (hl) live.classList.add('is-highlight');
    if (pencil) {
      ensurePencilFilter(board.edgeLayer);
      live.classList.add('is-pencil');
      live.setAttribute('filter', `url(#${PENCIL_FILTER_ID})`);
    }
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
      if (!raf) raf = window.requestAnimationFrame(redraw);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      doc.removeEventListener('pointercancel', cancel, true);
      if (raf) cancelAnimationFrame(raf);
      live.remove();
      this.cancelStroke = () => {};
      this.commit(stroke);
    };
    const cancel = () => {
      this.cancelStroke = () => {};
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      doc.removeEventListener('pointercancel', cancel, true);
      live.remove();
    };
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
    doc.addEventListener('pointercancel', cancel, true);
    this.cancelStroke = cancel;
  }

  /** Drop the stroke being drawn (a second finger came down to pinch). */
  cancelStroke: () => void = () => {};

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
        const node = board.model.addNode({ type: 'text', text: '', x: 0, y: 0, width: 1, height: 1, vc: { kind: 'drawing' } });
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
