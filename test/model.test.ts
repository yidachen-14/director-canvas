import { describe, it, expect } from 'vitest';
import { parseCanvas, serializeCanvas, type RawEdge, type RawNode } from '../src/model/canvas-file';
import { BoardModel } from '../src/model/board-model';
import { gridLayers } from '../src/board/viewport';
import { edgeGeometry, pinOnOutline, pinPoint, pinTs, reverseEdge, settleSidesForSave } from '../src/board/connections';

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
  it('a new card dropped while empty leaves no undo step', () => {
    const m = make();
    m.transact(() => { m.node('a')!.x = 50; m.touch('a'); });
    m.transact(() => m.addNode({ id: 'n', type: 'text', x: 0, y: 0, width: 1, height: 1 }), '!create:n');
    m.transact(() => m.removeNodes(['n']), '!create:n');
    // The one undo left is the earlier move, not a step that changes nothing.
    m.undo();
    expect(m.node('a')!.x).toBe(0);
    expect(m.canUndo()).toBe(false);
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

describe('connections', () => {
  const nodes: RawNode[] = [
    { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 50 },
    { id: 'b', type: 'text', x: 300, y: 0, width: 100, height: 50 },
  ];
  const node = (id: string) => nodes.find(n => n.id === id);

  it('floating ends face each other', () => {
    const e: RawEdge = { id: 'e', fromNode: 'a', toNode: 'b', vc: { route: 'straight', fromFloat: true, toFloat: true } };
    const g = edgeGeometry(e, node)!;
    expect(g.start).toEqual({ x: 100, y: 25 });
    expect(g.end).toEqual({ x: 300, y: 25 });
    expect(g.s1).toBe('right');
    expect(g.s2).toBe('left');
  });

  it('pinned ends sit at their t along the side', () => {
    const e: RawEdge = { id: 'e', fromNode: 'a', fromSide: 'bottom', toNode: 'b', toSide: 'top', vc: { fromT: 0.25 } };
    const g = edgeGeometry(e, node)!;
    expect(g.start).toEqual({ x: 25, y: 50 });
    expect(g.end).toEqual({ x: 350, y: 0 });
  });

  it('core Canvas edges keep their sides and curve', () => {
    const e: RawEdge = { id: 'e', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left' };
    const g = edgeGeometry(e, node)!;
    expect(g.d.startsWith('M100,25 C')).toBe(true);
  });

  it('bend moves the middle sideways', () => {
    const e: RawEdge = { id: 'e', fromNode: 'a', toNode: 'b', vc: { route: 'straight', fromFloat: true, toFloat: true, bend: 40 } };
    const g = edgeGeometry(e, node)!;
    expect(g.mid.x).toBeCloseTo(200);
    expect(Math.abs(g.mid.y - 25)).toBeCloseTo(40);
  });

  it('free lines round-trip through vc.lines', () => {
    const file = { nodes, edges: [{ id: 'f', fromNode: '', toNode: 'b', vc: { from: { x: -50, y: -50 } } } as RawEdge] };
    const text = serializeCanvas(file);
    const raw = JSON.parse(text);
    expect(raw.edges).toEqual([]);
    expect(raw.vc.lines[0].id).toBe('f');
    const back = parseCanvas(text);
    expect(back.edges[0].fromNode).toBe('');
    expect(back.vc).toBeUndefined();
  });

  it('floating ends get a side when saved', () => {
    const e: RawEdge = { id: 'e', fromNode: 'a', toNode: 'b', vc: { fromFloat: true, toFloat: true } };
    const [out] = settleSidesForSave([e], nodes);
    expect(out.fromSide).toBe('right');
    expect(out.toSide).toBe('left');
  });

  it('pins include the middle of each side', () => {
    expect(pinTs(100, 1)).toContain(0.5);
    expect(pinTs(400, 1).length).toBeGreaterThan(1);
  });

  it('a pin can sit anywhere along an edge and keeps its share of it when resized', () => {
    const r = { x: 0, y: 0, width: 400, height: 200 };
    // 10px under the bottom edge, a quarter-ish of the way along: not a regular pin position.
    const pin = pinOnOutline(r, { x: 130, y: 210 }, 1, 14, 6)!;
    expect(pin.side).toBe('bottom');
    expect(pin.t).toBeCloseTo(0.325);
    // The card twice as wide: the point moves with it, still 32.5% along.
    expect(pinPoint({ ...r, width: 800 }, pin.side, pin.t)).toEqual({ x: 260, y: 200 });
  });

  it('reversing a connection swaps its arrowheads and leaves the line exactly where it is', () => {
    const nodes: RawNode[] = [
      { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 50 },
      { id: 'b', type: 'text', x: 300, y: 200, width: 100, height: 50 },
    ];
    const node = (id: string) => nodes.find(n => n.id === id);
    for (const route of ['straight', 'curve', 'elbow'] as const) {
      const e: RawEdge = { id: 'e', fromNode: 'a', toNode: 'b', toSide: 'top', vc: { route, fromFloat: true, bend: 20 } };
      const before = edgeGeometry(e, node)!;
      reverseEdge(e);
      const after = edgeGeometry(e, node)!;
      expect(after.full).toBe(before.full);
      expect([e.fromEnd, e.toEnd]).toEqual(['arrow', 'none']);
      expect(e.fromNode).toBe('a');
    }
  });

  it('a connection end on a mind map topic follows the topic, else the whole card', () => {
    const nodes: RawNode[] = [
      { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 50 },
      { id: 'm', type: 'text', x: 400, y: 0, width: 300, height: 300, vc: { kind: 'mindmap' } },
    ];
    const node = (id: string) => nodes.find(n => n.id === id);
    const e: RawEdge = { id: 'e', fromNode: 'a', fromSide: 'right', toNode: 'm', toSide: 'left', vc: { toTopic: 't1' } };
    const topic = { x: 500, y: 200, width: 60, height: 20 };
    const g = edgeGeometry(e, node, (n, t) => (n.id === 'm' && t === 't1' ? topic : null))!;
    expect(g.end.x).toBeLessThanOrEqual(500 + 1);
    expect(g.end.y).toBeCloseTo(210, 0);
    // Topic gone (deleted, or no card to ask): the end goes to the map card as before.
    const whole = edgeGeometry(e, node, () => null)!;
    expect(whole.end.y).toBeCloseTo(150, 0);
  });

  it('a pin near a regular position snaps to it, and none is offered away from the edge', () => {
    const r = { x: 0, y: 0, width: 400, height: 200 };
    expect(pinOnOutline(r, { x: 203, y: 195 }, 1, 14, 6)).toEqual({ side: 'bottom', t: 0.5 });
    expect(pinOnOutline(r, { x: 200, y: 100 }, 1, 14, 6)).toBeNull();
    expect(pinOnOutline(r, { x: 200, y: 230 }, 1, 14, 6)).toBeNull();
  });
});

describe('elbow routes', () => {
  const nodes: RawNode[] = [
    { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 50 },
    { id: 'b', type: 'text', x: 300, y: 200, width: 100, height: 50 },
  ];
  const node = (id: string) => nodes.find(n => n.id === id);
  it('Z shape between facing sides', () => {
    const g = edgeGeometry({ id: 'e', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left', vc: { route: 'elbow' } } as RawEdge, node)!;
    expect(g.mid.x).toBeCloseTo(200);
  });
  it('L shape into a top side', () => {
    const g = edgeGeometry({ id: 'e', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'top', vc: { route: 'elbow' } } as RawEdge, node)!;
    expect(g.mid).toEqual({ x: 350, y: 25 });
  });
});
