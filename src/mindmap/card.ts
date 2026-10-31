import type { Menu } from 'obsidian';
import type { RawNode } from '../model/canvas-file';
import type { Rect } from '../model/board-model';
import type { BarItem, CardContext, CardHandle, CardType, MapDrop } from '../cards/types';
import { commitNode } from '../cards/basic';
import { t } from '../i18n';
import {
  type DropMode, type MMData, type MMTopic, type Placed, type Resolved, type Size,
  addBoundary, addChild, addSibling, addSummary, anyTopic, boundsOf, braceDownPath, bracePath, branchDown, branchSideways,
  cloneData, cloneTopic, countTopics, extrasCovering, findIn, respanBoundary, extrasSupported, gapsFor, isInside, layoutExtras, layoutMindMap,
  dashesAround, movedTopics, moveTopics, newMindMap, normalizeData, pruneExtras, removeTopics, resolveStyles, siblingRange, SIZE_SCALE, summaryOfTopic,
  toMarkdown, type ExtrasLayout,
} from './model';
import { boundaryBarItems, mindMapBarItems, themeItem } from './panels';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Room around the topics for the fold buttons and selection rings. */
const PAD = 24;
const SIDES = ['right' as const, 'left' as const];

interface Geo { w: number; h: number; ox: number; oy: number; rw: number; rh: number }

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.appendChild(el);
  return el;
}

/** Border dash patterns for a line `w` wide: dotted, then dashes from short to long. */
const DASH: Record<string, (w: number) => number[]> = {
  solid: () => [],
  dotted: (w) => [0.1, 2 * w + 2],
  short: (w) => [1.5 * w + 1.5, 1.5 * w + 2],
  dashed: (w) => [3 * w + 2, 2 * w + 2],
  long: (w) => [5.5 * w + 3, 2.5 * w + 2],
  dashdot: (w) => [4 * w + 2, 2 * w + 2, 0.1, 2 * w + 2],
};


/** The mind map controller the bar panels talk to. */
export interface MindMapControl {
  mapData(): MMData;
  selected(): string[];
  rootSelected(): boolean;
  apply(fn: (d: MMData) => void): void;
  /** Show a change without storing it (live colour picking). */
  preview(fn: (d: MMData) => void): void;
  /** Whether the selected topics can get a summary or a boundary (siblings, not the central topic). */
  canWrap(): boolean;
  addSummary(): void;
  addBoundary(): void;
}

export class MindMapCard implements CardHandle, MindMapControl {
  private data: MMData;
  private cardEl: HTMLElement;
  private svgEl: SVGSVGElement;
  private layer: HTMLElement;
  private overlay: HTMLElement;
  /** Boundaries as frames you can click, resize and title (under the topics). */
  private bndLayer: HTMLElement;
  /** The selected boundary (instead of topics), if any. */
  private bndSel: string | null = null;
  private topicEls = new Map<string, HTMLElement>();
  private placed = new Map<string, Placed>();
  private extras: ExtrasLayout = { boundaries: [], braces: [] };
  private styles = new Map<string, Resolved>();
  private shift = { x: PAD, y: PAD };
  private sel = new Set<string>();
  private primary: string | null = null;
  private editingId: string | null = null;
  private replaceOnEdit = false;
  /**
   * The selected topic waits for typing: it is editable (caret and highlight hidden) and focused,
   * with its text selected, so an input method composes right inside it and the first keystroke
   * replaces the text, like Boardmix.
   */
  private armedId: string | null = null;
  private typingFromArmed = false;
  private committed: unknown = null;
  private offs: (() => void)[] = [];
  private pendingRender = 0;
  /** Topic sizes can change after the first measurement (styles or fonts arriving late). */
  private sizeWatch: ResizeObserver;
  private relayoutFrame = 0;
  private dragCleanup: (() => void) | null = null;
  private joinHint: HTMLElement | null = null;

  /**
   * The card as it is on the board now. `node` can be an older copy of it (undo and quiet resizes
   * replace or move the model's node without remounting), so positions are always read from here.
   */
  private get live(): RawNode { return this.ctx.board.model.node(this.node.id) ?? this.node; }

  constructor(private node: RawNode, private body: HTMLElement, private ctx: CardContext) {
    this.cardEl = body.parentElement ?? body;
    body.addClass('vc-mm');
    this.svgEl = svg('svg', { class: 'vc-mm-svg' }, body);
    this.bndLayer = body.createDiv('vc-mm-bnd-layer');
    this.layer = body.createDiv('vc-mm-layer');
    this.overlay = body.createDiv('vc-mm-overlay');
    this.data = normalizeData(node.vc?.mm, node.text ?? '');
    this.sizeWatch = new ResizeObserver(() => {
      window.cancelAnimationFrame(this.relayoutFrame);
      this.relayoutFrame = window.requestAnimationFrame(() => {
        if (!this.body.isConnected || !this.placed.size) return;
        const changed = [...this.topicEls].some(([id, el]) => { const p = this.placed.get(id); return !p || p.w !== el.offsetWidth || p.h !== el.offsetHeight; });
        if (!changed) return;
        this.layoutDom();
        this.fitQuietly();
      });
    });
    body.addEventListener('pointerdown', e => this.onPointerDown(e));
    // A click on a topic that is not being edited must not drop a text caret into it (the
    // topic waits with its whole text selected, so typing replaces it); focus is set by arm().
    body.addEventListener('mousedown', (e) => {
      const el = (e.target as HTMLElement).closest('.vc-mm-topic');
      if (el && !el.hasClass('is-editing')) e.preventDefault();
    });
    body.addEventListener('contextmenu', e => this.onContextMenu(e));
    this.offs.push(ctx.board.on('selection', () => this.onBoardSelection()));
    this.renderSoon();
  }

  // ── CardHandle ────────────────────────────────────────────

  update(n: RawNode): void {
    this.node = n;
    if (n.vc?.mm === this.committed && this.committed) { this.fitQuietly(); return; }
    this.data = normalizeData(n.vc?.mm, n.text ?? '');
    this.pruneSelection();
    this.renderSoon();
  }

  resized(n: RawNode): void {
    this.node = n;
    // The map decides its own size: put it back if something else changed it.
    window.setTimeout(() => this.fitQuietly(), 0);
  }

  destroy(): void {
    window.cancelAnimationFrame(this.pendingRender);
    window.cancelAnimationFrame(this.relayoutFrame);
    this.sizeWatch.disconnect();
    this.dragCleanup?.();
    for (const off of this.offs) off();
  }

  searchText(): string {
    const out: string[] = [];
    const walk = (tp: MMTopic) => { out.push(tp.text); tp.children.forEach(walk); };
    walk(this.data.root);
    for (const sm of this.data.summaries ?? []) out.push(sm.topic.text);
    return out.join('\n');
  }

  isEditing(): boolean { return !!this.editingId; }

  edit(at?: { clientX: number; clientY: number }): boolean {
    let id = at ? this.topicAtClient(at.clientX, at.clientY) : this.primary;
    if (!id) {
      if (at) return false;
      id = this.data.root.id;
    }
    return this.beginEdit(id, at ? at : null);
  }

  stopEditing(): void {
    const id = this.editingId;
    if (!id) return;
    const el = this.topicEls.get(id);
    this.editingId = null;
    if (!el) return;
    const text = (el.innerText ?? '').replace(/\n+$/, '').replace(/\u00a0/g, ' ');
    el.removeAttribute('contenteditable');
    el.removeClass('is-editing');
    const cur = anyTopic(this.data, id);
    if (cur && cur.text !== text) this.apply(d => { const g = anyTopic(d, id); if (g) g.text = text; });
    else this.renderNow();
  }

  onKey(e: KeyboardEvent): boolean {
    if (this.editingId) return false;
    if (this.bndSel) {
      if (e.key === 'Delete' || e.key === 'Backspace') { this.removeBoundary(this.bndSel); return true; }
      if (e.key === 'Escape') { this.selectBoundary(null); return true; }
      if (e.key === 'Enter' || e.key === 'F2') { this.editBoundaryLabel(this.bndSel); return true; }
      return true;
    }
    const key = e.key;
    if (!this.sel.size) {
      if (key === 'Tab' || key === 'Enter' || key === 'F2') { this.setSel([this.data.root.id]); return true; }
      return false;
    }
    const cur = this.primary ?? [...this.sel][0];
    const onSummary = !!summaryOfTopic(this.data, cur);
    if (key === 'Enter' && onSummary && !e.shiftKey) return true;
    if (key === 'Tab' && !e.shiftKey) { this.addChildTo(cur); return true; }
    if (key === 'Enter' && !e.shiftKey && !e.isComposing) { this.addSiblingTo(cur); return true; }
    if (key === 'F2') { this.ctx.board.startEditing(this.node.id); return true; }
    if (key === 'Escape') { this.setSel([]); return true; }
    if (key === 'Delete' || key === 'Backspace') {
      const ids = [...this.sel].filter(id => id !== this.data.root.id);
      if (!ids.length) return false; // the central topic: the whole map goes
      let next: string | null = null;
      this.apply(d => { next = removeTopics(d, ids); });
      this.setSel(next ? [next] : []);
      return true;
    }
    if (key.startsWith('Arrow')) {
      const next = this.neighbour(cur, key);
      if (next) this.setSel([next]);
      return true;
    }
    const armedHere = !!this.armedId && this.armedId === cur && this.body.ownerDocument.activeElement === this.topicEls.get(cur);
    if (key === ' ') {
      this.typingFromArmed = armedHere;
      this.replaceOnEdit = !armedHere;
      this.ctx.board.startEditing(this.node.id);
      this.body.ownerDocument.execCommand('insertText', false, ' ');
      return true;
    }
    // Typing starts editing the topic, the keystroke (or the input method) replacing its text.
    if ((key.length === 1 || key === 'Process' || e.keyCode === 229) && !e.ctrlKey && !e.metaKey) {
      this.typingFromArmed = armedHere;
      this.replaceOnEdit = !armedHere;
      this.ctx.board.startEditing(this.node.id);
      return false;
    }
    return false;
  }

