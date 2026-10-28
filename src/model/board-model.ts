import { type CanvasFile, type RawEdge, type RawNode, newId } from './canvas-file';

export interface Rect { x: number; y: number; width: number; height: number; }

export type ChangeKind = 'nodes' | 'edges' | 'all';
export interface ChangeEvent {
  kind: ChangeKind;
  /** Ids of nodes/edges whose data changed; empty with kind 'all'. */
  ids: string[];
  /** True when the change came from undo/redo or a file reload. */
  reset?: boolean;
  /** True while a gesture is still running (not yet an undo step, not saved). */
  preview?: boolean;
}

interface Snapshot { nodes: string; edges: string; extra: string; }

const HISTORY_LIMIT = 200;

/**
 * The board's data plus its undo history. Nodes are kept in paint order:
 * the last node is drawn on top. All mutations go through `transact`, which
 * records one undo step and notifies listeners once.
 */
export class BoardModel {
  nodes: RawNode[] = [];
  edges: RawEdge[] = [];
  /** Top-level keys other than nodes/edges, kept as-is. */
  extra: Record<string, unknown> = {};

  private byId = new Map<string, RawNode>();
  private edgeById = new Map<string, RawEdge>();
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private listeners = new Set<(e: ChangeEvent) => void>();
  private txDepth = 0;
  private txChanged = new Set<string>();
  private txEdges = false;
  private txBefore: Snapshot | null = null;
  private txMerge: string | null = null;
  private txQuiet = false;
  private normalizers: ((changed: Set<string>) => void)[] = [];
  private normalizing = false;

  /**
   * Run after every change, inside the same undo step: layouts that follow
   * from other changes (a column stacking the cards dropped into it).
   */
  addNormalizer(fn: (changed: Set<string>) => void): () => void {
    this.normalizers.push(fn);
    return () => { this.normalizers = this.normalizers.filter(f => f !== fn); };
  }
  private lastMergeKey: string | null = null;
  private lastMergeAt = 0;

  load(file: CanvasFile, keepHistory = false): void {
    const { nodes, edges, ...extra } = file;
    this.nodes = nodes;
    this.edges = edges;
    this.extra = extra;
    this.reindex();
    if (!keepHistory) { this.undoStack = []; this.redoStack = []; }
    this.emit({ kind: 'all', ids: [], reset: true });
  }

  toFile(): CanvasFile {
    return { ...this.extra, nodes: this.nodes, edges: this.edges };
  }

