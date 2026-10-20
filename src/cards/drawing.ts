import { getStroke } from 'perfect-freehand';
import type { RawNode } from '../model/canvas-file';
import type { BarItem, CardContext, CardHandle, CardType } from './types';
import { t } from '../i18n';

/**
 * A drawing card holds the ink of one sketch. Points are relative to the
 * card (`vw` × `vh` is the size they were drawn at, so resizing the card
 * scales the ink).
 */
export interface Stroke {
  /** Points: x, y, pressure (0 when the device gave none). */
  p: number[];
  /** Ink colour (CSS colour; "currentColor" follows the theme). */
  c: string;
  /** Pen size in board units. */
  s: number;
  /** A highlighter swipe (translucent, chisel-edged). */
  h?: boolean;
}

export interface PenShape {
  thinning: number;
  streamline: number;
  smoothing: number;
  taperStart: number;
  taperEnd: number;
}

export const DEFAULT_PEN_SHAPE: PenShape = { thinning: 0.5, streamline: 0.5, smoothing: 0.5, taperStart: 0, taperEnd: 0 };

/** The live pen shape (set from settings); every pen stroke is drawn with it. */
export const penShape: PenShape = { ...DEFAULT_PEN_SHAPE };

const SVG_NS = 'http://www.w3.org/2000/svg';
const r2 = (n: number) => Math.round(n * 100) / 100;

function triples(p: number[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i + 1 < p.length; i += 3) out.push([p[i], p[i + 1], p[i + 2] || 0.5]);
  return out;
}

const hasPressure = (p: number[]) => { for (let i = 2; i < p.length; i += 3) if (p[i] > 0) return true; return false; };

/** A pen stroke as a filled, pressure-tapered outline (perfect-freehand). */
export function penOutline(st: Stroke, shape: PenShape = penShape, live = false): string {
  const pts = triples(st.p);
  if (!pts.length) return '';
  const outline = getStroke(pts, {
    size: st.s,
    thinning: shape.thinning,
    streamline: shape.streamline,
    smoothing: shape.smoothing,
    simulatePressure: !hasPressure(st.p),
    last: !live,
    start: { taper: shape.taperStart, cap: true },
    end: { taper: shape.taperEnd, cap: true },
  });
  if (outline.length < 3) {
    const [x, y] = pts[0];
    const r = st.s / 2;
    return `M${r2(x - r)},${r2(y)} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0 Z`;
  }
  let d = `M${r2(outline[0][0])},${r2(outline[0][1])}`;
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i - 1], [x1, y1] = outline[i];
    d += ` Q${r2(x0)},${r2(y0)} ${r2((x0 + x1) / 2)},${r2((y0 + y1) / 2)}`;
  }
  return d + ' Z';
}

/** A highlighter swipe: a broad band with slightly rough edges, like a real marker. */
export function highlightOutline(st: Stroke): string {
  const raw = triples(st.p).map(([x, y]) => ({ x, y }));
  const pts: { x: number; y: number }[] = [];
  for (const p of raw) {
    const prev = pts[pts.length - 1];
    if (prev) {
      const len = Math.hypot(p.x - prev.x, p.y - prev.y);
      const steps = Math.floor(len / 12);
      for (let k = 1; k <= steps; k++) { const f = k / (steps + 1); pts.push({ x: prev.x + (p.x - prev.x) * f, y: prev.y + (p.y - prev.y) * f }); }
    }
    pts.push(p);
  }
  if (pts.length < 2) {
    const [x, y] = [raw[0]?.x ?? 0, raw[0]?.y ?? 0];
    const h = st.s / 2;
    return `M${r2(x - h * 0.4)},${r2(y - h)} h${r2(h * 0.8)} v${r2(h * 2)} h${r2(-h * 0.8)} Z`;
  }
  // A seeded wobble so the edges look hand-made but never change between redraws.
  let seed = 7;
  for (let i = 0; i < st.p.length; i += 9) seed = (seed * 31 + Math.round(st.p[i])) >>> 0;
  const rnd = (i: number) => { let x = (seed ^ Math.imul(i + 1, 2654435761)) >>> 0; x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0; return ((x >>> 8) / 0xffffff) * 2 - 1; };
  const half = st.s / 2;
  // Gentle, rolling edge variation (averaged noise), not per-point jitter.
  const soft = (off: number) => {
    const raw = pts.map((_, i) => rnd(i + off));
    return raw.map((_, i) => { let sum = 0, k = 0; for (let j = i - 3; j <= i + 3; j++) if (j >= 0 && j < raw.length) { sum += raw[j]; k++; } return sum / k; });
  };
  const ja = soft(0), jb = soft(7919);
  const left: string[] = [], right: string[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const wa = half * (1 + ja[i] * 0.08), wb = half * (1 + jb[i] * 0.08);
    left.push(`${r2(pts[i].x - dy * wa)},${r2(pts[i].y + dx * wa)}`);
    right.push(`${r2(pts[i].x + dy * wb)},${r2(pts[i].y - dx * wb)}`);
  }
  return `M${left.join(' L')} L${right.reverse().join(' L')} Z`;
}

export function strokeOutline(st: Stroke, live = false): string {
  return st.h ? highlightOutline(st) : penOutline(st, penShape, live);
}

/** Inline SVG kept in the node's text, so the core Canvas shows the drawing too. */
export function drawingSvg(strokes: Stroke[], vw: number, vh: number): string {
  const paths = strokes.map(s => `<path d="${strokeOutline(s)}" style="fill:${s.c}${s.h ? ';fill-opacity:0.45' : ''}"/>`).join('');
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${r2(vw)} ${r2(vh)}" width="100%">${paths}</svg>`;
}

