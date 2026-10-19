import { Menu, setIcon, setTooltip } from 'obsidian';
import type { Board } from './board';
import { availableTools, toolById, type Tool } from './tools';
import { nodeRect, unionRect } from '../model/board-model';
import { cssColor } from '../cards/util';
import { t } from '../i18n';

/** Extra entries for the toolbar's "…" menu, added by later modules. */
const overflowActions: { section: string; add(menu: Menu, board: Board): void }[] = [];
export function contributeOverflow(a: { section: string; add(menu: Menu, board: Board): void }): void { overflowActions.push(a); }

// ── toolbar ───────────────────────────────────────────────────

export function attachToolbar(board: Board): void {
  const bar = board.uiEl.createDiv('vc-toolbar');
  bar.addEventListener('pointerdown', e => e.stopPropagation());
  bar.addEventListener('dblclick', e => e.stopPropagation());

  const activate = (tool: Tool) => {
    if (tool.run) { board.setTool('select'); tool.run(board); return; }
    board.setTool(board.tool === tool.id && tool.id !== 'select' ? 'select' : tool.id);
    board.root.focus({ preventScroll: true });
  };

  const render = () => {
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
      setTooltip(b, t(tool.label), { placement: s.toolbarPosition === 'bottom' ? 'top' : 'bottom' });
      b.toggleClass('is-active', board.tool === tool.id);
      b.addEventListener('click', () => activate(tool));
    }
    const more = bar.createDiv({ cls: 'vc-tool vc-tool-more', attr: { role: 'button', 'aria-label': t('More') } });
    setIcon(more.createDiv('vc-tool-icon'), 'more-horizontal');
    if (s.toolbarSize !== 'S') more.createDiv({ cls: 'vc-tool-label', text: t('More') });
    more.addEventListener('click', (e) => {
      const menu = new Menu();
      const rest = avail.filter(x => !shown.includes(x));
      for (const tool of rest) {
        menu.addItem(i => i.setTitle(t(tool.label)).setIcon(tool.icon).setSection('tools').onClick(() => activate(tool)));
      }
      for (const a of overflowActions) a.add(menu, board);
      menu.addItem(i => i.setTitle(t('Zoom to fit')).setIcon('maximize').setSection('view').onClick(() => board.zoomToFit()));
      menu.addItem(i => i.setTitle(t('Zoom to 100%')).setIcon('scan').setSection('view').onClick(() => board.setZoom(1)));
      menu.showAtMouseEvent(e);
    });
  };
  render();
  board.on('tool', () => {
    for (const el of Array.from(bar.querySelectorAll<HTMLElement>('.vc-tool'))) el.toggleClass('is-active', el.dataset.tool === board.tool);
  });
  board.addRefresher(render);
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
