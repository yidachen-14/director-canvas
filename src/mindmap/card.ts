import type { Menu } from 'obsidian';
import type { RawNode } from '../model/canvas-file';
import type { BarItem, CardContext, CardHandle, CardType } from '../cards/types';
import { commitNode } from '../cards/basic';
import { t } from '../i18n';
import {
  type DropMode, type MMData, type MMTopic, type Placed, type Resolved, type Size,
  addChild, addSibling, boundsOf, bracePath, branchDown, branchSideways, cloneData, countTopics,
  findTopic, gapsFor, isInside, layoutMindMap, moveTopic, newMindMap, normalizeData, removeTopics,
  resolveStyles, SIZE_SCALE, toMarkdown,
} from './model';
import { mindMapBarItems, themeItem } from './panels';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Room around the topics for the fold buttons and selection rings. */
const PAD = 24;
const SIDES = ['right' as const, 'left' as const];

interface Geo { w: number; h: number; ox: number; oy: number }

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.appendChild(el);
  return el;
}

const DASH: Record<string, (w: number) => string> = {
  solid: () => '',
  dashed: (w) => `${4 * w + 2} ${3 * w + 2}`,
  dotted: (w) => `0.1 ${2.4 * w + 1}`,
  long: (w) => `${9 * w + 4} ${4 * w + 2}`,
  dashdot: (w) => `${6 * w + 3} ${3 * w + 2} 0.1 ${3 * w + 2}`,
};

/** The mind map controller the bar panels talk to. */
export interface MindMapControl {
  mapData(): MMData;
  selected(): string[];
  rootSelected(): boolean;
  apply(fn: (d: MMData) => void): void;
}

export class MindMapCard implements CardHandle, MindMapControl {
  private data: MMData;
  private cardEl: HTMLElement;
  private svgEl: SVGSVGElement;
  private layer: HTMLElement;
  private overlay: HTMLElement;
  private topicEls = new Map<string, HTMLElement>();
  private placed = new Map<string, Placed>();
  private styles = new Map<string, Resolved>();
  private shift = { x: PAD, y: PAD };
  private sel = new Set<string>();
  private primary: string | null = null;
  private editingId: string | null = null;
  private replaceOnEdit = false;
  private committed: unknown = null;
  private offs: (() => void)[] = [];
  private pendingRender = 0;
  /** Topic sizes can change after the first measurement (styles or fonts arriving late). */
  private sizeWatch: ResizeObserver;
  private relayoutFrame = 0;
  private dragCleanup: (() => void) | null = null;

  constructor(private node: RawNode, private body: HTMLElement, private ctx: CardContext) {
    this.cardEl = body.parentElement ?? body;
    body.addClass('vc-mm');
    this.svgEl = svg('svg', { class: 'vc-mm-svg' }, body);
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
    return out.join('\n');
  }

  isEditing(): boolean { return !!this.editingId; }

  edit(at?: { clientX: number; clientY: number }): boolean {
    let id = at ? this.topicAtClient(at.clientX, at.clientY) : this.primary;
    if (!id) {
      if (at) return false;
      id = this.data.root.id;
    }
    return this.beginEdit(id, !!at ? at : null);
  }

  stopEditing(): void {
    const id = this.editingId;
    if (!id) return;
    const el = this.topicEls.get(id);
    this.editingId = null;
    if (!el) return;
    const text = (el.innerText ?? '').replace(/\n+$/, '').replace(/ /g, ' ');
    el.removeAttribute('contenteditable');
    el.removeClass('is-editing');
    const f = findTopic(this.data.root, id);
    if (f && f.topic.text !== text) this.apply(d => { const g = findTopic(d.root, id); if (g) g.topic.text = text; });
    else this.renderNow();
  }

  onKey(e: KeyboardEvent): boolean {
    if (this.editingId) return false;
    const key = e.key;
    if (!this.sel.size) {
      if (key === 'Tab' || key === 'Enter' || key === 'F2') { this.setSel([this.data.root.id]); return true; }
      return false;
    }
    const cur = this.primary ?? [...this.sel][0];
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
    if (key === ' ') { this.replaceOnEdit = true; this.ctx.board.startEditing(this.node.id); return true; }
    // Typing starts editing the topic, the keystroke replacing its text.
    if ((key.length === 1 || key === 'Process') && !e.ctrlKey && !e.metaKey) {
      this.replaceOnEdit = true;
      this.ctx.board.startEditing(this.node.id);
      return false;
    }
    return false;
  }

