import { Notice, setIcon, setTooltip } from 'obsidian';
import type { Board } from './board';
import type { RawEdge, RawNode, Side } from '../model/canvas-file';
import type { Point } from './viewport';
import type { Rect } from '../model/board-model';
import {
  edgeGeometry, pinOnOutline, pinPoint, rectOf, reverseEdge, routeOf, vcOf,
  type EdgeVc, type Route,
} from './connections';
import { cssColor } from '../cards/util';
import { t } from '../i18n';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** How close (screen px) the pointer must be to a card's edge to attach there. */
const PIN_REACH = 14;
/** Within this (screen px) along the edge, the point snaps to a regular pin (such as the middle). */
const PIN_SNAP = 6;
/** A press that moves less than this is a click. */
const CLICK_SLOP = 4;

/** What one end of a connection is being attached to. */
type EndSpec =
  | { kind: 'free'; p: Point }
  | { kind: 'pin'; id: string; side: Side; t: number; topic?: string }
  | { kind: 'float'; id: string; topic?: string };

/** A point on a card's edge; `topic` when it is on a mind map topic's edge. */
type Pin = { side: Side; t: number; topic?: string };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Write an end into an edge. */
export function setEnd(e: RawEdge, which: 'from' | 'to', end: EndSpec): void {
  const vc: EdgeVc & Record<string, unknown> = { ...(e.vc ?? {}) };
  const nodeKey = which === 'from' ? 'fromNode' : 'toNode';
  const sideKey = which === 'from' ? 'fromSide' : 'toSide';
  const tKey = which === 'from' ? 'fromT' : 'toT';
  const floatKey = which === 'from' ? 'fromFloat' : 'toFloat';
  const topicKey = which === 'from' ? 'fromTopic' : 'toTopic';
  delete vc[which]; delete vc[tKey]; delete vc[floatKey]; delete vc[topicKey];
  if (end.kind !== 'free' && end.topic) vc[topicKey] = end.topic;
  if (end.kind === 'free') {
    e[nodeKey] = '';
    delete e[sideKey];
    vc[which] = { x: Math.round(end.p.x), y: Math.round(end.p.y) };
  } else if (end.kind === 'pin') {
    e[nodeKey] = end.id;
    e[sideKey] = end.side;
    if (Math.abs(end.t - 0.5) > 0.001) vc[tKey] = round3(end.t);
  } else {
    e[nodeKey] = end.id;
    delete e[sideKey];
    vc[floatKey] = true;
  }
  e.vc = vc;
}

/** An edge's end as an EndSpec (enough to compare cards and topics). */
function endSpecOf(e: RawEdge, which: 'from' | 'to'): EndSpec {
  const vc = vcOf(e);
  const id = which === 'from' ? e.fromNode : e.toNode;
  if (!id) return { kind: 'free', p: vc[which] ?? { x: 0, y: 0 } };
  return { kind: 'float', id, topic: which === 'from' ? vc.fromTopic : vc.toTopic };
}

/** Both ends on one card is a loop, refused, unless they are two different topics of a mind map. */
function sameCard(a: EndSpec, b: EndSpec): boolean {
  if (a.kind === 'free' || b.kind === 'free' || a.id !== b.id) return false;
  return !a.topic || !b.topic || a.topic === b.topic;
}

function sameEnd(e: RawEdge, which: 'from' | 'to', end: EndSpec): boolean {
  const id = which === 'from' ? e.fromNode : e.toNode;
  if (end.kind === 'free' || !id || id !== end.id) return false;
  const vc = vcOf(e);
  if ((which === 'from' ? vc.fromTopic : vc.toTopic) !== end.topic) return false;
  const float = (which === 'from' ? vc.fromFloat : vc.toFloat) || !(which === 'from' ? e.fromSide : e.toSide);
  if (end.kind === 'float') return !!float;
  if (float) return false;
  const side = which === 'from' ? e.fromSide : e.toSide;
  const tt = (which === 'from' ? vc.fromT : vc.toT) ?? 0.5;
  return side === end.side && Math.abs(tt - end.t) < 0.001;
}

/**
 * Connections: the Connect tool (pins, drawing new lines), selected-line
 * handles (ends, bend) and the floating properties panel.
 */
