import { Menu, setIcon, setTooltip } from 'obsidian';
import type { Board } from './board';
import { availableTools, toolById, type Tool } from './tools';
import { getCardType } from '../cards/registry';
import { ARRANGE, runArrange } from './arrange-commands';
import type { Point } from './viewport';
import { nodeRect, unionRect } from '../model/board-model';
import { cssColor } from '../cards/util';
import { t } from '../i18n';

/** Extra entries for the toolbar's "More" panel, added by later modules. */
export interface OverflowAction { section: string; icon: string; label: string; run(board: Board): void; available?(board: Board): boolean; }
const overflowActions: OverflowAction[] = [];
export function contributeOverflow(a: OverflowAction): void { overflowActions.push(a); }

/** Kinds that only make sense as a mode, never dropped as a card. */
const MODE_TOOLS = new Set(['select', 'hand', 'connect', 'pen']);
/** Card kinds opened for typing as soon as they are made. */
const EDITABLE = new Set(['text', 'note', 'sticky', 'callout']);

/** The card kind a tool can be dragged out as, if any. */
function dragKind(tool: Tool): string | null {
  if (tool.run || MODE_TOOLS.has(tool.id)) return null;
  return getCardType(tool.id) ? tool.id : null;
}

/** Make a card of `kind` at a world point, as if dropped there from the toolbar. */
export function placeCard(board: Board, kind: string, at: Point): void {
  const type = getCardType(kind);
  if (!type) return;
  board.setTool('select');
  // Text starts where it was dropped, like typing on paper; other cards centre on the point.
  const p = kind === 'text' ? { x: at.x + type.defaultSize.width / 2 - 8, y: at.y + type.defaultSize.height / 2 - 12 } : at;
  board.createCard(kind, p, { edit: EDITABLE.has(kind) });
  board.root.focus({ preventScroll: true });
}

/**
 * Press on a tool: dragging it onto the board drops that card where it is
 * released; a plain click runs `onClick`.
 */
function bindToolPress(board: Board, el: HTMLElement, tool: Tool, onClick: () => void, onDragStart?: () => void): void {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const kind = dragKind(tool);
    const sx = e.clientX, sy = e.clientY;
    const doc = el.ownerDocument;
    let ghost: HTMLElement | null = null;
    let overBoard = false;
    const type = kind ? getCardType(kind) : undefined;
    const move = (ev: PointerEvent) => {
      if (!kind || !type) return;
      if (!ghost) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        onDragStart?.();
        ghost = doc.body.createDiv('vc-tool-ghost');
        const z = board.vp.zoom;
        const w = Math.min(320, Math.max(48, type.defaultSize.width * z));
        const h = Math.min(240, Math.max(32, type.defaultSize.height * z));
        ghost.style.width = `${w}px`;
        ghost.style.height = `${h}px`;
        ghost.style.setProperty('--vc-ghost-dx', kind === 'text' ? '-8px' : `${-w / 2}px`);
        ghost.style.setProperty('--vc-ghost-dy', kind === 'text' ? '-12px' : `${-h / 2}px`);
        setIcon(ghost.createDiv('vc-tool-ghost-icon'), tool.icon);
        ghost.createDiv({ cls: 'vc-tool-ghost-label', text: t(tool.label) });
        doc.body.addClass('vc-tool-dragging');
      }
      const under = doc.elementFromPoint(ev.clientX, ev.clientY);
      overBoard = !!under && board.root.contains(under) && !under.closest('.vc-ui > *');
      ghost.toggleClass('is-off', !overBoard);
      ghost.style.transform = `translate(${ev.clientX}px, ${ev.clientY}px)`;
    };
    const up = (ev: PointerEvent) => {
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      doc.removeEventListener('keydown', key, true);
      if (ghost) {
        ghost.remove();
        doc.body.removeClass('vc-tool-dragging');
        if (overBoard && kind) placeCard(board, kind, board.clientToWorld(ev.clientX, ev.clientY));
        return;
      }
      if (el.contains(ev.target as Node)) onClick();
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !ghost) return;
      ev.preventDefault();
      overBoard = false;
      up(new PointerEvent('pointerup'));
    };
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
    doc.addEventListener('keydown', key, true);
  });
}

// ── toolbar ───────────────────────────────────────────────────

