import { Component, Notice, setIcon, type App } from 'obsidian';
import type VisualCanvasPlugin from '../main';
import type { CanvasView } from '../view/canvas-view';
import { BoardModel, nodeRect, unionRect, type ChangeEvent, type Rect } from '../model/board-model';
import { newId, type CanvasFile, type RawEdge, type RawNode } from '../model/canvas-file';
import { Viewport, gridStep, type Point } from './viewport';
import { edgeGeometry, edgeWidth, vcOf } from './connections';
import type { ConnectController } from './connect-ui';
import { drawingHit, recolorDrawing } from '../cards/drawing';
import { cardKindOf, cssColor } from '../cards/util';
import { getCardType, fallbackCard } from '../cards/registry';
import type { CardHandle } from '../cards/types';
import { t } from '../i18n';

interface MountedCard {
  id: string;
  kind: string;
  el: HTMLElement;
  body: HTMLElement;
  handle: CardHandle;
  component: Component;
  /** JSON of the node minus geometry, to tell content changes from moves. */
  dataKey: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Half the size of the edge SVG, in board units. */
const EDGE_SPAN = 100000;

function dataKeyOf(n: RawNode): string {
  const { x: _x, y: _y, width: _w, height: _h, ...rest } = n;
  return JSON.stringify(rest);
}

/**
 * One open board: its data, its viewport and the DOM that shows it.
 * Interaction (pointer, keyboard, menus, toolbar) is attached from separate
 * modules through the public methods here.
 */
export class Board {
  readonly model = new BoardModel();
  readonly vp = new Viewport();
  readonly root: HTMLElement;
  readonly gridEl: HTMLElement;
  readonly worldEl: HTMLElement;
  readonly edgeSvg: SVGSVGElement;
  /** Where edge elements go (world coordinates). */
  readonly edgeLayer: SVGGElement;
  readonly edgeLabelsEl: HTMLElement;
  readonly nodesEl: HTMLElement;
  /** Groups paint below the connections, cards above. */
  readonly groupsEl: HTMLElement;
  /** Screen-space layer above the board (marquee, previews). */
  readonly overlayEl: HTMLElement;
  /** Screen-space layer for floating UI (toolbar, panels). */
  readonly uiEl: HTMLElement;

  readonly selection = new Set<string>();
  readonly edgeSelection = new Set<string>();
  readonly cards = new Map<string, MountedCard>();
  tool = 'select';
  editingId: string | null = null;
  /** A card just created to be typed into: its first edit joins the creation's undo step. */
  private freshCardId: string | null = null;

  /** Undo merge key for a card's edit (see freshCardId). */
  mergeKeyFor(id: string): string | undefined {
    if (this.freshCardId !== id) return undefined;
    this.freshCardId = null;
    return `!create:${id}`;
  }

  /** Set by the corner UI. */
  openSearch: (() => void) | null = null;
  /** Set by interactions: the connection tools. */
  connections: ConnectController | null = null;

  private edgeEls = new Map<string, SVGGElement>();
  private edgeLabelEls = new Map<string, HTMLElement>();
  private listeners: { selection: Set<() => void>; viewport: Set<() => void>; tool: Set<() => void>; edges: Set<() => void>; change: Set<(e: ChangeEvent) => void> } = {
    selection: new Set(), viewport: new Set(), tool: new Set(), edges: new Set(), change: new Set(),
  };
  private disposers: (() => void)[] = [];
  private destroyed = false;

  constructor(readonly view: CanvasView, readonly plugin: VisualCanvasPlugin, host: HTMLElement) {
    this.root = host.createDiv({ cls: 'vc-board', attr: { tabindex: '0' } });
    this.gridEl = this.root.createDiv('vc-grid');
    this.worldEl = this.root.createDiv('vc-world');
    this.groupsEl = this.worldEl.createDiv('vc-groups');
    // A large SVG (not a 1px one with overflow) so clicks on lines far from
    // the origin still hit them; its content is shifted back to world space.
    this.edgeSvg = document.createElementNS(SVG_NS, 'svg');
    this.edgeSvg.addClass('vc-edges');
    this.worldEl.appendChild(this.edgeSvg);
    this.edgeLayer = document.createElementNS(SVG_NS, 'g');
    this.edgeLayer.setAttribute('transform', `translate(${EDGE_SPAN}, ${EDGE_SPAN})`);
    this.edgeSvg.appendChild(this.edgeLayer);
    this.nodesEl = this.worldEl.createDiv('vc-nodes');
    this.edgeLabelsEl = this.worldEl.createDiv('vc-edge-labels');
    this.overlayEl = this.root.createDiv('vc-overlay');
    this.uiEl = this.root.createDiv('vc-ui');
    this.disposers.push(this.model.onChange(e => this.onModelChange(e)));
    this.applyAppearance();
    this.applyViewport();
  }

