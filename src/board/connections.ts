/**
 * Connection geometry: where a connection's ends sit and the line between them.
 *
 * A connection end is one of
 * - pinned: fixed to a point along one side of a card (side + t, 0..1),
 * - floating: attached to a card, sliding round its edge to face the other end,
 * - free: a point on the board, attached to nothing.
 *
 * Card-to-card connections are stored as ordinary JSON Canvas edges (so the
 * core Canvas still shows them); everything only Director Canvas understands
 * lives in the edge's `vc` object. Connections with a free end cannot be
 * expressed in JSON Canvas and are kept in the file's `vc.lines`.
 */
import type { RawEdge, RawNode, Side } from '../model/canvas-file';
import type { Rect } from '../model/board-model';
import type { Point } from './viewport';

export type Route = 'straight' | 'curve' | 'elbow';
export type ElbowAxis = 'auto' | 'h' | 'v';

export interface EdgeVc {
  route?: Route;
  /** Sideways offset of the line's middle, in board units. */
  bend?: number;
  elbow?: ElbowAxis;
  fromT?: number;
  toT?: number;
  fromFloat?: boolean;
  toFloat?: boolean;
  /** Free end positions (when fromNode / toNode is empty). */
  from?: Point;
  to?: Point;
  width?: number;
  dash?: boolean;
  labelSize?: number;
}

export type End =
  | { kind: 'free'; p: Point }
  | { kind: 'pin'; rect: Rect; side: Side; t: number; id: string }
  | { kind: 'float'; rect: Rect; id: string };

export const NORMAL: Record<Side, Point> = {
  top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};

export const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

export function vcOf(e: RawEdge): EdgeVc {
  return (e.vc ?? {});
}

/** Edges imported from the core Canvas have no route: they keep its curved look. */
export function routeOf(e: RawEdge): Route {
  const r = vcOf(e).route;
  return r === 'straight' || r === 'elbow' || r === 'curve' ? r : 'curve';
}

/** Empty margin a mind map card keeps around its topics (the card's PAD). */
const MINDMAP_MARGIN = 24;

/** Where connections attach to a card: its box, or for a mind map the topics inside its margin. */
export function rectOf(n: RawNode): Rect {
  if (n.vc?.kind === 'mindmap' && n.width > MINDMAP_MARGIN * 2 && n.height > MINDMAP_MARGIN * 2) {
    return { x: n.x + MINDMAP_MARGIN, y: n.y + MINDMAP_MARGIN, width: n.width - MINDMAP_MARGIN * 2, height: n.height - MINDMAP_MARGIN * 2 };
  }
  return { x: n.x, y: n.y, width: n.width, height: n.height };
}