export class ConnectController {
  private pinsEl: HTMLElement;
  private handlesEl: HTMLElement;
  private panel: HTMLElement | null = null;
  private panelFor = '';
  private panelCleanup: (() => void) | null = null;
  private pinHost: RawNode | null = null;
  private pinActive: Pin | null = null;
  private busy = false;

  constructor(private board: Board) {
    this.pinsEl = board.overlayEl.createDiv('vc-pins');
    this.handlesEl = board.overlayEl.createDiv('vc-edge-handles');
    const refresh = () => { this.refreshHandles(); this.refreshPins(); };
    board.on('viewport', refresh);
    board.on('edges', () => { this.refreshHandles(); this.syncPanel(); });
    board.on('selection', () => { this.refreshHandles(); this.syncPanel(); });
    board.on('tool', () => { this.showPins(null); this.refreshHandles(); });
    board.addDisposer(() => this.closePanel());
  }

  // ── pins (Connect tool) ─────────────────────────────────

  /** The dot where a connection would attach on a card (the pointer is near its edge), or none. */
  showPins(n: RawNode | null, active?: Pin | null): void {
    this.pinHost = n;
    this.pinActive = active ?? null;
    this.pinsEl.empty();
    if (!n || !active) return;
    const p = pinPoint(this.areaRect(n, active.topic), active.side, active.t);
    const s = this.board.vp.toScreen(p.x, p.y);
    const d = this.pinsEl.createDiv('vc-pin is-active');
    d.style.transform = `translate(${s.x}px, ${s.y}px)`;
  }

  private refreshPins(): void {
    if (this.pinHost) {
      const n = this.board.model.node(this.pinHost.id);
      this.showPins(n && this.board.tool === 'connect' ? n : null, this.pinActive);
    }
  }

  /** The point on the edge of `n` near a world point (anywhere along it), if the pointer is close enough. */
  pinNear(n: RawNode, w: Point): Pin | null {
    const area = this.areaAt(n, w);
    const pin = pinOnOutline(area.rect, w, this.board.vp.zoom, PIN_REACH, PIN_SNAP);
    return pin ? { ...pin, topic: area.topic } : null;
  }

  /** What a connection end at a world point on `n` attaches to: a point on its edge, or the card (or topic) itself. */
  private endAt(n: RawNode, w: Point, pin = this.pinNear(n, w)): EndSpec {
    return pin ? { kind: 'pin', id: n.id, ...pin } : { kind: 'float', id: n.id, topic: this.areaAt(n, w).topic };
  }

  /** The part of `n` a connection attaches to at a world point: a mind map's topic there, else the card. */
  private areaAt(n: RawNode, w: Point): { rect: Rect; topic?: string } {
    const h = this.board.cards.get(n.id)?.handle;
    const topic = h?.topicAt?.(w.x, w.y, PIN_REACH / this.board.vp.zoom);
    const rect = topic ? h?.topicRect?.(topic) : null;
    return rect && topic ? { rect, topic } : { rect: rectOf(n) };
  }

  private areaRect(n: RawNode, topic?: string): Rect {
    return (topic && this.board.cards.get(n.id)?.handle.topicRect?.(topic)) || rectOf(n);
  }