  get app(): App { return this.plugin.app; }
  get settings() { return this.plugin.settings; }
  get sourcePath(): string { return this.view.file?.path ?? ''; }

  // ── lifecycle ─────────────────────────────────────────────

  private suppressSave = false;

  load(file: CanvasFile, keepHistory = false): void {
    this.suppressSave = true;
    try { this.model.load(file, keepHistory); } finally { this.suppressSave = false; }
  }

  destroy(): void {
    this.destroyed = true;
    for (const d of this.disposers.splice(0)) d();
    for (const c of this.cards.values()) this.unmount(c);
    this.cards.clear();
    this.root.remove();
  }

  addDisposer(fn: () => void): void { this.disposers.push(fn); }

  private refreshers: (() => void)[] = [];
  /** Register UI that must redraw when settings change. */
  addRefresher(fn: () => void): void { this.refreshers.push(fn); }
  /** Settings changed: re-apply appearance and redraw floating UI. */
  refreshUi(): void {
    this.applyAppearance();
    for (const fn of this.refreshers) fn();
  }

  on(kind: 'selection' | 'viewport' | 'tool' | 'edges', fn: () => void): () => void {
    this.listeners[kind].add(fn);
    return () => this.listeners[kind].delete(fn);
  }

  onChange(fn: (e: ChangeEvent) => void): () => void {
    this.listeners.change.add(fn);
    return () => this.listeners.change.delete(fn);
  }

  /** Something inside a card's selection changed (e.g. a mind map topic): update the bar. */
  notifySelection(): void { this.fire('selection'); }

  private fire(kind: 'selection' | 'viewport' | 'tool' | 'edges'): void {
    for (const fn of this.listeners[kind]) fn();
  }

  // ── appearance & viewport ─────────────────────────────────

  applyAppearance(): void {
    const s = this.settings;
    this.root.style.setProperty('--vc-dot-color', s.dotColor || 'var(--vc-dot-default)');
    this.root.style.setProperty('--vc-dot-size', `${s.dotSize}px`);
    this.root.setAttr('data-grid', s.dotSize > 0 ? s.gridStyle : 'none');
    if (s.backgroundColor) this.root.style.setProperty('--vc-bg', s.backgroundColor);
    else this.root.style.removeProperty('--vc-bg');
    this.root.setAttr('data-toolbar-size', s.toolbarSize);
    this.root.style.setProperty('--vc-img-radius', `${s.imageRadius}px`);
    this.root.style.setProperty('--vc-img-radius-on', s.imageRadius > 0 ? '1' : '0');
    this.root.toggleClass('has-image-shadow', s.imageShadow);
    this.root.setAttr('data-toolbar-pos', s.toolbarPosition);
    this.applyGrid();
  }

  applyViewport(): void {
    const { x, y, zoom } = this.vp;
    this.worldEl.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    this.root.style.setProperty('--vc-zoom', String(zoom));
    this.applyGrid();
    // Floating handles were placed for the old view.
    this.overlayEl.querySelectorAll<HTMLElement>('.vc-block-handle').forEach(h => h.hide());
    this.fire('viewport');
  }

  private applyGrid(): void {
    const step = gridStep(this.settings.gridSize, this.vp.zoom);
    const g = this.gridEl.style;
    g.setProperty('--vc-grid-step', `${step}px`);
    // Dots sit in the middle of each tile, lines on its edges: both land on the board grid.
    const off = this.settings.gridStyle === 'dots' ? -step / 2 : 0;
    const px = ((this.vp.x + off) % step + step) % step, py = ((this.vp.y + off) % step + step) % step;
    g.backgroundPosition = `${px}px ${py}px`;
  }

  /** Size of the visible board area in screen pixels. */
  screenSize(): { width: number; height: number } {
    return { width: this.root.clientWidth, height: this.root.clientHeight };
  }