export function center(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** The point at `t` (0..1) along a side, left→right / top→bottom. */
export function pinPoint(r: Rect, side: Side, t: number): Point {
  switch (side) {
    case 'top': return { x: r.x + r.width * t, y: r.y };
    case 'bottom': return { x: r.x + r.width * t, y: r.y + r.height };
    case 'left': return { x: r.x, y: r.y + r.height * t };
    case 'right': return { x: r.x + r.width, y: r.y + r.height * t };
  }
}

/** The side of `r` that faces point `p`. */
export function facingSide(r: Rect, p: Point): Side {
  const c = center(r);
  const dx = (p.x - c.x) / Math.max(1, r.width), dy = (p.y - c.y) / Math.max(1, r.height);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}

/** Where the ray from the rect's centre towards `p` leaves the rect. */
export function boundaryToward(r: Rect, p: Point): { point: Point; side: Side } {
  const c = center(r);
  const dx = p.x - c.x, dy = p.y - c.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return { point: pinPoint(r, 'right', 0.5), side: 'right' };
  const hw = r.width / 2, hh = r.height / 2;
  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  const point = { x: c.x + dx * s, y: c.y + dy * s };
  const side: Side = sx < sy ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
  return { point, side };
}

/** Closest point on a rect's outline to `p`, as side + t. */
export function nearestOnOutline(r: Rect, p: Point): { side: Side; t: number; point: Point; dist: number } {
  let best: { side: Side; t: number; point: Point; dist: number } | null = null;
  for (const side of SIDES) {
    const horiz = side === 'top' || side === 'bottom';
    const len = horiz ? r.width : r.height;
    const along = horiz ? p.x - r.x : p.y - r.y;
    const t = Math.min(1, Math.max(0, along / Math.max(1, len)));
    const point = pinPoint(r, side, t);
    const dist = Math.hypot(point.x - p.x, point.y - p.y);
    if (!best || dist < best.dist) best = { side, t, point, dist };
  }
  return best!;
}

/** Pin positions (t values) along a side `len` board units long, shown at `zoom`. Always includes the middle. */
export function pinTs(len: number, zoom: number): number[] {
  let k = Math.floor((len * zoom) / 56);
  k = Math.max(1, Math.min(9, k));
  if (k % 2 === 0) k -= 1;
  return Array.from({ length: k }, (_, i) => (i + 1) / (k + 1));
}

/** Resolve one end of an edge against the current nodes. */
export function endOf(e: RawEdge, which: 'from' | 'to', node: (id: string) => RawNode | undefined): End | null {
  const vc = vcOf(e);
  const id = which === 'from' ? e.fromNode : e.toNode;
  if (!id) {
    const p = vc[which];
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { kind: 'free', p } : null;
  }
  const n = node(id);
  if (!n) return null;
  const side = which === 'from' ? e.fromSide : e.toSide;
  const float = which === 'from' ? vc.fromFloat : vc.toFloat;
  if (float || !side) return { kind: 'float', rect: rectOf(n), id };
  const t = which === 'from' ? vc.fromT : vc.toT;
  return { kind: 'pin', rect: rectOf(n), side, t: typeof t === 'number' ? Math.min(1, Math.max(0, t)) : 0.5, id };
}

function refPoint(end: End): Point {
  if (end.kind === 'free') return end.p;
  if (end.kind === 'pin') return pinPoint(end.rect, end.side, end.t);
  return center(end.rect);
}

/** Where each end actually touches, and which way it leaves its card. */
export function anchorPoints(a: End, b: End, route: Route): { p1: Point; s1: Side | null; p2: Point; s2: Side | null } {
  const ra = refPoint(a), rb = refPoint(b);
  const place = (end: End, other: Point): { p: Point; s: Side | null } => {
    if (end.kind === 'free') return { p: end.p, s: null };
    if (end.kind === 'pin') return { p: pinPoint(end.rect, end.side, end.t), s: end.side };
    if (route === 'straight') {
      const hit = boundaryToward(end.rect, other);
      return { p: hit.point, s: hit.side };
    }
    const s = facingSide(end.rect, other);
    return { p: pinPoint(end.rect, s, 0.5), s };
  };
  const A = place(a, rb), B = place(b, ra);
  return { p1: A.p, s1: A.s, p2: B.p, s2: B.s };
}

export interface Shape {
  /** The visible line (trimmed under arrowheads). */
  d: string;
  /** The full line, for the wide invisible hit area and the selection halo. */
  full: string;
  start: Point;
  end: Point;
  /** Point the label and the bend handle sit on. */
  mid: Point;
  startArrow: string;
  endArrow: string;
  /** Which way `bend` pushes the middle: perpendicular to the chord (straight/curve), or the elbow's axis. */
  bendAxis: Point;
  /** Where the middle would be with no bend. */
  bendOrigin: Point;
}

export interface ShapeOptions {
  route: Route;
  bend: number;
  elbow: ElbowAxis;
  width: number;
  startArrow: boolean;
  endArrow: boolean;
  /** The cards the ends are attached to, so elbow lines can go round them. */
  rect1?: Rect | null;
  rect2?: Rect | null;
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const len = (a: Point): number => Math.hypot(a.x, a.y);
const unit = (a: Point): Point => { const l = len(a); return l < 1e-9 ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l }; };
const f = (n: number) => Math.round(n * 100) / 100;
const P = (p: Point) => `${f(p.x)},${f(p.y)}`;

export function arrowSize(width: number): number {
  return 9 + width * 2;
}

/** Filled triangle with its tip at `tip`, pointing along `dir`. */
export function arrowHead(tip: Point, dir: Point, size: number): string {
  const u = unit(dir);
  const back = sub(tip, mul(u, size));
  const w = size * 0.5;
  const n = { x: -u.y * w, y: u.x * w };
  return `M${P(tip)} L${P(add(back, n))} L${P(sub(back, n))} Z`;
}

/** Build the line for anchors p1 (leaving side s1) → p2 (arriving via side s2). */
export function buildShape(p1: Point, s1: Side | null, p2: Point, s2: Side | null, o: ShapeOptions): Shape {
  const size = arrowSize(o.width);
  const trim = size * 0.8;
  if (o.route === 'elbow') return elbowShape(p1, s1, p2, s2, o, size, trim);

  const chord = sub(p2, p1);
  const normal = unit({ x: -chord.y, y: chord.x });
  const chordMid = mul(add(p1, p2), 0.5);

  if (o.route === 'straight') {
    if (Math.abs(o.bend) < 0.5) {
      const dir = unit(chord);
      const a = o.startArrow ? add(p1, mul(dir, trim)) : p1;
      const b = o.endArrow ? sub(p2, mul(dir, trim)) : p2;
      return {
        d: `M${P(a)} L${P(b)}`, full: `M${P(p1)} L${P(p2)}`, start: p1, end: p2, mid: chordMid,
        startArrow: o.startArrow ? arrowHead(p1, mul(dir, -1), size) : '',
        endArrow: o.endArrow ? arrowHead(p2, dir, size) : '',
        bendAxis: normal, bendOrigin: chordMid,
      };
    }
    // Quadratic through chordMid + normal·bend.
    const c = add(chordMid, mul(normal, o.bend * 2));
    const d1 = unit(sub(c, p1)), d2 = unit(sub(p2, c));
    const a = o.startArrow ? add(p1, mul(d1, trim)) : p1;
    const b = o.endArrow ? sub(p2, mul(d2, trim)) : p2;
    return {
      d: `M${P(a)} Q${P(c)} ${P(b)}`, full: `M${P(p1)} Q${P(c)} ${P(p2)}`, start: p1, end: p2,
      mid: add(chordMid, mul(normal, o.bend)),
      startArrow: o.startArrow ? arrowHead(p1, mul(d1, -1), size) : '',
      endArrow: o.endArrow ? arrowHead(p2, d2, size) : '',
      bendAxis: normal, bendOrigin: chordMid,
    };
  }

  // Curve: leaves and arrives along the sides' normals, like the core Canvas.
  const dist = len(chord);
  const k = Math.min(Math.max(dist * 0.45, 30), 180);
  const out1 = s1 ? NORMAL[s1] : unit(chord);
  const out2 = s2 ? NORMAL[s2] : unit(mul(chord, -1));
  const shift = mul(normal, o.bend / 0.75);
  const c1 = add(add(p1, mul(out1, k)), shift);
  const c2 = add(add(p2, mul(out2, k)), shift);
  const d1 = unit(sub(c1, p1)), d2 = unit(sub(p2, c2));
  const a = o.startArrow ? add(p1, mul(d1, trim)) : p1;
  const b = o.endArrow ? sub(p2, mul(d2, trim)) : p2;
  const mid = cubicAt(p1, c1, c2, p2, 0.5);
  const midNoBend = sub(mid, mul(normal, o.bend));
  return {
    d: `M${P(a)} C${P(c1)} ${P(c2)} ${P(b)}`, full: `M${P(p1)} C${P(c1)} ${P(c2)} ${P(p2)}`, start: p1, end: p2, mid,
    startArrow: o.startArrow ? arrowHead(p1, mul(d1, -1), size) : '',
    endArrow: o.endArrow ? arrowHead(p2, d2, size) : '',
    bendAxis: normal, bendOrigin: midNoBend,
  };
}

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + e * p3.x, y: a * p0.y + b * p1.y + c * p2.y + e * p3.y };
}