  // ── connections to topics ────────────────────────────────

  topicRect(topic: string): Rect | null {
    // A topic folded away: the connection goes to the nearest one still showing above it.
    let id: string | undefined = topic;
    while (id && !this.placed.has(id)) id = findIn(this.data, id)?.parent?.id;
    const p = id ? this.placed.get(id) : undefined;
    if (!p) return null;
    const n = this.live;
    return { x: n.x + this.shift.x + p.x, y: n.y + this.shift.y + p.y, width: p.w, height: p.h };
  }

  topicAt(wx: number, wy: number, margin: number): string | null {
    const n = this.live;
    const x = wx - n.x - this.shift.x, y = wy - n.y - this.shift.y;
    let best: { id: string; d: number } | null = null;
    for (const [id, p] of this.placed) {
      const dx = Math.max(p.x - x, 0, x - (p.x + p.w)), dy = Math.max(p.y - y, 0, y - (p.y + p.h));
      const d = Math.hypot(dx, dy);
      if (d <= margin && (!best || d < best.d)) best = { id, d };
    }
    return best?.id ?? null;
  }

  // ── duplicate, copy ──────────────────────────────────────

  duplicateParts(): boolean {
    const ids = movedTopics(this.data, [...this.sel]).map(tp => tp.id);
    if (!ids.length) return false;
    const made: string[] = [];
    this.apply(d => {
      for (const id of ids) {
        const f = findIn(d, id);
        if (!f?.parent) continue;
        // The copy (with everything under it) goes right after the original, under the same parent.
        const copy = cloneTopic(f.topic, true);
        f.parent.children.splice(f.index + 1, 0, copy);
        made.push(copy.id);
      }
    });
    if (made.length) this.setSel(made);
    return made.length > 0;
  }

  copyParts(cut: boolean): RawNode[] | null {
    const topics = movedTopics(cloneData(this.data), [...this.sel]);
    if (!topics.length) return null;
    const n = this.live;
    const out: RawNode[] = [];
    for (const topic of topics) {
      const p = this.placed.get(topic.id);
      delete topic.side;
      const mm: MMData = { root: cloneTopic(topic, true), layout: this.data.layout, theme: this.data.theme, size: this.data.size, align: this.data.align, line: this.data.line, branchColor: this.data.branchColor };
      // Where the topic is now, so several pasted together keep their places around each other.
      out.push({
        id: '', type: 'text', text: toMarkdown(mm.root),
        x: n.x + this.shift.x + (p?.x ?? 0), y: n.y + this.shift.y + (p?.y ?? 0), width: (p?.w ?? 120) + 48, height: (p?.h ?? 40) + 48,
        vc: { kind: 'mindmap', mm },
      });
    }
    if (cut) {
      this.apply(d => { removeTopics(d, topics.map(tp => tp.id)); });
      this.setSel([]);
    }
    return out;
  }

  pasteParts(nodes: RawNode[]): boolean {
    const at = this.primary ?? [...this.sel][0];
    if (!at || summaryOfTopic(this.data, at) || !nodes.length || nodes.some(n => n.vc?.kind !== 'mindmap')) return false;
    // Each pasted map comes in whole (its central topic and everything under it), as children.
    const topics = nodes.map(n => cloneTopic(normalizeData(n.vc?.mm, n.text ?? '').root, true));
    this.apply(d => {
      const f = findIn(d, at);
      if (!f) return;
      f.topic.collapsed = false;
      for (const tp of topics) { delete tp.side; f.topic.children.push(tp); }
    });
    this.setSel(topics.map(tp => tp.id));
    return true;
  }

  // ── joining maps ─────────────────────────────────────────

  dropTargetAt(wx: number, wy: number): MapDrop | null {
    const x = wx - this.live.x - this.shift.x, y = wy - this.live.y - this.shift.y;
    const spot = this.dropAt(x, y, []);
    return spot ? { topic: spot.target, mode: spot.mode, side: spot.side } : null;
  }

  markDropTarget(spot: MapDrop | null): void {
    // Above the dragged map while it hovers, so the insertion mark shows.
    this.body.closest<HTMLElement>('.vc-node')?.toggleClass('is-join-target', !!spot);
    if (!spot) { this.joinHint?.remove(); this.joinHint = null; for (const el of this.topicEls.values()) el.removeClass('is-drop-target'); return; }
    if (!this.joinHint?.isConnected) this.joinHint = this.overlay.createDiv('vc-mm-drop');
    this.placeHint(this.joinHint, { target: spot.topic, mode: spot.mode, side: spot.side });
  }

  /**
   * Show where a dropped topic goes: a dashed slot beside the topic it joins, or one line
   * halfway between the two siblings it lands between.
   */
  private placeHint(hint: HTMLElement, drop: { target: string; mode: DropMode; side?: 'left' | 'right' }): void {
    for (const [tid, el] of this.topicEls) el.toggleClass('is-drop-target', drop.mode === 'child' && tid === drop.target);
    const p = this.placed.get(drop.target);
    if (!p) { hint.hide(); return; }
    const hs = hint.style;
    hint.show();
    hint.toggleClass('is-child', drop.mode === 'child');
    if (drop.mode === 'child') {
      const g = this.childSlot(p, drop.side);
      hs.transform = `translate(${g.x}px, ${g.y}px)`;
      hs.width = '60px'; hs.height = '22px';
      return;
    }
    const horizontal = this.data.layout === 'down' || (this.data.layout === 'timeline' && p.depth === 1);
    // The neighbour on the other side of the gap (same parent, same side of the root).
    const f = findIn(this.data, drop.target);
    let other: Placed | undefined;
    if (f?.parent) {
      const sibs = f.parent.children
        .map(c => ({ c, q: this.placed.get(c.id) }))
        .filter((o): o is { c: MMTopic; q: Placed } => !!o.q && o.q.side === p.side)
        .sort((u, v) => (horizontal ? u.q.x - v.q.x : u.q.y - v.q.y));
      const i = sibs.findIndex(o => o.c.id === drop.target);
      other = sibs[drop.mode === 'before' ? i - 1 : i + 1]?.q;
    }
    const sx = this.shift.x, sy = this.shift.y;
    if (horizontal) {
      const edge = drop.mode === 'before' ? p.x : p.x + p.w;
      const mid = other ? (drop.mode === 'before' ? (other.x + other.w + p.x) / 2 : (p.x + p.w + other.x) / 2) : edge + (drop.mode === 'before' ? -5 : 5);
      hs.transform = `translate(${mid - 1.5 + sx}px, ${p.y + sy}px)`;
      hs.width = '3px'; hs.height = `${p.h}px`;
    } else {
      const mid = other ? (drop.mode === 'before' ? (other.y + other.h + p.y) / 2 : (p.y + p.h + other.y) / 2) : (drop.mode === 'before' ? p.y - 5 : p.y + p.h + 5);
      const x0 = other ? Math.min(p.x, other.x) : p.x;
      const w = other ? Math.max(p.x + p.w, other.x + other.w) - x0 : p.w;
      hs.transform = `translate(${x0 + sx}px, ${mid - 1.5 + sy}px)`;
      hs.width = `${w}px`; hs.height = '3px';
    }
  }

  /** Top-left (overlay coordinates) of the slot a new subtopic of a placed topic takes. */
  private childSlot(p: Placed, side?: 'left' | 'right'): { x: number; y: number } {
    const x = p.x + this.shift.x, y = p.y + this.shift.y;
    const down = this.data.layout === 'down';
    const list = this.data.layout === 'list' || (this.data.layout === 'timeline' && p.depth >= 1);
    const left = !down && !list && (side === 'left' || (p.depth > 0 && p.side === 'left'));
    return {
      x: down ? x + p.w / 2 - 30 : list ? x + 24 : left ? x - 76 : x + p.w + 16,
      y: down ? y + p.h + 16 : list ? y + p.h + 6 : y + p.h / 2 - 11,
    };
  }

  /** Another map (a floating topic and what hangs under it) becomes a subtopic of `topicId`. */
  adoptMap(spot: MapDrop, mm: unknown, text: string): void {
    const other = normalizeData(mm, text);
    this.markDropTarget(null);
    this.apply(d => {
      const f = findIn(d, spot.topic);
      if (!f) return;
      const root = other.root;
      delete root.side;
      if (spot.mode !== 'child' && f.parent) {
        // Between siblings, like a topic moved inside the map.
        const at = f.parent.children.indexOf(f.topic);
        f.parent.children.splice(spot.mode === 'before' ? at : at + 1, 0, root);
        if (f.parent === d.root) root.side = f.topic.side;
      } else {
        f.topic.collapsed = false;
        if (f.topic === d.root && d.layout === 'both') {
          const right = d.root.children.filter(c => (c.side ?? 'right') === 'right').length;
          root.side = spot.side ?? (right <= d.root.children.length - right ? 'right' : 'left');
        } else if (f.topic === d.root && spot.side === 'left' && d.layout !== 'right') root.side = 'left';
        f.topic.children.push(root);
      }
      if (other.summaries?.length) d.summaries = [...(d.summaries ?? []), ...other.summaries];
      if (other.boundaries?.length) d.boundaries = [...(d.boundaries ?? []), ...other.boundaries];
    });
  }

