import { describe, it, expect } from 'vitest';
import { alignEdges, distribute, normalize, optimalArrange, pushTogether, shelfPack, stack, shuffle, type Box } from '../src/board/arrange';

const boxes = (): Box[] => [
  { id: 'a', x: 0, y: 0, w: 100, h: 100 },
  { id: 'b', x: 300, y: 10, w: 200, h: 50 },
  { id: 'c', x: 50, y: 400, w: 50, h: 200 },
];

const overlaps = (p: Map<string, { x: number; y: number }>, items: Box[]) => {
  const r = items.map(b => ({ ...b, ...p.get(b.id) }));
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
    const a = r[i], b = r[j];
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return true;
  }
  return false;
};

describe('arrange', () => {
  it('shelf pack wraps rows without overlaps', () => {
    const r = shelfPack(boxes(), 320, 10, { x: 0, y: 0 });
    expect(overlaps(r.placement, boxes())).toBe(false);
    expect(r.placement.get('a')).toEqual({ x: 0, y: 0 });
  });

  it('optimal arrange has no overlaps and starts at the origin', () => {
    const many: Box[] = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, x: i * 37, y: i * 11, w: 80 + (i % 4) * 40, h: 60 + (i % 3) * 50 }));
    const p = optimalArrange(many, 16 / 9, 16, { x: 5, y: 7 });
    expect(overlaps(p, many)).toBe(false);
    expect(Math.min(...[...p.values()].map(v => v.x))).toBe(5);
    expect(Math.min(...[...p.values()].map(v => v.y))).toBe(7);
  });

  it('push left closes gaps between boxes on the same row', () => {
    const items: Box[] = [
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 500, y: 20, w: 100, h: 50 },
      { id: 'c', x: 300, y: 300, w: 50, h: 50 },
    ];
    const p = pushTogether(items, 'left', 10);
    expect(p.get('b')!.x).toBe(110);
    expect(p.get('c')!.x).toBe(0);
  });

  it('push right mirrors push left', () => {
    const items: Box[] = [
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 500, y: 20, w: 100, h: 50 },
    ];
    const p = pushTogether(items, 'right', 10);
    expect(p.get('b')!.x).toBe(500);
    expect(p.get('a')!.x).toBe(390);
  });

  it('stack puts everything on one spot', () => {
    const p = stack(boxes());
    expect(new Set([...p.values()].map(v => `${v.x},${v.y}`)).size).toBe(1);
  });

  it('same height keeps proportions', () => {
    const p = normalize(boxes(), 'height', 'first');
    expect(p.get('b')!.h).toBe(100);
    expect(p.get('b')!.w).toBe(400);
  });

  it('same area by average', () => {
    const p = normalize(boxes(), 'area', 'average');
    const areas = [...p.values()].map(v => v.w! * v.h!);
    expect(Math.max(...areas) - Math.min(...areas)).toBeLessThan(1e-6);
  });

  it('distribute makes a row with equal gaps', () => {
    const p = distribute(boxes(), 'h', 16);
    expect(p.get('a')!.x).toBe(0);
    expect(p.get('c')!.x).toBe(116);
    expect(p.get('b')!.x).toBe(182);
  });

  it('align left edges', () => {
    const p = alignEdges(boxes(), 'left');
    expect([...p.values()].every(v => v.x === 0)).toBe(true);
  });

  it('seeded shuffle keeps every item', () => {
    expect(shuffle([1, 2, 3, 4, 5], 42).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