const STUB = 20;

function elbowShape(p1: Point, s1: Side | null, p2: Point, s2: Side | null, o: ShapeOptions, size: number, trim: number): Shape {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  let axis: 'h' | 'v';
  if (o.elbow === 'h' || o.elbow === 'v') axis = o.elbow;
  else if (s1) axis = s1 === 'left' || s1 === 'right' ? 'h' : 'v';
  else axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';

  const out1 = s1 ? NORMAL[s1] : (axis === 'h' ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) || 1 });
  const out2 = s2 ? NORMAL[s2] : (axis === 'h' ? { x: -(Math.sign(dx) || 1), y: 0 } : { x: 0, y: -(Math.sign(dy) || 1) });
  // Work in "h" orientation; a vertical route is the same with x and y swapped.
  const sw = (p: Point): Point => (axis === 'h' ? p : { x: p.y, y: p.x });
  const swr = (r: Rect | null | undefined): Rect | null => (!r ? null : axis === 'h' ? r : { x: r.y, y: r.x, width: r.height, height: r.width });
  const stub = Math.max(STUB, o.endArrow || o.startArrow ? size + 8 : STUB);
  const route = elbowPoints(sw(p1), sw(out1), !!s1, sw(p2), sw(out2), !!s2, o.bend, stub, swr(o.rect2));
  let pts = route.pts.map(sw);
  const origin = sw(route.origin);
  const bendAxis = sw(route.axis);
  pts = simplify(pts);
  const mid = add(origin, mul(bendAxis, o.bend));

  const firstDir = unit(sub(pts[1] ?? p2, pts[0]));
  const lastDir = unit(sub(pts[pts.length - 1], pts[pts.length - 2] ?? p1));
  const vis = pts.slice();
  if (o.startArrow && vis.length >= 2) vis[0] = add(vis[0], mul(firstDir, Math.min(trim, len(sub(vis[1], vis[0])) * 0.9)));
  if (o.endArrow && vis.length >= 2) {
    const n = vis.length;
    vis[n - 1] = sub(vis[n - 1], mul(lastDir, Math.min(trim, len(sub(vis[n - 1], vis[n - 2])) * 0.9)));
  }
  return {
    d: roundedPath(vis, 10), full: roundedPath(pts, 10), start: p1, end: p2, mid,
    startArrow: o.startArrow ? arrowHead(p1, mul(firstDir, -1), size) : '',
    endArrow: o.endArrow ? arrowHead(p2, lastDir, size) : '',
    bendAxis, bendOrigin: origin,
  };
}

