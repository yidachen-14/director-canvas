import { Platform } from 'obsidian';
import type { Board } from './board';
import { snap } from './board';
import { nodeRect, rectsIntersect, type Rect } from '../model/board-model';
import type { RawNode } from '../model/canvas-file';
import type { MapDrop } from '../cards/types';
import { cardKindOf, vcGet } from '../cards/util';
import { getCardType } from '../cards/registry';
import { ConnectController } from './connect-ui';
import { PenController } from './pen';
import { descriptionHeight } from '../cards/media';
import { DropLine, findBlockDrop, insertMarkdownAt, richAt, type Drop } from '../richtext/block-drag';
import { t as tr } from '../i18n';
import { placeCursor } from '../ui/cursor';
import { COLUMN_PAD, columnDropAt } from './columns';

type Zone = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const ZONE_CURSOR: Record<Zone, string> = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
};

const DRAG_THRESHOLD = 3;
const MIN_W = 40, MIN_H = 24;

/** Card kinds a Text card can be dropped into. */
const MERGE_INTO = ['note', 'sticky', 'callout', 'checklist'];

/** Card kinds that keep their aspect ratio when resized from a corner. */
const KEEP_ASPECT = new Set(['image', 'video', 'swatch']);

const isMod = (e: MouseEvent | KeyboardEvent) => (Platform.isMacOS ? e.metaKey : e.ctrlKey);

