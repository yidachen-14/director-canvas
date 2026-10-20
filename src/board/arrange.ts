/**
 * PureRef-style arranging: pack, push together, stack, make the same size,
 * distribute, align. The layout maths here are pure functions over boxes;
 * `runArrange` applies them to a board as one undo step.
 */
export interface Box { id: string; x: number; y: number; w: number; h: number; }

export type Placement = Map<string, { x: number; y: number; w?: number; h?: number }>;

// ── packing into rows ───────────────────────────────────────

/** Rows left→right, top→bottom, wrapping at `maxWidth`. Items keep their order. */
export function shelfPack(items: Box[], maxWidth: number, gap: number, origin: { x: number; y: number }): { placement: Placement; width: number; height: number } {
  const placement: Placement = new Map();
  let x = 0, y = 0, rowH = 0, width = 0;
  for (const it of items) {
    if (x > 0 && x + it.w > maxWidth) { y += rowH + gap; x = 0; rowH = 0; }
    placement.set(it.id, { x: origin.x + x, y: origin.y + y });
    x += it.w + gap;
    rowH = Math.max(rowH, it.h);
    width = Math.max(width, x - gap);
  }
  return { placement, width, height: y + rowH };
}

/**
 * Rows whose overall shape is as close as possible to `aspect` (width/height),
 * keeping the given order.
 */
export function packToAspect(items: Box[], aspect: number, gap: number, origin: { x: number; y: number }): Placement {
  if (!items.length) return new Map();
  const widest = Math.max(...items.map(i => i.w));
  const total = items.reduce((s, i) => s + i.w + gap, -gap);
  let best: { score: number; placement: Placement } | null = null;
  const steps = 80;
  for (let k = 0; k <= steps; k++) {
    // Geometric sweep between the widest item and one long row.
    const w = widest * Math.pow(Math.max(1, total / widest), k / steps);
    const r = shelfPack(items, w + 0.5, gap, origin);
    const shape = Math.abs(Math.log((r.width / Math.max(1, r.height)) / aspect));
    const area = items.reduce((s, i) => s + i.w * i.h, 0);
    const waste = 1 - area / Math.max(1, r.width * r.height);
    const score = shape + waste * 0.6;
    if (!best || score < best.score - 1e-9) best = { score, placement: r.placement };
  }
  return best!.placement;
}

/** Optimal: tallest first so rows hold similar heights, then packed to the view's shape. */
export function optimalArrange(items: Box[], aspect: number, gap: number, origin: { x: number; y: number }, reverse = false): Placement {
  const sorted = [...items].sort((a, b) => b.h - a.h || b.w - a.w);
  if (reverse) sorted.reverse();
  return packToAspect(sorted, aspect, gap, origin);
}

// ── pushing together ────────────────────────────────────────

export type Direction = 'left' | 'right' | 'up' | 'down';

/**
 * Move every box in `dir` until it meets another box (or the selection's
 * edge), leaving `gap` between them — like gravity towards one side.
 */
export function pushTogether(items: Box[], dir: Direction, gap: number): Placement {
  const placement: Placement = new Map();
  if (!items.length) return placement;
  const horiz = dir === 'left' || dir === 'right';
  const sign = dir === 'left' || dir === 'up' ? -1 : 1;
  // Work as if pushing left/up: flip coordinates for right/down.
  const pos = (b: Box) => (horiz ? b.x : b.y) * -sign - (sign > 0 ? (horiz ? b.w : b.h) : 0);
  const size = (b: Box) => (horiz ? b.w : b.h);
  const crossA = (b: Box) => (horiz ? b.y : b.x);
  const crossB = (b: Box) => (horiz ? b.y + b.h : b.x + b.w);
  const edge = Math.min(...items.map(pos));
  const order = [...items].sort((a, b) => pos(a) - pos(b));
  const placed: { a: number; b: number; end: number }[] = [];
  for (const it of order) {
    let p = edge;
    for (const q of placed) {
      if (crossA(it) < q.b && crossB(it) > q.a) p = Math.max(p, q.end + gap);
    }
    placed.push({ a: crossA(it), b: crossB(it), end: p + size(it) });
    // Back to real coordinates.
    const real = sign < 0 ? p : -(p + size(it));
    placement.set(it.id, horiz ? { x: real, y: it.y } : { x: it.x, y: real });
  }
  return placement;
}