  clientToWorld(clientX: number, clientY: number): Point {
    const r = this.root.getBoundingClientRect();
    return this.vp.toWorld(clientX - r.left, clientY - r.top);
  }

  worldToClient(x: number, y: number): Point {
    const r = this.root.getBoundingClientRect();
    const p = this.vp.toScreen(x, y);
    return { x: p.x + r.left, y: p.y + r.top };
  }

  /** World point at the centre of the visible area. */
  viewCenter(): Point {
    const { width, height } = this.screenSize();
    return this.vp.toWorld(width / 2, height / 2);
  }

  zoomToFit(ids?: string[], animate = false): void {
    const nodes = ids?.length ? ids.map(id => this.model.node(id)).filter((n): n is RawNode => !!n) : this.model.nodes;
    const rect = unionRect(nodes.map(nodeRect));
    const { width, height } = this.screenSize();
    const target = new Viewport();
    if (!rect) { target.zoom = 1; target.x = width / 2; target.y = height / 2; }
    else target.fit(rect, width, height, 64, ids?.length ? 2 : 1);
    if (animate) { this.animateTo(target); return; }
    this.stopViewAnimation();
    this.vp.x = target.x; this.vp.y = target.y; this.vp.zoom = target.zoom;
    this.applyViewport();
  }

  zoomBy(factor: number): void {
    this.stopViewAnimation();
    const { width, height } = this.screenSize();
    this.vp.zoomAt(width / 2, height / 2, factor);
    this.applyViewport();
  }

  /** Zoom to `z` around the middle of the view; smoothly when `animate`. */
  setZoom(z: number, animate = false): void {
    if (!animate) { this.zoomBy(z / this.vp.zoom); return; }
    const { width, height } = this.screenSize();
    const target = new Viewport();
    target.x = this.vp.x; target.y = this.vp.y; target.zoom = this.vp.zoom;
    target.zoomAt(width / 2, height / 2, z / this.vp.zoom);
    this.animateTo(target);
  }

  /** One step in or out along the fixed zoom levels (… 50%, 67%, 75%, 100%, 125% …), smoothly. */
  zoomStep(dir: 1 | -1): void {
    const from = this.viewAnim?.target.zoom ?? this.vp.zoom;
    this.setZoom(nextZoomStep(from, dir), true);
  }

  private viewAnim: { raf: number; target: Viewport; last: { x: number; y: number; zoom: number } } | null = null;

  private stopViewAnimation(): void {
    if (this.viewAnim) cancelAnimationFrame(this.viewAnim.raf);
    this.viewAnim = null;
  }

  /** Glide to a view: zoom moves evenly on a log scale, the middle of the view moves in a line. */
  animateTo(target: Viewport, ms = 220): void {
    this.stopViewAnimation();
    const { width, height } = this.screenSize();
    const z0 = this.vp.zoom, z1 = target.zoom;
    const c0 = this.vp.toWorld(width / 2, height / 2), c1 = target.toWorld(width / 2, height / 2);
    const t0 = performance.now();
    const ease = (k: number) => 1 - Math.pow(1 - k, 3);
    const anim = { raf: 0, target, last: { x: this.vp.x, y: this.vp.y, zoom: this.vp.zoom } };
    this.viewAnim = anim;
    const step = (now: number) => {
      if (this.viewAnim !== anim) return;
      // Someone else moved the view (wheel, pan): let them have it.
      if (this.vp.x !== anim.last.x || this.vp.y !== anim.last.y || this.vp.zoom !== anim.last.zoom) { this.viewAnim = null; return; }
      const k = Math.min(1, (now - t0) / ms), e = ease(k);
      const z = Math.exp(Math.log(z0) + (Math.log(z1) - Math.log(z0)) * e);
      const cx = c0.x + (c1.x - c0.x) * e, cy = c0.y + (c1.y - c0.y) * e;
      this.vp.zoom = z;
      this.vp.x = width / 2 - cx * z;
      this.vp.y = height / 2 - cy * z;
      if (k >= 1) { this.vp.x = target.x; this.vp.y = target.y; this.vp.zoom = target.zoom; }
      anim.last = { x: this.vp.x, y: this.vp.y, zoom: this.vp.zoom };
      this.applyViewport();
      if (k < 1) anim.raf = requestAnimationFrame(step);
      else this.viewAnim = null;
    };
    anim.raf = requestAnimationFrame(step);
  }