export function attachToolbar(board: Board): void {
  const bar = board.uiEl.createDiv('vc-toolbar');
  bar.addEventListener('pointerdown', e => e.stopPropagation());
  bar.addEventListener('dblclick', e => e.stopPropagation());
  let panel: OverflowPanel | null = null;

  /** A click on a tool: modes toggle, actions run, cards appear in the middle of the view. */
  const activate = (tool: Tool) => {
    panel?.close();
    if (tool.run) { board.setTool('select'); tool.run(board); return; }
    if (MODE_TOOLS.has(tool.id) || tool.id === 'group') {
      board.setTool(board.tool === tool.id && tool.id !== 'select' ? 'select' : tool.id);
      board.root.focus({ preventScroll: true });
      return;
    }
    const kind = dragKind(tool);
    if (kind) placeCard(board, kind, board.viewCenter());
  };

  const render = () => {
    panel?.close();
    bar.empty();
    const s = board.settings;
    bar.setAttr('data-size', s.toolbarSize);
    const avail = availableTools();
    const shown = s.toolbarTools.map(id => avail.find(x => x.id === id)).filter((x): x is Tool => !!x);
    if (!shown.some(x => x.id === 'select')) shown.unshift(toolById('select')!);
    for (const tool of shown) {
      const b = bar.createDiv({ cls: 'vc-tool', attr: { 'data-tool': tool.id, role: 'button', 'aria-label': t(tool.label) } });
      setIcon(b.createDiv('vc-tool-icon'), tool.icon);
      if (s.toolbarSize !== 'S') b.createDiv({ cls: 'vc-tool-label', text: t(tool.label) });
      setTooltip(b, dragKind(tool) ? t('{tool} — drag onto the board, or click', { tool: t(tool.label) }) : t(tool.label), { placement: s.toolbarPosition === 'bottom' ? 'top' : 'bottom' });
      b.toggleClass('is-active', board.tool === tool.id);
      bindToolPress(board, b, tool, () => activate(tool));
    }
    const more = bar.createDiv({ cls: 'vc-tool vc-tool-more', attr: { role: 'button', 'aria-label': t('More') } });
    setIcon(more.createDiv('vc-tool-icon'), 'layout-grid');
    if (s.toolbarSize !== 'S') more.createDiv({ cls: 'vc-tool-label', text: t('More') });
    setTooltip(more, t('More'), { placement: s.toolbarPosition === 'bottom' ? 'top' : 'bottom' });
    more.addEventListener('click', () => {
      if (panel) { panel.close(); return; }
      panel = new OverflowPanel(board, more, avail.filter(x => !shown.includes(x)), activate, () => { panel = null; more.removeClass('is-active'); });
      more.addClass('is-active');
    });
  };
  render();
  board.on('tool', () => {
    for (const el of Array.from(bar.querySelectorAll<HTMLElement>('.vc-tool'))) if (el.dataset.tool) el.toggleClass('is-active', el.dataset.tool === board.tool);
  });
  board.addRefresher(render);
  board.addDisposer(() => panel?.close());
}

/** The toolbar's "More" panel: the other tools (click or drag), then board actions. */
class OverflowPanel {
  private el: HTMLElement;
  private offDoc: () => void;