/** All boxes on one spot (top-left of the first), in their layer order. */
export function stack(items: Box[]): Placement {
  const placement: Placement = new Map();
  if (!items.length) return placement;
  const x = Math.min(...items.map(i => i.x)), y = Math.min(...items.map(i => i.y));
  for (const it of items) placement.set(it.id, { x, y });
  return placement;
}

// ── same size ───────────────────────────────────────────────

export type Normalize = 'height' | 'width' | 'size' | 'area';

/** Resize, keeping each box's proportions and centre, so one measure matches the base. */
export function normalize(items: Box[], what: Normalize, base: 'first' | 'average'): Placement {
  const placement: Placement = new Map();
  if (items.length < 2) return placement;
  const measure = (b: Box) => what === 'height' ? b.h : what === 'width' ? b.w : what === 'size' ? Math.max(b.w, b.h) : b.w * b.h;
  const target = base === 'first' ? measure(items[0]) : items.reduce((s, b) => s + measure(b), 0) / items.length;
  for (const b of items) {
    const m = measure(b);
    if (m <= 0) continue;
    const k = what === 'area' ? Math.sqrt(target / m) : target / m;
    const w = b.w * k, h = b.h * k;
    placement.set(b.id, { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h });
  }
  return placement;
}

// ── rows, columns, alignment ────────────────────────────────

/** One row (or column), evenly spaced, in left-to-right (top-to-bottom) order. */
export function distribute(items: Box[], axis: 'h' | 'v', gap: number): Placement {
  const placement: Placement = new Map();
  if (!items.length) return placement;
  const sorted = [...items].sort((a, b) => axis === 'h' ? a.x - b.x : a.y - b.y);
  const x0 = Math.min(...items.map(i => i.x)), y0 = Math.min(...items.map(i => i.y));
  let cur = axis === 'h' ? x0 : y0;
  for (const it of sorted) {
    placement.set(it.id, axis === 'h' ? { x: cur, y: y0 } : { x: x0, y: cur });
    cur += (axis === 'h' ? it.w : it.h) + gap;
  }
  return placement;
}

export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export function alignEdges(items: Box[], edge: AlignEdge): Placement {
  const placement: Placement = new Map();
  if (items.length < 2) return placement;
  const minX = Math.min(...items.map(i => i.x)), maxX = Math.max(...items.map(i => i.x + i.w));
  const minY = Math.min(...items.map(i => i.y)), maxY = Math.max(...items.map(i => i.y + i.h));
  for (const b of items) {
    let { x, y } = b;
    if (edge === 'left') x = minX;
    if (edge === 'right') x = maxX - b.w;
    if (edge === 'hcenter') x = (minX + maxX) / 2 - b.w / 2;
    if (edge === 'top') y = minY;
    if (edge === 'bottom') y = maxY - b.h;
    if (edge === 'vcenter') y = (minY + maxY) / 2 - b.h / 2;
    placement.set(b.id, { x, y });
  }
  return placement;
}

/** A seeded shuffle, so tests can check it. */
export function shuffle<T>(arr: T[], seed = Date.now()): T[] {
  const out = [...arr];
  let s = seed % 2147483647 || 1;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Keep the outermost boxes where they are and make the gaps between all of them equal. */
export function spaceEvenly(items: Box[], axis: 'h' | 'v'): Placement {
  const placement: Placement = new Map();
  if (items.length < 3) return placement;
  const pos = (b: Box) => (axis === 'h' ? b.x : b.y);
  const size = (b: Box) => (axis === 'h' ? b.w : b.h);
  const sorted = [...items].sort((a, b) => pos(a) - pos(b));
  const start = pos(sorted[0]);
  const end = Math.max(...sorted.map(b => pos(b) + size(b)));
  const total = sorted.reduce((s, b) => s + size(b), 0);
  const gap = (end - start - total) / (sorted.length - 1);
  let cur = start;
  for (const b of sorted) {
    placement.set(b.id, axis === 'h' ? { x: cur, y: b.y } : { x: b.x, y: cur });
    cur += size(b) + gap;
  }
  return placement;
}
