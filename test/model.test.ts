import { describe, it, expect } from 'vitest';
import { parseCanvas, serializeCanvas } from '../src/model/canvas-file';
import { BoardModel } from '../src/model/board-model';
import { gridLayers } from '../src/board/viewport';
import { autoSides, edgeShape } from '../src/board/edge-geometry';

describe('canvas file', () => {
  it('keeps unknown keys on file, nodes and edges', () => {
    const src = JSON.stringify({ nodes: [{ id: 'a', type: 'text', text: 'x', x: 1, y: 2, width: 3, height: 4, styleAttributes: { shape: 'pill' }, vc: { kind: 'text' } }], edges: [], metadata: { v: 1 } });
    const back = JSON.parse(serializeCanvas(parseCanvas(src)));
    expect(back.metadata).toEqual({ v: 1 });
    expect(back.nodes[0].styleAttributes).toEqual({ shape: 'pill' });
    expect(back.nodes[0].vc).toEqual({ kind: 'text' });
  });
  it('drops edges pointing at missing nodes and duplicate ids', () => {
    const src = JSON.stringify({ nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 1, height: 1 }, { id: 'a', type: 'text', x: 0, y: 0, width: 1, height: 1 }], edges: [{ id: 'e', fromNode: 'a', toNode: 'zz' }] });
    const c = parseCanvas(src);
    expect(c.nodes).toHaveLength(1);
    expect(c.edges).toHaveLength(0);
  });
  it('writes one node per line like Obsidian', () => {
    const out = serializeCanvas(parseCanvas('{"nodes":[{"id":"a","type":"text","text":"hi","x":0,"y":0,"width":10,"height":10}],"edges":[]}'));
    expect(out.split('\n')[2].startsWith('\t\t{"id":"a"')).toBe(true);
  });
  it('empty text gives an empty board', () => {
    expect(parseCanvas('')).toEqual({ nodes: [], edges: [] });
  });
});

describe('board model', () => {
  const make = () => {
    const m = new BoardModel();
    m.load(parseCanvas('{"nodes":[{"id":"a","type":"text","text":"a","x":0,"y":0,"width":10,"height":10}],"edges":[]}'));
    return m;
  };
  it('undo and redo a transaction', () => {
    const m = make();
    m.transact(() => { m.node('a')!.x = 50; m.touch('a'); });
    expect(m.node('a')!.x).toBe(50);
    m.undo();
    expect(m.node('a')!.x).toBe(0);
    m.redo();
    expect(m.node('a')!.x).toBe(50);
  });
  it('a gesture is one undo step', () => {
    const m = make();
    const g = m.beginGesture();
    for (let i = 1; i <= 5; i++) { m.node('a')!.x = i * 10; g.preview(['a']); }
    g.end();
    m.undo();
    expect(m.node('a')!.x).toBe(0);
    expect(m.canUndo()).toBe(false);
  });
  it('merges repeated keyed steps', () => {
    const m = make();
    m.transact(() => { m.node('a')!.x += 1; m.touch('a'); }, 'nudge');
    m.transact(() => { m.node('a')!.x += 1; m.touch('a'); }, 'nudge');
    m.undo();
    expect(m.node('a')!.x).toBe(0);
  });
  it('removing a node removes its edges', () => {
    const m = make();
    m.transact(() => { const b = m.addNode({ type: 'text', x: 0, y: 0, width: 1, height: 1 }); m.addEdge({ fromNode: 'a', toNode: b.id }); });
    expect(m.edges).toHaveLength(1);
    m.transact(() => m.removeNodes(['a']));
    expect(m.edges).toHaveLength(0);
  });
  it('groups stay under cards when reordered', () => {
    const m = make();
    m.transact(() => { m.addNode({ id: 'g', type: 'group', x: 0, y: 0, width: 1, height: 1 }); });
    expect(m.nodes[0].id).toBe('g');
    m.transact(() => m.reorder(['g'], 'front'));
    expect(m.nodes[0].id).toBe('g');
  });
  it('mutation outside a transaction throws', () => {
    const m = make();
    expect(() => m.addNode({ type: 'text', x: 0, y: 0, width: 1, height: 1 })).toThrow();
  });
});

describe('dot grid', () => {
  it('keeps spacing between 18 and 36 px at any zoom', () => {
    for (const z of [0.05, 0.1, 0.33, 0.5, 1, 1.7, 3, 8]) {
      const { fine, coarse } = gridLayers(20, z);
      expect(fine).toBeGreaterThanOrEqual(18);
      expect(fine).toBeLessThan(36);
      expect(coarse).toBeCloseTo(fine * 2);
    }
  });
});

describe('edges', () => {
  it('auto sides face each other', () => {
    expect(autoSides({ x: 0, y: 0, width: 10, height: 10 }, { x: 100, y: 0, width: 10, height: 10 })).toEqual(['right', 'left']);
    expect(autoSides({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 100, width: 10, height: 10 })).toEqual(['bottom', 'top']);
  });
  it('curve starts and ends on the sides', () => {
    const s = edgeShape({ x: 0, y: 0, width: 100, height: 50 }, 'right', { x: 300, y: 0, width: 100, height: 50 }, 'left');
    expect(s.start).toEqual({ x: 100, y: 25 });
    expect(s.end).toEqual({ x: 300, y: 25 });
  });
});