  constructor(private board: Board, anchor: HTMLElement, tools: Tool[], activate: (t: Tool) => void, private onClose: () => void) {
    const el = board.uiEl.createDiv('vc-more-panel');
    this.el = el;
    el.addEventListener('pointerdown', e => e.stopPropagation());
    el.addEventListener('dblclick', e => e.stopPropagation());
    el.addEventListener('wheel', e => e.stopPropagation());

    if (tools.length) {
      el.createDiv({ cls: 'vc-more-title', text: t('More tools') });
      const grid = el.createDiv('vc-more-grid');
      for (const tool of tools) {
        const tile = grid.createDiv({ cls: 'vc-more-tile', attr: { role: 'button', 'aria-label': t(tool.label) } });
        setIcon(tile.createDiv('vc-more-tile-icon'), tool.icon);
        tile.createDiv({ cls: 'vc-more-tile-label', text: t(tool.label) });
        tile.toggleClass('is-active', board.tool === tool.id);
        bindToolPress(board, tile, tool, () => activate(tool), () => this.close());
      }
    }

    // Arranging, as tiles: the same commands as the right-click menu.
    el.createDiv({ cls: 'vc-more-title', text: t('Arrange') });
    const agrid = el.createDiv('vc-more-grid');
    for (const d of ARRANGE.filter(x => x.group === 'arrange' || x.group === 'distribute')) {
      const tile = agrid.createDiv({ cls: 'vc-more-tile is-action', attr: { role: 'button', 'aria-label': t(d.label) } });
      setIcon(tile.createDiv('vc-more-tile-icon'), d.icon);
      tile.createDiv({ cls: 'vc-more-tile-label', text: t(d.label) });
      if (d.keys) setTooltip(tile, `${t(d.label)}  ${d.keys}`, { placement: 'top' });
      tile.addEventListener('click', () => { this.close(); runArrange(board, d.id); });
    }

    const sections = new Map<string, OverflowAction[]>();
    const builtIn: OverflowAction[] = [
      { section: 'view', icon: 'maximize', label: 'Zoom to fit', run: b => b.zoomToFit() },
      { section: 'view', icon: 'scan', label: 'Zoom to 100%', run: b => b.setZoom(1) },
      { section: 'board', icon: 'settings-2', label: 'Customise the toolbar…', run: b => b.plugin.openSettings() },
    ];
    for (const a of [...overflowActions, ...builtIn]) {
      if (a.available && !a.available(board)) continue;
      if (!sections.has(a.section)) sections.set(a.section, []);
      sections.get(a.section)!.push(a);
    }
    for (const list of sections.values()) {
      el.createDiv('vc-more-sep');
      for (const a of list) {
        const row = el.createDiv({ cls: 'vc-more-row', attr: { role: 'button' } });
        setIcon(row.createDiv('vc-more-row-icon'), a.icon);
        row.createDiv({ cls: 'vc-more-row-label', text: t(a.label) });
        row.addEventListener('click', () => { this.close(); a.run(board); });
      }
    }

    // Open next to the button, kept inside the board.
    const br = board.root.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    const pos = board.settings.toolbarPosition;
    const pw = el.offsetWidth, ph = el.offsetHeight;
    let x = ar.left + ar.width / 2 - pw / 2 - br.left;
    let y = pos === 'top' ? ar.bottom + 8 - br.top : ar.top - ph - 8 - br.top;
    if (pos === 'left') { x = ar.right + 8 - br.left; y = ar.top + ar.height / 2 - ph / 2 - br.top; }
    if (pos === 'right') { x = ar.left - pw - 8 - br.left; y = ar.top + ar.height / 2 - ph / 2 - br.top; }
    x = Math.max(8, Math.min(br.width - pw - 8, x));
    y = Math.max(8, Math.min(br.height - ph - 8, y));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;

    const doc = el.ownerDocument;
    const outside = (e: PointerEvent) => {
      if (el.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
      this.close();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); this.close(); } };
    doc.addEventListener('pointerdown', outside, true);
    doc.addEventListener('keydown', key, true);
    this.offDoc = () => { doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', key, true); };
  }

  close(): void {
    if (!this.el.isConnected) return;
    this.offDoc();
    this.el.remove();
    this.onClose();
  }
}

// ── bottom-left: search, minimap, appearance, zoom ───────────

