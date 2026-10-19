import { Platform } from 'obsidian';
import type { Board } from './board';
import { snap } from './board';
import { nodeRect, rectsIntersect, type Rect } from '../model/board-model';
import type { RawNode, Side } from '../model/canvas-file';
import { autoSides, edgeShape, facingSide, sidePoint } from './edge-geometry';
import { cardKindOf } from '../cards/util';
import { getCardType } from '../cards/registry';

type Zone = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const ZONE_CURSOR: Record<Zone, string> = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
};

const DRAG_THRESHOLD = 3;
const MIN_W = 40, MIN_H = 24;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Card kinds that keep their aspect ratio when resized from a corner. */
const KEEP_ASPECT = new Set(['image', 'video']);

const isMod = (e: MouseEvent | KeyboardEvent) => (Platform.isMacOS ? e.metaKey : e.ctrlKey);

/** Wire pointer, wheel and keyboard handling to a board. */
export function attachInteractions(board: Board): void {
  const root = board.root;
  let spaceDown = false;
  let hoverZone: { id: string; zone: Zone } | null = null;
  let hoverNodeId: string | null = null;
  let active: { kind: string; cleanup: () => void } | null = null;
  const dots = board.overlayEl.createDiv('vc-connect-dots');

  const editingTarget = (target: EventTarget | null): boolean => {
    if (!board.editingId) return false;
    const el = board.cards.get(board.editingId)?.el;
    return !!el && target instanceof Node && el.contains(target);
  };

  /** Topmost node under a world point (cards above groups). */
  const nodeAt = (wx: number, wy: number): RawNode | null => {
    const nodes = board.model.nodes;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n.type === 'group') continue;
      if (wx >= n.x && wx <= n.x + n.width && wy >= n.y && wy <= n.y + n.height) return n;
    }
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n.type !== 'group') continue;
      if (wx >= n.x && wx <= n.x + n.width && wy >= n.y && wy <= n.y + n.height) return n;
    }
    return null;
  };

  /** Resize zone under a world point: a band just inside and outside each edge. */
  const zoneAt = (wx: number, wy: number): { id: string; zone: Zone } | null => {
    const out = 6 / board.vp.zoom, inn = 5 / board.vp.zoom;
    const nodes = board.model.nodes;
    // Search cards first (they sit on top), then groups.
    const order = [...nodes.filter(n => n.type !== 'group').reverse(), ...nodes.filter(n => n.type === 'group').reverse()];
    for (const n of order) {
      if (board.editingId === n.id) continue;
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

  const baseCursor = () => {
    if (spaceDown || board.tool === 'hand') return 'grab';
    if (board.tool === 'select' || board.tool === 'connect') return '';
    return 'crosshair';
  };

  // ── connection dots (connect tool only) ─────────────────

  const showDots = (n: RawNode | null) => {
    dots.empty();
    if (!n || board.tool !== 'connect') return;
    const r = nodeRect(n);
    for (const side of ['top', 'right', 'bottom', 'left'] as Side[]) {
      const p = sidePoint(r, side);
      const s = board.vp.toScreen(p.x, p.y);
      const d = dots.createDiv({ cls: 'vc-connect-dot', attr: { 'data-side': side } });
      d.style.transform = `translate(${s.x}px, ${s.y}px)`;
    }
  };
  board.on('viewport', () => showDots(hoverNodeId && board.tool === 'connect' ? board.model.node(hoverNodeId) ?? null : null));
  board.on('tool', () => { showDots(null); setCursor(baseCursor()); });

  // ── hover ───────────────────────────────────────────────

  root.addEventListener('pointermove', (e) => {
    if (active || e.buttons) return;
    if (editingTarget(e.target)) { setCursor(''); return; }
    if (!(e.target instanceof Node) || !board.root.contains(e.target) || board.uiEl.contains(e.target)) return;
    const w = board.clientToWorld(e.clientX, e.clientY);
    if (board.tool === 'connect') {
      const n = nodeAt(w.x, w.y);
      if ((n?.id ?? null) !== hoverNodeId) { hoverNodeId = n?.id ?? null; showDots(n); }
      setCursor(n ? 'crosshair' : '');
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
    if (t.closest('a, input, button, select, textarea, [contenteditable="true"], [contenteditable="plaintext-only"], .vc-interactive')) return;
    const mediaHost = t.closest('video, audio')?.closest<HTMLElement>('.vc-node');
    if (mediaHost && board.selection.has(mediaHost.dataset.id ?? '') && board.selection.size === 1) return;
    if (board.editingId) board.stopEditing();
    root.focus({ preventScroll: true });

    const panBtn = board.settings.panButton;
    if (e.button === 1 && panBtn === 'middle') { e.preventDefault(); startPan(e); return; }
    if (e.button === 2 && panBtn === 'right') { startPan(e, true); return; }
    if (e.button !== 0) return;
    if (spaceDown || board.tool === 'hand') { startPan(e); return; }

    const w = board.clientToWorld(e.clientX, e.clientY);

    const edgeEl = t.closest('[data-edge-id]');
    if (edgeEl && board.tool === 'select') {
      const id = edgeEl.getAttribute('data-edge-id')!;
      board.selectEdges([id], e.shiftKey ? 'toggle' : 'replace');
      return;
    }

    if (board.tool === 'connect') {
      const n = nodeAt(w.x, w.y);
      if (n) startConnect(e, n);
      else board.clearSelection();
      return;
    }

    if (board.tool !== 'select') {
      // A placement tool: drop a card of that kind where clicked.
      const type = getCardType(board.tool);
      if (type) {
        const kind = board.tool;
        board.setTool('select');
        const editable = ['text', 'note', 'sticky', 'callout'].includes(kind);
        board.createCard(kind, w, { edit: editable });
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
    }, () => {
      root.removeClass('is-dragging');
      gesture?.end();
    });
  }

  function startResize(e: PointerEvent, id: string, zone: Zone): void {
    const n = board.model.node(id);
    if (!n) return;
    if (!board.selection.has(id)) board.select([id]);
    const o = { x: n.x, y: n.y, w: n.width, h: n.height };
    const start = board.clientToWorld(e.clientX, e.clientY);
    const keepAspectKind = KEEP_ASPECT.has(cardKindOf(n));
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
      const aspect = corner && (keepAspectKind !== ev.shiftKey);
      if (aspect) {
        const ratio = o.w / o.h;
        if (Math.abs(w - o.w) / o.w > Math.abs(h - o.h) / o.h) h = w / ratio; else w = h * ratio;
        if (zone.includes('w')) x = o.x + o.w - w;
        if (zone.includes('n')) y = o.y + o.h - h;
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

  function startConnect(e: PointerEvent, from: RawNode): void {
    const fromRect = nodeRect(from);
    // Started on a dot: that side is fixed. Otherwise the sides that face each other win.
    const dotSide = (e.target as HTMLElement).closest('.vc-connect-dot')?.getAttribute('data-side') as Side | null;
    const sidesFor = (to: Rect | { x: number; y: number }): [Side, Side | null] => {
      if ('width' in to) {
        const [a, b] = autoSides(fromRect, to);
        return dotSide ? [dotSide, facingSide(to, sidePoint(fromRect, dotSide))] : [a, b];
      }
      return [dotSide ?? facingSide(fromRect, to), null];
    };
    const g = document.createElementNS(SVG_NS, 'g');
    g.classList.add('vc-edge', 'is-preview');
    const path = document.createElementNS(SVG_NS, 'path');
    path.classList.add('vc-edge-line');
    g.appendChild(path);
    board.edgeLayer.appendChild(g);
    let target: RawNode | null = null;
    track(e, 'connect', (ev) => {
      const w = board.clientToWorld(ev.clientX, ev.clientY);
      const over = nodeAt(w.x, w.y);
      target = over && over.id !== from.id ? over : null;
      showDots(target ?? from);
      const to = target ? nodeRect(target) : w;
      const [fs, ts] = sidesFor(to);
      path.setAttribute('d', edgeShape(fromRect, fs, to, ts).d);
    }, () => {
      g.remove();
      showDots(null);
      if (!target) return;
      const to = target;
      const [fromSide, toSide] = sidesFor(nodeRect(to));
      const edge = board.model.transact(() => board.model.addEdge({ fromNode: from.id, fromSide, toNode: to.id, toSide: toSide ?? undefined, toEnd: 'arrow' }));
      board.selectEdges([edge.id]);
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
    if (labelOf) { board.startEditing(labelOf); return; }
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
    if (target !== root && target.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
    const mod = isMod(e);

    if (board.selection.size === 1 && !mod) {
      const id = [...board.selection][0];
      if (board.cards.get(id)?.handle.onKey?.(e)) { e.preventDefault(); return; }
    }

    if (e.key === ' ' && !spaceDown) { spaceDown = true; setCursor('grab'); e.preventDefault(); return; }
    if (mod) return; // ⌘ shortcuts go through the view's hotkey scope (hotkeys.ts)
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
    if (e.shiftKey && e.key === '!' || (e.shiftKey && e.code === 'Digit1')) { board.zoomToFit(); e.preventDefault(); return; }
    if (e.shiftKey && e.code === 'Digit2') { board.zoomToFit([...board.selection]); e.preventDefault(); return; }

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
