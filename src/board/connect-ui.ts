import { Notice, setIcon, setTooltip } from 'obsidian';
import type { Board } from './board';
import type { RawEdge, RawNode, Side } from '../model/canvas-file';
import type { Point } from './viewport';
import {
  SIDES, edgeGeometry, nearestOnOutline, pinPoint, pinTs, rectOf, routeOf, vcOf,
  type EdgeVc, type Route,
} from './connections';
import { cssColor } from '../cards/util';
import { t } from '../i18n';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** How close (screen px) the pointer must be to a pin to snap to it. */
const PIN_SNAP = 14;
/** A press that moves less than this is a click. */
const CLICK_SLOP = 4;

/** What one end of a connection is being attached to. */
type EndSpec =
  | { kind: 'free'; p: Point }
  | { kind: 'pin'; id: string; side: Side; t: number }
  | { kind: 'float'; id: string };

type Pin = { side: Side; t: number };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Write an end into an edge. */
export function setEnd(e: RawEdge, which: 'from' | 'to', end: EndSpec): void {
  const vc: EdgeVc & Record<string, unknown> = { ...(e.vc ?? {}) } as EdgeVc & Record<string, unknown>;
  const nodeKey = which === 'from' ? 'fromNode' : 'toNode';
  const sideKey = which === 'from' ? 'fromSide' : 'toSide';
  const tKey = which === 'from' ? 'fromT' : 'toT';
  const floatKey = which === 'from' ? 'fromFloat' : 'toFloat';
  delete vc[which]; delete vc[tKey]; delete vc[floatKey];
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

/** Swap a connection's direction (ends, sides, pins, arrowheads). */
export function reverseEdge(e: RawEdge): void {
  const vc = { ...(e.vc ?? {}) } as EdgeVc & Record<string, unknown>;
  const swap = (a: string, b: string, obj: Record<string, unknown>) => {
    const x = obj[a], y = obj[b];
    if (y === undefined) delete obj[a]; else obj[a] = y;
    if (x === undefined) delete obj[b]; else obj[b] = x;
  };
  e.fromEnd ??= 'none';
  e.toEnd ??= 'arrow';
  swap('fromNode', 'toNode', e);
  swap('fromSide', 'toSide', e);
  swap('fromEnd', 'toEnd', e);
  swap('fromT', 'toT', vc);
  swap('fromFloat', 'toFloat', vc);
  swap('from', 'to', vc);
  if (typeof vc.bend === 'number') vc.bend = -vc.bend;
  e.vc = vc;
}

function sameEnd(e: RawEdge, which: 'from' | 'to', end: EndSpec): boolean {
  const id = which === 'from' ? e.fromNode : e.toNode;
  if (end.kind === 'free' || !id || id !== end.id) return false;
  const vc = vcOf(e);
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
  private pinHost: RawNode | null = null;
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

  /** Pins along every side of a card, or none. */
  showPins(n: RawNode | null, active?: Pin | null): void {
    this.pinHost = n;
    this.pinsEl.empty();
    if (!n) return;
    const r = rectOf(n);
    const zoom = this.board.vp.zoom;
    for (const side of SIDES) {
      const along = side === 'top' || side === 'bottom' ? r.width : r.height;
      for (const tt of pinTs(along, zoom)) {
        const p = pinPoint(r, side, tt);
        const s = this.board.vp.toScreen(p.x, p.y);
        const d = this.pinsEl.createDiv('vc-pin');
        d.style.transform = `translate(${s.x}px, ${s.y}px)`;
        if (active && active.side === side && Math.abs(active.t - tt) < 0.001) d.addClass('is-active');
      }
    }
  }

  private refreshPins(): void {
    if (this.pinHost) {
      const n = this.board.model.node(this.pinHost.id);
      this.showPins(n && this.board.tool === 'connect' ? n : null);
    }
  }

  /** The pin of `n` near a world point, if within snapping distance. */
  pinNear(n: RawNode, w: Point): Pin | null {
    const r = rectOf(n);
    const zoom = this.board.vp.zoom;
    let best: (Pin & { d: number }) | null = null;
    for (const side of SIDES) {
      const along = side === 'top' || side === 'bottom' ? r.width : r.height;
      for (const tt of pinTs(along, zoom)) {
        const p = pinPoint(r, side, tt);
        const d = Math.hypot(p.x - w.x, p.y - w.y) * zoom;
        if (d <= PIN_SNAP && (!best || d < best.d)) best = { side, t: tt, d };
      }
    }
    return best ? { side: best.side, t: best.t } : null;
  }

  /** Hover with the Connect tool. */
  hover(w: Point): void {
    if (this.busy) return;
    const n = this.board.nodeAt(w.x, w.y, 10 / this.board.vp.zoom);
    this.showPins(n, n ? this.pinNear(n, w) : null);
  }

  // ── drawing a new connection ────────────────────────────

  /** Pointer down with the Connect tool (on a card, or on empty board). */
  startConnect(e: PointerEvent): void {
    const board = this.board;
    const start = board.clientToWorld(e.clientX, e.clientY);
    const fromNode = board.nodeAt(start.x, start.y, 10 / board.vp.zoom);
    let from: EndSpec;
    if (fromNode) {
      const pin = this.pinNear(fromNode, start);
      from = pin ? { kind: 'pin', id: fromNode.id, ...pin } : { kind: 'float', id: fromNode.id };
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
      const over = board.nodeAt(w.x, w.y, 10 / board.vp.zoom);
      const target = over && (from.kind === 'free' || over.id !== from.id) ? over : null;
      if (target) {
        const pin = this.pinNear(target, w);
        to = pin ? { kind: 'pin', id: target.id, ...pin } : { kind: 'float', id: target.id };
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
      if (!moved) {
        // A click on empty board drops a default arrow; a click on a card does nothing.
        if (from.kind === 'free') this.create(from, { kind: 'free', p: { x: start.x + 160, y: start.y } });
        return;
      }
      const end = to as EndSpec | null;
      if (!end) return;
      const dist = Math.hypot(ev.clientX - sx, ev.clientY - sy);
      // A short drag off a card onto empty board is a slip, not a line.
      if (end.kind === 'free' && from.kind !== 'free' && dist < 24) return;
      if (end.kind === 'free' && from.kind === 'free' && dist < 12) return;
      this.create(from, end);
    };

    const doc = board.root.ownerDocument;
    const up = (ev: PointerEvent) => finish(ev);
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(null); } };
    const cleanup = () => {
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      doc.removeEventListener('keydown', key, true);
    };
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
    doc.addEventListener('keydown', key, true);
  }

  private defaultRoute(): Route {
    return this.board.settings.defaultRoute ?? 'straight';
  }

  private create(from: EndSpec, to: EndSpec): void {
    const board = this.board;
    if (from.kind !== 'free' && to.kind !== 'free' && from.id === to.id) return;
    // The very same connection again (same cards, same pins) is refused.
    const dup = board.model.edges.find(ed => (sameEnd(ed, 'from', from) && sameEnd(ed, 'to', to)) || (sameEnd(ed, 'from', to) && sameEnd(ed, 'to', from)));
    if (dup) { new Notice(t('These two cards are already connected this way.')); board.selectEdges([dup.id]); return; }
    const edge = board.model.transact(() => {
      const ed = board.model.addEdge({ fromNode: '', toNode: '', fromEnd: 'none', toEnd: 'arrow', vc: { route: this.defaultRoute() } });
      setEnd(ed, 'from', from);
      setEnd(ed, 'to', to);
      return ed;
    });
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
        const shape = edgeGeometry(ed, id => this.board.model.node(id));
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
        this.board.model.transact(() => { setEnd(ed, which, { kind: 'float', id: end.id }); this.board.model.touchEdges(); });
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
    const otherId = which === 'from' ? ed.toNode : ed.fromNode;
    const gesture = board.model.beginGesture();
    this.busy = true;
    const doc = board.root.ownerDocument;
    let moved = false;
    const sx = e.clientX, sy = e.clientY;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < CLICK_SLOP) return;
      moved = true;
      const w = board.clientToWorld(ev.clientX, ev.clientY);
      const over = board.nodeAt(w.x, w.y, 10 / board.vp.zoom);
      const target = over && over.id !== otherId ? over : null;
      let end: EndSpec;
      if (target) {
        const pin = this.pinNear(target, w);
        end = pin ? { kind: 'pin', id: target.id, ...pin } : { kind: 'float', id: target.id };
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

  private buildPanel(): void {
    const p = this.board.uiEl.createDiv('vc-edge-panel');
    this.panel = p;
    p.addEventListener('pointerdown', e => e.stopPropagation());
    p.addEventListener('dblclick', e => e.stopPropagation());
    p.addEventListener('wheel', e => e.stopPropagation());
    const group = (cls = '') => p.createDiv(`vc-ep-group ${cls}`.trim());
    const button = (host: HTMLElement, key: string, label: string, icon: string | ((el: HTMLElement) => void), onClick: () => void) => {
      const b = host.createDiv({ cls: 'vc-ep-btn clickable-icon', attr: { 'data-key': key, role: 'button', 'aria-label': label } });
      if (typeof icon === 'string') setIcon(b, icon); else icon(b);
      setTooltip(b, label, { placement: 'top' });
      b.addEventListener('click', onClick);
      return b;
    };

    // Label
    const lg = group('vc-ep-label');
    const input = lg.createEl('input', { type: 'text', placeholder: t('Label'), cls: 'vc-ep-input' });
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { input.blur(); this.board.root.focus({ preventScroll: true }); } });
    input.addEventListener('input', () => {
      const v = input.value;
      this.apply(e => { if (v.trim()) e.label = v; else delete e.label; }, `!edge-label:${this.panelFor}`);
    });
    const size = lg.createDiv('vc-ep-size');
    setTooltip(size, t('Label size'), { placement: 'top' });
    const sizeDown = size.createDiv({ cls: 'vc-ep-step clickable-icon', attr: { role: 'button' } });
    setIcon(sizeDown, 'minus');
    const sizeVal = size.createDiv('vc-ep-size-val');
    const sizeUp = size.createDiv({ cls: 'vc-ep-step clickable-icon', attr: { role: 'button' } });
    setIcon(sizeUp, 'plus');
    const stepSize = (d: number) => {
      const cur = this.labelSize(this.selectedEdges()[0]);
      const next = Math.min(40, Math.max(10, cur + d));
      this.apply(e => { (e.vc as EdgeVc).labelSize = next; }, `!edge-size:${this.panelFor}`);
    };
    sizeDown.addEventListener('click', () => stepSize(-2));
    sizeUp.addEventListener('click', () => stepSize(2));

    // Colour
    const cg = group('vc-ep-colors');
    const sw = (c: string | undefined, label: string) => {
      const b = cg.createDiv({ cls: 'vc-ep-swatch', attr: { 'data-key': `color:${c ?? ''}`, role: 'button', 'aria-label': label } });
      if (c) b.style.background = cssColor(c) ?? ''; else b.addClass('is-none');
      setTooltip(b, label, { placement: 'top' });
      b.addEventListener('click', () => this.apply(e => { if (c) e.color = c; else delete e.color; }));
    };
    sw(undefined, t('Default'));
    const names = ['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Purple'];
    for (let i = 1; i <= 6; i++) sw(String(i), t(names[i - 1]));
    const custom = cg.createDiv({ cls: 'vc-ep-swatch is-custom', attr: { 'data-key': 'color:custom', 'aria-label': t('Custom colour') } });
    setTooltip(custom, t('Custom colour'), { placement: 'top' });
    const picker = custom.createEl('input', { type: 'color' });
    picker.addEventListener('input', () => this.apply(e => { e.color = picker.value; }, `!edge-color:${this.panelFor}`));

    // Thickness and dash
    const tg = group();
    for (const w of [2, 4, 6]) {
      button(tg, `width:${w}`, t('Thickness {n}', { n: w }), el => lineIcon(el, { width: w / 1.3 }), () => this.apply(e => { if (w === 2) delete (e.vc as EdgeVc).width; else (e.vc as EdgeVc).width = w; }));
    }
    const dg = group();
    button(dg, 'dash:0', t('Solid'), el => lineIcon(el, {}), () => this.apply(e => { delete (e.vc as EdgeVc).dash; }));
    button(dg, 'dash:1', t('Dashed'), el => lineIcon(el, { dash: true }), () => this.apply(e => { (e.vc as EdgeVc).dash = true; }));

    // Arrowheads
    const ag = group();
    const ends: [string, string, 'none' | 'arrow', 'none' | 'arrow'][] = [
      ['none', 'No arrowheads', 'none', 'none'], ['end', 'Arrow at end', 'none', 'arrow'], ['both', 'Arrows at both ends', 'arrow', 'arrow'],
    ];
    for (const [k, label, fe, te] of ends) {
      button(ag, `ends:${k}`, t(label), el => lineIcon(el, { start: fe === 'arrow', end: te === 'arrow' }), () => this.apply(e => { e.fromEnd = fe; e.toEnd = te; }));
    }
    button(ag, 'reverse', t('Reverse direction'), 'arrow-left-right', () => this.apply(e => reverseEdge(e)));

    // Route
    const rg = group();
    const routes: [Route, string][] = [['straight', 'Straight'], ['curve', 'Curved'], ['elbow', 'Elbow']];
    for (const [r, label] of routes) {
      button(rg, `route:${r}`, t(label), el => routeIcon(el, r), () => this.apply(e => { (e.vc as EdgeVc).route = r; delete (e.vc as EdgeVc).bend; }));
    }

    // Delete
    const xg = group();
    const del = button(xg, 'delete', t('Delete'), 'trash-2', () => this.board.deleteSelection());
    del.addClass('is-danger');
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
    on('ends:end', ends === 'none-arrow');
    on('ends:both', ends === 'arrow-arrow');
    const route = all(e => routeOf(e));
    for (const r of ['straight', 'curve', 'elbow']) on(`route:${r}`, route === r);
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