export function attachCorner(board: Board): void {
  const corner = board.uiEl.createDiv('vc-corner');
  corner.addEventListener('pointerdown', e => e.stopPropagation());
  corner.addEventListener('dblclick', e => e.stopPropagation());
  corner.addEventListener('wheel', e => e.stopPropagation());

  const panel = corner.createDiv('vc-corner-panel');
  const row = corner.createDiv('vc-corner-row');
  const btn = (icon: string, label: string, onClick: (e: MouseEvent) => void) => {
    const b = row.createDiv({ cls: 'vc-corner-btn clickable-icon', attr: { role: 'button', 'aria-label': label } });
    setIcon(b, icon);
    setTooltip(b, label, { placement: 'top' });
    b.addEventListener('click', onClick);
    return b;
  };

  const search = new SearchBox(board, panel);
  const minimap = new Minimap(board, panel);

  const searchBtn = btn('search', t('Search the board'), () => { search.toggle(); searchBtn.toggleClass('is-active', search.open); });
  board.addDisposer(() => search.close());
  const mapBtn = btn('map', t('Minimap'), () => { minimap.toggle(); mapBtn.toggleClass('is-active', minimap.open); });
  btn('palette', t('Appearance'), (e) => appearanceMenu(board, e));
  const zoom = row.createDiv({ cls: 'vc-zoom-label', attr: { role: 'button', 'aria-label': t('Zoom') } });
  setTooltip(zoom, t('Zoom'), { placement: 'top' });
  zoom.addEventListener('click', (e) => {
    const menu = new Menu();
    menu.addItem(i => i.setTitle(t('Zoom in')).setIcon('zoom-in').onClick(() => board.zoomBy(1.25)));
    menu.addItem(i => i.setTitle(t('Zoom out')).setIcon('zoom-out').onClick(() => board.zoomBy(0.8)));
    menu.addItem(i => i.setTitle(t('Zoom to 100%')).setIcon('scan').onClick(() => board.setZoom(1)));
    menu.addItem(i => i.setTitle(t('Zoom to fit')).setIcon('maximize').onClick(() => board.zoomToFit()));
    if (board.selection.size) menu.addItem(i => i.setTitle(t('Zoom to selection')).setIcon('scan-search').onClick(() => board.zoomToFit([...board.selection])));
    menu.showAtMouseEvent(e);
  });
  const updateZoom = () => zoom.setText(`${Math.round(board.vp.zoom * 100)}%`);
  updateZoom();
  board.on('viewport', updateZoom);

  // ⌘F (hotkeys.ts) opens search.
  board.openSearch = () => {
    if (!search.open) { search.toggle(); searchBtn.addClass('is-active'); }
    search.focus();
  };
  search.onClose = () => searchBtn.removeClass('is-active');
}

function appearanceMenu(board: Board, e: MouseEvent): void {
  const plugin = board.plugin;
  const s = plugin.settings;
  const menu = new Menu();
  const save = () => { void plugin.saveSettings(); plugin.refreshBoards(); };
  menu.addItem(i => i.setTitle(t('Snap to grid')).setIcon('grid-3x3').setChecked(s.snapToGrid).onClick(() => { s.snapToGrid = !s.snapToGrid; save(); }));
  const sizes: [number, string][] = [[1, 'Small dots'], [1.5, 'Medium dots'], [2.5, 'Large dots'], [0, 'Hide dots']];
  for (const [size, label] of sizes) {
    menu.addItem(i => i.setTitle(t(label)).setSection('dots').setChecked(s.dotSize === size).onClick(() => { s.dotSize = size; save(); }));
  }
  menu.addItem(i => i.setTitle(t('More appearance settings…')).setIcon('settings').setSection('more').onClick(() => plugin.openSettings()));
  menu.showAtMouseEvent(e);
}

// ── search ────────────────────────────────────────────────────

class SearchBox {
  open = false;
  onClose: (() => void) | null = null;
  private el: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private hits: string[] = [];
  private index = -1;

  constructor(private board: Board, private host: HTMLElement) {}

  toggle(): void { if (this.open) this.close(); else this.show(); }

  focus(): void { this.input?.focus(); this.input?.select(); }

  private show(): void {
    this.open = true;
    this.el = this.host.createDiv('vc-search');
    this.input = this.el.createEl('input', { type: 'search', placeholder: t('Search cards…') });
    const count = this.el.createDiv('vc-search-count');
    const run = () => {
      const q = this.input!.value.trim().toLowerCase();
      this.clearHits();
      if (!q) { count.setText(''); return; }
      this.hits = this.board.model.nodes.filter(n => {
        const c = this.board.cards.get(n.id);
        const text = (c?.handle.searchText?.() ?? n.text ?? n.label ?? n.file ?? n.url ?? '').toLowerCase();
        return text.includes(q);
      }).map(n => n.id);
      for (const id of this.hits) this.board.cards.get(id)?.el.addClass('is-search-hit');
      this.index = -1;
      count.setText(this.hits.length ? `${this.hits.length}` : t('No results'));
    };
    this.input.addEventListener('input', run);
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { this.close(); this.board.root.focus(); }
      if (e.key === 'Enter' && this.hits.length) {
        this.index = (this.index + (e.shiftKey ? -1 : 1) + this.hits.length) % this.hits.length;
        const id = this.hits[this.index];
        const n = this.board.model.node(id);
        if (n) {
          this.board.select([id]);
          this.board.reveal(nodeRect(n));
          count.setText(`${this.index + 1} / ${this.hits.length}`);
        }
      }
    });
    this.input.focus();
  }

  private clearHits(): void {
    for (const id of this.hits) this.board.cards.get(id)?.el.removeClass('is-search-hit');
    this.hits = [];
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.clearHits();
    this.el?.remove();
    this.el = null;
    this.onClose?.();
  }
}