  /** Another mind map's topic under a screen point (a topic dragged out of this map can join it). */
  private otherMapAt(clientX: number, clientY: number): { id: string; spot: MapDrop } | null {
    const b = this.ctx.board;
    const w = b.clientToWorld(clientX, clientY);
    for (let i = b.model.nodes.length - 1; i >= 0; i--) {
      const n = b.model.nodes[i];
      if (n.id === this.node.id || n.vc?.kind !== 'mindmap') continue;
      const spot = b.cards.get(n.id)?.handle.dropTargetAt?.(w.x, w.y);
      if (spot) return { id: n.id, spot };
    }
    return null;
  }

  // ── boundaries ───────────────────────────────────────────

  private drawBoundaries(): void {
    const layer = this.bndLayer;
    layer.empty();
    const sx = this.shift.x, sy = this.shift.y;
    const down = this.data.layout === 'down';
    for (const q of this.extras.boundaries) {
      const el = layer.createDiv({ cls: 'vc-mm-bnd', attr: { 'data-bid': q.id } });
      el.style.transform = `translate(${q.x + sx}px, ${q.y + sy}px)`;
      el.style.width = `${q.w}px`;
      el.style.height = `${q.h}px`;
      el.style.setProperty('--vc-bnd-color', this.boundaryColor(q.id, q.from));
      if (q.label) el.createDiv({ cls: 'vc-mm-bnd-label', text: q.label });
      for (const edge of ['start', 'end'] as const) {
        const h = el.createDiv({ cls: `vc-mm-bnd-handle is-${edge}${down ? ' is-x' : ''}`, attr: { 'data-edge': edge } });
        h.setAttr('aria-label', t('Drag to change what the boundary covers'));
      }
      el.addEventListener('dblclick', (ev) => { ev.stopPropagation(); ev.preventDefault(); this.editBoundaryLabel(q.id); });
    }
    this.paintBoundaries();
  }

  /** A boundary's frame colour: its own, or its run's branch colour. */
  private boundaryColor(id: string, from: string): string {
    return this.data.boundaries?.find(x => x.id === id)?.color ?? this.styles.get(from)?.branchColor ?? 'var(--text-muted)';
  }

  private paintBoundaries(): void {
    for (const el of Array.from(this.bndLayer.children) as HTMLElement[]) el.toggleClass('is-selected', el.dataset.bid === this.bndSel);
  }

  private selectBoundary(id: string | null): void {
    if (id) {
      if (this.editingId) this.ctx.board.stopEditing();
      if (this.armedId) { this.disarmEl(this.armedId); this.armedId = null; }
      this.sel.clear();
      this.primary = null;
      this.paintSelection();
      this.drawOverlay();
    }
    this.bndSel = id;
    this.paintBoundaries();
    this.ctx.board.notifySelection();
  }

  private removeBoundary(id: string): void {
    this.bndSel = null;
    this.apply(d => { d.boundaries = d.boundaries?.filter(b => b.id !== id); });
  }