  /** Scroll so the world rect is visible, without changing zoom when it already fits. */
  reveal(rect: Rect): void {
    const { width, height } = this.screenSize();
    const a = this.vp.toScreen(rect.x, rect.y);
    const b = this.vp.toScreen(rect.x + rect.width, rect.y + rect.height);
    if (a.x >= 0 && a.y >= 0 && b.x <= width && b.y <= height) return;
    this.vp.x += width / 2 - (a.x + b.x) / 2;
    this.vp.y += height / 2 - (a.y + b.y) / 2;
    this.applyViewport();
  }

  /** Topmost node under a world point (cards above groups); `margin` widens each card's hit area. */
  nodeAt(wx: number, wy: number, margin = 0): RawNode | null {
    const nodes = this.model.nodes;
    const hit = (n: RawNode) => {
      if (!(wx >= n.x - margin && wx <= n.x + n.width + margin && wy >= n.y - margin && wy <= n.y + n.height + margin)) return false;
      // A drawing is picked by its ink, not its whole box.
      return n.vc?.kind !== 'drawing' || drawingHit(n, wx, wy, 6 / this.vp.zoom + margin);
    };
    for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i].type !== 'group' && hit(nodes[i])) return nodes[i];
    for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i].type === 'group' && hit(nodes[i])) return nodes[i];
    return null;
  }

  // ── tools ─────────────────────────────────────────────────

  setTool(tool: string): void {
    if (this.tool === tool) return;
    this.tool = tool;
    this.root.setAttr('data-tool', tool);
    this.fire('tool');
  }

  // ── selection ─────────────────────────────────────────────

  select(ids: Iterable<string>, mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
    if (mode === 'replace') { this.selection.clear(); this.edgeSelection.clear(); }
    for (const id of ids) {
      if (!this.model.node(id)) continue;
      if (mode === 'toggle' && this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    }
    this.refreshSelection();
  }

  selectEdges(ids: Iterable<string>, mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
    if (mode === 'replace') { this.selection.clear(); this.edgeSelection.clear(); }
    for (const id of ids) {
      if (mode === 'toggle' && this.edgeSelection.has(id)) this.edgeSelection.delete(id);
      else this.edgeSelection.add(id);
    }
    this.refreshSelection();
  }

  clearSelection(): void {
    if (!this.selection.size && !this.edgeSelection.size) return;
    this.selection.clear();
    this.edgeSelection.clear();
    this.refreshSelection();
  }

  selectedNodes(): RawNode[] {
    return this.model.nodes.filter(n => this.selection.has(n.id));
  }

  selectionRect(): Rect | null {
    return unionRect(this.selectedNodes().map(nodeRect));
  }

  private refreshSelection(): void {
    for (const id of [...this.selection]) if (!this.model.node(id)) this.selection.delete(id);
    for (const id of [...this.edgeSelection]) if (!this.model.edge(id)) this.edgeSelection.delete(id);
    for (const c of this.cards.values()) c.el.toggleClass('is-selected', this.selection.has(c.id));
    for (const [id, g] of this.edgeEls) g.classList.toggle('is-selected', this.edgeSelection.has(id));
    for (const [id, l] of this.edgeLabelEls) l.toggleClass('is-selected', this.edgeSelection.has(id));
    this.root.toggleClass('has-multi-selection', this.selection.size > 1);
    this.fire('selection');
  }

  // ── editing ───────────────────────────────────────────────

  startEditing(id: string, at?: { clientX: number; clientY: number }): boolean {
    const card = this.cards.get(id);
    if (!card?.handle.edit) return false;
    if (this.editingId && this.editingId !== id) this.stopEditing();
    this.select([id]);
    const ok = card.handle.edit(at);
    if (ok) {
      this.editingId = id;
      card.el.addClass('is-editing');
    }
    return ok;
  }

  /** Called by cards when their editor closes. */
  editingEnded(id: string): void {
    if (this.editingId !== id) return;
    this.editingId = null;
    this.cards.get(id)?.el.removeClass('is-editing');
    if (!this.destroyed) this.root.focus({ preventScroll: true });
    this.fire('selection');
  }

  stopEditing(): void {
    if (!this.editingId) return;
    const card = this.cards.get(this.editingId);
    card?.handle.stopEditing?.();
    if (this.editingId) this.editingEnded(this.editingId);
  }

  // ── rendering ─────────────────────────────────────────────

  private onModelChange(e: ChangeEvent): void {
    if (this.destroyed) return;
    if (e.kind === 'all') this.syncAll();
    else if (e.kind === 'nodes') this.syncNodes(e.ids);
    this.renderEdges();
    this.refreshSelection();
    for (const fn of this.listeners.change) fn(e);
    if (!e.preview && !this.suppressSave) this.view.requestSave();
  }

  private syncAll(): void {
    const ids = new Set(this.model.nodes.map(n => n.id));
    for (const [id, c] of this.cards) if (!ids.has(id)) { this.unmount(c); this.cards.delete(id); }
    for (const n of this.model.nodes) this.syncNode(n);
    // Paint order follows the model, groups and cards in their own layers.
    for (const layer of [this.groupsEl, this.nodesEl]) {
      let prev: HTMLElement | null = null;
      for (const n of this.model.nodes) {
        if ((n.type === 'group') !== (layer === this.groupsEl)) continue;
        const el = this.cards.get(n.id)?.el;
        if (!el) continue;
        const want: Element | null = prev ? prev.nextElementSibling : layer.firstElementChild;
        if (want !== el) layer.insertBefore(el, prev ? prev.nextSibling : layer.firstChild);
        prev = el;
      }
    }
  }

  private syncNodes(ids: string[]): void {
    for (const id of ids) {
      const n = this.model.node(id);
      const c = this.cards.get(id);
      if (!n) { if (c) { this.unmount(c); this.cards.delete(id); } continue; }
      this.syncNode(n);
    }
  }

  private syncNode(n: RawNode): void {
    let c = this.cards.get(n.id);
    const kind = cardKindOf(n);
    if (c && c.kind !== kind) { this.unmount(c); this.cards.delete(n.id); c = undefined; }
    if (!c) {
      c = this.mount(n, kind);
      this.cards.set(n.id, c);
      // New cards go where the model has them.
      const layer = n.type === 'group' ? this.groupsEl : this.nodesEl;
      const idx = this.model.nodes.indexOf(n);
      const next = this.model.nodes.slice(idx + 1).filter(m => (m.type === 'group') === (n.type === 'group')).map(m => this.cards.get(m.id)?.el).find(Boolean);
      layer.insertBefore(c.el, next ?? null);
    }
    this.place(c, n);
    const key = dataKeyOf(n);
    if (key !== c.dataKey) {
      c.dataKey = key;
      c.handle.update(n);
    }
  }

  private place(c: MountedCard, n: RawNode): void {
    const s = c.el.style;
    const changedSize = s.width !== `${n.width}px` || s.height !== `${n.height}px`;
    s.transform = `translate(${n.x}px, ${n.y}px)`;
    s.width = `${n.width}px`;
    s.height = `${n.height}px`;
    if (changedSize) c.handle.resized?.(n);
  }

  private mount(n: RawNode, kind: string): MountedCard {
    const type = getCardType(kind) ?? fallbackCard;
    const el = createDiv({ cls: `vc-node vc-kind-${kind}`, attr: { 'data-id': n.id } });
    const body = el.createDiv('vc-node-body');
    const component = new Component();
    component.load();
    const handle = type.mount(n, body, { app: this.app, board: this, sourcePath: this.sourcePath, component });
    return { id: n.id, kind, el, body, handle, component, dataKey: dataKeyOf(n) };
  }

  private unmount(c: MountedCard): void {
    if (this.editingId === c.id) this.editingId = null;
    try { c.handle.destroy(); } catch (err) { console.error('Visual Canvas: card destroy failed', err); }
    c.component.unload();
    c.el.remove();
  }

  /** Re-render every card (after a setting change). */
  remountAll(): void {
    for (const c of this.cards.values()) this.unmount(c);
    this.cards.clear();
    this.syncAll();
    this.renderEdges();
    this.refreshSelection();
  }

  // ── edges ─────────────────────────────────────────────────

  /** Geometry of an edge as currently drawn (null when an end is missing). */
  edgeGeometry(id: string): ReturnType<typeof edgeGeometry> {
    const e = this.model.edge(id);
    return e ? edgeGeometry(e, nid => this.model.node(nid)) : null;
  }

  renderEdges(): void {
    const seen = new Set<string>();
    for (const e of this.model.edges) {
      const shape = edgeGeometry(e, nid => this.model.node(nid));
      if (!shape) continue;
      seen.add(e.id);
      let g = this.edgeEls.get(e.id);
      if (!g) {
        g = document.createElementNS(SVG_NS, 'g');
        g.classList.add('vc-edge');
        g.setAttribute('data-edge-id', e.id);
        for (const cls of ['vc-edge-halo', 'vc-edge-hit', 'vc-edge-line', 'vc-edge-arrow', 'vc-edge-arrow']) {
          const p = document.createElementNS(SVG_NS, 'path');
          p.classList.add(cls);
          g.appendChild(p);
        }
        this.edgeLayer.appendChild(g);
        this.edgeEls.set(e.id, g);
      }
      const [halo, hit, line, arrowStart, arrowEnd] = Array.from(g.children) as SVGPathElement[];
      halo.setAttribute('d', shape.full);
      hit.setAttribute('d', shape.full);
      line.setAttribute('d', shape.d);
      arrowStart.setAttribute('d', shape.startArrow);
      arrowEnd.setAttribute('d', shape.endArrow);
      const vc = vcOf(e);
      const width = edgeWidth(e);
      g.style.setProperty('--vc-edge-w', String(width));
      if (vc.dash) line.setAttribute('stroke-dasharray', `${width * 4} ${width * 3}`);
      else line.removeAttribute('stroke-dasharray');
      const color = cssColor(e.color);
      if (color) g.style.setProperty('--vc-edge-color', color); else g.style.removeProperty('--vc-edge-color');
      g.classList.toggle('is-selected', this.edgeSelection.has(e.id));
      // Label
      let label = this.edgeLabelEls.get(e.id);
      if (e.label) {
        if (!label) {
          label = this.edgeLabelsEl.createDiv({ cls: 'vc-edge-label', attr: { 'data-edge-id': e.id } });
          this.edgeLabelEls.set(e.id, label);
        }
        if (label.textContent !== e.label) label.setText(e.label);
        label.style.transform = `translate(${shape.mid.x}px, ${shape.mid.y}px) translate(-50%, -50%)`;
        label.style.fontSize = typeof vc.labelSize === 'number' ? `${vc.labelSize}px` : '';
        if (color) label.style.setProperty('--vc-edge-color', color); else label.style.removeProperty('--vc-edge-color');
        label.toggleClass('is-selected', this.edgeSelection.has(e.id));
      } else if (label) {
        label.remove();
        this.edgeLabelEls.delete(e.id);
      }
    }
    for (const [id, g] of this.edgeEls) if (!seen.has(id)) { g.remove(); this.edgeEls.delete(id); }
    for (const [id, l] of this.edgeLabelEls) if (!seen.has(id)) { l.remove(); this.edgeLabelEls.delete(id); }
    this.fire('edges');
  }

  /** Midpoint of an edge in world units, for placing its label editor. */
  edgeMid(id: string): Point | null {
    return this.edgeGeometry(id)?.mid ?? null;
  }

  // ── operations ────────────────────────────────────────────

  /** Create a card of a kind centred on a world point, select it, optionally start editing. */
  createCard(kind: string, at: Point, opts: { edit?: boolean; data?: Partial<RawNode>; size?: { width: number; height: number }; topLeft?: boolean } = {}): RawNode | null {
    const type = getCardType(kind);
    if (!type) { new Notice(t('This card type is not available yet.')); return null; }
    const size = opts.size ?? type.defaultSize;
    const base = type.create?.({ settings: this.settings }) ?? {};
    let x = Math.round(opts.topLeft ? at.x : at.x - size.width / 2), y = Math.round(opts.topLeft ? at.y : at.y - size.height / 2);
    if (this.settings.snapToGrid) { x = snap(x, this.settings.gridSize); y = snap(y, this.settings.gridSize); }
    const id = newId();
    const node = this.model.transact(() => this.model.addNode({
      type: 'text', ...base, ...opts.data,
      id, x, y, width: size.width, height: size.height,
    } as RawNode), `!create:${id}`);
    this.select([node.id]);
    if (opts.edit) {
      this.freshCardId = node.id;
      window.setTimeout(() => this.startEditing(node.id), 0);
    }
    return node;
  }

  deleteSelection(): void {
    const nodes = [...this.selection], edges = [...this.edgeSelection];
    if (!nodes.length && !edges.length) return;
    this.stopEditing();
    this.model.transact(() => {
      this.model.removeEdges(edges);
      this.model.removeNodes(nodes);
    });
    this.clearSelection();
  }

  /** Nodes fully inside a group's rect (the group's members). */
  groupMembers(group: RawNode): RawNode[] {
    const r = nodeRect(group);
    return this.model.nodes.filter(n => n.id !== group.id && n.x >= r.x && n.y >= r.y
      && n.x + n.width <= r.x + r.width && n.y + n.height <= r.y + r.height);
  }

  /** Wrap the selection in a new group. */
  groupSelection(): void {
    const sel = this.selectedNodes();
    const rect = unionRect(sel.map(nodeRect));
    if (!rect) return;
    const pad = 32;
    const g = this.model.transact(() => this.model.addNode({
      type: 'group', label: t('Group'),
      x: rect.x - pad, y: rect.y - pad - 8, width: rect.width + pad * 2, height: rect.height + pad * 2 + 8,
    }));
    this.select([g.id]);
  }

  setColor(color: string | undefined): void {
    if (this.colorGesture) { this.commitColor(color); return; }
    const nodes = this.selectedNodes();
    const edges = [...this.edgeSelection].map(id => this.model.edge(id)).filter((e): e is RawEdge => !!e);
    if (!nodes.length && !edges.length) return;
    this.model.transact(() => {
      this.paintColor(color);
      for (const n of nodes) this.model.touch(n.id);
      if (edges.length) this.model.touchEdges();
    });
  }

  private paintColor(color: string | undefined): { ids: string[]; edges: boolean } {
    const nodes = this.selectedNodes();
    const edges = [...this.edgeSelection].map(id => this.model.edge(id)).filter((e): e is RawEdge => !!e);
    for (const n of nodes) {
      if (n.vc?.kind === 'drawing') {
        // Drawings take the colour as their ink.
        recolorDrawing(n, color ? (cssColor(color) ?? color) : 'currentColor');
        if (color) n.color = color; else delete n.color;
      } else if (color) n.color = color; else delete n.color;
    }
    for (const e of edges) { if (color) e.color = color; else delete e.color; }
    return { ids: nodes.map(n => n.id), edges: edges.length > 0 };
  }

  private colorGesture: ReturnType<BoardModel['beginGesture']> | null = null;

  /** Show a colour on the selection while it is being picked; commitColor() makes it one undo step. */
  previewColor(color: string): void {
    if (!this.colorGesture) this.colorGesture = this.model.beginGesture();
    const r = this.paintColor(color);
    this.colorGesture.preview(r.ids, r.edges);
  }

  /** Keep whatever colour is being previewed (a panel closed mid-pick). */
  finishColorPreview(): void {
    const g = this.colorGesture;
    if (!g) return;
    this.colorGesture = null;
    g.end();
  }

  commitColor(color: string | undefined): void {
    const g = this.colorGesture;
    if (!g) { this.setColor(color); return; }
    const r = this.paintColor(color);
    g.preview(r.ids, r.edges);
    this.colorGesture = null;
    g.end();
  }

  reorderSelection(where: 'front' | 'back'): void {
    const ids = [...this.selection];
    if (!ids.length) return;
    this.model.transact(() => this.model.reorder(ids, where));
  }

  undo(): void {
    this.stopEditing();
    if (this.model.undo()) this.refreshSelection();
  }

  redo(): void {
    this.stopEditing();
    if (this.model.redo()) this.refreshSelection();
  }

  /** Icon helper for UI modules. */
  icon(el: HTMLElement, name: string): void { setIcon(el, name); }
}

/** Zoom levels the + / − buttons and ⌘= / ⌘− step through. */
export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

/** The next level up or down from `z` (a zoom between levels goes to the neighbour on that side). */
export function nextZoomStep(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find(s => s > z * 1.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i] < z * 0.999) return ZOOM_STEPS[i];
  return ZOOM_STEPS[0];
}

export function snap(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}