  /**
   * The card a connection would attach to at a world point: the one under it, or a card one of
   * whose pins is right there (a mind map's pins sit on the edge of its topics, which only take a
   * pointer on the topics themselves).
   */
  private targetAt(w: Point, except?: string): RawNode | null {
    const board = this.board;
    const n = board.nodeAt(w.x, w.y, 10 / board.vp.zoom);
    if (n && n.id !== except) return n;
    const nodes = board.model.nodes;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const m = nodes[i];
      if (m.id === except || m.type === 'group' || m.vc?.kind !== 'mindmap') continue;
      if (this.pinNear(m, w)) return m;
    }
    return n && n.id !== except ? n : null;
  }

  /** Hover with the Connect tool. */
  hover(w: Point): void {
    if (this.busy) return;
    const n = this.targetAt(w);
    this.showPins(n, n ? this.pinNear(n, w) : null);
  }

  // ── drawing a new connection ────────────────────────────

  /** Pointer down with the Connect tool (on a card, or on empty board). */
  startConnect(e: PointerEvent): void {
    const board = this.board;
    const start = board.clientToWorld(e.clientX, e.clientY);
    const fromNode = this.targetAt(start);
    let from: EndSpec;
    if (fromNode) {
      const pin = this.pinNear(fromNode, start);
      from = this.endAt(fromNode, start, pin);
    } else {
      from = { kind: 'free', p: start };
    }
    const preview = this.makePreview();
    let to: EndSpec | null = null;
    let moved = false;
    this.busy = true;
    const sx = e.clientX, sy = e.clientY;

    const draft = (end: EndSpec): RawEdge => {
      const ed: RawEdge = { id: '__preview', fromNode: '', toNode: '', toEnd: 'arrow', vc: { route: this.defaultRoute() } };
      setEnd(ed, 'from', from);
      setEnd(ed, 'to', end);
      return ed;
    };

    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < CLICK_SLOP) return;
      moved = true;
      const w = board.clientToWorld(ev.clientX, ev.clientY);
      // Another topic of the same mind map is a fine target too.
      const target = this.targetAt(w, from.kind === 'free' || from.topic ? undefined : from.id);
      const pin = target ? this.pinNear(target, w) : null;
      const cand = target ? this.endAt(target, w, pin) : null;
      if (target && cand && !sameCard(from, cand)) {
        to = cand;
        this.showPins(target, pin);
      } else {
        to = { kind: 'free', p: w };
        this.showPins(fromNode, from.kind === 'pin' ? from : null);
      }
      preview.draw(draft(to));
    };

    const finish = (ev: PointerEvent | null) => {
      cleanup();
      preview.remove();
      this.busy = false;
      this.showPins(board.tool === 'connect' ? fromNode : null);
      if (!ev) return;
      const end = to;
      if (!end) return;
      const dist = Math.hypot(ev.clientX - sx, ev.clientY - sy);
      // A short drag off a card onto empty board is a slip, not a line.
      if (end.kind === 'free' && from.kind !== 'free' && dist < 24) return;
      if (end.kind === 'free' && from.kind === 'free' && dist < 12) return;
      this.create(from, end);
    };

    const doc = board.root.ownerDocument;
    /** After a click (not a drag) the line follows the pointer until a second click places its end. */
    let waiting = false;
    const up = (ev: PointerEvent) => {
      if (waiting) { ev.stopPropagation(); return; }
      if (moved) { finish(ev); return; }
      waiting = true;
      moved = true; // from now on every move updates the line
      move(ev);
    };
    const second = (ev: PointerEvent) => {
      if (!waiting) return;
      // A press on the board's own controls (or outside the board) drops the line and does its job.
      const tgt = ev.target as Node;
      if (board.tool !== 'connect' || !board.root.contains(tgt) || board.uiEl.contains(tgt)) { finish(null); return; }
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.button !== 0) { finish(null); return; }
      move(ev);
      finish(ev);
      // The release of this second click belongs to nothing.
      const swallow = (u: PointerEvent) => { u.stopPropagation(); doc.removeEventListener('pointerup', swallow, true); };
      doc.addEventListener('pointerup', swallow, true);
    };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(null); } };
    const cleanup = () => {
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      doc.removeEventListener('pointerdown', second, true);
      doc.removeEventListener('keydown', key, true);
    };
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
    doc.addEventListener('pointerdown', second, true);
    doc.addEventListener('keydown', key, true);
  }

  private defaultRoute(): Route {
    return this.board.settings.defaultRoute ?? 'straight';
  }

  private create(from: EndSpec, to: EndSpec): void {
    const board = this.board;
    if (sameCard(from, to)) return;
    // The very same connection again (same cards, same pins) is refused.
    const dup = board.model.edges.find(ed => (sameEnd(ed, 'from', from) && sameEnd(ed, 'to', to)) || (sameEnd(ed, 'from', to) && sameEnd(ed, 'to', from)));
    if (dup) { new Notice(t('These two cards are already connected this way.')); board.selectEdges([dup.id]); return; }
    const edge = board.model.transact(() => {
      const ed = board.model.addEdge({ fromNode: '', toNode: '', fromEnd: 'none', toEnd: 'arrow', vc: { route: this.defaultRoute() } });
      setEnd(ed, 'from', from);
      setEnd(ed, 'to', to);
      return ed;
    });
    // One connection per use of the tool: back to selecting, with the new connection selected.
    board.setTool('select');
    this.showPins(null);
    board.selectEdges([edge.id]);
  }

  private makePreview(): { draw(e: RawEdge): void; remove(): void } {
    const g = document.createElementNS(SVG_NS, 'g');
    g.classList.add('vc-edge', 'is-preview');
    const line = document.createElementNS(SVG_NS, 'path');
    line.classList.add('vc-edge-line');
    const arrow = document.createElementNS(SVG_NS, 'path');
    arrow.classList.add('vc-edge-arrow');
    g.append(line, arrow);
    this.board.edgeLayer.appendChild(g);
    return {
      draw: (ed) => {
        const shape = edgeGeometry(ed, id => this.board.model.node(id), this.board.areaOf);
        if (!shape) return;
        line.setAttribute('d', shape.d);
        arrow.setAttribute('d', shape.endArrow);
      },
      remove: () => g.remove(),
    };
  }

  // ── selected connection: handles ────────────────────────

  private soleEdge(): RawEdge | null {
    const b = this.board;
    if (b.selection.size || b.edgeSelection.size !== 1) return null;
    return b.model.edge([...b.edgeSelection][0]) ?? null;
  }

  refreshHandles(): void {
    if (this.busy) return;
    this.handlesEl.empty();
    const edge = this.soleEdge();
    if (!edge) return;
    const g = this.board.edgeGeometry(edge.id);
    if (!g) return;
    const vp = this.board.vp;
    const place = (el: HTMLElement, p: Point) => {
      const s = vp.toScreen(p.x, p.y);
      el.style.transform = `translate(${s.x}px, ${s.y}px)`;
    };
    for (const which of ['from', 'to'] as const) {
      const end = which === 'from' ? g.a : g.b;
      const h = this.handlesEl.createDiv({ cls: `vc-edge-end is-${end.kind}` });
      setTooltip(h, end.kind === 'pin' ? t('Drag to re-attach · double-click to unpin') : t('Drag to re-attach'), { placement: 'top' });
      place(h, which === 'from' ? g.start : g.end);
      h.addEventListener('pointerdown', (e) => { if (e.button === 0) { e.stopPropagation(); e.preventDefault(); this.dragEnd(e, edge.id, which); } });
      h.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const ed = this.board.model.edge(edge.id);
        if (!ed || end.kind !== 'pin') return;
        const topic = which === 'from' ? vcOf(ed).fromTopic : vcOf(ed).toTopic;
        this.board.model.transact(() => { setEnd(ed, which, { kind: 'float', id: end.id, topic }); this.board.model.touchEdges(); });
      });
    }
    const bend = this.handlesEl.createDiv({ cls: 'vc-edge-bend' });
    setTooltip(bend, t('Drag to bend · double-click to straighten'), { placement: 'top' });
    place(bend, g.mid);
    bend.addEventListener('pointerdown', (e) => { if (e.button === 0) { e.stopPropagation(); e.preventDefault(); this.dragBend(e, edge.id); } });
    bend.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const ed = this.board.model.edge(edge.id);
      if (!ed) return;
      this.board.model.transact(() => { const vc = { ...(ed.vc ?? {}) }; delete vc.bend; ed.vc = vc; this.board.model.touchEdges(); });
    });
  }

  /** Drag one end of a connection to re-attach it (card, pin, or free point). */
  private dragEnd(e: PointerEvent, id: string, which: 'from' | 'to'): void {
    const board = this.board;
    const ed = board.model.edge(id);
    if (!ed) return;
    const other = which === 'from' ? endSpecOf(ed, 'to') : endSpecOf(ed, 'from');
    const gesture = board.model.beginGesture();
    this.busy = true;
    const doc = board.root.ownerDocument;
    let moved = false;
    const sx = e.clientX, sy = e.clientY;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < CLICK_SLOP) return;
      moved = true;
      const w = board.clientToWorld(ev.clientX, ev.clientY);
      const target = board.nodeAt(w.x, w.y, 10 / board.vp.zoom);
      const pin = target ? this.pinNear(target, w) : null;
      const cand = target ? this.endAt(target, w, pin) : null;
      let end: EndSpec;
      if (target && cand && !sameCard(cand, other)) {
        end = cand;
        this.showPins(target, pin);
      } else {
        end = { kind: 'free', p: w };
        this.showPins(null);
      }
      setEnd(ed, which, end);
      gesture.preview([], true);
    };
    const up = () => {
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      this.busy = false;
      this.showPins(null);
      if (moved) gesture.end(); else gesture.cancel();
      this.refreshHandles();
    };
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
  }

  /** Drag the middle of a connection sideways to bend it. */
  dragBend(e: PointerEvent, id: string): void {
    const board = this.board;
    const ed = board.model.edge(id);
    const g0 = board.edgeGeometry(id);
    if (!ed || !g0) return;
    const gesture = board.model.beginGesture();
    this.busy = true;
    const doc = board.root.ownerDocument;
    let moved = false;
    const sx = e.clientX, sy = e.clientY;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < CLICK_SLOP) return;
      moved = true;
      const w = board.clientToWorld(ev.clientX, ev.clientY);
      const g = board.edgeGeometry(id) ?? g0;
      let bend = (w.x - g.bendOrigin.x) * g.bendAxis.x + (w.y - g.bendOrigin.y) * g.bendAxis.y;
      if (Math.abs(bend) * board.vp.zoom < 6) bend = 0;
      const vc = { ...(ed.vc ?? {}) } as EdgeVc;
      if (bend) vc.bend = Math.round(bend); else delete vc.bend;
      ed.vc = vc as Record<string, unknown>;
      gesture.preview([], true);
    };
    const up = () => {
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      this.busy = false;
      if (moved) gesture.end(); else gesture.cancel();
      this.refreshHandles();
    };
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
  }

  /** Press on a line's body: select it; dragging bends it, or moves it when both ends are free. */
  pressEdge(e: PointerEvent, id: string): void {
    const board = this.board;
    board.selectEdges([id], e.shiftKey ? 'toggle' : 'replace');
    if (e.shiftKey) return;
    const ed = board.model.edge(id);
    if (!ed) return;
    if (ed.fromNode || ed.toNode) { this.dragBend(e, id); return; }
    // Both ends free: move the whole line.
    const vc0 = structuredClone(vcOf(ed));
    const start = board.clientToWorld(e.clientX, e.clientY);
    const gesture = board.model.beginGesture();
    this.busy = true;
    const doc = board.root.ownerDocument;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const w = board.clientToWorld(ev.clientX, ev.clientY);
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < CLICK_SLOP) return;
      moved = true;
      const dx = Math.round(w.x - start.x), dy = Math.round(w.y - start.y);
      const vc = { ...(ed.vc ?? {}) } as EdgeVc;
      if (vc0.from) vc.from = { x: vc0.from.x + dx, y: vc0.from.y + dy };
      if (vc0.to) vc.to = { x: vc0.to.x + dx, y: vc0.to.y + dy };
      ed.vc = vc as Record<string, unknown>;
      gesture.preview([], true);
    };
    const up = () => {
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      this.busy = false;
      if (moved) gesture.end(); else gesture.cancel();
      this.refreshHandles();
    };
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
  }

  // ── properties panel ────────────────────────────────────

  private selectedEdges(): RawEdge[] {
    const b = this.board;
    if (b.selection.size) return [];
    return [...b.edgeSelection].map(id => b.model.edge(id)).filter((x): x is RawEdge => !!x);
  }

  private syncPanel(): void {
    const edges = this.selectedEdges();
    if (!edges.length) { this.closePanel(); return; }
    const key = edges.map(e => e.id).join(',');
    if (this.panel && key === this.panelFor) { this.updatePanel(edges); return; }
    this.closePanel();
    this.panelFor = key;
    this.buildPanel();
    this.updatePanel(edges);
  }

  private closePanel(): void {
    this.panelCleanup?.();
    this.panelCleanup = null;
    this.panel?.remove();
    this.panel = null;
    this.panelFor = '';
  }

  /** Apply a change to every selected connection as one undo step. */
  private apply(fn: (e: RawEdge) => void, mergeKey?: string): void {
    const edges = this.selectedEdges();
    if (!edges.length) return;
    this.board.model.transact(() => {
      for (const e of edges) { e.vc = { ...(e.vc ?? {}) }; fn(e); if (e.vc && Object.keys(e.vc).length === 0) delete e.vc; }
      this.board.model.touchEdges();
    }, mergeKey);
  }

  /**
   * One compact row, like Boardmix: each group of choices is a single button showing the current
   * setting, opening a small panel of options above it (below it when the toolbar is at the top).
   */
  private buildPanel(): void {
    const p = this.board.uiEl.createDiv('vc-edge-panel');
    this.panel = p;
    p.addEventListener('pointerdown', e => e.stopPropagation());
    p.addEventListener('dblclick', e => e.stopPropagation());
    p.addEventListener('wheel', e => e.stopPropagation());
    const sep = () => p.createDiv('vc-ep-sep');
    const button = (host: HTMLElement, key: string, label: string, icon: string | ((el: HTMLElement) => void), onClick: () => void) => {
      const b = host.createDiv({ cls: 'vc-ep-btn clickable-icon', attr: { 'data-key': key, role: 'button', 'aria-label': label } });
      if (typeof icon === 'string') setIcon(b, icon); else icon(b);
      setTooltip(b, label, { placement: 'top' });
      b.addEventListener('click', onClick);
      return b;
    };

    // A trigger button and the panel of choices it opens.
    const pops: HTMLElement[] = [];
    const doc = p.ownerDocument;
    const closePops = () => { for (const x of pops) x.removeClass('is-open'); p.querySelectorAll('.vc-ep-trigger').forEach(el => el.removeClass('is-open')); };
    const outside = (e: PointerEvent) => { if (!p.contains(e.target as Node)) closePops(); };
    doc.addEventListener('pointerdown', outside, true);
    this.panelCleanup = () => doc.removeEventListener('pointerdown', outside, true);
    const dropdown = (key: string, label: string, onOpen?: (pop: HTMLElement) => void) => {
      const wrap = p.createDiv('vc-ep-drop');
      const trig = wrap.createDiv({ cls: 'vc-ep-btn vc-ep-trigger clickable-icon', attr: { 'data-trigger': key, role: 'button', 'aria-label': label } });
      trig.createDiv('vc-ep-face');
      setIcon(trig.createDiv('vc-ep-caret'), 'chevron-down');
      setTooltip(trig, label, { placement: 'top' });
      const pop = wrap.createDiv(`vc-ep-pop vc-ep-pop-${key}`);
      pops.push(pop);
      trig.addEventListener('click', () => {
        const open = !pop.hasClass('is-open');
        closePops();
        if (!open) return;
        pop.addClass('is-open');
        trig.addClass('is-open');
        onOpen?.(pop);
      });
      // Picking an option closes the panel (the label panel stays open for typing).
      if (key !== 'label') pop.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('.vc-ep-btn, .vc-ep-swatch:not(.is-custom)')) closePops(); });
      return pop;
    };
    const row = (host: HTMLElement, title?: string) => {
      if (title) host.createDiv({ cls: 'vc-ep-title', text: title });
      return host.createDiv('vc-ep-row');
    };

    // Colour
    const cp = row(dropdown('color', t('Colour')));
    const sw = (c: string | undefined, label: string) => {
      const b = cp.createDiv({ cls: 'vc-ep-swatch', attr: { 'data-key': `color:${c ?? ''}`, role: 'button', 'aria-label': label } });
      if (c) b.style.background = cssColor(c) ?? ''; else b.addClass('is-none');
      setTooltip(b, label, { placement: 'top' });
      b.addEventListener('click', () => this.apply(e => { if (c) e.color = c; else delete e.color; }));
    };
    sw(undefined, t('Default'));
    const names = ['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Purple'];
    for (let i = 1; i <= 6; i++) sw(String(i), t(names[i - 1]));
    const custom = cp.createDiv({ cls: 'vc-ep-swatch is-custom', attr: { 'data-key': 'color:custom', 'aria-label': t('Custom colour') } });
    setTooltip(custom, t('Custom colour'), { placement: 'top' });
    const picker = custom.createEl('input', { type: 'color' });
    picker.addEventListener('input', () => this.apply(e => { e.color = picker.value; }, `!edge-color:${this.panelFor}`));

    // Line style: thickness, then solid or dashed
    const lp = dropdown('line', t('Line style'));
    const tg = row(lp, t('Thickness'));
    for (const w of [2, 4, 6]) {
      button(tg, `width:${w}`, t('Thickness {n}', { n: w }), el => lineIcon(el, { width: w / 1.3 }), () => this.apply(e => { if (w === 2) delete (e.vc as EdgeVc).width; else (e.vc as EdgeVc).width = w; }));
    }
    const dg = row(lp, t('Line style'));
    button(dg, 'dash:0', t('Solid'), el => lineIcon(el, {}), () => this.apply(e => { delete (e.vc as EdgeVc).dash; }));
    button(dg, 'dash:1', t('Dashed'), el => lineIcon(el, { dash: true }), () => this.apply(e => { (e.vc as EdgeVc).dash = true; }));

    // Route
    const rp = row(dropdown('route', t('Line shape')));
    const routes: [Route, string][] = [['straight', 'Straight'], ['curve', 'Curved'], ['elbow', 'Elbow']];
    for (const [r, label] of routes) {
      button(rp, `route:${r}`, t(label), el => routeIcon(el, r), () => this.apply(e => { (e.vc as EdgeVc).route = r; delete (e.vc as EdgeVc).bend; }));
    }

    // Arrowheads
    const ap = row(dropdown('ends', t('Arrows')));
    const ends: [string, string, 'none' | 'arrow', 'none' | 'arrow'][] = [
      ['none', 'No arrowheads', 'none', 'none'], ['end', 'Arrow at end', 'none', 'arrow'], ['both', 'Arrows at both ends', 'arrow', 'arrow'],
    ];
    for (const [k, label, fe, te] of ends) {
      button(ap, `ends:${k}`, t(label), el => lineIcon(el, { start: fe === 'arrow', end: te === 'arrow' }), () => this.apply(e => {
        // Already one arrowhead, at the start (a reversed line): keep it there.
        if (k === 'end' && e.fromEnd === 'arrow' && (e.toEnd ?? 'arrow') === 'none') return;
        e.fromEnd = fe; e.toEnd = te;
      }));
    }
    button(p, 'reverse', t('Reverse direction'), 'arrow-left-right', () => this.apply(e => reverseEdge(e)));
    sep();

    // Label: its text and size
    let input: HTMLInputElement | null = null;
    const labelPop = dropdown('label', t('Label'), () => window.setTimeout(() => input?.focus(), 0));
    const lr = row(labelPop);
    input = lr.createEl('input', { type: 'text', placeholder: t('Label'), cls: 'vc-ep-input' });
    const inp = input;
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { inp.blur(); closePops(); this.board.root.focus({ preventScroll: true }); } });
    inp.addEventListener('input', () => {
      const v = inp.value;
      this.apply(e => { if (v.trim()) e.label = v; else delete e.label; }, `!edge-label:${this.panelFor}`);
    });
    const size = lr.createDiv('vc-ep-size');
    setTooltip(size, t('Label size'), { placement: 'top' });
    const sizeDown = size.createDiv({ cls: 'vc-ep-step clickable-icon', attr: { role: 'button' } });
    setIcon(sizeDown, 'minus');
    size.createDiv('vc-ep-size-val');
    const sizeUp = size.createDiv({ cls: 'vc-ep-step clickable-icon', attr: { role: 'button' } });
    setIcon(sizeUp, 'plus');
    const stepSize = (d: number) => {
      const cur = this.labelSize(this.selectedEdges()[0]);
      const next = Math.min(40, Math.max(10, cur + d));
      this.apply(e => { (e.vc as EdgeVc).labelSize = next; }, `!edge-size:${this.panelFor}`);
    };
    sizeDown.addEventListener('click', () => stepSize(-2));
    sizeUp.addEventListener('click', () => stepSize(2));
    sep();

    const del = button(p, 'delete', t('Delete'), 'trash-2', () => this.board.deleteSelection());
    del.addClass('is-danger');
  }

  /** Each trigger shows the current choice (blank when the selected connections differ). */
  private paintTriggers(p: HTMLElement, v: { color?: string; width?: number; dash?: boolean; route?: string; ends?: string; label?: string }): void {
    const face = (key: string) => {
      const f = p.querySelector<HTMLElement>(`[data-trigger="${key}"] .vc-ep-face`);
      f?.empty();
      return f;
    };
    const c = face('color');
    if (c) {
      const dot = c.createDiv('vc-ep-dot');
      if (v.color === undefined) dot.addClass('is-mixed');
      else if (v.color === '') dot.addClass('is-none');
      else dot.style.background = cssColor(v.color) ?? v.color;
    }
    const l = face('line');
    if (l) lineIcon(l, { width: (v.width ?? 2) / 1.3, dash: !!v.dash });
    const r = face('route');
    if (r) routeIcon(r, (v.route ?? 'straight') as Route);
    const a = face('ends');
    if (a) lineIcon(a, { start: v.ends === 'arrow-arrow' || v.ends === 'arrow-none', end: v.ends !== 'none-none' && v.ends !== 'arrow-none' });
    const tx = face('label');
    if (tx) setIcon(tx, 'type');
    p.querySelector('[data-trigger="label"]')?.toggleClass('has-value', !!v.label);
  }

  private labelSize(e: RawEdge | undefined): number {
    const s = e ? vcOf(e).labelSize : undefined;
    return typeof s === 'number' ? s : 14;
  }

  private updatePanel(edges: RawEdge[]): void {
    const p = this.panel;
    if (!p) return;
    const first = edges[0];
    const all = <T>(fn: (e: RawEdge) => T): T | undefined => {
      const v = fn(first);
      return edges.every(e => fn(e) === v) ? v : undefined;
    };
    const input = p.querySelector<HTMLInputElement>('.vc-ep-input');
    if (input && p.ownerDocument.activeElement !== input) input.value = all(e => e.label ?? '') ?? '';
    const sizeVal = p.querySelector<HTMLElement>('.vc-ep-size-val');
    sizeVal?.setText(String(this.labelSize(first)));
    const on = (key: string, v: boolean) => p.querySelector(`[data-key="${key}"]`)?.toggleClass('is-active', v);
    const color = all(e => e.color ?? '');
    p.querySelectorAll<HTMLElement>('.vc-ep-swatch').forEach(el => el.removeClass('is-active'));
    if (color !== undefined) {
      const preset = color === '' || /^[1-6]$/.test(color);
      on(preset ? `color:${color}` : 'color:custom', true);
      const custom = p.querySelector<HTMLElement>('.vc-ep-swatch.is-custom');
      if (custom) custom.style.background = preset ? '' : color;
    }
    const width = all(e => vcOf(e).width ?? 2);
    for (const w of [2, 4, 6]) on(`width:${w}`, width === w);
    const dash = all(e => !!vcOf(e).dash);
    on('dash:0', dash === false);
    on('dash:1', dash === true);
    const ends = all(e => `${e.fromEnd ?? 'none'}-${e.toEnd ?? 'arrow'}`);
    on('ends:none', ends === 'none-none');
    on('ends:end', ends === 'none-arrow' || ends === 'arrow-none');
    on('ends:both', ends === 'arrow-arrow');
    const route = all(e => routeOf(e));
    for (const r of ['straight', 'curve', 'elbow']) on(`route:${r}`, route === r);
    this.paintTriggers(p, { color, width, dash, route, ends, label: all(e => e.label ?? '') });
  }
}