/**
 * Orthogonal route in "horizontal-first" space: leaves p1 along out1 and
 * arrives at p2 against out2. Picks a Z, U, L or S shape so the line does
 * not double back through the cards it connects.
 */
function elbowPoints(p1: Point, out1: Point, attached1: boolean, p2: Point, out2: Point, attached2: boolean, bend: number, stub: number, rect2: Rect | null): { pts: Point[]; origin: Point; axis: Point } {
  const q1 = attached1 ? add(p1, mul(out1, stub)) : p1;
  const q2 = attached2 ? add(p2, mul(out2, stub)) : p2;
  const X = { x: 1, y: 0 }, Y = { x: 0, y: 1 };
  const d1 = Math.sign(out1.x);
  // Leaving sideways (the normal case in this orientation).
  if (d1 !== 0) {
    const d2x = Math.sign(out2.x), d2y = Math.sign(out2.y);
    if (d2x === -d1 && (q2.x - q1.x) * d1 >= 0) {
      // Z: across, up/down, across.
      const mx0 = (q1.x + q2.x) / 2, mx = mx0 + bend;
      return { pts: [p1, q1, { x: mx, y: q1.y }, { x: mx, y: q2.y }, q2, p2], origin: { x: mx0, y: (q1.y + q2.y) / 2 }, axis: X };
    }
    if (d2x === d1) {
      // U: both leave the same way; go round the outside.
      const mx0 = d1 > 0 ? Math.max(q1.x, q2.x) : Math.min(q1.x, q2.x), mx = mx0 + bend;
      // The way across would cut through the target card: go round above or below it.
      if (rect2 && q1.y > rect2.y - stub && q1.y < rect2.y + rect2.height + stub
        && Math.min(q1.x, mx) < rect2.x + rect2.width && Math.max(q1.x, mx) > rect2.x) {
        const yd = q1.y < rect2.y + rect2.height / 2 ? rect2.y - stub : rect2.y + rect2.height + stub;
        return { pts: [p1, q1, { x: q1.x, y: yd }, { x: mx, y: yd }, { x: mx, y: q2.y }, q2, p2], origin: { x: mx0, y: (yd + q2.y) / 2 }, axis: X };
      }
      return { pts: [p1, q1, { x: mx, y: q1.y }, { x: mx, y: q2.y }, q2, p2], origin: { x: mx0, y: (q1.y + q2.y) / 2 }, axis: X };
    }
    if (d2y !== 0 && (q2.x - q1.x) * d1 >= 0 && (q1.y - q2.y) * d2y >= 0) {
      // L: across, then straight into the side facing us.
      const corner = { x: q2.x, y: q1.y };
      return { pts: [p1, q1, corner, q2, p2], origin: corner, axis: { x: 0, y: 0 } };
    }
    // S: the cards overlap in this direction; cross over between them.
    const my0 = (q1.y + q2.y) / 2, my = my0 + bend;
    return { pts: [p1, q1, { x: q1.x, y: my }, { x: q2.x, y: my }, q2, p2], origin: { x: (q1.x + q2.x) / 2, y: my0 }, axis: Y };
  }
  const mx0 = (q1.x + q2.x) / 2, mx = mx0 + bend;
  return { pts: [p1, q1, { x: mx, y: q1.y }, { x: mx, y: q2.y }, q2, p2], origin: { x: mx0, y: (q1.y + q2.y) / 2 }, axis: X };
}