  /** Type a title for the boundary on its tab (Enter to keep, Escape to cancel; empty removes it). */
  private editBoundaryLabel(id: string): void {
    const frame = this.bndLayer.querySelector<HTMLElement>(`.vc-mm-bnd[data-bid="${CSS.escape(id)}"]`);
    if (!frame) return;
    const cur = this.data.boundaries?.find(b => b.id === id)?.label ?? '';
    frame.querySelector('.vc-mm-bnd-label')?.remove();
    const input = frame.createEl('input', { type: 'text', cls: 'vc-mm-bnd-label is-input', attr: { placeholder: t('Boundary title') } });
    input.value = cur;
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      input.remove();
      if (save && v !== cur) this.apply(d => { const b = d.boundaries?.find(x => x.id === id); if (b) { if (v) b.label = v; else delete b.label; } });
      else this.renderNow();
      this.selectBoundary(id);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', e => e.stopPropagation());
    window.setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  /** Drag a boundary's top / bottom (or left / right) edge: it takes in the siblings it then covers. */
  private startBoundaryResize(_e: PointerEvent, id: string, edge: 'start' | 'end'): void {
    const q0 = this.extras.boundaries.find(b => b.id === id);
    const frame = this.bndLayer.querySelector<HTMLElement>(`.vc-mm-bnd[data-bid="${CSS.escape(id)}"]`);
    if (!q0 || !frame) return;
    const axis: 'x' | 'y' = this.data.layout === 'down' ? 'x' : 'y';
    const win = this.body.ownerDocument.defaultView ?? window;
    let lo = axis === 'y' ? q0.y : q0.x, hi = axis === 'y' ? q0.y + q0.h : q0.x + q0.w;
    const sx = this.shift.x, sy = this.shift.y;
    frame.addClass('is-resizing');
    const move = (ev: PointerEvent) => {
      const l = this.toLocal(ev.clientX, ev.clientY);
      const v = axis === 'y' ? l.y : l.x;
      if (edge === 'start') lo = Math.min(v, hi - 16); else hi = Math.max(v, lo + 16);
      if (axis === 'y') { frame.style.transform = `translate(${q0.x + sx}px, ${lo + sy}px)`; frame.style.height = `${hi - lo}px`; }
      else { frame.style.transform = `translate(${lo + sx}px, ${q0.y + sy}px)`; frame.style.width = `${hi - lo}px`; }
    };
    const up = () => {
      win.removeEventListener('pointermove', move, true);
      win.removeEventListener('pointerup', up, true);
      frame.removeClass('is-resizing');
      const placed = this.placed;
      let ok = false;
      this.apply(d => { ok = respanBoundary(d, id, placed, lo, hi, axis); });
      if (!ok) this.renderNow();
      this.selectBoundary(id);
    };
    win.addEventListener('pointermove', move, true);
    win.addEventListener('pointerup', up, true);
  }

  /** Only the topics (and their buttons) are the map; the room between them is board. */
  hitTest(wx: number, wy: number): boolean {
    const x = wx - this.live.x - this.shift.x, y = wy - this.live.y - this.shift.y;
    const m = 6;
    for (const p of this.placed.values()) {
      if (x >= p.x - m && x <= p.x + p.w + m && y >= p.y - m && y <= p.y + p.h + m) return true;
    }
    for (const q of this.extras.boundaries) {
      const top = q.label ? q.y - 24 : q.y;
      if (x >= q.x - m && x <= q.x + q.w + m && y >= top - m && y <= q.y + q.h + m) return true;
    }
    return false;
  }

  partsIn(r: { x: number; y: number; width: number; height: number }): { ids: string[]; all: boolean } {
    const ox = this.live.x + this.shift.x, oy = this.live.y + this.shift.y;
    const ids: string[] = [];
    for (const [id, p] of this.placed) {
      const x = p.x + ox, y = p.y + oy;
      if (x < r.x + r.width && x + p.w > r.x && y < r.y + r.height && y + p.h > r.y) ids.push(id);
    }
    return { ids, all: ids.length === this.placed.size };
  }

  selectParts(ids: string[]): void {
    const same = ids.length === this.sel.size && ids.every(id => this.sel.has(id));
    if (!same) this.setSel(ids);
  }

  barKey(): string { return `mm:${[...this.sel].join(',')}|${this.bndSel ?? ''}`; }
  barExclusive(): boolean { return this.sel.size > 0 || !!this.bndSel; }
  barAnchor(): { x: number; y: number; width: number; height: number } | null {
    const q = this.bndSel ? this.extras.boundaries.find(b => b.id === this.bndSel) : null;
    if (q) return { x: this.live.x + this.shift.x + q.x, y: this.live.y + this.shift.y + q.y - (q.label ? 24 : 0), width: q.w, height: q.h + (q.label ? 24 : 0) };
    if (!this.sel.size) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of this.sel) {
      const p = this.placed.get(id);
      if (!p) continue;
      const x = this.live.x + p.x + this.shift.x, y = this.live.y + p.y + this.shift.y;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + p.w); y1 = Math.max(y1, y + p.h);
    }
    return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
  }

  barAvoid(): { x: number; y: number; width: number; height: number }[] {
    // A selected boundary: the bar keeps clear of every topic. A selected topic's bar simply
    // sits above it (Boardmix), even over other topics.
    if (!this.bndSel) return [];
    const out: { x: number; y: number; width: number; height: number }[] = [];
    for (const q of this.extras.boundaries) {
      if (q.label && q.id !== this.bndSel) out.push({ x: this.live.x + this.shift.x + q.x, y: this.live.y + this.shift.y + q.y - 24, width: q.w, height: 24 });
    }
    for (const [id, p] of this.placed) {
      const x = this.live.x + p.x + this.shift.x, y = this.live.y + p.y + this.shift.y;
      // The selected topic's "+" buttons sit just outside it.
      const grow = id === this.primary ? 22 : 0;
      out.push({ x: x - grow, y, width: p.w + grow * 2, height: p.h + grow });
    }
    return out;
  }

  barItems(): BarItem[] {
    if (this.bndSel) {
      const id = this.bndSel;
      const b = this.data.boundaries?.find(x => x.id === id);
      // The title is edited by double-clicking it (or Enter), so the bar only styles the frame.
      return boundaryBarItems(this, id, this.boundaryColor(id, b?.from ?? ''), () => this.removeBoundary(id));
    }
    if (!this.sel.size) return [themeItem(this)];
    return mindMapBarItems(this);
  }

  menu(menu: Menu): void {
    if (!this.sel.size) return;
    const cur = this.primary ?? [...this.sel][0];
    if (summaryOfTopic(this.data, cur)) {
      menu.addItem(i => i.setTitle(t('Edit text')).setIcon('pencil').onClick(() => this.ctx.board.startEditing(this.node.id)));
      menu.addItem(i => i.setTitle(t('Remove summary')).setIcon('trash-2').onClick(() => this.removeSummaryTopic(cur)));
      return;
    }
    const f = findIn(this.data, cur);
    menu.addItem(i => i.setTitle(t('Add subtopic')).setIcon('corner-down-right').onClick(() => this.addChildTo(cur)));
    if (f?.parent) menu.addItem(i => i.setTitle(t('Add sibling topic')).setIcon('plus').onClick(() => this.addSiblingTo(cur)));
    menu.addItem(i => i.setTitle(t('Edit text')).setIcon('pencil').onClick(() => this.ctx.board.startEditing(this.node.id)));
    if (f?.topic.children.length) {
      menu.addItem(i => i.setTitle(f.topic.collapsed ? t('Expand') : t('Collapse')).setIcon(f.topic.collapsed ? 'chevrons-up-down' : 'chevrons-down-up').onClick(() => this.toggleFold(cur)));
    }
    if (this.canWrap()) {
      menu.addItem(i => i.setTitle(t('Add summary')).setIcon('vc-mm-summary').setSection('wrap').onClick(() => this.addSummary()));
      menu.addItem(i => i.setTitle(t('Add boundary')).setIcon('vc-mm-boundary').setSection('wrap').onClick(() => this.addBoundary()));
    }
    const around = extrasCovering(this.data, [...this.sel]);
    if (around.boundaries.length) {
      menu.addItem(i => i.setTitle(t('Remove boundary')).setIcon('x').setSection('wrap').onClick(() => {
        const ids = new Set(around.boundaries.map(b => b.id));
        this.apply(d => { d.boundaries = d.boundaries?.filter(b => !ids.has(b.id)); });
      }));
    }
    if (around.summaries.length) {
      menu.addItem(i => i.setTitle(t('Remove summary')).setIcon('x').setSection('wrap').onClick(() => {
        const ids = new Set(around.summaries.map(x => x.id));
        this.apply(d => { d.summaries = d.summaries?.filter(x => !ids.has(x.id)); });
      }));
    }
    if (f?.parent) menu.addItem(i => i.setTitle(t('Delete topic')).setIcon('trash-2').onClick(() => {
      let next: string | null = null;
      this.apply(d => { next = removeTopics(d, [...this.sel].filter(id => id !== this.data.root.id)); });
      this.setSel(next ? [next] : []);
    }));
  }

  // ── MindMapControl (bar panels) ───────────────────────────

  selected(): string[] { return [...this.sel]; }

  canWrap(): boolean {
    return this.sel.size > 0 && extrasSupported(this.data.layout) && !!siblingRange(this.data, [...this.sel]);
  }

  /** A summary of the selected sibling topics; its new topic is selected for typing. */
  addSummary(): void {
    if (!this.canWrap()) return;
    const ids = [...this.sel];
    let made: MMTopic | null = null;
    this.apply(d => { made = addSummary(d, ids, t('Summary')); });
    if (made) this.setSel([(made as MMTopic).id]);
  }

  addBoundary(): void {
    if (!this.canWrap()) return;
    const ids = [...this.sel];
    this.apply(d => { addBoundary(d, ids); });
  }

  private removeSummaryTopic(id: string): void {
    let next: string | null = null;
    this.apply(d => { next = removeTopics(d, [id]); });
    this.setSel(next ? [next] : []);
  }
  rootSelected(): boolean { return this.sel.has(this.data.root.id); }
  mapData(): MMData { return this.data; }

  preview(fn: (d: MMData) => void): void {
    const keep = this.data;
    const d = cloneData(keep);
    fn(d);
    this.data = d;
    try { this.renderNow(); } finally { this.data = keep; }
  }

  /** Change the map as one undo step; the card grows or shrinks around the central topic. */
  apply(fn: (d: MMData) => void): void {
    const d = cloneData(this.data);
    fn(d);
    pruneExtras(d);
    this.data = d;
    this.committed = d;
    this.pruneSelection();
    const geo = this.renderNow();
    commitNode(this.ctx, this.node.id, (n) => {
      n.vc = { ...(n.vc ?? {}), kind: 'mindmap', mm: d };
      n.text = toMarkdown(d.root);
      if (geo) this.fitInto(n, geo);
    });
    this.ctx.board.notifySelection();
  }

  // ── selection ─────────────────────────────────────────────

  private setSel(ids: string[]): void {
    if (this.bndSel) { this.bndSel = null; this.paintBoundaries(); }
    this.sel = new Set(ids);
    this.primary = ids[0] ?? null;
    if (ids.length && !this.isSole()) this.ctx.board.select([this.node.id]);
    this.paintSelection();
    this.drawOverlay();
    this.ctx.board.notifySelection();
    this.arm();
  }

  private isSole(): boolean {
    const s = this.ctx.board.selection;
    return s.size === 1 && s.has(this.node.id);
  }

  private onBoardSelection(): void {
    if (!this.isSole() && (this.sel.size || this.bndSel)) {
      if (this.editingId) this.ctx.board.stopEditing();
      this.sel.clear();
      this.primary = null;
      this.bndSel = null;
      this.paintSelection();
      this.paintBoundaries();
    }
    this.drawOverlay();
    this.arm();
  }

  /** Make the one selected topic wait for typing (see armedId). */
  private arm(): void {
    const b = this.ctx.board;
    const want = !this.editingId && this.sel.size === 1 && this.primary && this.isSole() && b.tool === 'select' && !b.editingId ? this.primary : null;
    if (this.armedId && this.armedId !== want) this.disarmEl(this.armedId);
    this.armedId = null;
    if (!want || !this.body.isConnected) return;
    const el = this.topicEls.get(want);
    if (!el) return;
    this.armedId = want;
    el.setAttr('contenteditable', 'plaintext-only');
    el.setAttr('data-vc-armed', '');
    const doc = el.ownerDocument;
    const active = doc.activeElement as HTMLElement | null;
    // Never pull focus out of a field the user is typing in (a hex code in a panel, a search box).
    if (active && active !== el && active.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]:not([data-vc-armed])')) return;
    if (active !== el) el.focus({ preventScroll: true });
    const range = doc.createRange();
    range.selectNodeContents(el);
    const sel = doc.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  private disarmEl(id: string): void {
    const el = this.topicEls.get(id);
    if (!el || el.hasClass('is-editing')) return;
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-vc-armed');
    if (el.ownerDocument.activeElement === el) this.ctx.board.root.focus({ preventScroll: true });
  }

  private pruneSelection(): void {
    for (const id of [...this.sel]) if (!anyTopic(this.data, id)) this.sel.delete(id);
    if (this.primary && !this.sel.has(this.primary)) this.primary = [...this.sel][0] ?? null;
  }

  private paintSelection(): void {
    for (const [id, el] of this.topicEls) el.toggleClass('is-selected', this.sel.has(id));
    this.cardEl.toggleClass('has-topic-sel', this.sel.size > 0);
  }

  // ── rendering ─────────────────────────────────────────────

  private renderSoon(): void {
    window.cancelAnimationFrame(this.pendingRender);
    if (this.body.isConnected) { this.renderNow(); this.fitQuietly(); return; }
    this.pendingRender = window.requestAnimationFrame(() => { this.renderNow(); this.fitQuietly(); });
  }

  private visibleTopics(): MMTopic[] {
    const out: MMTopic[] = [];
    const shown = new Set<string>();
    const walk = (tp: MMTopic) => { out.push(tp); shown.add(tp.id); if (!tp.collapsed) tp.children.forEach(walk); };
    walk(this.data.root);
    // Summary topics of runs that are showing.
    if (extrasSupported(this.data.layout)) {
      for (const sm of this.data.summaries ?? []) {
        const parent = findIn(this.data, sm.parent)?.topic;
        if (parent && shown.has(parent.id) && !parent.collapsed && shown.has(sm.from)) walk(sm.topic);
      }
    }
    return out;
  }

  private renderNow(): Geo | null {
    const d = this.data;
    this.styles = resolveStyles(d);
    const scale = SIZE_SCALE[d.size] ?? 1;
    const keep = new Set<string>();
    for (const tp of this.visibleTopics()) {
      keep.add(tp.id);
      let el = this.topicEls.get(tp.id);
      if (!el) {
        el = this.layer.createDiv({ cls: 'vc-mm-topic', attr: { 'data-tid': tp.id } });
        this.topicEls.set(tp.id, el);
        this.sizeWatch.observe(el);
        const tid = tp.id;
        el.addEventListener('input', () => { if (this.editingId === tid) this.layoutDom(); });
        el.addEventListener('keydown', e => this.onEditKey(e, tid));
        const typeIn = () => {
          if (this.armedId === tid && !this.editingId) { this.typingFromArmed = true; this.ctx.board.startEditing(this.node.id); }
        };
        // Input methods and dictation can write without a keystroke first.
        el.addEventListener('compositionstart', typeIn);
        el.addEventListener('beforeinput', typeIn);
        el.addEventListener('blur', () => { if (this.editingId === tid) window.setTimeout(() => { if (this.editingId === tid) this.ctx.board.stopEditing(); }, 0); });
      }
      const st = this.styles.get(tp.id)!;
      const s = el.style;
      s.fontSize = `${st.fontSize}px`;
      s.fontWeight = st.bold ? '600' : '';
      s.fontStyle = st.italic ? 'italic' : '';
      s.textDecoration = [st.underline ? 'underline' : '', st.strike ? 'line-through' : ''].filter(Boolean).join(' ');
      s.color = st.text;
      const pad = st.shape === 'underline'
        ? `${Math.round(3 * scale)}px ${Math.round(6 * scale)}px ${Math.round(5 * scale + st.borderWidth)}px`
        : st.depth === 0 ? `${Math.round(10 * scale)}px ${Math.round(20 * scale)}px` : `${Math.round(6 * scale)}px ${Math.round(14 * scale)}px`;
      s.padding = pad;
      s.maxWidth = `${Math.round((st.depth === 0 ? 320 : 260) * scale)}px`;
      el.toggleClass('is-root', st.depth === 0);
      if (this.editingId !== tp.id) el.textContent = tp.text;
      el.toggleClass('is-empty', !tp.text);
    }
    for (const [id, el] of this.topicEls) if (!keep.has(id)) { this.sizeWatch.unobserve(el); el.remove(); this.topicEls.delete(id); }
    this.paintSelection();
    if (!this.body.isConnected) return null;
    const geo = this.layoutDom();
    if (!this.editingId) this.arm();
    return geo;
  }

  /** Measure the topics, place them, and draw. */
  private layoutDom(): Geo {
    const d = this.data;
    const sizes = new Map<string, Size>();
    for (const [id, el] of this.topicEls) sizes.set(id, { w: el.offsetWidth, h: el.offsetHeight });
    this.placed = layoutMindMap(d, sizes);
    this.extras = layoutExtras(d, sizes, this.placed);
    const b = boundsOf(this.placed);
    // Boundaries and braces can reach past the topics.
    {
      let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
      for (const q of this.extras.boundaries) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y - (q.label ? 24 : 0)); x1 = Math.max(x1, q.x + q.w); y1 = Math.max(y1, q.y + q.h); }
      for (const q of this.extras.braces) {
        if (q.vertical) { x0 = Math.min(x0, q.at - 8); x1 = Math.max(x1, q.at + 8); }
        else { y1 = Math.max(y1, q.at + 8); }
      }
      b.x = x0; b.y = y0; b.w = x1 - x0; b.h = y1 - y0;
    }
    this.shift = { x: Math.round(PAD - b.x), y: Math.round(PAD - b.y) };
    for (const [id, p] of this.placed) {
      const el = this.topicEls.get(id);
      if (el) el.style.transform = `translate(${p.x + this.shift.x}px, ${p.y + this.shift.y}px)`;
    }
    const w = Math.ceil(b.w + PAD * 2), h = Math.ceil(b.h + PAD * 2);
    this.svgEl.setAttribute('width', String(w));
    this.svgEl.setAttribute('height', String(h));
    this.drawLines();
    // Connections attached to topics follow them.
    if (this.ctx.board.model.edges.some(e => (e.fromNode === this.node.id && e.vc?.fromTopic) || (e.toNode === this.node.id && e.vc?.toTopic))) {
      window.requestAnimationFrame(() => { this.ctx.board.renderEdges(); this.ctx.board.connections?.refreshHandles(); });
    }
    this.drawBoundaries();
    this.drawOverlay();
    const r = this.placed.get(d.root.id)!;
    return { w, h, ox: Math.round(r.x + this.shift.x + r.w / 2), oy: Math.round(r.y + this.shift.y + r.h / 2), rw: r.w, rh: r.h };
  }

  /** Where the central topic is now, kept still while the card changes size. */
  private fitInto(n: RawNode, geo: Geo): void {
    let ox = Number(n.vc?.ox), oy = Number(n.vc?.oy);
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) { ox = n.width / 2; oy = n.height / 2; }
    let cx = n.x + ox, cy = n.y + oy;
    // A new map: its central topic's top-left corner sits where the board was clicked.
    if (n.vc?.newAt) { cx = n.x + geo.rw / 2; cy = n.y + geo.rh / 2; }
    n.x = Math.round(cx - geo.ox);
    n.y = Math.round(cy - geo.oy);
    n.width = geo.w;
    n.height = geo.h;
    const vc: Record<string, unknown> = { ...(n.vc ?? {}), ox: geo.ox, oy: geo.oy };
    delete vc.newAt;
    n.vc = vc;
  }

  private fitQuietly(): void {
    // Not laid out (a board in a background tab): the topics measure 0, so wait until it shows.
    if (!this.body.isConnected || !this.body.getClientRects().length || this.editingId) return;
    const m = this.ctx.board.model;
    const n = m.node(this.node.id);
    if (!n || !this.placed.size) return;
    const geo = this.layoutDom();
    const ox = Number(n.vc?.ox), oy = Number(n.vc?.oy);
    if (n.width === geo.w && n.height === geo.h && ox === geo.ox && oy === geo.oy) return;
    m.quiet(() => { this.fitInto(n, geo); m.touch(n.id); });
  }

  private anchorY(p: Placed, st: Resolved): number {
    return st.shape === 'underline' && st.border ? p.y + p.h - st.borderWidth / 2 : p.y + p.h / 2;
  }

  private drawLines(): void {
    const d = this.data;
    const sv = this.svgEl;
    while (sv.firstChild) sv.removeChild(sv.firstChild);
    const frames = svg('g', { class: 'vc-mm-boundaries' }, sv);
    const lines = svg('g', { class: 'vc-mm-lines', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, sv);
    const shapes = svg('g', { class: 'vc-mm-shapes' }, sv);
    const g = gapsFor(d.size);
    const sx = this.shift.x, sy = this.shift.y;
    const P = (id: string): Placed | null => { const p = this.placed.get(id); return p ? { ...p, x: p.x + sx, y: p.y + sy } : null; };
    const S = (id: string) => this.styles.get(id)!;
    const stroke = (path: string, color: string, width: number) => svg('path', { d: path, stroke: color, 'stroke-width': width }, lines);

    const listLine = (p: Placed, c: Placed, cs: Resolved, style: string) => {
      const tx = c.x - g.indent * 0.55;
      const top = p.y + p.h;
      const cy = this.anchorY(c, cs);
      const r = Math.min(8, Math.abs(cy - top) / 2);
      let path: string;
      if (style === 'straight') path = `M${tx},${top} L${c.x},${cy}`;
      else if (style === 'elbow' || style === 'brace') path = `M${tx},${top} V${cy} H${c.x}`;
      else path = `M${tx},${top} V${cy - r} Q${tx},${cy} ${tx + r},${cy} H${c.x}`;
      stroke(path, cs.branchColor, cs.inWidth);
    };

    const walk = (tp: MMTopic, depth: number) => {
      const p = P(tp.id);
      if (!p || tp.collapsed) return;
      const ps = S(tp.id);
      const kids = tp.children.filter(c => this.placed.has(c.id));
      if (kids.length) {
        if (d.layout === 'down') {
          const a = { x: p.x + p.w / 2, y: p.y + p.h };
          for (const c of kids) {
            const cp = P(c.id)!, cs = S(c.id);
            stroke(branchDown(a, { x: cp.x + cp.w / 2, y: cp.y }, ps.line, a.y + g.level / 2), cs.branchColor, cs.inWidth);
          }
        } else if (d.layout === 'list' || (d.layout === 'timeline' && depth >= 1)) {
          for (const c of kids) listLine(p, P(c.id)!, S(c.id), ps.line);
        } else if (d.layout === 'timeline') {
          // The spine: central topic to the first step, then step to step at the steps' own line height.
          let prev: { x: number; y: number } = { x: p.x + p.w, y: this.anchorY(p, ps) };
          for (const c of kids) {
            const cp = P(c.id)!, cs = S(c.id);
            const b = { x: cp.x, y: this.anchorY(cp, cs) };
            stroke(Math.abs(prev.y - b.y) < 0.5 ? `M${prev.x},${b.y} H${b.x}` : branchSideways(prev, b, 'curve'), cs.branchColor, cs.inWidth);
            prev = { x: cp.x + cp.w, y: b.y };
          }
        } else {
          for (const side of SIDES) {
            const group = kids.filter(c => this.placed.get(c.id)!.side === side);
            if (!group.length) continue;
            const dir = side === 'right' ? 1 : -1;
            const a = { x: side === 'right' ? p.x + p.w : p.x, y: this.anchorY(p, ps) };
            const trunk = a.x + dir * g.h * 0.45;
            const ends = group.map(c => {
              const cp = P(c.id)!, cs = S(c.id);
              return { c, cs, b: { x: side === 'right' ? cp.x : cp.x + cp.w, y: this.anchorY(cp, cs) } };
            });
            if (ps.line === 'brace' && ends.length > 1) {
              const y0 = Math.min(...ends.map(e => e.b.y)), y1 = Math.max(...ends.map(e => e.b.y));
              const mid = Math.max(y0 + 6, Math.min(y1 - 6, a.y));
              const color = depth === 0 ? ps.branchColor : ps.branchColor;
              stroke(bracePath(trunk, y0, y1, mid, dir), color, ends[0].cs.inWidth);
              stroke(`M${a.x},${a.y} L${trunk - dir * 6},${mid}`, color, ends[0].cs.inWidth);
              for (const e of ends) stroke(`M${trunk + dir * 6},${e.b.y} H${e.b.x}`, e.cs.branchColor, e.cs.inWidth);
            } else {
              for (const e of ends) stroke(branchSideways(a, e.b, ps.line === 'brace' ? 'elbow' : ps.line, trunk), e.cs.branchColor, e.cs.inWidth);
            }
          }
        }
      }
      for (const c of kids) walk(c, depth + 1);
    };
    walk(d.root, 0);
    for (const sm of d.summaries ?? []) if (this.placed.has(sm.topic.id)) walk(sm.topic, 1);

    // Boundaries: a soft dashed frame in the run's branch colour, unless given a look of its own.
    for (const q of this.extras.boundaries) {
      const b = this.data.boundaries?.find(x => x.id === q.id);
      const c = this.boundaryColor(q.id, q.from);
      const w = b?.width ?? 1.5;
      const fill = b?.fill === 'none' ? 'none' : b?.fill ? `color-mix(in srgb, ${b.fill} 30%, transparent)` : `color-mix(in srgb, ${c} 7%, transparent)`;
      const r = Math.min(12, q.w / 2, q.h / 2);
      const dash = dashesAround(b?.dash ? DASH[b.dash]?.(w) ?? [] : [6, 4], 2 * (q.w + q.h) - (8 - 2 * Math.PI) * r);
      svg('rect', {
        x: q.x + sx, y: q.y + sy, width: q.w, height: q.h, rx: r,
        style: `fill:${fill};stroke:${c};stroke-width:${w}px`, 'stroke-dasharray': dash,
        'stroke-linecap': b?.dash === 'dotted' ? 'round' : 'butt',
      }, frames);
    }
    // Summaries: a brace beside the run, pointing at the summary topic.
    for (const q of this.extras.braces) {
      const cs = S(q.from);
      const color = cs?.branchColor ?? 'var(--text-muted)';
      const w = cs?.inWidth ?? 2;
      const path = q.vertical ? bracePath(q.at + sx, q.a + sy, q.b + sy, q.mid + sy, q.dir) : braceDownPath(q.at + sy, q.a + sx, q.b + sx, q.mid + sx);
      stroke(path, color, w);
    }

    // Topic shapes, over the lines.
    for (const [id] of this.placed) {
      const p = P(id)!, st = S(id);
      const bw = st.border ? st.borderWidth : 0;
      const pattern = DASH[st.borderDash]?.(bw) ?? [];
      if (st.shape === 'underline') {
        const dash = pattern.join(' ');
        if (st.fill !== 'none') svg('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: 4, style: `fill:${st.fill}` }, shapes);
        if (st.border) {
          const y = p.y + p.h - bw / 2;
          svg('path', { d: `M${p.x},${y} H${p.x + p.w}`, style: `stroke:${st.borderColor};stroke-width:${bw}px;fill:none`, 'stroke-dasharray': dash, 'stroke-linecap': st.borderDash === 'solid' ? 'butt' : 'round' }, shapes);
        }
        continue;
      }
      const rx = st.shape === 'rect' ? 0 : st.shape === 'rounded-sm' ? 4 : st.shape === 'rounded' ? 10 : (p.h - bw) / 2;
      const rw = Math.max(0, p.w - bw), rh = Math.max(0, p.h - bw), r = Math.min(Math.max(0, rx), rw / 2, rh / 2);
      // The outline's length: straight sides plus the quarter circles of the corners.
      const dash = dashesAround(pattern, 2 * (rw + rh) - (8 - 2 * Math.PI) * r);
      svg('rect', {
        x: p.x + bw / 2, y: p.y + bw / 2, width: Math.max(0, p.w - bw), height: Math.max(0, p.h - bw), rx: Math.max(0, rx),
        style: `fill:${st.fill === 'none' ? 'none' : st.fill};stroke:${st.border ? st.borderColor : 'none'};stroke-width:${bw}px`,
        'stroke-dasharray': dash, 'stroke-linecap': st.borderDash === 'dotted' || st.borderDash === 'dashdot' ? 'round' : 'butt',
      }, shapes);
    }
  }

  /** Fold buttons, add buttons, and nothing else. */
  private drawOverlay(): void {
    const ov = this.overlay;
    ov.empty();
    if (!this.placed.size) return;
    const d = this.data;
    const sx = this.shift.x, sy = this.shift.y;
    const sole = this.isSole();
    const btn = (cls: string, x: number, y: number, tid: string, text?: string) => {
      const b = ov.createDiv({ cls: `vc-mm-btn ${cls}`, attr: { 'data-tid': tid } });
      if (text !== undefined) b.setText(text);
      b.style.translate = `${Math.round(x - 8)}px ${Math.round(y - 8)}px`;
      return b;
    };
    const g = gapsFor(d.size);
    // How wide each folded topic's count badge came out ("+" buttons keep clear of it).
    const badgeW = new Map<string, number>();
    const walk = (tp: MMTopic, depth: number) => {
      const p0 = this.placed.get(tp.id);
      if (!p0) return;
      const p = { ...p0, x: p0.x + sx, y: p0.y + sy };
      const st = this.styles.get(tp.id)!;
      if (tp.children.length) {
        let fx: number, fy: number;
        if (d.layout === 'down') { fx = p.x + p.w / 2; fy = p.y + p.h + 10; }
        else if (d.layout === 'list' || (d.layout === 'timeline' && depth >= 1)) { fx = p.x + (depth === 0 ? Math.min(p.w / 2, g.indent * 1.5) : g.indent) - g.indent * 0.55; fy = p.y + p.h + 10; }
        else {
          const rightKids = depth > 0 ? p0.side === 'right' : tp.children.some(c => (this.placed.get(c.id)?.side ?? 'right') === 'right') || tp.collapsed;
          fx = rightKids ? p.x + p.w + 11 : p.x - 11;
          fy = this.anchorY(p, st);
        }
        const fold = btn(`vc-mm-fold${tp.collapsed ? ' is-collapsed' : ''}`, fx, fy, tp.id, tp.collapsed ? String(countTopics(tp)) : '−');
        fold.setAttr('aria-label', tp.collapsed ? t('Expand') : t('Collapse'));
        if (tp.collapsed) badgeW.set(tp.id, fold.offsetWidth);
      }
      if (!tp.collapsed) for (const c of tp.children) walk(c, depth + 1);
    };
    walk(d.root, 0);
    for (const sm of d.summaries ?? []) if (this.placed.has(sm.topic.id)) walk(sm.topic, 1);

    // "+" buttons around the one selected topic.
    if (!sole || this.sel.size !== 1 || this.editingId || !this.primary) return;
    const p0 = this.placed.get(this.primary);
    if (!p0) return;
    const p = { ...p0, x: p0.x + sx, y: p0.y + sy };
    if (summaryOfTopic(d, this.primary)) {
      // A summary's topic grows subtopics away from its run.
      const st = this.styles.get(this.primary)!;
      const hasK = !!summaryOfTopic(d, this.primary)!.topic.children.length;
      const o = hasK ? 30 : 12;
      if (d.layout === 'down') btn('vc-mm-add is-child', p.x + p.w / 2, p.y + p.h + o, this.primary);
      else btn('vc-mm-add is-child', p0.side === 'left' ? p.x - o : p.x + p.w + o, this.anchorY(p, st), this.primary);
      return;
    }
    const isRoot = this.primary === d.root.id;
    const hasKids = !!findIn(d, this.primary)?.topic.children.length;
    // Past the fold switch; past a folded topic's count badge, which grows with the number.
    const off = hasKids ? Math.max(30, (badgeW.get(this.primary) ?? 0) + 15) : 12;
    if (d.layout === 'down') {
      btn('vc-mm-add is-child', p.x + p.w / 2, p.y + p.h + off, this.primary);
      if (!isRoot) btn('vc-mm-add is-sibling', p.x + p.w + 12, p.y + p.h / 2, this.primary);
    } else if (d.layout === 'list' || (d.layout === 'timeline' && !isRoot && p0.depth >= 1)) {
      btn('vc-mm-add is-child', p.x + p.w + 12, p.y + p.h / 2, this.primary);
      if (!isRoot) btn(`vc-mm-add is-sibling`, p.x + 8, p.y + p.h + (hasKids ? 26 : 12), this.primary);
    } else if (d.layout === 'timeline') {
      btn('vc-mm-add is-child', p.x + p.w + off, p.y + p.h / 2, this.primary);
    } else {
      const right = isRoot || p0.side === 'right';
      btn('vc-mm-add is-child', right ? p.x + p.w + off : p.x - off, this.anchorY(p, this.styles.get(this.primary)!), this.primary);
      if (isRoot) btn('vc-mm-add is-child is-left', p.x - 12, p.y + p.h / 2, this.primary);
      else btn('vc-mm-add is-sibling', p.x + p.w / 2, p.y + p.h + 12, this.primary);
    }
  }

  // ── editing ───────────────────────────────────────────────

  private beginEdit(id: string, at: { clientX: number; clientY: number } | null): boolean {
    const el = this.topicEls.get(id);
    if (!el) return false;
    if (this.typingFromArmed && this.armedId === id) {
      // Already editable, focused and selected: just switch to editing, leaving the keystroke to land.
      this.typingFromArmed = false;
      this.armedId = null;
      this.editingId = id;
      el.removeAttribute('data-vc-armed');
      el.addClass('is-editing');
      this.drawOverlay();
      return true;
    }
    this.typingFromArmed = false;
    if (this.armedId) { this.disarmEl(this.armedId); this.armedId = null; }
    if (!this.sel.has(id) || this.sel.size !== 1) { this.sel = new Set([id]); this.primary = id; this.paintSelection(); }
    this.editingId = id;
    this.drawOverlay();
    el.setAttr('contenteditable', 'plaintext-only');
    el.addClass('is-editing');
    el.focus({ preventScroll: true });
    const range = document.createRange();
    const selection = window.getSelection();
    if (this.replaceOnEdit || !at) {
      range.selectNodeContents(el);
      if (!this.replaceOnEdit) { /* Enter / F2: select everything, like Boardmix */ }
    } else {
      const pos = document.caretRangeFromPoint?.(at.clientX, at.clientY);
      if (pos && el.contains(pos.startContainer)) { range.setStart(pos.startContainer, pos.startOffset); range.collapse(true); }
      else { range.selectNodeContents(el); range.collapse(false); }
    }
    this.replaceOnEdit = false;
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
  }

  private onEditKey(e: KeyboardEvent, id: string): void {
    if (this.editingId !== id) return;
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.ctx.board.stopEditing(); return; }
    if (e.key === 'Escape') { e.preventDefault(); this.ctx.board.stopEditing(); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      this.ctx.board.stopEditing();
      this.addChildTo(id);
    }
  }

  // ── tree edits ────────────────────────────────────────────

  private addChildTo(id: string, side?: 'left' | 'right'): void {
    let made: MMTopic | null = null;
    const f = findIn(this.data, id);
    const isRoot = !!f && f.topic === this.data.root;
    const text = isRoot ? t('Branch topic') : t('Subtopic');
    this.apply(d => {
      if (d.layout === 'both' && !side && isRoot) {
        // Two-sided: the new branch goes to the side with fewer.
        const right = d.root.children.filter((c, i) => (c.side ?? (i < Math.ceil(d.root.children.length / 2) ? 'right' : 'left')) === 'right').length;
        side = right <= d.root.children.length - right ? 'right' : 'left';
        for (const [i, c] of d.root.children.entries()) c.side = c.side ?? (i < Math.ceil(d.root.children.length / 2) ? 'right' : 'left');
      }
      made = addChild(d, id, text, side);
    });
    if (made) this.setSel([(made as MMTopic).id]);
  }

  private addSiblingTo(id: string): void {
    let made: MMTopic | null = null;
    const f = findIn(this.data, id);
    const text = f && f.depth === 1 ? t('Branch topic') : f && !f.parent ? t('Branch topic') : t('Subtopic');
    this.apply(d => { made = addSibling(d, id, text); });
    if (made) this.setSel([(made as MMTopic).id]);
  }

  private toggleFold(id: string): void {
    this.apply(d => { const f = findIn(d, id); if (f) f.topic.collapsed = !f.topic.collapsed; });
    // Selected topics hidden by folding: select the folded one.
    if ([...this.sel].some(s => !this.placed.has(s))) this.setSel([id]);
  }

  /**
   * Arrow keys follow the map: towards the children enters the first child,
   * the opposite way goes to the parent, across moves between topics of the same level.
   */
  private neighbour(id: string, key: string): string | null {
    const p = this.placed.get(id);
    const f = findIn(this.data, id);
    if (!p || !f) return null;
    const layout = this.data.layout;
    const OPP: Record<string, string> = { ArrowLeft: 'ArrowRight', ArrowRight: 'ArrowLeft', ArrowUp: 'ArrowDown', ArrowDown: 'ArrowUp' };
    const kids = f.topic.collapsed ? [] : f.topic.children.filter(c => this.placed.has(c.id));
    if (p.depth === 0 && (layout === 'right' || layout === 'both') && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      const side = key === 'ArrowRight' ? 'right' : 'left';
      const list = kids.filter(c => this.placed.get(c.id)!.side === side);
      return list[Math.floor((list.length - 1) / 2)]?.id ?? null;
    }
    const childKey = layout === 'down' ? 'ArrowDown'
      : layout === 'timeline' && p.depth >= 1 ? 'ArrowDown'
        : (layout === 'right' || layout === 'both') && p.side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    if (key === childKey) return kids[0]?.id ?? null;
    if (key === OPP[childKey] && f.parent) return f.parent.id;
    // Across: the nearest topic of the same level that way.
    const same = this.spatial(id, key, q => q.depth === p.depth);
    return same ?? this.spatial(id, key, () => true);
  }

  private spatial(id: string, key: string, ok: (p: Placed) => boolean): string | null {
    const p = this.placed.get(id);
    if (!p) return null;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    let best: string | null = null, score = Infinity;
    for (const [oid, q] of this.placed) {
      if (oid === id || !ok(q)) continue;
      const dx = q.x + q.w / 2 - cx, dy = q.y + q.h / 2 - cy;
      let along: number, across: number;
      if (key === 'ArrowRight') { along = dx; across = dy; }
      else if (key === 'ArrowLeft') { along = -dx; across = dy; }
      else if (key === 'ArrowDown') { along = dy; across = dx; }
      else { along = -dy; across = dx; }
      if (along <= 1) continue;
      const s = along + Math.abs(across) * 2.5;
      if (s < score) { score = s; best = oid; }
    }
    return best;
  }

  // ── pointer ───────────────────────────────────────────────

  private topicAtClient(clientX: number, clientY: number): string | null {
    for (const [id, el] of this.topicEls) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return id;
    }
    return null;
  }

  private onContextMenu(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.vc-mm-topic');
    if (!el?.dataset.tid) return;
    if (!this.sel.has(el.dataset.tid)) {
      if (!this.isSole()) this.ctx.board.select([this.node.id]);
      this.setSel([el.dataset.tid]);
    }
  }

  private onPointerDown(e: PointerEvent): void {
    const b = this.ctx.board;
    if (e.button !== 0 || b.tool !== 'select') return;
    const target = e.target as HTMLElement;
    if (this.editingId) {
      if (this.topicEls.get(this.editingId)?.contains(target)) { e.stopPropagation(); return; }
      b.stopEditing();
    }
    const btnEl = target.closest<HTMLElement>('.vc-mm-btn');
    if (btnEl?.dataset.tid) {
      e.stopPropagation();
      e.preventDefault();
      b.root.focus({ preventScroll: true });
      const id = btnEl.dataset.tid;
      if (!this.isSole()) b.select([this.node.id]);
      if (btnEl.hasClass('vc-mm-fold')) this.toggleFold(id);
      else if (btnEl.hasClass('is-sibling')) this.addSiblingTo(id);
      else this.addChildTo(id, btnEl.hasClass('is-left') ? 'left' : btnEl.hasClass('is-child') && id === this.data.root.id && this.data.layout !== 'down' ? 'right' : undefined);
      return;
    }
    const bndHandle = target.closest<HTMLElement>('.vc-mm-bnd-handle');
    const bndEl = target.closest<HTMLElement>('.vc-mm-bnd');
    if (bndEl?.dataset.bid) {
      e.stopPropagation();
      e.preventDefault();
      b.root.focus({ preventScroll: true });
      if (!this.isSole()) b.select([this.node.id]);
      if (this.bndSel !== bndEl.dataset.bid) this.selectBoundary(bndEl.dataset.bid);
      if (bndHandle?.dataset.edge) this.startBoundaryResize(e, bndEl.dataset.bid, bndHandle.dataset.edge as 'start' | 'end');
      return;
    }
    const topicEl = target.closest<HTMLElement>('.vc-mm-topic');
    const id = topicEl?.dataset.tid;
    if (!id) {
      if (this.bndSel) this.selectBoundary(null);
      // The map's empty area: the board selects and moves the whole map.
      if (this.sel.size) { this.sel.clear(); this.primary = null; this.paintSelection(); this.drawOverlay(); b.notifySelection(); }
      return;
    }
    if (e.shiftKey) {
      if (!this.isSole()) return; // adding the card itself to a board selection
      e.stopPropagation();
      b.root.focus({ preventScroll: true });
      const next = new Set(this.sel);
      if (next.has(id)) next.delete(id); else next.add(id);
      this.sel = next;
      this.primary = next.has(id) ? id : [...next][0] ?? null;
      this.paintSelection();
      this.drawOverlay();
      b.notifySelection();
      return;
    }
    // This map is one of several selected cards: pressing any of its topics drags them all,
    // like any other card (the board does that); a click without dragging then selects the map.
    if (b.selection.size > 1 && b.selection.has(this.node.id)) return;
    if (!this.isSole()) b.select([this.node.id]);
    if (!(this.sel.size > 1 && this.sel.has(id))) this.setSel([id]);
    if (summaryOfTopic(this.data, id)) { e.stopPropagation(); e.preventDefault(); return; } // stays beside its run
    // The central topic carries the whole map; other topics drag within it.
    if (id === this.data.root.id) {
      e.preventDefault(); // keep the waiting selection; the board still moves the map
      window.setTimeout(() => this.arm(), 0);
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    if (!this.armedId) b.root.focus({ preventScroll: true });
    this.startTopicDrag(e, id);
  }

  private toLocal(clientX: number, clientY: number): { x: number; y: number } {
    const w = this.ctx.board.clientToWorld(clientX, clientY);
    return { x: w.x - this.live.x - this.shift.x, y: w.y - this.live.y - this.shift.y };
  }

  private startTopicDrag(e: PointerEvent, id: string): void {
    const sx = e.clientX, sy = e.clientY;
    const doc = this.body.ownerDocument;
    const win = doc.defaultView ?? window;
    let dragging = false;
    let ghost: HTMLElement | null = null;
    let hint: HTMLElement | null = null;
    let drop: { target: string; mode: DropMode; side?: 'left' | 'right' } | null = null;
    let detach = false;
    let joinTarget: { id: string; spot: MapDrop } | null = null;
    const sameJoin = (u: { id: string; spot: MapDrop } | null, v: { id: string; spot: MapDrop } | null) =>
      !!u && !!v && u.id === v.id && u.spot.topic === v.spot.topic && u.spot.mode === v.spot.mode && u.spot.side === v.spot.side;
    let lastClient = { x: sx, y: sy };
    const dragged = findIn(this.data, id)?.topic;
    // Several topics selected and one of them grabbed: they all go together (within this map).
    const moving = this.sel.size > 1 && this.sel.has(id)
      ? [...this.sel].filter(x => x !== this.data.root.id && !summaryOfTopic(this.data, x))
      : [id];
    const srcEls = moving.map(x => this.topicEls.get(x)).filter((el): el is HTMLElement => !!el);
    const clearMarks = () => { for (const el of this.topicEls.values()) el.removeClass('is-drop-target'); };

    const move = (ev: PointerEvent) => {
      lastClient = { x: ev.clientX, y: ev.clientY };
      if (!dragging) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        dragging = true;
        for (const el of srcEls) el.addClass('is-dragging');
        const label = (dragged?.text || ' ') + (moving.length > 1 ? `  +${moving.length - 1}` : '');
        ghost = this.overlay.createDiv({ cls: 'vc-mm-ghost', text: label });
        hint = this.overlay.createDiv('vc-mm-drop');
        hint.hide();
      }
      const l = this.toLocal(ev.clientX, ev.clientY);
      ghost!.style.transform = `translate(${Math.round(l.x + this.shift.x + 8)}px, ${Math.round(l.y + this.shift.y + 8)}px)`;
      drop = this.dropAt(l.x, l.y, moving);
      clearMarks();
      // Away from the map: onto another map's topic (joins it), or onto the board (a topic of its own).
      detach = !drop && this.outsideMap(l.x, l.y);
      const join = detach ? this.otherMapAt(ev.clientX, ev.clientY) : null;
      if (joinTarget && joinTarget.id !== join?.id) this.ctx.board.cards.get(joinTarget.id)?.handle.markDropTarget?.(null);
      if (join && !sameJoin(join, joinTarget)) this.ctx.board.cards.get(join.id)?.handle.markDropTarget?.(join.spot);
      joinTarget = join;
      ghost!.toggleClass('is-detaching', detach && !join);
      if (!drop) { hint!.hide(); return; }
      this.placeHint(hint!, drop);
    };
    const finish = (commit: boolean) => {
      win.removeEventListener('pointermove', move, true);
      win.removeEventListener('pointerup', up, true);
      win.removeEventListener('keydown', key, true);
      this.dragCleanup = null;
      for (const el of srcEls) el.removeClass('is-dragging');
      clearMarks();
      ghost?.remove(); hint?.remove();
      if (commit && dragging && drop) {
        const dd = drop;
        this.apply(d => { moveTopics(d, moving, dd.target, dd.mode, dd.side); });
        this.setSel(moving);
      } else if (commit && dragging && detach && joinTarget) {
        this.moveToOtherMap(moving, joinTarget);
      } else if (commit && dragging && detach) {
        this.detachTopics(moving, id, lastClient);
      }
      if (joinTarget) this.ctx.board.cards.get(joinTarget.id)?.handle.markDropTarget?.(null);
      // The dragged topic's element may be gone now; keep the keys (⌘Z) on the board.
      if (commit && dragging && !this.ctx.board.root.contains(doc.activeElement)) this.ctx.board.root.focus({ preventScroll: true });
    };
    const up = () => finish(true);
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); } };
    win.addEventListener('pointermove', move, true);
    win.addEventListener('pointerup', up, true);
    win.addEventListener('keydown', key, true);
    this.dragCleanup = () => finish(false);
  }

  /** Whether a local point is clearly away from every topic of the map. */
  private outsideMap(x: number, y: number): boolean {
    const margin = 36;
    for (const p of this.placed.values()) {
      if (x > p.x - margin && x < p.x + p.w + margin && y > p.y - margin && y < p.y + p.h + margin) return false;
    }
    return true;
  }

  /**
   * Take topics (and everything under them) out of this map and put them on the board where they
   * were dropped, each as a mind map of its own with the same look, like a floating topic in
   * Boardmix. The grabbed topic lands at the drop point; the others keep their places around it.
   */
  private detachTopics(ids: string[], grabbed: string, at: { x: number; y: number }): void {
    const sub = cloneData(this.data);
    const topics = movedTopics(sub, ids);
    if (!topics.length) return;
    const b = this.ctx.board;
    const drop = b.clientToWorld(at.x, at.y);
    // Read where they sit now: removing them lays the map out again.
    const origin = this.placed.get(grabbed) ?? this.placed.get(topics[0].id);
    const spots = new Map(topics.map(tp => {
      const p = this.placed.get(tp.id);
      return [tp.id, p && origin ? { x: drop.x + p.x - origin.x, y: drop.y + p.y - origin.y } : drop] as const;
    }));
    const made: string[] = [];
    b.model.transact(() => {
      this.apply(d => { removeTopics(d, topics.map(tp => tp.id)); });
      for (const topic of topics) {
        delete topic.side;
        const w = spots.get(topic.id) ?? drop;
        const mm: MMData = { root: topic, layout: this.data.layout, theme: this.data.theme, size: this.data.size, align: this.data.align, line: this.data.line, branchColor: this.data.branchColor };
        const n = b.createCard('mindmap', w, { data: { type: 'text', text: toMarkdown(topic), vc: { kind: 'mindmap', mm } } });
        if (n) made.push(n.id);
      }
    });
    if (made.length > 1) b.select(made);
  }

  /** Move topics (and what is under them) out of this map into another map, keeping their order. */
  private moveToOtherMap(ids: string[], to: { id: string; spot: MapDrop }): void {
    const target = this.ctx.board.cards.get(to.id)?.handle;
    const topics = movedTopics(cloneData(this.data), ids);
    if (!topics.length || !target?.adoptMap) return;
    // Each one goes in at the same spot: "after" a topic would reverse them, so those go in last first.
    const inOrder = to.spot.mode === 'after' ? [...topics].reverse() : topics;
    this.ctx.board.model.transact(() => {
      this.apply(d => { removeTopics(d, topics.map(tp => tp.id)); });
      for (const topic of inOrder) {
        const mm: MMData = { root: topic, layout: this.data.layout, theme: this.data.theme, size: this.data.size, align: false };
        target.adoptMap!(to.spot, mm, topic.text);
      }
    });
  }

  /** What dropping a dragged topic at a local point would do. */
  private dropAt(x: number, y: number, dragIds: string[]): { target: string; mode: DropMode; side?: 'left' | 'right' } | null {
    const dragged = dragIds.map(d => findIn(this.data, d)?.topic).filter((t): t is MMTopic => !!t);
    let best: { id: string; p: Placed; dist: number } | null = null;
    for (const [id, p] of this.placed) {
      if (dragIds.includes(id) || dragged.some(t => isInside(t, id))) continue;
      const m = 10;
      if (x < p.x - m || x > p.x + p.w + m || y < p.y - m || y > p.y + p.h + m) continue;
      const dist = Math.hypot(x - (p.x + p.w / 2), y - (p.y + p.h / 2));
      if (!best || dist < best.dist) best = { id, p, dist };
    }
    if (!best) return null;
    const { id, p } = best;
    const rootId = this.data.root.id;
    if (id === rootId) {
      const side = (this.data.layout === 'right' || this.data.layout === 'both') && x < p.x + p.w / 2 ? 'left' : 'right';
      return { target: id, mode: 'child', side };
    }
    const horizontal = this.data.layout === 'down' || (this.data.layout === 'timeline' && p.depth === 1);
    const f = horizontal ? (x - p.x) / p.w : (y - p.y) / p.h;
    if (f < 0.28) return { target: id, mode: 'before' };
    if (f > 0.72) return { target: id, mode: 'after' };
    return { target: id, mode: 'child' };
  }
}

export const mindMapCard: CardType = {
  id: 'mindmap',
  label: 'Mind map',
  icon: 'vc-mm-icon',
  defaultSize: { width: 180, height: 90 },
  fixedSize: true,
  noColor: true,
  create: () => {
    const d = newMindMap(t('Central topic'));
    return { type: 'text', text: toMarkdown(d.root), vc: { kind: 'mindmap', mm: d, newAt: true } };
  },
  mount: (node, el, ctx) => new MindMapCard(node, el, ctx),
};
