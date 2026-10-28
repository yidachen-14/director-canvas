import { Menu, setIcon, setTooltip } from 'obsidian';
import type { Board } from './board';
import { availableTools, FIXED_TOOLS, toolById, type Tool } from './tools';
import { ZOOM_STEPS } from './board';
import { shortcutLabel, toolTip } from './shortcuts';
import { getCardType } from '../cards/registry';
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

  /**
   * A click on a tool: modes toggle, actions run, card kinds wait for a click on the board
   * (the cursor shows the tool; the click is the card's top-left corner).
   */
  const activate = (tool: Tool) => {
    panel?.close();
    if (tool.run) { board.setTool('select'); tool.run(board); return; }
    board.setTool(board.tool === tool.id && tool.id !== 'select' ? 'select' : tool.id);
    board.root.focus({ preventScroll: true });
  };

  const render = () => {
    panel?.close();
    bar.empty();
    const s = board.settings;
    bar.setAttr('data-size', s.toolbarSize);
    const avail = availableTools();
    const fixed = FIXED_TOOLS.map(id => toolById(id)!).filter(Boolean);
    const chosen = s.toolbarTools.filter(id => !FIXED_TOOLS.includes(id)).map(id => avail.find(x => x.id === id)).filter((x): x is Tool => !!x);
    const tip = { placement: ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const)[s.toolbarPosition] };
    const button = (tool: Tool) => {
      const b = bar.createDiv({ cls: 'vc-tool', attr: { 'data-tool': tool.id, role: 'button', 'aria-label': t(tool.label) } });
      setIcon(b.createDiv('vc-tool-icon'), tool.icon);
      if (s.toolbarSize !== 'S') b.createDiv({ cls: 'vc-tool-label', text: t(tool.label) });
      setTooltip(b, toolTip(tool.id, t(tool.label), s.hotkeys), tip);
      b.toggleClass('is-active', board.tool === tool.id);
      bindToolPress(board, b, tool, () => activate(tool));
    };
    for (const tool of fixed) button(tool);
    bar.createDiv('vc-tool-sep');
    for (const tool of chosen) button(tool);
    if (chosen.length) bar.createDiv('vc-tool-sep');
    const more = bar.createDiv({ cls: 'vc-tool vc-tool-more', attr: { role: 'button', 'aria-label': t('More') } });
    setIcon(more.createDiv('vc-tool-icon'), 'more-horizontal');
    if (s.toolbarSize !== 'S') more.createDiv({ cls: 'vc-tool-label', text: t('More') });
    setTooltip(more, t('More'), tip);
    more.addEventListener('click', () => {
      if (panel) { panel.close(); return; }
      const rest = avail.filter(x => !FIXED_TOOLS.includes(x.id) && !chosen.includes(x));
      panel = new OverflowPanel(board, more, rest, activate, () => { panel = null; more.removeClass('is-active'); });
      more.addClass('is-active');
    });
  };
  render();
  const syncActive = () => {
    let onBar = false;
    for (const el of Array.from(bar.querySelectorAll<HTMLElement>('.vc-tool'))) {
      if (!el.dataset.tool) continue;
      el.toggleClass('is-active', el.dataset.tool === board.tool);
      if (el.dataset.tool === board.tool) onBar = true;
    }
    // A tool picked from "More" lights up the More button while it is in use.
    bar.querySelector('.vc-tool-more')?.toggleClass('is-tool-active', !onBar && board.tool !== 'select');
  };
  board.on('tool', syncActive);
  board.addRefresher(render);
  board.addDisposer(() => panel?.close());
}

/** The toolbar's "More" list: the other tools (click or drag), board actions, then "Customise the toolbar". */
class OverflowPanel {
  private el: HTMLElement;
  private offDoc: () => void;

