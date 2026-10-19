import type { Side } from '../model/canvas-file';
import type { Rect } from '../model/board-model';
import type { Point } from './viewport';

export function sidePoint(r: Rect, side: Side): Point {
  switch (side) {
    case 'top': return { x: r.x + r.width / 2, y: r.y };
    case 'bottom': return { x: r.x + r.width / 2, y: r.y + r.height };
    case 'left': return { x: r.x, y: r.y + r.height / 2 };
    case 'right': return { x: r.x + r.width, y: r.y + r.height / 2 };
  }
}

const NORMAL: Record<Side, Point> = {
  top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};

/** The side of `r` facing point `p` best. */
export function facingSide(r: Rect, p: Point): Side {
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const dx = (p.x - cx) / Math.max(1, r.width), dy = (p.y - cy) / Math.max(1, r.height);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}

/** Sides for an edge stored without them: the pair facing each other. */
export function autoSides(a: Rect, b: Rect): [Side, Side] {
  const ac = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const bc = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  return [facingSide(a, bc), facingSide(b, ac)];
}

export interface EdgeShape {
  d: string;
  start: Point;
  end: Point;
  mid: Point;
  /** Direction the curve arrives at `end` / leaves `start`, in radians. */
  endAngle: number;
  startAngle: number;
}

/** A cubic curve leaving and entering along the side normals, like the core Canvas. */
export function edgeShape(from: Rect, fromSide: Side, to: Rect | Point, toSide: Side | null): EdgeShape {
  const start = sidePoint(from, fromSide);
  const end = 'width' in to ? sidePoint(to, toSide ?? 'left') : to;
  const dist = Math.hypot(end.x - start.x, end.y - start.y);
  const k = Math.min(Math.max(dist * 0.5, 40), 160);
  const n1 = NORMAL[fromSide];
  const c1 = { x: start.x + n1.x * k, y: start.y + n1.y * k };
  let c2: Point;
  if (toSide) {
    const n2 = NORMAL[toSide];
    c2 = { x: end.x + n2.x * k, y: end.y + n2.y * k };
  } else {
    c2 = { x: end.x - (end.x - c1.x) * 0.3, y: end.y - (end.y - c1.y) * 0.3 };
  }
  const d = `M${start.x},${start.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`;
  const mid = cubicAt(start, c1, c2, end, 0.5);
  return {
    d, start, end, mid,
    endAngle: Math.atan2(end.y - c2.y, end.x - c2.x),
    startAngle: Math.atan2(start.y - c1.y, start.x - c1.x),
  };
}

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + e * p3.x, y: a * p0.y + b * p1.y + c * p2.y + e * p3.y };
}

/** Triangle path for an arrowhead whose tip is at `tip`, pointing along `angle`. */
export function arrowPath(tip: Point, angle: number, size: number): string {
  const back = { x: tip.x - Math.cos(angle) * size, y: tip.y - Math.sin(angle) * size };
  const w = size * 0.55;
  const px = -Math.sin(angle) * w, py = Math.cos(angle) * w;
  return `M${tip.x},${tip.y} L${back.x + px},${back.y + py} L${back.x - px},${back.y - py} Z`;
}