  onChange(fn: (e: ChangeEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  node(id: string): RawNode | undefined { return this.byId.get(id); }
  edge(id: string): RawEdge | undefined { return this.edgeById.get(id); }

  /**
   * Run `fn` as one undoable step. `mergeKey` lets rapid repeats of the same
   * action (typing, nudging with arrow keys) collapse into a single step.
   */
  transact<T>(fn: () => T, mergeKey?: string): T {
    if (this.txDepth === 0) {
      this.txBefore = this.snapshot();
      this.txChanged.clear();
      this.txEdges = false;
      this.txMerge = mergeKey ?? null;
    }
    this.txDepth++;
    try {
      return fn();
    } finally {
      this.txDepth--;
      if (this.txDepth === 0) this.commit();
    }
  }

  /**
   * A change made by the plugin itself (a fetched link preview): saved, but
   * not an undo step of its own.
   */
  quiet<T>(fn: () => T): T {
    if (this.txDepth > 0) return fn();
    this.txQuiet = true;
    try { return this.transact(fn); } finally { this.txQuiet = false; }
  }

  /**
   * A long interaction (drag, resize) that mutates nodes in place over many
   * pointer moves and becomes ONE undo step when it ends. Call `preview` to
   * redraw while it runs; `cancel` puts everything back.
   */
  beginGesture(): { preview: (ids: string[], edges?: boolean) => void; end: () => void; cancel: () => void } {
    if (this.txDepth === 0) {
      this.txBefore = this.snapshot();
      this.txChanged.clear();
      this.txEdges = false;
      this.txMerge = null;
    }
    this.txDepth++;
    let done = false;
    return {
      preview: (ids, edges) => {
        for (const id of ids) this.txChanged.add(id);
        if (edges) this.txEdges = true;
        this.emit({ kind: 'nodes', ids, preview: true });
      },
      end: () => {
        if (done) return; done = true;
        this.txDepth--;
        if (this.txDepth === 0) this.commit();
      },
      cancel: () => {
        if (done) return; done = true;
        this.txDepth--;
        const before = this.txBefore;
        this.txBefore = null;
        if (before && this.txDepth === 0) this.restore(before);
      },
    };
  }

  get inTransaction(): boolean { return this.txDepth > 0; }

  /** Mark a node as changed inside a transaction (after mutating it in place). */
  touch(id: string): void {
    this.assertTx();
    this.txChanged.add(id);
  }

  touchEdges(): void {
    this.assertTx();
    this.txEdges = true;
  }

  addNode(partial: Partial<RawNode> & Pick<RawNode, 'type' | 'x' | 'y' | 'width' | 'height'>): RawNode {
    this.assertTx();
    const node = { ...partial, id: partial.id && !this.byId.has(partial.id) ? partial.id : newId() } as RawNode;
    if (node.type === 'group') {
      // Groups paint underneath: insert after the last group.
      let i = 0;
      while (i < this.nodes.length && this.nodes[i].type === 'group') i++;
      this.nodes.splice(i, 0, node);
    } else {
      this.nodes.push(node);
    }
    this.byId.set(node.id, node);
    this.txChanged.add(node.id);
    return node;
  }

  removeNodes(ids: Iterable<string>): void {
    this.assertTx();
    const drop = new Set(ids);
    if (!drop.size) return;
    this.nodes = this.nodes.filter(n => !drop.has(n.id));
    for (const id of drop) { this.byId.delete(id); this.txChanged.add(id); }
    const before = this.edges.length;
    this.edges = this.edges.filter(e => !drop.has(e.fromNode) && !drop.has(e.toNode));
    if (this.edges.length !== before) { this.reindexEdges(); this.txEdges = true; }
  }

  addEdge(partial: Omit<RawEdge, 'id'> & { id?: string }): RawEdge {
    this.assertTx();
    const edge = { ...partial, id: partial.id && !this.edgeById.has(partial.id) ? partial.id : newId() } as RawEdge;
    this.edges.push(edge);
    this.edgeById.set(edge.id, edge);
    this.txEdges = true;
    return edge;
  }

  removeEdges(ids: Iterable<string>): void {
    this.assertTx();
    const drop = new Set(ids);
    if (!drop.size) return;
    this.edges = this.edges.filter(e => !drop.has(e.id));
    this.reindexEdges();
    this.txEdges = true;
  }

  /** Move nodes to the top (end) or bottom (start) of the paint order; groups stay under cards. */
  reorder(ids: string[], where: 'front' | 'back'): void {
    this.assertTx();
    const set = new Set(ids);
    const moving = this.nodes.filter(n => set.has(n.id));
    const rest = this.nodes.filter(n => !set.has(n.id));
    const groups = (arr: RawNode[]) => arr.filter(n => n.type === 'group');
    const cards = (arr: RawNode[]) => arr.filter(n => n.type !== 'group');
    this.nodes = where === 'front'
      ? [...groups(rest), ...groups(moving), ...cards(rest), ...cards(moving)]
      : [...groups(moving), ...groups(rest), ...cards(moving), ...cards(rest)];
    for (const id of ids) this.txChanged.add(id);
    this.txChanged.add('__order__');
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
    this.lastMergeKey = null;
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.snapshot());
    this.restore(next);
    this.lastMergeKey = null;
    return true;
  }

  /** Stop the next transaction from merging into the previous one. */
  breakMerge(): void { this.lastMergeKey = null; }

  // ── internals ─────────────────────────────────────────────

  private assertTx(): void {
    if (this.txDepth === 0) throw new Error('BoardModel: mutation outside transact()');
  }

  private commit(): void {
    const before = this.txBefore;
    this.txBefore = null;
    if (!before) return;
    if (!this.txChanged.size && !this.txEdges) return;
    if (this.normalizers.length && !this.normalizing) {
      this.normalizing = true;
      this.txDepth++;
      try { for (const fn of this.normalizers) fn(new Set(this.txChanged)); }
      catch (err) { console.error('Direct Canvas: layout failed', err); }
      finally { this.txDepth--; this.normalizing = false; }
    }
    const now = Date.now();
    // Keys starting with '!' merge regardless of time (a new card and its first edit).
    const merge = this.txQuiet || (!!this.txMerge && this.txMerge === this.lastMergeKey && (this.txMerge.startsWith('!') || now - this.lastMergeAt < 1500));
    if (!merge) {
      this.undoStack.push(before);
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    }
    // A quiet change is not an undo step of its own and leaves merging and redo alone.
    if (!this.txQuiet) {
      this.redoStack = [];
      this.lastMergeKey = this.txMerge;
      this.lastMergeAt = now;
    }
    const ids = [...this.txChanged].filter(id => id !== '__order__');
    if (this.txChanged.has('__order__')) this.emit({ kind: 'all', ids: [] });
    else {
      if (ids.length) this.emit({ kind: 'nodes', ids });
      if (this.txEdges) this.emit({ kind: 'edges', ids: [] });
    }
  }

  private snapshot(): Snapshot {
    return { nodes: JSON.stringify(this.nodes), edges: JSON.stringify(this.edges), extra: JSON.stringify(this.extra) };
  }

  private restore(s: Snapshot): void {
    this.nodes = JSON.parse(s.nodes) as RawNode[];
    this.edges = JSON.parse(s.edges) as RawEdge[];
    this.extra = JSON.parse(s.extra) as Record<string, unknown>;
    this.reindex();
    this.emit({ kind: 'all', ids: [], reset: true });
  }

  private reindex(): void {
    this.byId = new Map(this.nodes.map(n => [n.id, n]));
    this.reindexEdges();
  }

  private reindexEdges(): void {
    this.edgeById = new Map(this.edges.map(e => [e.id, e]));
  }

  private emit(e: ChangeEvent): void {
    for (const fn of this.listeners) fn(e);
  }
}

export function nodeRect(n: RawNode): Rect {
  return { x: n.x, y: n.y, width: n.width, height: n.height };
}

export function unionRect(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width); y1 = Math.max(y1, r.y + r.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