// ── small drawn icons ─────────────────────────────────────────

function svgIcon(host: HTMLElement): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.classList.add('vc-ep-icon');
  host.appendChild(svg);
  return svg;
}

function svgPath(svg: SVGSVGElement, d: string, attrs: Record<string, string> = {}): void {
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v);
  svg.appendChild(p);
}

function lineIcon(host: HTMLElement, o: { width?: number; dash?: boolean; start?: boolean; end?: boolean }): void {
  const svg = svgIcon(host);
  const x0 = o.start ? 7 : 3, x1 = o.end ? 17 : 21;
  svgPath(svg, `M${x0} 12 H${x1}`, { 'stroke-width': String(o.width ?? 2), ...(o.dash ? { 'stroke-dasharray': '3 3', 'stroke-linecap': 'butt' } : {}) });
  if (o.end) svgPath(svg, 'M16 8 L21 12 L16 16 Z', { fill: 'currentColor', 'stroke-width': '1' });
  if (o.start) svgPath(svg, 'M8 8 L3 12 L8 16 Z', { fill: 'currentColor', 'stroke-width': '1' });
}

function routeIcon(host: HTMLElement, r: Route): void {
  const svg = svgIcon(host);
  if (r === 'straight') svgPath(svg, 'M4 19 L20 5');
  else if (r === 'curve') svgPath(svg, 'M4 19 C 12 19, 12 5, 20 5');
  else svgPath(svg, 'M4 19 H12 V5 H20');
}