// ── minimap ───────────────────────────────────────────────────

class Minimap {
  open = false;
  private el: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private raf = 0;
  private offs: (() => void)[] = [];

  constructor(private board: Board, private host: HTMLElement) {}

  toggle(): void { if (this.open) this.close(); else this.show(); }

  private show(): void {
    this.open = true;
    this.el = this.host.createDiv('vc-minimap');
    this.canvas = this.el.createEl('canvas');
    this.canvas.width = 220 * devicePixelRatio;
    this.canvas.height = 150 * devicePixelRatio;
    const schedule = () => { cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(() => this.draw()); };
    this.offs.push(this.board.on('viewport', schedule), this.board.onChange(schedule));
    const nav = (e: PointerEvent) => {
      const m = this.mapping();
      if (!m) return;
      const r = this.canvas!.getBoundingClientRect();
      const wx = (e.clientX - r.left - m.ox) / m.s, wy = (e.clientY - r.top - m.oy) / m.s;
      const { width, height } = this.board.screenSize();
      this.board.vp.x = width / 2 - wx * this.board.vp.zoom;
      this.board.vp.y = height / 2 - wy * this.board.vp.zoom;
      this.board.applyViewport();
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      nav(e);
      const move = (ev: PointerEvent) => nav(ev);
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    this.draw();
  }

  private mapping(): { s: number; ox: number; oy: number; world: { x: number; y: number; width: number; height: number } } | null {
    const nodes = this.board.model.nodes;
    const { width, height } = this.board.screenSize();
    const tl = this.board.vp.toWorld(0, 0), br = this.board.vp.toWorld(width, height);
    const view = { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y };
    const world = unionRect([...nodes.map(nodeRect), view]);
    if (!world) return null;
    const W = 220, H = 150, pad = 8;
    const s = Math.min((W - pad * 2) / world.width, (H - pad * 2) / world.height);
    return { s, ox: (W - world.width * s) / 2 - world.x * s, oy: (H - world.height * s) / 2 - world.y * s, world };
  }

  private draw(): void {
    const c = this.canvas;
    if (!c) return;
    const g = c.getContext('2d')!;
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.clearRect(0, 0, 220, 150);
    const m = this.mapping();
    if (!m) return;
    const style = getComputedStyle(this.board.root);
    const base = style.getPropertyValue('--text-faint').trim() || '#888';
    for (const n of this.board.model.nodes) {
      const col = cssColor(n.color);
      g.globalAlpha = n.type === 'group' ? 0.25 : 0.7;
      g.fillStyle = col ? resolveCss(this.board.root, col) : base;
      g.fillRect(n.x * m.s + m.ox, n.y * m.s + m.oy, Math.max(1, n.width * m.s), Math.max(1, n.height * m.s));
    }
    g.globalAlpha = 1;
    const { width, height } = this.board.screenSize();
    const tl = this.board.vp.toWorld(0, 0), br = this.board.vp.toWorld(width, height);
    g.strokeStyle = style.getPropertyValue('--interactive-accent').trim() || '#7c5cff';
    g.lineWidth = 1.5;
    g.strokeRect(tl.x * m.s + m.ox, tl.y * m.s + m.oy, (br.x - tl.x) * m.s, (br.y - tl.y) * m.s);
  }

  close(): void {
    this.open = false;
    cancelAnimationFrame(this.raf);
    for (const off of this.offs.splice(0)) off();
    this.el?.remove();
    this.el = null;
    this.canvas = null;
  }
}

/** Resolve a CSS colour expression (may contain var()) to a concrete colour. */
function resolveCss(host: HTMLElement, expr: string): string {
  const probe = host.createDiv();
  probe.style.color = expr;
  const v = getComputedStyle(probe).color;
  probe.remove();
  return v;
}