  barKey(): string { return `mm:${[...this.sel].join(',')}`; }
  barExclusive(): boolean { return this.sel.size > 0; }
  barAnchor(): { x: number; y: number; width: number; height: number } | null {
    if (!this.sel.size) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of this.sel) {
      const p = this.placed.get(id);
      if (!p) continue;
      const x = this.node.x + p.x + this.shift.x, y = this.node.y + p.y + this.shift.y;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + p.w); y1 = Math.max(y1, y + p.h);
    }
    return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
  }

  barAvoid(): { x: number; y: number; width: number; height: number }[] {
    if (!this.sel.size) return [];
    const out: { x: number; y: number; width: number; height: number }[] = [];
    for (const [id, p] of this.placed) {
      const x = this.node.x + p.x + this.shift.x, y = this.node.y + p.y + this.shift.y;
      // The selected topic's "+" buttons sit just outside it.
      const grow = id === this.primary ? 22 : 0;
      out.push({ x: x - grow, y, width: p.w + grow * 2, height: p.h + grow });
    }
    return out;
  }

  barItems(): BarItem[] {
    if (!this.sel.size) return [themeItem(this)];
    return mindMapBarItems(this);
  }

  menu(menu: Menu): void {
    if (!this.sel.size) return;
    const cur = this.primary ?? [...this.sel][0];
    const f = findTopic(this.data.root, cur);
    menu.addItem(i => i.setTitle(t('Add subtopic')).setIcon('corner-down-right').onClick(() => this.addChildTo(cur)));
    if (f?.parent) menu.addItem(i => i.setTitle(t('Add sibling topic')).setIcon('plus').onClick(() => this.addSiblingTo(cur)));
    menu.addItem(i => i.setTitle(t('Edit text')).setIcon('pencil').onClick(() => this.ctx.board.startEditing(this.node.id)));
    if (f?.topic.children.length) {
      menu.addItem(i => i.setTitle(f.topic.collapsed ? t('Expand') : t('Collapse')).setIcon(f.topic.collapsed ? 'chevrons-up-down' : 'chevrons-down-up').onClick(() => this.toggleFold(cur)));
    }
    if (f?.parent) menu.addItem(i => i.setTitle(t('Delete topic')).setIcon('trash-2').onClick(() => {
      let next: string | null = null;
      this.apply(d => { next = removeTopics(d, [...this.sel].filter(id => id !== this.data.root.id)); });
      this.setSel(next ? [next] : []);
    }));
  }

  // ── MindMapControl (bar panels) ───────────────────────────

  selected(): string[] { return [...this.sel]; }
  rootSelected(): boolean { return this.sel.has(this.data.root.id); }
  mapData(): MMData { return this.data; }

  /** Change the map as one undo step; the card grows or shrinks around the central topic. */
  apply(fn: (d: MMData) => void): void {
    const d = cloneData(this.data);
    fn(d);
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
    this.sel = new Set(ids);
    this.primary = ids[0] ?? null;
    if (ids.length && !this.isSole()) this.ctx.board.select([this.node.id]);
    this.paintSelection();
    this.drawOverlay();
    this.ctx.board.notifySelection();
  }

  private isSole(): boolean {
    const s = this.ctx.board.selection;
    return s.size === 1 && s.has(this.node.id);
  }

  private onBoardSelection(): void {
    if (!this.isSole() && this.sel.size) {
      if (this.editingId) this.ctx.board.stopEditing();
      this.sel.clear();
      this.primary = null;
      this.paintSelection();
    }
    this.drawOverlay();
  }

  private pruneSelection(): void {
    for (const id of [...this.sel]) if (!findTopic(this.data.root, id)) this.sel.delete(id);
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
    const walk = (tp: MMTopic) => { out.push(tp); if (!tp.collapsed) tp.children.forEach(walk); };
    walk(this.data.root);
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
        el.addEventListener('blur', () => { if (this.editingId === tid) window.setTimeout(() => { if (this.editingId === tid) this.ctx.board.stopEditing(); }, 0); });
      }
      const st = this.styles.get(tp.id)!;
      const s = el.style;
      s.fontSize = `${st.fontSize}px`;
      s.fontWeight = st.bold ? '600' : '';
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
    return this.layoutDom();
  }

  /** Measure the topics, place them, and draw. */
  private layoutDom(): Geo {
    const d = this.data;
    const sizes = new Map<string, Size>();
    for (const [id, el] of this.topicEls) sizes.set(id, { w: el.offsetWidth, h: el.offsetHeight });
    this.placed = layoutMindMap(d, sizes);
    const b = boundsOf(this.placed);
    this.shift = { x: Math.round(PAD - b.x), y: Math.round(PAD - b.y) };
    for (const [id, p] of this.placed) {
      const el = this.topicEls.get(id);
      if (el) el.style.transform = `translate(${p.x + this.shift.x}px, ${p.y + this.shift.y}px)`;
    }
    const w = Math.ceil(b.w + PAD * 2), h = Math.ceil(b.h + PAD * 2);
    this.svgEl.setAttribute('width', String(w));
    this.svgEl.setAttribute('height', String(h));
    this.drawLines();
    this.drawOverlay();
    const r = this.placed.get(d.root.id)!;
    return { w, h, ox: Math.round(r.x + this.shift.x + r.w / 2), oy: Math.round(r.y + this.shift.y + r.h / 2) };
  }

  /** Where the central topic is now, kept still while the card changes size. */
  private fitInto(n: RawNode, geo: Geo): void {
    let ox = Number(n.vc?.ox), oy = Number(n.vc?.oy);
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) { ox = n.width / 2; oy = n.height / 2; }
    const cx = n.x + ox, cy = n.y + oy;
    n.x = Math.round(cx - geo.ox);
    n.y = Math.round(cy - geo.oy);
    n.width = geo.w;
    n.height = geo.h;
    n.vc = { ...(n.vc ?? {}), ox: geo.ox, oy: geo.oy };
  }

  private fitQuietly(): void {
    if (!this.body.isConnected || this.editingId) return;
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

    // Topic shapes, over the lines.
    for (const [id] of this.placed) {
      const p = P(id)!, st = S(id);
      const bw = st.border ? st.borderWidth : 0;
      const dash = DASH[st.borderDash]?.(bw) ?? '';
      if (st.shape === 'underline') {
        if (st.fill !== 'none') svg('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: 4, style: `fill:${st.fill}` }, shapes);
        if (st.border) {
          const y = p.y + p.h - bw / 2;
          svg('path', { d: `M${p.x},${y} H${p.x + p.w}`, style: `stroke:${st.borderColor};stroke-width:${bw}px;fill:none`, 'stroke-dasharray': dash, 'stroke-linecap': st.borderDash === 'solid' ? 'butt' : 'round' }, shapes);
        }
        continue;
      }
      const rx = st.shape === 'rect' ? 0 : st.shape === 'rounded-sm' ? 4 : st.shape === 'rounded' ? 10 : (p.h - bw) / 2;
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
      }
      if (!tp.collapsed) for (const c of tp.children) walk(c, depth + 1);
    };
    walk(d.root, 0);

    // "+" buttons around the one selected topic.
    if (!sole || this.sel.size !== 1 || this.editingId || !this.primary) return;
    const p0 = this.placed.get(this.primary);
    if (!p0) return;
    const p = { ...p0, x: p0.x + sx, y: p0.y + sy };
    const isRoot = this.primary === d.root.id;
    const hasKids = !!findTopic(d.root, this.primary)?.topic.children.length;
    const off = hasKids ? 30 : 12;
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
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.ctx.board.stopEditing(); this.ctx.board.root.focus({ preventScroll: true }); return; }
    if (e.key === 'Escape') { e.preventDefault(); this.ctx.board.stopEditing(); this.ctx.board.root.focus({ preventScroll: true }); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      this.ctx.board.stopEditing();
      this.ctx.board.root.focus({ preventScroll: true });
      this.addChildTo(id);
    }
  }

  // ── tree edits ────────────────────────────────────────────

  private addChildTo(id: string, side?: 'left' | 'right'): void {
    let made: MMTopic | null = null;
    const f = findTopic(this.data.root, id);
    const text = f && !f.parent ? t('Branch topic') : t('Subtopic');
    this.apply(d => {
      if (d.layout === 'both' && !side && f && !f.parent) {
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
    const f = findTopic(this.data.root, id);
    const text = f && f.depth === 1 ? t('Branch topic') : f && !f.parent ? t('Branch topic') : t('Subtopic');
    this.apply(d => { made = addSibling(d, id, text); });
    if (made) this.setSel([(made as MMTopic).id]);
  }

  private toggleFold(id: string): void {
    this.apply(d => { const f = findTopic(d.root, id); if (f) f.topic.collapsed = !f.topic.collapsed; });
    // Selected topics hidden by folding: select the folded one.
    if ([...this.sel].some(s => !this.placed.has(s))) this.setSel([id]);
  }

  /**
   * Arrow keys follow the map: towards the children enters the first child,
   * the opposite way goes to the parent, across moves between topics of the same level.
   */
  private neighbour(id: string, key: string): string | null {
    const p = this.placed.get(id);
    const f = findTopic(this.data.root, id);
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
    const topicEl = target.closest<HTMLElement>('.vc-mm-topic');
    const id = topicEl?.dataset.tid;
    if (!id) {
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
    if (!this.isSole()) b.select([this.node.id]);
    if (!(this.sel.size > 1 && this.sel.has(id))) this.setSel([id]);
    // The central topic carries the whole map; other topics drag within it.
    if (id === this.data.root.id) return;
    e.stopPropagation();
    e.preventDefault();
    b.root.focus({ preventScroll: true });
    this.startTopicDrag(e, id);
  }

  private toLocal(clientX: number, clientY: number): { x: number; y: number } {
    const w = this.ctx.board.clientToWorld(clientX, clientY);
    return { x: w.x - this.node.x - this.shift.x, y: w.y - this.node.y - this.shift.y };
  }

  private startTopicDrag(e: PointerEvent, id: string): void {
    const sx = e.clientX, sy = e.clientY;
    const doc = this.body.ownerDocument;
    const win = doc.defaultView ?? window;
    let dragging = false;
    let ghost: HTMLElement | null = null;
    let hint: HTMLElement | null = null;
    let drop: { target: string; mode: DropMode; side?: 'left' | 'right' } | null = null;
    const dragged = findTopic(this.data.root, id)?.topic;
    const srcEl = this.topicEls.get(id);
    const clearMarks = () => { for (const el of this.topicEls.values()) el.removeClass('is-drop-target'); };

    const move = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        dragging = true;
        srcEl?.addClass('is-dragging');
        ghost = this.overlay.createDiv({ cls: 'vc-mm-ghost', text: dragged?.text || ' ' });
        hint = this.overlay.createDiv('vc-mm-drop');
        hint.hide();
      }
      const l = this.toLocal(ev.clientX, ev.clientY);
      ghost!.style.transform = `translate(${Math.round(l.x + this.shift.x + 8)}px, ${Math.round(l.y + this.shift.y + 8)}px)`;
      drop = this.dropAt(l.x, l.y, id);
      clearMarks();
      if (!drop) { hint!.hide(); return; }
      const p = this.placed.get(drop.target)!;
      const x = p.x + this.shift.x, y = p.y + this.shift.y;
      const hs = hint!.style;
      hint!.show();
      if (drop.mode === 'child') {
        this.topicEls.get(drop.target)?.addClass('is-drop-target');
        hint!.addClass('is-child');
        const down = this.data.layout === 'down';
        const list = this.data.layout === 'list' || (this.data.layout === 'timeline' && p.depth >= 1);
        const left = !down && !list && (drop.side === 'left' || (p.depth > 0 && p.side === 'left'));
        const gx = down ? x + p.w / 2 - 30 : list ? x + 24 : left ? x - 76 : x + p.w + 16;
        const gy = down ? y + p.h + 16 : list ? y + p.h + 6 : y + p.h / 2 - 11;
        hs.transform = `translate(${gx}px, ${gy}px)`;
        hs.width = '60px'; hs.height = '22px';
      } else {
        hint!.removeClass('is-child');
        const horizontal = this.data.layout === 'down' || (this.data.layout === 'timeline' && p.depth === 1);
        if (horizontal) {
          const gx = drop.mode === 'before' ? x - 6 : x + p.w + 3;
          hs.transform = `translate(${gx}px, ${y}px)`;
          hs.width = '3px'; hs.height = `${p.h}px`;
        } else {
          const gy = drop.mode === 'before' ? y - 6 : y + p.h + 3;
          hs.transform = `translate(${x}px, ${gy}px)`;
          hs.width = `${p.w}px`; hs.height = '3px';
        }
      }
    };
    const finish = (commit: boolean) => {
      win.removeEventListener('pointermove', move, true);
      win.removeEventListener('pointerup', up, true);
      win.removeEventListener('keydown', key, true);
      this.dragCleanup = null;
      srcEl?.removeClass('is-dragging');
      clearMarks();
      ghost?.remove(); hint?.remove();
      if (commit && dragging && drop) {
        const dd = drop;
        this.apply(d => { moveTopic(d, id, dd.target, dd.mode, dd.side); });
        this.setSel([id]);
      }
    };
    const up = () => finish(true);
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); } };
    win.addEventListener('pointermove', move, true);
    win.addEventListener('pointerup', up, true);
    win.addEventListener('keydown', key, true);
    this.dragCleanup = () => finish(false);
  }

  /** What dropping a dragged topic at a local point would do. */
  private dropAt(x: number, y: number, dragId: string): { target: string; mode: DropMode; side?: 'left' | 'right' } | null {
    const dragged = findTopic(this.data.root, dragId)?.topic;
    let best: { id: string; p: Placed; dist: number } | null = null;
    for (const [id, p] of this.placed) {
      if (id === dragId || (dragged && isInside(dragged, id))) continue;
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
    return { type: 'text', text: toMarkdown(d.root), vc: { kind: 'mindmap', mm: d } };
  },
  mount: (node, el, ctx) => new MindMapCard(node, el, ctx),
};