export function strokesOf(n: RawNode): Stroke[] {
  const s = n.vc?.strokes;
  if (!Array.isArray(s)) return [];
  // First version: { c, w, p: [x, y, x, y…] }.
  return (s as Record<string, unknown>[]).map((x) => {
    if (typeof x.s === 'number') return x as unknown as Stroke;
    const flat = (x.p as number[]) ?? [];
    const p: number[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) p.push(flat[i], flat[i + 1], 0);
    return { c: String(x.c ?? 'currentColor'), s: Number(x.w ?? 3) * 1.6, p };
  });
}

/** Bounds of strokes (with their width), in their own coordinates. */
export function strokesBounds(strokes: Stroke[]): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    const pad = s.s / 2 + 1;
    for (let i = 0; i + 1 < s.p.length; i += 3) {
      x0 = Math.min(x0, s.p[i] - pad); x1 = Math.max(x1, s.p[i] + pad);
      y0 = Math.min(y0, s.p[i + 1] - pad); y1 = Math.max(y1, s.p[i + 1] + pad);
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) } : null;
}

/** A card's strokes in board coordinates. */
export function strokesOnBoard(n: RawNode): Stroke[] {
  const kx = n.width / (Number(n.vc?.vw) || n.width), ky = n.height / (Number(n.vc?.vh) || n.height);
  return strokesOf(n).map(s => ({ ...s, s: s.s * Math.min(kx, ky), p: s.p.map((v, i) => (i % 3 === 0 ? n.x + v * kx : i % 3 === 1 ? n.y + v * ky : v)) }));
}

export function distanceToStroke(s: Stroke, x: number, y: number): number {
  let best = Infinity;
  const n = Math.floor(s.p.length / 3);
  if (n === 1) return Math.hypot(s.p[0] - x, s.p[1] - y);
  for (let i = 0; i < n - 1; i++) {
    const ax = s.p[i * 3], ay = s.p[i * 3 + 1], bx = s.p[i * 3 + 3], by = s.p[i * 3 + 4];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const k = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + dx * k - x, ay + dy * k - y));
  }
  return best;
}

/** Is a board point on the ink of a drawing card (not just inside its box)? */
export function drawingHit(n: RawNode, x: number, y: number, tol: number): boolean {
  if (x < n.x - tol || x > n.x + n.width + tol || y < n.y - tol || y > n.y + n.height + tol) return false;
  return strokesOnBoard(n).some(s => distanceToStroke(s, x, y) <= s.s / 2 + tol);
}

/** Store strokes given in board coordinates: the card wraps them exactly. */
export function writeDrawing(n: RawNode, strokes: Stroke[]): void {
  const b = strokesBounds(strokes);
  if (!b) return;
  const pad = 2;
  const x = b.x - pad, y = b.y - pad, w = b.w + pad * 2, h = b.h + pad * 2;
  const local = strokes.map(s => ({ ...s, s: r2(s.s), p: s.p.map((v, i) => (i % 3 === 0 ? r2(v - x) : i % 3 === 1 ? r2(v - y) : r2(v))) }));
  n.x = Math.round(x); n.y = Math.round(y);
  n.width = Math.max(4, Math.round(w)); n.height = Math.max(4, Math.round(h));
  n.vc = { ...(n.vc ?? {}), kind: 'drawing', strokes: local, vw: n.width, vh: n.height };
  n.text = drawingSvg(local, n.width, n.height);
}

/** Recolour all ink of a drawing (from the colour menu). */
export function recolorDrawing(n: RawNode, color: string): void {
  const strokes = strokesOf(n).map(s => ({ ...s, c: color }));
  const vw = Number(n.vc?.vw) || n.width, vh = Number(n.vc?.vh) || n.height;
  n.vc = { ...(n.vc ?? {}), strokes };
  n.text = drawingSvg(strokes, vw, vh);
}

class DrawingCard implements CardHandle {
  private svg: SVGSVGElement;
  constructor(private node: RawNode, el: HTMLElement, private ctx: CardContext) {
    el.addClass('vc-drawing');
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    el.appendChild(this.svg);
    this.render();
  }

  render(): void {
    const n = this.node;
    const vw = Number(n.vc?.vw) || n.width, vh = Number(n.vc?.vh) || n.height;
    this.svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
    this.svg.replaceChildren();
    for (const s of strokesOf(n)) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', strokeOutline(s));
      p.style.fill = s.c;
      if (s.h) { p.style.fillOpacity = '0.45'; p.classList.add('is-highlight'); }
      this.svg.appendChild(p);
    }
  }

  update(n: RawNode): void { this.node = n; this.render(); }
  destroy(): void { /* nothing */ }
  barItems(): BarItem[] {
    return [{ id: 'pen', icon: 'pen-line', label: t('Keep drawing'), run: () => this.ctx.board.setTool('pen') }];
  }
}

export const drawingCard: CardType = {
  id: 'drawing',
  label: 'Drawing',
  icon: 'pen-line',
  defaultSize: { width: 200, height: 200 },
  mount: (node, el, ctx) => new DrawingCard(node, el, ctx),
};

/** Redraw every drawing on a board after the pen shape changed. */
export function rerenderDrawings(cards: Iterable<{ kind: string; handle: CardHandle }>): void {
  for (const c of cards) if (c.kind === 'drawing') (c.handle as DrawingCard).render();
}