/** Wire pointer, wheel and keyboard handling to a board. */
export function attachInteractions(board: Board): void {
  const root = board.root;
  let spaceDown = false;
  let hoverZone: { id: string; zone: Zone } | null = null;
  let active: { kind: string; cleanup: () => void; cancel: () => void } | null = null;
  const connect = new ConnectController(board);
  const pen = new PenController(board);
  board.connections = connect;

  const editingTarget = (target: EventTarget | null): boolean => {
    if (!board.editingId) return false;
    const el = board.cards.get(board.editingId)?.el;
    return !!el && target instanceof Node && el.contains(target);
  };

  const nodeAt = (wx: number, wy: number): RawNode | null => board.nodeAt(wx, wy);

  /** Resize zone under a world point: a band just inside and outside each edge. */
  const zoneAt = (wx: number, wy: number, touch = false): { id: string; zone: Zone } | null => {
    // A finger needs wider bands, and only the selected cards offer them (else every touch near an edge would resize).
    const k = touch ? 2.6 : 1;
    const out = 6 * k / board.vp.zoom, inn = 5 * k / board.vp.zoom;
    const nodes = board.model.nodes;
    // Search cards first (they sit on top), then groups.
    const order = [...nodes.filter(n => n.type !== 'group').reverse(), ...nodes.filter(n => n.type === 'group').reverse()];
    for (const n of order) {
      if (board.editingId === n.id) continue;
      if (touch && !board.selection.has(n.id)) continue;
      if (getCardType(cardKindOf(n))?.fixedSize) {
        if (wx > n.x && wx < n.x + n.width && wy > n.y && wy < n.y + n.height) return null;
        continue;
      }
      const x0 = n.x, y0 = n.y, x1 = n.x + n.width, y1 = n.y + n.height;
      if (wx < x0 - out || wx > x1 + out || wy < y0 - out || wy > y1 + out) continue;
      const nearW = wx < x0 + inn, nearE = wx > x1 - inn, nearN = wy < y0 + inn, nearS = wy > y1 - inn;
      const corner = Math.max(inn * 2, 10 / board.vp.zoom);
      const cW = wx < x0 + corner, cE = wx > x1 - corner, cN = wy < y0 + corner, cS = wy > y1 - corner;
      if ((nearN && cW) || (nearW && cN)) return { id: n.id, zone: 'nw' };
      if ((nearN && cE) || (nearE && cN)) return { id: n.id, zone: 'ne' };
      if ((nearS && cW) || (nearW && cS)) return { id: n.id, zone: 'sw' };
      if ((nearS && cE) || (nearE && cS)) return { id: n.id, zone: 'se' };
      if (nearN) return { id: n.id, zone: 'n' };
      if (nearS) return { id: n.id, zone: 's' };
      if (nearW) return { id: n.id, zone: 'w' };
      if (nearE) return { id: n.id, zone: 'e' };
      // Inside this node, away from its edges: a node underneath can't be resized here.
      if (wx > x0 && wx < x1 && wy > y0 && wy < y1) return null;
    }
    return null;
  };

  const setCursor = (c: string) => { root.style.cursor = c; };

  /** The insertion line in a column while a card is dragged over it. */
  let colLine: HTMLElement | null = null;
  let colHot: HTMLElement | null = null;
  const showColumnDrop = (spot: { col: RawNode; y: number } | null) => {
    const el = spot ? board.cards.get(spot.col.id)?.el ?? null : null;
    if (colHot !== el) { colHot?.removeClass('is-drop-target'); el?.addClass('is-drop-target'); colHot = el; }
    if (!spot) { colLine?.remove(); colLine = null; return; }
    colLine ??= board.overlayEl.createDiv('vc-column-drop');
    const a = board.vp.toScreen(spot.col.x + COLUMN_PAD - 4, spot.y), b = board.vp.toScreen(spot.col.x + spot.col.width - COLUMN_PAD + 4, spot.y);
    colLine.style.transform = `translate(${a.x}px, ${a.y - 1.5}px)`;
    colLine.style.width = `${b.x - a.x}px`;
  };

  const baseCursor = () => {
    if (spaceDown || board.tool === 'hand') return 'grab';
    if (board.tool === 'select') return '';
    if (board.tool === 'pen' && root.hasClass('is-erasing')) return 'cell';
    const type = getCardType(board.tool);
    if (type && typeof type.icon === 'string') return placeCursor(type.icon);
    return 'crosshair';
  };

  board.on('tool', () => setCursor(baseCursor()));

  // ── hover ───────────────────────────────────────────────

  root.addEventListener('pointermove', (e) => {
    if (active || e.buttons) return;
    if (editingTarget(e.target)) { setCursor(''); return; }
    if (!(e.target instanceof Node) || !board.root.contains(e.target) || board.uiEl.contains(e.target)) return;
    const w = board.clientToWorld(e.clientX, e.clientY);
    if (board.tool === 'connect') {
      connect.hover(w);
      setCursor((e.target as HTMLElement).closest('[data-edge-id]') ? 'pointer' : 'crosshair');
      return;
    }
    if (board.tool !== 'select' || spaceDown) { setCursor(baseCursor()); hoverZone = null; return; }
    hoverZone = zoneAt(w.x, w.y);
    setCursor(hoverZone ? ZONE_CURSOR[hoverZone.zone] : '');
    root.toggleClass('is-zone-hover', !!hoverZone);
  });

  root.addEventListener('pointerleave', () => {
    if (!active) { hoverZone = null; setCursor(baseCursor()); }
  });

  // ── pointer down ────────────────────────────────────────

  root.addEventListener('pointerdown', (e) => {
    if (board.uiEl.contains(e.target as Node)) return;
    if (editingTarget(e.target)) return;
    // Interactive bits inside cards (links, checkboxes, inputs) keep their own clicks;
    // media controls only once their card is selected, so a first click selects it.
    const t = e.target as HTMLElement;
    // A player's control bar runs along the card's bottom edge: the resize band there still resizes.
    const pw = board.clientToWorld(e.clientX, e.clientY);
    const edgeOfBar = board.tool === 'select' && !!t.closest('.vc-video-ctrl, .vc-gif-ui') && !t.closest('.vc-vt, .vc-gif-tl, .vc-vt-pop, .vc-vc-volpop')
      && !!zoneAt(pw.x, pw.y, e.pointerType === 'touch');
    if (!edgeOfBar && t.closest('a, input, button, select, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]:not([data-vc-armed]), .vc-interactive')) return;
    const mediaHost = t.closest('video, audio')?.closest<HTMLElement>('.vc-node');
    if (mediaHost && board.selection.has(mediaHost.dataset.id ?? '') && board.selection.size === 1) return;
    // Buttons inside cards (kanban, swatch, calendar) work once their card is the selection.
    const clickHost = t.closest('.vc-click')?.closest<HTMLElement>('.vc-node');
    if (clickHost && board.selection.has(clickHost.dataset.id ?? '') && board.selection.size === 1 && board.tool === 'select') return;
    if (board.editingId) board.stopEditing();
    root.focus({ preventScroll: true });

    const panBtn = board.settings.panButton;
    if (e.button === 1 && panBtn === 'middle') { e.preventDefault(); startPan(e); return; }
    if (e.button === 2 && panBtn === 'right') { startPan(e, true); return; }
    if (e.button !== 0) return;
    if (spaceDown || board.tool === 'hand') { startPan(e); return; }
    if (board.tool === 'pen') { pen.pointerDown(e); return; }

    const w = board.clientToWorld(e.clientX, e.clientY);

    const edgeEl = t.closest('[data-edge-id]');
    if (edgeEl && (board.tool === 'select' || board.tool === 'connect') && (t.closest('.vc-edge-label') || !nodeAt(w.x, w.y))) {
      connect.pressEdge(e, edgeEl.getAttribute('data-edge-id')!);
      return;
    }

    if (board.tool === 'connect') {
      board.clearSelection();
      connect.startConnect(e);
      return;
    }

    if (board.tool === 'group') {
      startGroupDraw(e);
      return;
    }

    if (board.tool !== 'select') {
      // A placement tool: drop a card of that kind where clicked.
      const type = getCardType(board.tool);
      if (type) {
        const kind = board.tool;
        board.setTool('select');
        const editable = ['text', 'note', 'sticky', 'callout', 'checklist'].includes(kind);
        // The click is the card's top-left corner.
        board.createCard(kind, w, { edit: editable, topLeft: true });
        lastPlaceAt = Date.now();
      }
      return;
    }

    const touch = e.pointerType === 'touch';
    const zone = zoneAt(w.x, w.y, touch);
    if (zone) { startResize(e, zone.id, zone.zone); return; }

    // A group's label sits above its frame; it picks the group.
    const labelOf = t.closest('.vc-group-label')?.closest<HTMLElement>('.vc-node')?.dataset.id;
    const n = (labelOf && board.model.node(labelOf)) || nodeAt(w.x, w.y);
    if (n) {
      if (e.shiftKey) board.select([n.id], 'toggle');
      else if (!board.selection.has(n.id)) board.select([n.id]);
      if (board.selection.has(n.id)) startMove(e);
      return;
    }
    // One finger on an empty spot only taps (clearing the selection): moving the board takes two
    // fingers, so a swipe never fights the app's own side panels. Holding still draws a selection box.
    if (touch) { if (!e.shiftKey) board.clearSelection(); return; }
    startMarquee(e);
  });

  attachTouch();

  root.addEventListener('contextmenu', (e) => {
    if (board.settings.panButton === 'right' && suppressNextContextMenu) { e.preventDefault(); suppressNextContextMenu = false; return; }
    suppressNextContextMenu = false;
  }, true);

  let suppressNextContextMenu = false;
  let lastPlaceAt = 0;
  /** A drag's second click is not a double-click. */
  let lastDragAt = 0;


  // ── touch: pinch, long press, double tap ───────────────

  /**
   * Phones and tablets: two fingers pinch and pan (one finger never moves the board); a long press
   * opens the menu (on an empty spot, holding then dragging draws a selection box); a double tap
   * does what a double-click does.
   */
  function attachTouch(): void {
    const LONG_PRESS = 480, SLOP = 10, DOUBLE_TAP = 350;
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; mx: number; my: number } | null = null;
    /** Fingers whose remaining moves belong to nothing (after a pinch or a long press). */
    const ignored = new Set<number>();
    let hold: { id: number; x: number; y: number; t: number; target: HTMLElement; down: PointerEvent; timer: number; fired: boolean; empty: boolean } | null = null;
    let lastTap = { t: 0, x: 0, y: 0 };
    let synthDblAt = 0, synthMenuAt = 0, touchAt = 0, nativeDblAt = 0, swallowClickUntil = 0;

    const inUi = (t: EventTarget | null) => t instanceof Node && board.uiEl.contains(t);
    const cancelHold = () => { if (hold) { window.clearTimeout(hold.timer); hold = null; } };
    const fire = (type: 'contextmenu' | 'dblclick', target: HTMLElement, x: number, y: number) => {
      const ev = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, button: type === 'contextmenu' ? 2 : 0, detail: type === 'dblclick' ? 2 : 0, view: window });
      if (type === 'dblclick') {
        if (Date.now() - nativeDblAt < 500) return; // the system already sent one
        synthDblAt = Date.now();
      } else synthMenuAt = Date.now();
      target.dispatchEvent(ev);
    };
    const mid = () => {
      const [a, b] = [...touches.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };

    root.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      touchAt = Date.now();
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size >= 2) {
        // A second finger: whatever the first one began gives way to pinching.
        cancelHold();
        active?.cancel();
        pen.cancelStroke();
        for (const id of touches.keys()) ignored.add(id);
        if (touches.size === 2) pinch = mid();
        lastDragAt = Date.now();
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (inUi(e.target) || editingTarget(e.target)) return;
      const target = e.target as HTMLElement;
      // Buttons, links and fields inside cards keep their own taps.
      if (target.closest('a, input, button, select, textarea, [contenteditable="true"], .vc-interactive, .vc-click, .vc-vc-btn, .clickable-icon')) { lastTap = { t: 0, x: 0, y: 0 }; return; }
      const w = board.clientToWorld(e.clientX, e.clientY);
      const empty = board.tool === 'select' && !nodeAt(w.x, w.y) && !target.closest('[data-edge-id]');
      if (board.tool !== 'select' && board.tool !== 'hand') return;
      hold = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(), target, down: e, fired: false, empty, timer: 0 };
      hold.timer = window.setTimeout(() => {
        const h = hold;
        if (!h) return;
        h.fired = true;
        navigator.vibrate?.(12);
        active?.cancel();
        if (h.empty && board.tool === 'select') {
          // Hold, then drag: a selection box; hold and let go: the board's menu.
          startMarquee(h.down);
        } else {
          ignored.add(h.id);
          fire('contextmenu', h.target, h.x, h.y);
        }
      }, LONG_PRESS);
    }, true);

    root.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (hold && hold.id === e.pointerId && !hold.fired && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > SLOP) cancelHold();
      if (hold?.fired && hold.id === e.pointerId && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > SLOP) hold.empty = false; // a box, not a menu
      if (pinch && touches.size >= 2) {
        const m = mid();
        const r = root.getBoundingClientRect();
        board.vp.panBy(m.mx - pinch.mx, m.my - pinch.my);
        if (pinch.d > 0 && m.d > 0) board.vp.zoomAt(m.mx - r.left, m.my - r.top, m.d / pinch.d);
        board.applyViewport();
        pinch = m;
        e.stopImmediatePropagation();
        return;
      }
      if (ignored.has(e.pointerId)) e.stopImmediatePropagation();
    }, true);

    const lift = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      const wasIgnored = ignored.has(e.pointerId);
      touches.delete(e.pointerId);
      ignored.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
      const h = hold && hold.id === e.pointerId ? hold : null;
      cancelHold();
      // The tap that ends a long press must not land on the menu it opened.
      if (h?.fired) swallowClickUntil = Date.now() + 500;
      if (wasIgnored) { e.stopImmediatePropagation(); return; }
      if (e.type !== 'pointerup') return;
      if (h?.fired) {
        // Held still on an empty spot and let go: the menu (after the box gesture has ended).
        if (h.empty) window.setTimeout(() => fire('contextmenu', h.target, h.x, h.y), 0);
        return;
      }
      // A quick tap: two of them close together make a double-click.
      const now = Date.now();
      const tap = h && now - h.t < 300 && Math.hypot(e.clientX - h.x, e.clientY - h.y) < SLOP;
      if (!tap) { lastTap = { t: 0, x: 0, y: 0 }; return; }
      if (now - lastTap.t < DOUBLE_TAP && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        lastTap = { t: 0, x: 0, y: 0 };
        // Right away, inside the touch itself: only then may editing bring up the on-screen keyboard.
        active?.cancel();
        e.stopImmediatePropagation();
        fire('dblclick', h.target.isConnected ? h.target : root, e.clientX, e.clientY);
      } else lastTap = { t: now, x: e.clientX, y: e.clientY };
    };
    root.addEventListener('pointerup', lift, true);
    root.addEventListener('pointercancel', lift, true);

    // The system's own long-press menu and double-tap would come on top of ours.
    root.addEventListener('contextmenu', (e) => {
      if (e.isTrusted && Date.now() - touchAt < 1500 && (touches.size > 0 || Date.now() - synthMenuAt < 1500)) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    root.addEventListener('dblclick', (e) => {
      if (!e.isTrusted) return;
      if (Date.now() - synthDblAt < 700) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (Date.now() - touchAt < 1000) nativeDblAt = Date.now();
    }, true);
    const doc = root.ownerDocument;
    const swallow = (e: MouseEvent) => { if (Date.now() < swallowClickUntil) { swallowClickUntil = 0; e.preventDefault(); e.stopImmediatePropagation(); } };
    doc.addEventListener('click', swallow, true);
    // Obsidian opens its side panels on a sideways swipe: touches on the board are the board's own.
    const keep = (e: TouchEvent) => e.stopPropagation();
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const) root.addEventListener(type, keep, { passive: true });
    board.addDisposer(() => { cancelHold(); doc.removeEventListener('click', swallow, true); });
  }

  // ── gestures ────────────────────────────────────────────

  const track = (e: PointerEvent, kind: string, move: (ev: PointerEvent) => void, up: (ev: PointerEvent, moved: boolean) => void) => {
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const pointerId = e.pointerId;
    try { root.setPointerCapture(pointerId); } catch { /* ignore */ }
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD) return;
      moved = true;
      move(ev);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
      if (moved) lastDragAt = Date.now();
      up(ev, moved);
    };
    const onCancel = () => { cleanup(); up(e, false); };
    const cleanup = () => {
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', onCancel);
      try { root.releasePointerCapture(pointerId); } catch { /* ignore */ }
      active = null;
    };
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onCancel);
    active = { kind, cleanup, cancel: onCancel };
  };

  function startPan(e: PointerEvent, fromRight = false): void {
    let lx = e.clientX, ly = e.clientY;
    setCursor('grabbing');
    track(e, 'pan', (ev) => {
      board.vp.panBy(ev.clientX - lx, ev.clientY - ly);
      lx = ev.clientX; ly = ev.clientY;
      board.applyViewport();
    }, (_ev, moved) => {
      setCursor(baseCursor());
      if (fromRight && moved) suppressNextContextMenu = true;
    });
  }

  function startMarquee(e: PointerEvent): void {
    const additive = e.shiftKey;
    const before = new Set(board.selection);
    const start = board.clientToWorld(e.clientX, e.clientY);
    const rootRect = root.getBoundingClientRect();
    const box = board.overlayEl.createDiv('vc-marquee');
    box.hide();
    track(e, 'marquee', (ev) => {
      const cur = board.clientToWorld(ev.clientX, ev.clientY);
      const r: Rect = { x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y), width: Math.abs(cur.x - start.x), height: Math.abs(cur.y - start.y) };
      const a = board.vp.toScreen(r.x, r.y);
      box.show();
      box.style.transform = `translate(${a.x}px, ${a.y}px)`;
      box.style.width = `${r.width * board.vp.zoom}px`;
      box.style.height = `${r.height * board.vp.zoom}px`;
      const parts = new Map<string, { ids: string[]; all: boolean }>();
      const hit = board.model.nodes.filter(n => {
        if (n.type === 'group') {
          // A group is picked only when the box covers it whole.
          return r.x <= n.x && r.y <= n.y && r.x + r.width >= n.x + n.width && r.y + r.height >= n.y + n.height;
        }
        if (!rectsIntersect(r, nodeRect(n))) return false;
        // A mind map counts only where the box touches its topics.
        const h = board.cards.get(n.id)?.handle;
        if (h?.partsIn) {
          const p = h.partsIn(r);
          if (!p.ids.length) return false;
          parts.set(n.id, p);
        }
        return true;
      }).map(n => n.id);
      // The box over one mind map only (not all of it): select those topics, like Boardmix.
      const only = hit.length === 1 && !additive ? parts.get(hit[0]) : undefined;
      if (only && !only.all) {
        if (!(board.selection.size === 1 && board.selection.has(hit[0]))) board.select(hit);
        board.cards.get(hit[0])?.handle.selectParts?.(only.ids);
      } else {
        board.select(additive ? [...before, ...hit] : hit);
      }
      void rootRect;
    }, (_ev, moved) => {
      box.remove();
      if (!moved && !additive) board.clearSelection();
    });
  }

  function startMove(e: PointerEvent): void {
    // Moving a group carries what sits inside it.
    const ids = new Set(board.selection);
    for (const id of [...ids]) {
      const n = board.model.node(id);
      if (n?.type === 'group') for (const m of board.groupMembers(n)) ids.add(m.id);
    }
    const nodes = [...ids].map(id => board.model.node(id)).filter((n): n is RawNode => !!n);
    const origin = new Map(nodes.map(n => [n.id, { x: n.x, y: n.y }]));
    const start = board.clientToWorld(e.clientX, e.clientY);
    const lead = nodes.find(n => board.selection.has(n.id)) ?? nodes[0];
    const duplicate = e.altKey;
    let gesture: ReturnType<typeof board.model.beginGesture> | null = null;
    let moving = nodes;
    // A lone Text card dragged onto a Note (or other text card) goes into it as blocks.
    const mergeable = !duplicate && nodes.length === 1 && cardKindOf(nodes[0]) === 'text' ? nodes[0] : null;
    const mergeEl = mergeable ? board.cards.get(mergeable.id)?.el ?? null : null;
    let mergeDrop: Drop | null = null;
    let dropLine: DropLine | null = null;
    let mapJoin: { id: string; spot: MapDrop } | null = null;
    track(e, 'move', (ev) => {
      if (!gesture) {
        gesture = board.model.beginGesture();
        if (duplicate) {
          // ⌥-drag leaves the originals and moves copies.
          const map = new Map<string, string>();
          moving = nodes.map(n => {
            const copy = board.model.addNode({ ...structuredClone(n), id: undefined });
            map.set(n.id, copy.id);
            origin.set(copy.id, { x: n.x, y: n.y });
            return copy;
          });
          for (const ed of [...board.model.edges]) {
            const a = map.get(ed.fromNode), b = map.get(ed.toNode);
            if (a && b) board.model.addEdge({ ...structuredClone(ed), id: undefined, fromNode: a, toNode: b });
          }
          board.select(nodes.filter(n => board.selection.has(n.id)).map(n => map.get(n.id)!));
        }
        root.addClass('is-dragging');
        setCursor('');
        board.draggingIds = new Set(moving.map(n => n.id));
      }
      const cur = board.clientToWorld(ev.clientX, ev.clientY);
      let dx = cur.x - start.x, dy = cur.y - start.y;
      if (board.settings.snapToGrid && lead) {
        const o = origin.get(duplicate ? moving[nodes.indexOf(lead)]?.id ?? lead.id : lead.id) ?? { x: 0, y: 0 };
        const g = board.settings.gridSize;
        dx = snap(o.x + dx, g) - o.x;
        dy = snap(o.y + dy, g) - o.y;
      }
      for (const n of moving) {
        const o = origin.get(n.id)!;
        n.x = o.x + dx;
        n.y = o.y + dy;
      }
      gesture.preview(moving.map(n => n.id));
      // Over a column: show where the card will go.
      const leadNode = moving[duplicate ? 0 : Math.max(0, nodes.indexOf(lead))] ?? moving[0];
      const spot = leadNode && leadNode.type !== 'group'
        ? columnDropAt(board.model.nodes, { x: leadNode.x + leadNode.width / 2, y: leadNode.y + leadNode.height / 2 }, board.draggingIds)
        : null;
      showColumnDrop(spot);
      // A mind map (a floating topic) dragged onto another map's topic joins it there.
      if (moving.length === 1 && moving[0].vc?.kind === 'mindmap') {
        const at = board.clientToWorld(ev.clientX, ev.clientY);
        let found: { id: string; spot: MapDrop } | null = null;
        for (let i = board.model.nodes.length - 1; i >= 0 && !found; i--) {
          const n = board.model.nodes[i];
          if (n.id === moving[0].id || n.vc?.kind !== 'mindmap') continue;
          const spot = board.cards.get(n.id)?.handle.dropTargetAt?.(at.x, at.y);
          if (spot) found = { id: n.id, spot };
        }
        if (mapJoin && mapJoin.id !== found?.id) board.cards.get(mapJoin.id)?.handle.markDropTarget?.(null);
        if (found) board.cards.get(found.id)?.handle.markDropTarget?.(found.spot);
        // See-through while over another map, so where it would join stays visible.
        board.cards.get(moving[0].id)?.el.toggleClass('is-joining', !!found);
        mapJoin = found;
      }
      if (spot) { mergeDrop = null; dropLine?.hide(); mergeEl?.removeClass('is-merging'); }
      else if (mergeable && mergeEl) {
        const target = richAt(ev.clientX, ev.clientY, mergeEl);
        const targetCard = target?.view.dom.closest<HTMLElement>('.vc-node');
        const ok = target && targetCard && MERGE_INTO.some(k => targetCard.hasClass(`vc-kind-${k}`));
        mergeDrop = ok ? findBlockDrop(target, ev.clientX, ev.clientY, { movingItem: false }) : null;
        if (mergeDrop) { dropLine ??= new DropLine(); dropLine.show(mergeDrop.line); } else dropLine?.hide();
        mergeEl.toggleClass('is-merging', !!mergeDrop);
      }
    }, () => {
      root.removeClass('is-dragging');
      for (const n of moving) board.cards.get(n.id)?.el.removeClass('is-joining');
      // Columns take the dropped cards in again (before the move becomes an undo step).
      board.draggingIds = new Set();
      showColumnDrop(null);
      if (mapJoin && gesture) {
        // Put the dragged map back where it was, then hand its topics to the other map.
        const join = mapJoin;
        const src = moving[0];
        board.cards.get(join.id)?.handle.markDropTarget?.(null);
        gesture.cancel();
        const target = board.cards.get(join.id)?.handle;
        if (target?.adoptMap) {
          board.model.transact(() => {
            target.adoptMap!(join.spot, src.vc?.mm, src.text ?? '');
            board.model.removeNodes([src.id]);
          });
          board.select([join.id]);
        }
        return;
      }
      dropLine?.remove();
      mergeEl?.removeClass('is-merging');
      if (mergeable && mergeDrop && gesture) {
        gesture.cancel();
        const drop = mergeDrop;
        const md = mergeable.text ?? '';
        board.model.transact(() => {
          if (md.trim()) insertMarkdownAt(drop.rich, drop.pos, md);
          board.model.removeNodes([mergeable.id]);
        });
        const host = drop.rich.view.dom.closest<HTMLElement>('.vc-node')?.dataset.id;
        if (host) board.select([host]);
        return;
      }
      gesture?.end();
    });
  }

  /** Group tool: drag out a rectangle; it becomes the group. */
  function startGroupDraw(e: PointerEvent): void {
    const start = board.clientToWorld(e.clientX, e.clientY);
    const box = board.overlayEl.createDiv('vc-marquee vc-group-draft');
    box.hide();
    let rect: Rect | null = null;
    track(e, 'group', (ev) => {
      const cur = board.clientToWorld(ev.clientX, ev.clientY);
      let x0 = Math.min(start.x, cur.x), y0 = Math.min(start.y, cur.y);
      let x1 = Math.max(start.x, cur.x), y1 = Math.max(start.y, cur.y);
      if (board.settings.snapToGrid) {
        const g = board.settings.gridSize;
        x0 = snap(x0, g); y0 = snap(y0, g); x1 = snap(x1, g); y1 = snap(y1, g);
      }
      rect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
      const a = board.vp.toScreen(rect.x, rect.y);
      box.show();
      box.style.transform = `translate(${a.x}px, ${a.y}px)`;
      box.style.width = `${rect.width * board.vp.zoom}px`;
      box.style.height = `${rect.height * board.vp.zoom}px`;
    }, (_ev, moved) => {
      box.remove();
      board.setTool('select');
      lastPlaceAt = Date.now();
      if (!moved || !rect || rect.width < 24 || rect.height < 24) {
        // A plain click: a group of the default size there.
        board.createCard('group', start);
        return;
      }
      const r = rect;
      const g = board.model.transact(() => board.model.addNode({ type: 'group', label: tr('Group'), x: r.x, y: r.y, width: r.width, height: r.height }));
      board.select([g.id]);
    });
  }

  /**
   * Text cards: dragging a size handle scales the font, like Visual Notes. The size follows the
   * pointer smoothly (not rounded to whole pixels), at most once a frame, and the box is always
   * the text's own measured size, so the frame never jumps or disagrees with the text.
   */
  function startFontResize(e: PointerEvent, n: RawNode, zone: Zone): void {
    const id = n.id;
    if (!board.selection.has(id)) board.select([id]);
    const o = { x: n.x, y: n.y, w: n.width, h: n.height };
    const f0 = vcGet(n, 'fontSize', board.settings.defaultTextSize);
    const start = board.clientToWorld(e.clientX, e.clientY);
    let gesture: ReturnType<typeof board.model.beginGesture> | null = null;
    const tip = board.overlayEl.createDiv('vc-size-tip');
    tip.hide();
    setCursor(ZONE_CURSOR[zone]);
    root.addClass('is-resizing');
    let frame = 0;
    let last: PointerEvent | null = null;
    const apply = () => {
      frame = 0;
      const ev = last;
      if (!ev) return;
      gesture ??= board.model.beginGesture();
      const cur = board.clientToWorld(ev.clientX, ev.clientY);
      const dx = cur.x - start.x, dy = cur.y - start.y;
      // Corners and side handles follow the width; top and bottom handles the height.
      const byWidth = zone.includes('e') || zone.includes('w');
      const ratio = byWidth
        ? (zone.includes('e') ? o.w + dx : o.w - dx) / o.w
        : (zone.includes('s') ? o.h + dy : o.h - dy) / o.h;
      const size = Math.min(400, Math.max(6, Math.round(f0 * ratio * 10) / 10));
      const node = board.model.node(id);
      if (!node) return;
      node.vc = { ...(node.vc ?? {}), fontSize: size };
      gesture.preview([id]);
      // The text at its new size decides the box; the opposite corner stays put.
      const m = board.cards.get(id)?.handle.measure?.() ?? { width: o.w * size / f0, height: o.h * size / f0 };
      node.width = m.width; node.height = m.height;
      node.x = zone.includes('w') ? o.x + o.w - m.width : o.x;
      node.y = zone.includes('n') ? o.y + o.h - m.height : o.y;
      gesture.preview([id]);
      const r = root.getBoundingClientRect();
      tip.show();
      tip.setText(`${Math.round(size)}px`);
      tip.style.transform = `translate(${ev.clientX - r.left + 14}px, ${ev.clientY - r.top + 14}px)`;
    };
    track(e, 'resize', (ev) => {
      last = ev;
      if (!frame) frame = window.requestAnimationFrame(apply);
    }, () => {
      if (frame) { cancelAnimationFrame(frame); apply(); }
      tip.remove();
      root.removeClass('is-resizing');
      gesture?.end();
      setCursor('');
    });
  }

  /**
   * Several cards selected: a handle on any of them scales the whole selection together, like any
   * whiteboard: every selected card is scaled by the same factor around one fixed point on the
   * selection's frame, opposite the handle (corner for a corner, middle of the edge for an edge),
   * so the layout between them is kept. Text cards scale their type,
   * mind maps (sized by their topics) only move.
   */
  function startMultiResize(e: PointerEvent, id: string, zone: Zone): void {
    const n = board.model.node(id);
    if (!n) return;
    // A selected group scales what sits inside it too (as moving it carries it).
    const set = new Map<string, RawNode>();
    for (const m of board.selectedNodes()) {
      set.set(m.id, m);
      if (m.type === 'group') for (const c of board.groupMembers(m)) set.set(c.id, c);
    }
    const nodes = [...set.values()];
    const extraOf = (m: RawNode) => KEEP_ASPECT.has(cardKindOf(m)) ? descriptionHeight(board.cards.get(m.id)?.el) : 0;
    const fixedOf = (m: RawNode) => !!getCardType(cardKindOf(m))?.fixedSize;
    const orig = nodes.map(m => ({
      m, x: m.x, y: m.y, w: m.width, h: m.height, extra: extraOf(m), fixed: fixedOf(m),
      text: cardKindOf(m) === 'text', font: vcGet(m, 'fontSize', board.settings.defaultTextSize),
    }));
    // The smallest scale that keeps every card at least the minimum size.
    let kMin = 0.05;
    for (const a of orig) {
      if (a.fixed || a.text) continue;
      kMin = Math.max(kMin, MIN_W / Math.max(1, a.w), MIN_H / Math.max(1, a.h - a.extra));
    }
    // The fixed point is on the whole selection's frame, opposite the handle: the bottom-right
    // handle scales from the top-left corner, the bottom edge from the middle of the top edge, etc.
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const a of orig) { bx0 = Math.min(bx0, a.x); by0 = Math.min(by0, a.y); bx1 = Math.max(bx1, a.x + a.w); by1 = Math.max(by1, a.y + a.h); }
    const fx = zone.includes('w') ? bx1 : zone.includes('e') ? bx0 : (bx0 + bx1) / 2;
    const fy = zone.includes('n') ? by1 : zone.includes('s') ? by0 : (by0 + by1) / 2;
    const start = board.clientToWorld(e.clientX, e.clientY);
    let gesture: ReturnType<typeof board.model.beginGesture> | null = null;
    const ids = orig.map(a => a.m.id);
    setCursor(ZONE_CURSOR[zone]);
    root.addClass('is-resizing');
    let frame = 0;
    let last: PointerEvent | null = null;
    const apply = () => {
      frame = 0;
      const ev = last;
      if (!ev) return;
      gesture ??= board.model.beginGesture();
      const cur = board.clientToWorld(ev.clientX, ev.clientY);
      // The point under the pointer follows it: its distance from the fixed point sets the scale.
      const kx = Math.abs(start.x - fx) > 1 ? (cur.x - fx) / (start.x - fx) : 1;
      const ky = Math.abs(start.y - fy) > 1 ? (cur.y - fy) / (start.y - fy) : 1;
      let k = zone === 'e' || zone === 'w' ? kx : zone === 'n' || zone === 's' ? ky : (Math.abs(kx - 1) > Math.abs(ky - 1) ? kx : ky);
      k = Math.max(kMin, k);
      for (const a of orig) {
        const m = a.m;
        if (a.fixed) {
          // Keeps its size; its middle moves with the rest.
          const cx = fx + (a.x + a.w / 2 - fx) * k, cy = fy + (a.y + a.h / 2 - fy) * k;
          m.x = cx - a.w / 2; m.y = cy - a.h / 2;
          continue;
        }
        m.x = fx + (a.x - fx) * k;
        m.y = fy + (a.y - fy) * k;
        if (a.text) {
          m.vc = { ...(m.vc ?? {}), fontSize: Math.min(400, Math.max(6, Math.round(a.font * k * 10) / 10)) };
          m.width = a.w * k; m.height = a.h * k;
        } else {
          m.width = a.w * k;
          m.height = (a.h - a.extra) * k + a.extra;
        }
      }
      gesture.preview(ids);
      // Text cards take the size of their text at the new type size.
      let measured = false;
      for (const a of orig) {
        if (!a.text) continue;
        const size = board.cards.get(a.m.id)?.handle.measure?.();
        if (size) { a.m.width = size.width; a.m.height = size.height; measured = true; }
      }
      if (measured) gesture.preview(ids);
    };
    track(e, 'resize', (ev) => {
      last = ev;
      if (!frame) frame = window.requestAnimationFrame(apply);
    }, () => {
      if (frame) { cancelAnimationFrame(frame); apply(); }
      root.removeClass('is-resizing');
      gesture?.end();
      setCursor('');
    });
  }

  function startResize(e: PointerEvent, id: string, zone: Zone): void {
    const n = board.model.node(id);
    if (!n) return;
    if (board.selection.size > 1 && board.selection.has(id)) { startMultiResize(e, id, zone); return; }
    if (cardKindOf(n) === 'text') { startFontResize(e, n, zone); return; }
    if (!board.selection.has(id)) board.select([id]);
    const o = { x: n.x, y: n.y, w: n.width, h: n.height };
    const start = board.clientToWorld(e.clientX, e.clientY);
    const keepAspectKind = KEEP_ASPECT.has(cardKindOf(n));
    const extra = keepAspectKind ? descriptionHeight(board.cards.get(id)?.el) : 0;
    let gesture: ReturnType<typeof board.model.beginGesture> | null = null;
    setCursor(ZONE_CURSOR[zone]);
    root.addClass('is-resizing');
    track(e, 'resize', (ev) => {
      gesture ??= board.model.beginGesture();
      const cur = board.clientToWorld(ev.clientX, ev.clientY);
      const dx = cur.x - start.x, dy = cur.y - start.y;
      let x = o.x, y = o.y, w = o.w, h = o.h;
      if (zone.includes('e')) w = o.w + dx;
      if (zone.includes('w')) { w = o.w - dx; x = o.x + dx; }
      if (zone.includes('s')) h = o.h + dy;
      if (zone.includes('n')) { h = o.h - dy; y = o.y + dy; }
      const corner = zone.length === 2;
      // Pictures always keep their proportions, from corners and edges alike (like Freeform);
      // other cards keep them from a corner with Shift.
      const aspect = keepAspectKind || (corner && ev.shiftKey);
      if (aspect) {
        // A picture's description is not part of its proportions.
        const ratio = o.w / Math.max(1, o.h - extra);
        const byWidth = zone === 'e' || zone === 'w' || (corner && Math.abs(w - o.w) / o.w > Math.abs(h - o.h) / o.h);
        if (byWidth) h = w / ratio + extra; else w = (h - extra) * ratio;
        if (zone.includes('w')) x = o.x + o.w - w;
        if (zone.includes('n')) y = o.y + o.h - h;
        // An edge drag grows the other axis around the middle.
        if (zone === 'e' || zone === 'w') y = o.y + (o.h - h) / 2;
        if (zone === 'n' || zone === 's') x = o.x + (o.w - w) / 2;
      }
      if (w < MIN_W) { if (zone.includes('w')) x -= MIN_W - w; w = MIN_W; }
      if (h < MIN_H) { if (zone.includes('n')) y -= MIN_H - h; h = MIN_H; }
      if (board.settings.snapToGrid) {
        const g = board.settings.gridSize;
        if (zone.includes('e')) w = Math.max(MIN_W, snap(x + w, g) - x);
        if (zone.includes('s')) h = Math.max(MIN_H, snap(y + h, g) - y);
      }
      n.x = x; n.y = y; n.width = w; n.height = h;
      gesture.preview([id]);
    }, () => {
      root.removeClass('is-resizing');
      gesture?.end();
      setCursor('');
    });
  }

  // ── double click ────────────────────────────────────────

  root.addEventListener('dblclick', (e) => {
    if (board.uiEl.contains(e.target as Node)) return;
    if (editingTarget(e.target)) return;
    if (board.tool !== 'select') return;
    if (Date.now() - lastDragAt < 500) return;
    const t = e.target as HTMLElement;
    const edgeEl = t.closest('[data-edge-id]');
    if (edgeEl) { editEdgeLabel(board, edgeEl.getAttribute('data-edge-id')!); return; }
    const w = board.clientToWorld(e.clientX, e.clientY);
    const labelOf = t.closest('.vc-group-label')?.closest<HTMLElement>('.vc-node')?.dataset.id;
    if (labelOf) return; // groups are renamed from their bar, not by double-clicking
    const z = zoneAt(w.x, w.y);
    if (z) {
      // Double-clicking a text card's bottom edge fits its height to the text, keeping the top in place.
      const h = z.zone === 's' ? board.cards.get(z.id)?.handle.fitHeight?.() : undefined;
      const node = board.model.node(z.id);
      if (h && node && Math.abs(h - node.height) >= 1) {
        board.model.transact(() => { node.height = Math.max(MIN_H, h); board.model.touch(z.id); });
      }
      return;
    }
    const n = nodeAt(w.x, w.y);
    if (n) {
      // Double-clicking inside a group's empty area creates a card there, like on the board.
      if (n.type === 'group' && !t.closest('.vc-group-label')) { createAt(w); return; }
      board.startEditing(n.id, { clientX: e.clientX, clientY: e.clientY });
      return;
    }
    // A double-click right after placing a card with a tool is the tail of that click.
    if (Date.now() - lastPlaceAt < 600) return;
    createAt(w);
  });

  const createAt = (w: { x: number; y: number }) => {
    const kind = board.settings.doubleClickKind;
    const type = getCardType(kind);
    if (!type) return;
    // The click point becomes the card's top-left text position, like typing on paper.
    board.createCard(kind, { x: w.x + type.defaultSize.width / 2 - 8, y: w.y }, { edit: true });
  };

  // ── wheel: pan, zoom, or scroll inside a card ───────────

  root.addEventListener('wheel', (e) => {
    if (board.uiEl.contains(e.target as Node)) return;
    const zoomGesture = e.ctrlKey || e.metaKey;
    if (!zoomGesture && scrollsInside(e.target as HTMLElement, e.deltaX, e.deltaY, root)) return;
    e.preventDefault();
    const r = root.getBoundingClientRect();
    if (zoomGesture) {
      const factor = Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002));
      board.vp.zoomAt(e.clientX - r.left, e.clientY - r.top, factor);
    } else {
      let dx = e.deltaX, dy = e.deltaY;
      if (e.shiftKey && !dx) { dx = dy; dy = 0; }
      board.vp.panBy(-dx, -dy);
    }
    board.applyViewport();
  }, { passive: false });

  // ── keyboard ────────────────────────────────────────────

  root.addEventListener('keydown', (e) => {
    if (board.editingId || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    if (target !== root && target.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]:not([data-vc-armed])')) return;
    const mod = isMod(e);

    if (board.selection.size === 1 && !mod) {
      const id = [...board.selection][0];
      if (board.cards.get(id)?.handle.onKey?.(e)) { e.preventDefault(); return; }
    }

    if (e.key === ' ' && !spaceDown) { spaceDown = true; setCursor('grab'); e.preventDefault(); return; }
    if (mod) return; // shortcuts go through the view's scope (shortcuts.ts)
    if (e.key === 'Enter' && board.tool === 'pen') { board.setTool('select'); e.preventDefault(); return; }
    if (e.key === 'Escape') {
      if (board.tool !== 'select') board.setTool('select');
      else board.clearSelection();
      e.preventDefault();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { board.deleteSelection(); e.preventDefault(); return; }
    if (e.key === 'Enter' && board.selection.size === 1) {
      board.startEditing([...board.selection][0]);
      e.preventDefault();
      return;
    }

    if (!mod && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && board.selection.size) {
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      const nodes = board.selectedNodes();
      board.model.transact(() => { for (const n of nodes) { n.x += dx; n.y += dy; board.model.touch(n.id); } }, 'nudge');
      e.preventDefault();
      return;
    }
  });

  root.addEventListener('keyup', (e) => {
    if (e.key === ' ') { spaceDown = false; setCursor(baseCursor()); }
  });
  root.addEventListener('blur', () => { spaceDown = false; });

  board.addDisposer(() => active?.cleanup());
}

/** Whether a wheel event over `el` should scroll a card's own content instead of the board. */
function scrollsInside(el: HTMLElement | null, dx: number, dy: number, stop: HTMLElement): boolean {
  while (el && el !== stop) {
    if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) {
      const st = getComputedStyle(el);
      const canY = /(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 1;
      const canX = /(auto|scroll)/.test(st.overflowX) && el.scrollWidth > el.clientWidth + 1;
      if (canY && dy) {
        if ((dy < 0 && el.scrollTop > 0) || (dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1)) return true;
      }
      if (canX && dx) {
        if ((dx < 0 && el.scrollLeft > 0) || (dx > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1)) return true;
      }
    }
    if (el.classList.contains('vc-node')) return false;
    el = el.parentElement;
  }
  return false;
}

export function duplicateSelection(board: Board, offset = 30): void {
  const nodes = board.selectedNodes();
  if (!nodes.length) return;
  // Topics selected in a mind map: they are copied inside the map, beside themselves.
  if (nodes.length === 1 && board.cards.get(nodes[0].id)?.handle.duplicateParts?.()) return;
  const ids = new Set(nodes.map(n => n.id));
  const map = new Map<string, string>();
  board.model.transact(() => {
    for (const n of nodes) {
      const copy = board.model.addNode({ ...structuredClone(n), id: undefined, x: n.x + offset, y: n.y + offset });
      map.set(n.id, copy.id);
    }
    for (const e of [...board.model.edges]) {
      if (ids.has(e.fromNode) && ids.has(e.toNode)) {
        board.model.addEdge({ ...structuredClone(e), id: undefined, fromNode: map.get(e.fromNode)!, toNode: map.get(e.toNode)! });
      }
    }
  });
  board.select([...map.values()]);
}

/** Inline editor for an edge's label. */
export function editEdgeLabel(board: Board, id: string): void {
  const edge = board.model.edge(id);
  const mid = board.edgeMid(id);
  if (!edge || !mid) return;
  board.selectEdges([id]);
  const s = board.vp.toScreen(mid.x, mid.y);
  const input = board.overlayEl.createEl('input', { cls: 'vc-edge-label-input', type: 'text' });
  input.value = edge.label ?? '';
  input.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
  let done = false;
  const finish = (save: boolean) => {
    if (done) return; done = true;
    const v = input.value.trim();
    input.remove();
    if (save && v !== (edge.label ?? '')) {
      board.model.transact(() => { if (v) edge.label = v; else delete edge.label; board.model.touchEdges(); });
    }
    board.root.focus({ preventScroll: true });
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('pointerdown', e => e.stopPropagation());
  input.focus();
  input.select();
}
