import { describe, it, expect } from 'vitest';
import {
  addChild, addSibling, boundsOf, findTopic, fromMarkdown, layoutMindMap, moveTopic, newMindMap, normalizeData,
  removeTopics, resolveStyles, sidesOf, toMarkdown, type MMData, type Size,
} from '../src/mindmap/model';

function sample(): MMData {
  const d = newMindMap('Root');
  const a = addChild(d, d.root.id, 'A')!;
  const b = addChild(d, d.root.id, 'B')!;
  addChild(d, d.root.id, 'C');
  addChild(d, a.id, 'A1');
  addChild(d, a.id, 'A2');
  addChild(d, b.id, 'B1');
  return d;
}
const sizes = (d: MMData): Map<string, Size> => {
  const m = new Map<string, Size>();
  const walk = (t: MMData['root']) => { m.set(t.id, { w: 40 + t.text.length * 8, h: 24 }); t.children.forEach(walk); };
  walk(d.root);
  return m;
};
const byText = (d: MMData, text: string) => {
  let id = '';
  const walk = (t: MMData['root']) => { if (t.text === text) id = t.id; t.children.forEach(walk); };
  walk(d.root);
  return id;
};

describe('mind map tree edits', () => {
  it('adds children and siblings', () => {
    const d = sample();
    expect(d.root.children.map(c => c.text)).toEqual(['A', 'B', 'C']);
    const s = addSibling(d, byText(d, 'A1'), 'A1b')!;
    expect(findTopic(d.root, byText(d, 'A'))!.topic.children.map(c => c.text)).toEqual(['A1', 'A1b', 'A2']);
    // The central topic has no siblings: Enter adds a child.
    addSibling(d, d.root.id, 'D');
    expect(d.root.children.map(c => c.text)).toEqual(['A', 'B', 'C', 'D']);
    expect(s.id).toBeTruthy();
  });

  it('removes topics and picks the next one to select', () => {
    const d = sample();
    const next = removeTopics(d, [byText(d, 'A1')]);
    expect(findTopic(d.root, next!)!.topic.text).toBe('A2');
    expect(removeTopics(d, [d.root.id])).toBe(d.root.id);
    expect(d.root.children.length).toBe(3);
  });

  it('moves a topic under another, before and after, never into itself', () => {
    const d = sample();
    expect(moveTopic(d, byText(d, 'A'), byText(d, 'A1'), 'child')).toBe(false);
    expect(moveTopic(d, byText(d, 'B1'), byText(d, 'A'), 'child')).toBe(true);
    expect(findTopic(d.root, byText(d, 'A'))!.topic.children.map(c => c.text)).toEqual(['A1', 'A2', 'B1']);
    expect(moveTopic(d, byText(d, 'C'), byText(d, 'A'), 'before')).toBe(true);
    expect(d.root.children.map(c => c.text)).toEqual(['C', 'A', 'B']);
    expect(moveTopic(d, byText(d, 'A2'), byText(d, 'B'), 'after')).toBe(true);
    expect(d.root.children.map(c => c.text)).toEqual(['C', 'A', 'B', 'A2']);
  });
});

describe('mind map layout', () => {
  it('right: children right of their parent, central topic at 0,0', () => {
    const d = sample();
    const p = layoutMindMap(d, sizes(d));
    const r = p.get(d.root.id)!;
    expect(r.x).toBe(0); expect(r.y).toBe(0);
    for (const c of d.root.children) expect(p.get(c.id)!.x).toBeGreaterThan(r.x + r.w);
    const a = p.get(byText(d, 'A'))!, a1 = p.get(byText(d, 'A1'))!;
    expect(a1.x).toBeGreaterThan(a.x + a.w);
    // Siblings stack without overlapping.
    const ys = d.root.children.map(c => p.get(c.id)!);
    for (let i = 1; i < ys.length; i++) expect(ys[i].y).toBeGreaterThanOrEqual(ys[i - 1].y + ys[i - 1].h);
  });

  it('both: branches split over the two sides', () => {
    const d = sample();
    d.layout = 'both';
    const sides = sidesOf(d);
    expect([...sides.values()].filter(s => s === 'left').length).toBe(1);
    const p = layoutMindMap(d, sizes(d));
    const left = d.root.children.find(c => sides.get(c.id) === 'left')!;
    expect(p.get(left.id)!.x + p.get(left.id)!.w).toBeLessThan(0);
  });

  it('down: children below the parent', () => {
    const d = sample();
    d.layout = 'down';
    const p = layoutMindMap(d, sizes(d));
    const r = p.get(d.root.id)!;
    for (const c of d.root.children) expect(p.get(c.id)!.y).toBeGreaterThan(r.y + r.h);
  });

  it('collapsed topics hide their children', () => {
    const d = sample();
    findTopic(d.root, byText(d, 'A'))!.topic.collapsed = true;
    const p = layoutMindMap(d, sizes(d));
    expect(p.has(byText(d, 'A1'))).toBe(false);
    expect(p.has(byText(d, 'A'))).toBe(true);
  });

  it('aligned siblings share a column per level', () => {
    const d = sample();
    d.align = true;
    const p = layoutMindMap(d, sizes(d));
    const xs = [byText(d, 'A1'), byText(d, 'B1')].map(id => p.get(id)!.x);
    expect(xs[0]).toBe(xs[1]);
  });

  it('timeline and outline place everything without overlaps', () => {
    for (const layout of ['timeline', 'list'] as const) {
      const d = sample();
      d.layout = layout;
      const p = layoutMindMap(d, sizes(d));
      expect(p.size).toBe(7);
      const list = [...p.values()];
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
      expect(boundsOf(p).w).toBeGreaterThan(0);
    }
  });
});

describe('mind map styles', () => {
  it('rainbow branches inherit their colour; map-wide colour overrides', () => {
    const d = sample();
    let s = resolveStyles(d);
    const ca = s.get(byText(d, 'A'))!.branchColor, cb = s.get(byText(d, 'B'))!.branchColor;
    expect(ca).not.toBe(cb);
    expect(s.get(byText(d, 'A1'))!.branchColor).toBe(ca);
    d.branchColor = '#123456';
    s = resolveStyles(d);
    expect(s.get(byText(d, 'B1'))!.branchColor).toBe('#123456');
  });

  it('a branch line style applies to that branch and below', () => {
    const d = sample();
    findTopic(d.root, byText(d, 'A'))!.topic.line = 'elbow';
    const s = resolveStyles(d);
    expect(s.get(byText(d, 'A'))!.line).toBe('elbow');
    expect(s.get(byText(d, 'A1'))!.line).toBe('elbow');
    expect(s.get(byText(d, 'B'))!.line).toBe('curve');
  });

  it('dark fills get light text', () => {
    const d = sample();
    findTopic(d.root, byText(d, 'A'))!.topic.style = { fill: '#111111' };
    expect(resolveStyles(d).get(byText(d, 'A'))!.text).toBe('#ffffff');
  });
});

describe('mind map markdown', () => {
  it('round-trips a nested list', () => {
    const d = sample();
    const md = toMarkdown(d.root);
    expect(md).toBe('- Root\n  - A\n    - A1\n    - A2\n  - B\n    - B1\n  - C');
    const back = fromMarkdown(md)!;
    expect(toMarkdown(back)).toBe(md);
  });

  it('builds a map from text when the data is missing', () => {
    const d = normalizeData(undefined, '- Plan\n  - Shoot\n  - Edit');
    expect(d.root.text).toBe('Plan');
    expect(d.root.children.map(c => c.text)).toEqual(['Shoot', 'Edit']);
    expect(d.layout).toBe('right');
  });
});
