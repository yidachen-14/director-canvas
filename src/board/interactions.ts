import { Platform } from 'obsidian';
import type { Board } from './board';
import { snap } from './board';
import { nodeRect, rectsIntersect, type Rect } from '../model/board-model';
import type { RawNode } from '../model/canvas-file';
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
  let active: { kind: string; cleanup: () => void } | null = null;
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
  const zoneAt = (wx: number, wy: number): { id: string; zone: Zone } | null => {
    const out = 6 / board.vp.zoom, inn = 5 / board.vp.zoom;
    const nodes = board.model.nodes;
    // Search cards first (they sit on top), then groups.
    const order = [...nodes.filter(n => n.type !== 'group').reverse(), ...nodes.filter(n => n.type === 'group').reverse()];
    for (const n of order) {
      if (board.editingId === n.id) continue;
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
    if (t.closest('a, input, button, select, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]:not([data-vc-armed]), .vc-interactive')) return;
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

    const zone = zoneAt(w.x, w.y);
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
    startMarquee(e);
  });

  root.addEventListener('contextmenu', (e) => {
    if (board.settings.panButton === 'right' && suppressNextContextMenu) { e.preventDefault(); suppressNextContextMenu = false; return; }
    suppressNextContextMenu = false;
  }, true);

  let suppressNextContextMenu = false;
  let lastPlaceAt = 0;
  /** A drag's second click is not a double-click. */
  let lastDragAt = 0;

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
    active = { kind, cleanup };
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
      const hit = board.model.nodes.filter(n => {
        if (n.type === 'group') {
          // A group is picked only when the box covers it whole.
          return r.x <= n.x && r.y <= n.y && r.x + r.width >= n.x + n.width && r.y + r.height >= n.y + n.height;
        }
        return rectsIntersect(r, nodeRect(n));
      }).map(n => n.id);
      board.select(additive ? [...before, ...hit] : hit);
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
    track(e, 'move', (ev) => {
      if (!gesture) {
        gesture = board.model.beginGesture();
        if (duplicate) {
          // ⌥-drag leaves the originals and moves copies.
          const map = new Map<string, string>();
          moving = nodes.map(n => {
            const copy = board.model.addNode({ ...structuredClone(n), id: undefined } as unknown as RawNode);
            map.set(n.id, copy.id);
            origin.set(copy.id, { x: n.x, y: n.y });
            return copy;
          });
          for (const ed of [...board.model.edges]) {
            const a = map.get(ed.fromNode), b = map.get(ed.toNode);
            if (a && b) board.model.addEdge({ ...structuredClone(ed), id: undefined, fromNode: a, toNode: b } as never);
          }
          board.select(nodes.filter(n => board.selection.has(n.id)).map(n => map.get(n.id)!));
        }
        root.addClass('is-dragging');
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
      if (mergeable && mergeEl) {
        const target = richAt(ev.clientX, ev.clientY, mergeEl);
        const targetCard = target?.view.dom.closest<HTMLElement>('.vc-node');
        const ok = target && targetCard && MERGE_INTO.some(k => targetCard.hasClass(`vc-kind-${k}`));
        mergeDrop = ok ? findBlockDrop(target, ev.clientX, ev.clientY, { movingItem: false }) : null;
        if (mergeDrop) { dropLine ??= new DropLine(); dropLine.show(mergeDrop.line); } else dropLine?.hide();
        mergeEl.toggleClass('is-merging', !!mergeDrop);
      }
    }, () => {
      root.removeClass('is-dragging');
      // Columns take the dropped cards in again (before the move becomes an undo step).
      board.draggingIds = new Set();
      showColumnDrop(null);
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
      const g = board.model.transact(() => board.model.addNode({ type: 'group', label: tr('Group'), x: r.x, y: r.y, width: r.width, height: r.height } as RawNode));
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
      if (!frame) frame = requestAnimationFrame(apply);
    }, () => {
      if (frame) { cancelAnimationFrame(frame); apply(); }
      tip.remove();
      root.removeClass('is-resizing');
      gesture?.end();
      setCursor('');
    });
  }

  function startResize(e: PointerEvent, id: string, zone: Zone): void {
    const n = board.model.node(id);
    if (!n) return;
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
    if (zoneAt(w.x, w.y)) return;
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
  const ids = new Set(nodes.map(n => n.id));
  const map = new Map<string, string>();
  board.model.transact(() => {
    for (const n of nodes) {
      const copy = board.model.addNode({ ...structuredClone(n), id: undefined, x: n.x + offset, y: n.y + offset } as unknown as RawNode);
      map.set(n.id, copy.id);
    }
    for (const e of [...board.model.edges]) {
      if (ids.has(e.fromNode) && ids.has(e.toNode)) {
        board.model.addEdge({ ...structuredClone(e), id: undefined, fromNode: map.get(e.fromNode)!, toNode: map.get(e.toNode)! } as never);
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