  constructor(board: Board, anchor: HTMLElement, tools: Tool[], activate: (t: Tool) => void, private onClose: () => void) {
    const el = board.uiEl.createDiv('vc-more-panel');
    this.el = el;
    el.addEventListener('pointerdown', e => e.stopPropagation());
    el.addEventListener('dblclick', e => e.stopPropagation());
    el.addEventListener('wheel', e => e.stopPropagation());

    const row = (icon: string, label: string) => {
      const r = el.createDiv({ cls: 'vc-more-row', attr: { role: 'button', 'aria-label': label } });
      setIcon(r.createDiv('vc-more-row-icon'), icon);
      r.createDiv({ cls: 'vc-more-row-label', text: label });
      return r;
    };

    for (const tool of tools) {
      const r = row(tool.icon, t(tool.label));
      const k = shortcutLabel(`tool-${tool.id}`, board.settings.hotkeys);
      if (k) r.createDiv({ cls: 'vc-more-row-keys', text: k });
      r.toggleClass('is-active', board.tool === tool.id);
      bindToolPress(board, r, tool, () => activate(tool), () => this.close());
    }

    const sections = new Map<string, OverflowAction[]>();
    for (const a of overflowActions) {
      if (a.available && !a.available(board)) continue;
      if (!sections.has(a.section)) sections.set(a.section, []);
      sections.get(a.section)!.push(a);
    }
    for (const list of sections.values()) {
      if (el.childElementCount) el.createDiv('vc-more-sep');
      for (const a of list) row(a.icon, t(a.label)).addEventListener('click', () => { this.close(); a.run(board); });
    }
    if (el.childElementCount) el.createDiv('vc-more-sep');
    row('settings-2', t('Customise the toolbar…')).addEventListener('click', () => { this.close(); board.plugin.openSettings(); });

    // Open next to the button, kept inside the board.
    const br = board.root.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    const pos = board.settings.toolbarPosition;
    const pw = el.offsetWidth, ph = el.offsetHeight;
    let x = ar.right - pw - br.left;
    let y = pos === 'bottom' ? ar.top - ph - 8 - br.top : ar.bottom + 8 - br.top;
    if (pos === 'left') { x = ar.right + 8 - br.left; y = ar.top - br.top; }
    if (pos === 'right') { x = ar.left - pw - 8 - br.left; y = ar.top - br.top; }
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

// ── bottom-left: history · search, minimap, appearance · zoom ─

export function attachCorner(board: Board): void {
  const corner = board.uiEl.createDiv('vc-corner');
  corner.addEventListener('pointerdown', e => e.stopPropagation());
  corner.addEventListener('dblclick', e => e.stopPropagation());
  corner.addEventListener('wheel', e => e.stopPropagation());

  const panel = corner.createDiv('vc-corner-panel');
  const bars = corner.createDiv('vc-corner-bars');
  const pill = () => bars.createDiv('vc-corner-row');
  const btn = (row: HTMLElement, icon: string, label: string, onClick: (e: MouseEvent) => void) => {
    const b = row.createDiv({ cls: 'vc-corner-btn clickable-icon', attr: { role: 'button', 'aria-label': label } });
    setIcon(b, icon);
    setTooltip(b, label, { placement: 'top' });
    b.addEventListener('click', onClick);
    return b;
  };
  const sep = (row: HTMLElement) => row.createDiv('vc-corner-sep');

  // 1. History
  const history = pill();
  const undoBtn = btn(history, 'undo-2', t('Undo'), () => board.undo());
  sep(history);
  const redoBtn = btn(history, 'redo-2', t('Redo'), () => board.redo());
  const updateHistory = () => {
    undoBtn.toggleClass('is-disabled', !board.model.canUndo());
    redoBtn.toggleClass('is-disabled', !board.model.canRedo());
  };
  updateHistory();
  board.addDisposer(board.onChange(updateHistory));

  // 2. View tools
  const view = pill();
  const search = new SearchBox(board, panel);
  const minimap = new Minimap(board, panel);
  const searchBtn = btn(view, 'search', t('Search the board'), () => { search.toggle(); searchBtn.toggleClass('is-active', search.open); });
  board.addDisposer(() => search.close());
  const mapBtn = btn(view, 'map', t('Minimap'), () => { minimap.toggle(); mapBtn.toggleClass('is-active', minimap.open); });
  btn(view, 'palette', t('Appearance'), (e) => appearanceMenu(board, e));

  // 3. Zoom: + · 100% ▾ · −
  const zoomRow = pill();
  zoomRow.addClass('vc-zoom-row');
  btn(zoomRow, 'plus', t('Zoom in'), () => board.zoomStep(1));
  const zoom = zoomRow.createDiv({ cls: 'vc-zoom-label', attr: { role: 'button', 'aria-label': t('Zoom to 100%') } });
  setTooltip(zoom, t('Zoom to 100%'), { placement: 'top' });
  zoom.addEventListener('click', () => board.setZoom(1, true));
  const caret = zoomRow.createDiv({ cls: 'vc-zoom-caret clickable-icon', attr: { role: 'button', 'aria-label': t('Zoom options') } });
  setIcon(caret, 'chevron-down');
  setTooltip(caret, t('Zoom options'), { placement: 'top' });
  let zoomPop: ZoomPopover | null = null;
  caret.addEventListener('click', () => {
    if (zoomPop) { zoomPop.close(); return; }
    zoomPop = new ZoomPopover(board, zoomRow, () => { zoomPop = null; caret.removeClass('is-active'); });
    caret.addClass('is-active');
  });
  btn(zoomRow, 'minus', t('Zoom out'), () => board.zoomStep(-1));
  const updateZoom = () => zoom.setText(`${Math.round(board.vp.zoom * 100)}%`);
  updateZoom();
  board.on('viewport', updateZoom);
  board.addDisposer(() => zoomPop?.close());

  // ⌘F (hotkeys.ts) opens search.
  board.openSearch = () => {
    if (!search.open) { search.toggle(); searchBtn.addClass('is-active'); }
    search.focus();
  };
  search.onClose = () => searchBtn.removeClass('is-active');
}

/** Under the zoom caret: a slider, and the overview views. */
class ZoomPopover {
  private el: HTMLElement;
  private offs: (() => void)[] = [];

  constructor(board: Board, anchor: HTMLElement, private onClose: () => void) {
    const el = board.uiEl.createDiv('vc-zoom-pop');
    this.el = el;
    el.addEventListener('pointerdown', e => e.stopPropagation());
    el.addEventListener('wheel', e => e.stopPropagation());

    // Slider on a log scale, 10% – 400%.
    const MIN = Math.log(0.1), MAX = Math.log(4);
    const sliderRow = el.createDiv('vc-zoom-slider');
    const slider = sliderRow.createEl('input', { type: 'range', cls: 'slider', attr: { min: '0', max: '1000', step: '1' } });
    const value = sliderRow.createDiv({ cls: 'vc-zoom-slider-value' });
    const sync = () => {
      const z = board.vp.zoom;
      slider.value = String(Math.round(((Math.log(Math.min(4, Math.max(0.1, z))) - MIN) / (MAX - MIN)) * 1000));
      value.setText(`${Math.round(z * 100)}%`);
    };
    sync();
    slider.addEventListener('input', () => {
      const z = Math.exp(MIN + (Number(slider.value) / 1000) * (MAX - MIN));
      // Settle on round percentages near the fixed levels.
      const near = ZOOM_STEPS.find(s => Math.abs(s - z) / s < 0.03);
      board.setZoom(near ?? Math.round(z * 100) / 100);
    });
    this.offs.push(board.on('viewport', sync));

    const item = (icon: string, label: string, keys: string, run: () => void) => {
      const r = el.createDiv({ cls: 'vc-more-row', attr: { role: 'button' } });
      setIcon(r.createDiv('vc-more-row-icon'), icon);
      r.createDiv({ cls: 'vc-more-row-label', text: label });
      if (keys) r.createDiv({ cls: 'vc-more-row-keys', text: keys });
      r.addEventListener('click', () => { this.close(); run(); });
    };
    el.createDiv('vc-more-sep');
    const keys = (id: string) => shortcutLabel(id, board.settings.hotkeys);
    item('maximize', t('Zoom to fit'), keys('zoom-fit'), () => board.zoomToFit(undefined, true));
    if (board.selection.size) item('scan-search', t('Zoom to selection'), keys('zoom-selection'), () => board.zoomToFit([...board.selection], true));
    item('scan', t('Zoom to 100%'), keys('zoom-100'), () => board.setZoom(1, true));

    const br = board.root.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
    el.style.left = `${Math.max(8, ar.left - br.left)}px`;
    el.style.bottom = `${br.bottom - ar.top + 8}px`;

    const doc = el.ownerDocument;
    const outside = (e: PointerEvent) => { if (!el.contains(e.target as Node) && !anchor.contains(e.target as Node)) this.close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); this.close(); } };
    doc.addEventListener('pointerdown', outside, true);
    doc.addEventListener('keydown', key, true);
    this.offs.push(() => { doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', key, true); });
  }

  close(): void {
    if (!this.el.isConnected) return;
    for (const off of this.offs.splice(0)) off();
    this.el.remove();
    this.onClose();
  }
}

function appearanceMenu(board: Board, e: MouseEvent): void {
  const plugin = board.plugin;
  const s = plugin.settings;
  const menu = new Menu();
  const save = () => { void plugin.saveSettings(); plugin.refreshBoards(); };
  menu.addItem(i => i.setTitle(t('Snap to grid')).setIcon('grid-3x3').setChecked(s.snapToGrid).onClick(() => { s.snapToGrid = !s.snapToGrid; save(); }));
  const grids: ['lines' | 'dots' | 'none', number, string][] = [
    ['dots', 1, 'Small dots'], ['dots', 1.5, 'Medium dots'], ['dots', 2.5, 'Large dots'], ['lines', 0, 'Square grid'], ['none', 0, 'Hide the grid'],
  ];
  for (const [style, size, label] of grids) {
    const on = style === 'none' ? s.dotSize === 0 : s.dotSize > 0 && s.gridStyle === style && (style === 'lines' || s.dotSize === size);
    menu.addItem(i => i.setTitle(t(label)).setSection('dots').setChecked(on).onClick(() => {
      if (style === 'none') s.dotSize = 0;
      else { s.gridStyle = style; if (style === 'dots') s.dotSize = size; else if (!s.dotSize) s.dotSize = 1.5; }
      save();
    }));
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
    const schedule = () => { cancelAnimationFrame(this.raf); this.raf = window.requestAnimationFrame(() => this.draw()); };
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