/** Drop repeated points and middle points of straight runs. */
function simplify(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (Math.abs(cross) < 0.01 && dot >= 0) out.splice(i, 1);
  }
  return out;
}

/** Polyline with rounded corners. */
function roundedPath(pts: Point[], radius: number): string {
  if (pts.length < 2) return '';
  let d = `M${P(pts[0])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const r = Math.min(radius, len(sub(b, a)) / 2, len(sub(c, b)) / 2);
    const p = sub(b, mul(unit(sub(b, a)), r));
    const q = add(b, mul(unit(sub(c, b)), r));
    d += ` L${P(p)} Q${P(b)} ${P(q)}`;
  }
  d += ` L${P(pts[pts.length - 1])}`;
  return d;
}

/** Everything needed to draw an edge, or null when an end is missing. */
export function edgeGeometry(e: RawEdge, node: (id: string) => RawNode | undefined): (Shape & { a: End; b: End; s1: Side | null; s2: Side | null }) | null {
  const a = endOf(e, 'from', node), b = endOf(e, 'to', node);
  if (!a || !b) return null;
  const vc = vcOf(e);
  const route = routeOf(e);
  const { p1, s1, p2, s2 } = anchorPoints(a, b, route);
  const shape = buildShape(p1, s1, p2, s2, {
    route,
    bend: typeof vc.bend === 'number' ? vc.bend : 0,
    elbow: vc.elbow ?? 'auto',
    width: edgeWidth(e),
    startArrow: e.fromEnd === 'arrow',
    endArrow: (e.toEnd ?? 'arrow') === 'arrow',
    rect1: a.kind === 'free' ? null : a.rect,
    rect2: b.kind === 'free' ? null : b.rect,
  });
  return { ...shape, a, b, s1, s2 };
}

export function edgeWidth(e: RawEdge): number {
  const w = vcOf(e).width;
  return typeof w === 'number' && w > 0 ? w : 2;
}

/**
 * Before saving: floating ends get the side they currently face, so the core
 * Canvas draws them sensibly too.
 */
export function settleSidesForSave(edges: RawEdge[], nodes: RawNode[]): RawEdge[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  return edges.map((e) => {
    const vc = vcOf(e);
    if (!vc.fromFloat && !vc.toFloat) return e;
    const g = edgeGeometry(e, id => byId.get(id));
    if (!g) return e;
    const out = { ...e };
    if (vc.fromFloat && g.s1) out.fromSide = g.s1;
    if (vc.toFloat && g.s2) out.toSide = g.s2;
    return out;
  });
}
