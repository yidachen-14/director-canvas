import type { RawNode } from '../model/canvas-file';
import type { CardHandle, CardType } from './types';

/** One pen stroke: colour, width, and points as a flat x,y list relative to the drawing. */
export interface Stroke { c: string; w: number; p: number[]; }

const SVG_NS = 'http://www.w3.org/2000/svg';
const r1 = (n: number) => Math.round(n * 10) / 10;

/** A smooth path through the points (quadratic curves between midpoints). */
export function strokePath(p: number[]): string {
  const n = p.length / 2;
  if (n === 0) return '';
  if (n === 1) return `M${r1(p[0])},${r1(p[1])} l0.01,0`;
  let d = `M${r1(p[0])},${r1(p[1])}`;
  for (let i = 1; i < n - 1; i++) {
    const x = p[i * 2], y = p[i * 2 + 1];
    const mx = (x + p[i * 2 + 2]) / 2, my = (y + p[i * 2 + 3]) / 2;
    d += ` Q${r1(x)},${r1(y)} ${r1(mx)},${r1(my)}`;
  }
  d += ` L${r1(p[n * 2 - 2])},${r1(p[n * 2 - 1])}`;
  return d;
}

/** Inline SVG kept in the node's text, so the core Canvas shows the drawing too. */
export function drawingSvg(strokes: Stroke[], vw: number, vh: number): string {
  const paths = strokes.map(s => `<path d="${strokePath(s.p)}" stroke="${s.c}" stroke-width="${s.w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${r1(vw)} ${r1(vh)}" width="100%" preserveAspectRatio="xMidYMid meet">${paths}</svg>`;
}

export function strokesOf(n: RawNode): Stroke[] {
  const s = n.vc?.strokes;
  return Array.isArray(s) ? (s as Stroke[]) : [];
}

/** Bounding box of strokes (including half their width). */
export function strokesBounds(strokes: Stroke[]): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    for (let i = 0; i < s.p.length; i += 2) {
      x0 = Math.min(x0, s.p[i] - s.w / 2); x1 = Math.max(x1, s.p[i] + s.w / 2);
      y0 = Math.min(y0, s.p[i + 1] - s.w / 2); y1 = Math.max(y1, s.p[i + 1] + s.w / 2);
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) } : null;
}

/** Distance from a point to a stroke's centre line. */
export function distanceToStroke(s: Stroke, x: number, y: number): number {
  let best = Infinity;
  const n = s.p.length / 2;
  if (n === 1) return Math.hypot(s.p[0] - x, s.p[1] - y);
  for (let i = 0; i < n - 1; i++) {
    const ax = s.p[i * 2], ay = s.p[i * 2 + 1], bx = s.p[i * 2 + 2], by = s.p[i * 2 + 3];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
  }
  return best;
}

class DrawingCard implements CardHandle {
  private svg: SVGSVGElement;
  constructor(private node: RawNode, el: HTMLElement) {
    el.addClass('vc-drawing');
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    el.appendChild(this.svg);
    this.render();
  }

  private render(): void {
    const n = this.node;
    const vw = Number(n.vc?.vw) || n.width, vh = Number(n.vc?.vh) || n.height;
    this.svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
    this.svg.replaceChildren();
    for (const s of strokesOf(n)) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', strokePath(s.p));
      p.setAttribute('stroke', s.c);
      p.setAttribute('stroke-width', String(s.w));
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      this.svg.appendChild(p);
    }
  }

  update(n: RawNode): void { this.node = n; this.render(); }
  destroy(): void { /* nothing */ }
}

export const drawingCard: CardType = {
  id: 'drawing',
  label: 'Drawing',
  icon: 'pen-line',
  defaultSize: { width: 200, height: 200 },
  mount: (node, el) => new DrawingCard(node, el),
};
