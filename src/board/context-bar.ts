import { getIcon, setIcon, setTooltip } from 'obsidian';
import type { Board } from './board';
import type { BarItem } from '../cards/types';
import { ARRANGE, runArrange, type ArrangeDef } from './arrange-commands';
import { duplicateSelection } from './interactions';
import { showSelectionMenu } from './menus';
import { cardKindOf, presetColor } from '../cards/util';
import { getCardType } from '../cards/registry';
import { t } from '../i18n';

/** Set an icon, falling back to the next name when this Obsidian's icon set lacks one. */
export function setIconSafe(el: HTMLElement, names: string | string[]): void {
  for (const n of Array.isArray(names) ? names : [names]) {
    if (getIcon(n)) { setIcon(el, n); return; }
  }
  setIcon(el, 'circle');
}

/** Icons for the arrange commands, with fallbacks for older icon sets. */
const ICON_FALLBACK: Record<string, string[]> = {
  'align-horizontal-space-around': ['align-horizontal-space-around', 'align-horizontal-distribute-center', 'columns-3'],
  'align-vertical-space-around': ['align-vertical-space-around', 'align-vertical-distribute-center', 'rows-3'],
  'a-large-small': ['arrow-down-a-z', 'arrow-down-az', 'a-large-small'],
  'ellipsis-vertical': ['ellipsis-vertical', 'more-vertical'],
  'more-horizontal': ['ellipsis', 'more-horizontal'],
  'arrow-left-to-line': ['arrow-left-to-line', 'chevrons-left'],
  'arrow-right-to-line': ['arrow-right-to-line', 'chevrons-right'],
  'arrow-up-to-line': ['arrow-up-to-line', 'chevrons-up'],
  'arrow-down-to-line': ['arrow-down-to-line', 'chevrons-down'],
};
const iconFor = (name: string) => ICON_FALLBACK[name] ?? [name];

const COLORS: { id: string | undefined; label: string }[] = [
  { id: undefined, label: 'No colour' },
  { id: '1', label: 'Red' }, { id: '2', label: 'Orange' }, { id: '3', label: 'Yellow' },
  { id: '4', label: 'Green' }, { id: '5', label: 'Cyan' }, { id: '6', label: 'Purple' },
];

/**
 * A small bar floating above the selection (Boardmix-style): what the
 * selected card can do, and for several cards, aligning and arranging them.
 */
export class ContextBar {
  private el: HTMLElement;
  private pop: HTMLElement | null = null;
  private key = '';
  /** The selected cards' data changed since the bar was built. */
  private dataDirty = false;
  private raf = 0;

  constructor(private board: Board) {
    this.el = board.uiEl.createDiv('vc-ctx-bar');
    this.el.hide();
    this.el.addEventListener('pointerdown', e => e.stopPropagation());
    this.el.addEventListener('dblclick', e => e.stopPropagation());
    this.el.addEventListener('wheel', e => e.stopPropagation());
    const schedule = () => { cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(() => this.refresh()); };
    board.on('selection', schedule);
    board.on('viewport', () => this.place());
    board.on('tool', schedule);
    board.addDisposer(board.onChange((e) => {
      if (!e.preview && (e.reset || e.ids.some(id => board.selection.has(id)))) this.dataDirty = true;
      schedule();
    }));
    board.addDisposer(() => { cancelAnimationFrame(this.raf); this.closePop(); this.el.remove(); });
  }

  /** Rebuild when what is selected changed; otherwise just move. */
  refresh(): void {
    const b = this.board;
    const nodes = b.selectedNodes();
    const show = nodes.length > 0 && !b.edgeSelection.size && b.tool === 'select' && !b.editingId;
    if (!show) { this.hide(); return; }
    const sole = nodes.length === 1 ? b.cards.get(nodes[0].id)?.handle : undefined;
    const key = nodes.map(n => `${n.id}:${cardKindOf(n)}:${n.color ?? ''}`).join('|') + (sole?.barKey?.() ?? '');
    if (key !== this.key || !this.el.isShown()) {
      this.key = key;
      this.closePop();
      this.build();
    } else if (this.dataDirty) {
      // Same selection, its data changed: redraw the buttons, keeping an open panel open (and redrawn).
      this.rebuildKeepingPanel();
    }
    this.dataDirty = false;
    this.el.show();
    this.place();
  }

  hide(): void {
    this.closePop();
    this.el.hide();
    this.key = '';
  }

  // ── layout ──────────────────────────────────────────────

  private place(): void {
    if (!this.el.isShown()) return;
    const r = this.anchorRect();
    if (!r) return;
    const vp = this.board.vp;
    const a = vp.toScreen(r.x, r.y), b = vp.toScreen(r.x + r.width, r.y + r.height);
    const { width, height } = this.board.screenSize();
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    const gap = 14;
    let x = (a.x + b.x) / 2 - w / 2;
    let y = a.y - h - gap;
    // A group's name sits above it; keep clear of it.
    if (this.board.selectedNodes().some(n => n.type === 'group')) y -= 22;
    if (y < 8) y = b.y + gap; // no room above: below the selection
    if (y + h > height - 8) y = Math.max(8, Math.min(height - h - 8, a.y + 8)); // tall selection: inside its top
    x = Math.max(8, Math.min(width - w - 8, x));
    // Parts of the card the bar must not cover (other mind map topics): try below, then around the whole card.
    const nodes = this.board.selectedNodes();
    const avoid = nodes.length === 1 ? this.board.cards.get(nodes[0].id)?.handle.barAvoid?.() ?? [] : [];
    if (avoid.length) {
      const boxes = avoid.map(q => { const p = vp.toScreen(q.x, q.y), p2 = vp.toScreen(q.x + q.width, q.y + q.height); return { l: p.x, t: p.y, r: p2.x, b: p2.y }; });
      const card = this.board.selectionRect();
      const c1 = card ? vp.toScreen(card.x, card.y) : a, c2 = card ? vp.toScreen(card.x + card.width, card.y + card.height) : b;
      const clear = (cy: number) => cy >= 8 && cy + h <= height - 8 && !boxes.some(q => x < q.r && x + w > q.l && cy < q.b + 4 && cy + h > q.t - 4);
      const tries = [a.y - h - gap, b.y + gap, c1.y - h - gap, c2.y + gap];
      const pick = tries.find(clear);
      if (pick !== undefined) y = pick;
    }
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (this.pop && this.popAnchor) this.placePop(this.popAnchor);
  }

  /** What the bar sits next to, in board coordinates. */
  private anchorRect(): { x: number; y: number; width: number; height: number } | null {
    const nodes = this.board.selectedNodes();
    const anchor = nodes.length === 1 ? this.board.cards.get(nodes[0].id)?.handle.barAnchor?.() : null;
    return anchor ?? this.board.selectionRect();
  }

  // ── content ─────────────────────────────────────────────

  private build(): void {
    const el = this.el;
    el.empty();
    this.builders.clear();
    const b = this.board;
    const nodes = b.selectedNodes();
    const multi = nodes.length > 1;

    if (multi) {
      el.createDiv({ cls: 'vc-ctx-count', text: t('{n} selected', { n: nodes.length }) });
      this.sep();
      this.dropdownButton('size', 'move-diagonal-2', t('Size'), (pop, close) => this.sizePanel(pop, close));
      this.dropdownButton('align', 'align-start-vertical', t('Align'), (pop) => this.alignPanel(pop, nodes.length));
      this.dropdownButton('arrange', 'layout-grid', t('Arrange'), (pop, close) => this.arrangePanel(pop, close));
      this.dropdownButton('same', 'maximize-2', t('Same size'), (pop, close) => this.arrangeList(pop, close, ['size']));
      this.button({ id: 'shuffle', icon: 'shuffle', label: t('Arrange randomly'), run: () => runArrange(b, 'random') });
      this.button({ id: 'group', icon: 'box-select', label: t('Create group from selection'), run: () => b.groupSelection() });
      this.sep();
    } else {
      const card = b.cards.get(nodes[0].id);
      const items = card?.handle.barItems?.() ?? [];
      for (const it of items) this.item(it);
      // A part of the card is selected (a mind map topic): only its own controls.
      if (card?.handle.barExclusive?.()) { this.updateActive(); return; }
      if (items.length) this.sep();
      const kind = cardKindOf(nodes[0]);
      if (kind !== 'text' && !getCardType(kind)?.fixedSize) this.dropdownButton('size', 'move-diagonal-2', t('Size'), (pop, close) => this.sizePanel(pop, close));
    }

    const drawingOnly = nodes.every(n => cardKindOf(n) === 'drawing');
    if (!nodes.every(n => getCardType(cardKindOf(n))?.noColor)) this.dropdownButton('color', 'palette', drawingOnly ? t('Ink colour') : t('Colour'), (pop, close) => this.colorPanel(pop, close), true);
    this.dropdownButton('layer', 'layers', t('Layer'), (pop, close) => {
      this.listItem(pop, 'bring-to-front', t('Bring to front'), () => { b.reorderSelection('front'); close(); });
      this.listItem(pop, 'send-to-back', t('Send to back'), () => { b.reorderSelection('back'); close(); });
    });
    this.button({ id: 'dup', icon: 'copy-plus', label: t('Duplicate'), run: () => duplicateSelection(b) });
    const del = this.button({ id: 'del', icon: 'trash-2', label: t('Delete'), run: () => b.deleteSelection() });
    del.addClass('is-danger');
    this.button({
      id: 'more', icon: 'more-horizontal', label: t('More'),
      run: () => {
        const r = this.el.getBoundingClientRect();
        showSelectionMenu(b, r.right - 16, r.bottom + 4);
      },
    });
    this.updateActive();
  }

  private sep(): void { this.el.createDiv('vc-ctx-sep'); }

  private button(it: BarItem): HTMLElement {
    if (it.dropdown) this.builders.set(it.id, it.dropdown);
    const btn = this.el.createDiv({ cls: 'vc-ctx-btn', attr: { role: 'button', 'aria-label': it.label, 'data-id': it.id } });
    setIconSafe(btn.createDiv('vc-ctx-icon'), iconFor(it.icon));
    if (it.text) btn.createDiv({ cls: 'vc-ctx-text', text: it.text });
    btn.toggleClass('is-active', !!it.active);
    setTooltip(btn, it.label, { placement: 'top' });
    let timer = 0;
    btn.addEventListener('click', () => {
      // A click decides; a hover-open still waiting must not undo it.
      window.clearTimeout(timer);
      if (it.dropdown) { if (this.popAnchor !== btn || !this.hoverOpened) this.togglePop(btn, it.dropdown); this.hoverOpened = false; }
      else { this.closePop(); it.run?.(); }
    });
    if (it.dropdown) {
      // Like Boardmix: resting the pointer on a button opens its panel.
      btn.addEventListener('mouseenter', () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          if (this.popAnchor === btn) return;
          this.togglePop(btn, it.dropdown!);
          this.hoverOpened = true;
          window.setTimeout(() => { this.hoverOpened = false; }, 400);
        }, this.pop ? 60 : 220);
      });
      btn.addEventListener('mouseleave', () => window.clearTimeout(timer));
    }
    return btn;
  }

  private item(it: BarItem): void {
    const btn = this.button(it);
    if (it.swatch !== undefined) {
      const dot = btn.createDiv('vc-ctx-swatch-dot');
      if (it.swatch === 'none' || !it.swatch) dot.addClass('is-none'); else dot.style.background = it.swatch;
    }
    if (it.dropdown) btn.createDiv('vc-ctx-caret');
  }

  /** Rebuild the buttons; a panel that was open is opened again (with fresh content) and keeps its scroll. */
  private rebuildKeepingPanel(): void {
    const openId = this.popAnchor?.dataset.id;
    const scroll = this.pop?.scrollTop ?? 0;
    const builder = openId ? this.builders.get(openId) : undefined;
    this.closePop();
    this.build();
    if (!openId || !builder) return;
    const btn = this.el.querySelector<HTMLElement>(`.vc-ctx-btn[data-id="${CSS.escape(openId)}"]`);
    const fresh = this.builders.get(openId);
    if (!btn || !fresh) return;
    this.togglePop(btn, fresh);
    if (this.pop) this.pop.scrollTop = scroll;
  }

  /** Dropdown builders of the current buttons, by button id. */
  private builders = new Map<string, (pop: HTMLElement, close: () => void) => void>();

  private dropdownButton(id: string, icon: string, label: string, build: (pop: HTMLElement, close: () => void) => void, swatch = false): HTMLElement {
    const btn = this.button({ id, icon, label, dropdown: build });
    if (swatch) {
      // The colour button shows the current colour.
      const cur = this.board.selectedNodes()[0]?.color;
      const dot = btn.createDiv('vc-ctx-swatch-dot');
      if (cur && /^[1-6]$/.test(cur)) dot.style.background = presetColor(cur);
      else if (cur) dot.style.background = cur;
      else dot.addClass('is-none');
    }
    btn.createDiv('vc-ctx-caret');
    return btn;
  }

  private updateActive(): void { /* buttons carry their state from build() */ }

  // ── dropdown panels ─────────────────────────────────────

  private popAnchor: HTMLElement | null = null;
  /** A panel just opened by hovering: the click that follows should not close it. */
  private hoverOpened = false;

  private togglePop(anchor: HTMLElement, build: (pop: HTMLElement, close: () => void) => void): void {
    if (this.pop && this.popAnchor === anchor) { this.closePop(); return; }
    this.closePop();
    const pop = this.board.uiEl.createDiv('vc-ctx-pop');
    pop.addEventListener('pointerdown', e => e.stopPropagation());
    pop.addEventListener('wheel', e => e.stopPropagation());
    this.pop = pop;
    this.popAnchor = anchor;
    anchor.addClass('is-open');
    build(pop, () => this.closePop());
    this.placePop(anchor);
    const doc = this.el.ownerDocument;
    const outside = (e: PointerEvent) => {
      const tgt = e.target as Node;
      if (pop.contains(tgt) || anchor.contains(tgt)) return;
      this.closePop();
    };
    doc.addEventListener('pointerdown', outside, true);
    this.offPop = () => doc.removeEventListener('pointerdown', outside, true);
  }

  private offPop: (() => void) | null = null;

  private placePop(anchor: HTMLElement): void {
    const pop = this.pop;
    if (!pop) return;
    const root = this.board.root.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    const br = this.el.getBoundingClientRect();
    pop.style.maxHeight = '';
    const pw = pop.offsetWidth;
    let ph = pop.offsetHeight;
    let x = ar.left - root.left + ar.width / 2 - pw / 2;
    // Below the bar if it fits, else above; if neither, the roomier side, scrolling inside.
    const below = root.height - (br.bottom - root.top) - 14;
    const above = br.top - root.top - 14;
    // When the bar sits above the selection, open upwards first so the panel doesn't hide what it changes.
    const sel = this.anchorRect();
    const selTop = sel ? this.board.vp.toScreen(sel.x, sel.y).y : Infinity;
    const barAbove = br.bottom - root.top <= selTop + 2;
    let y: number;
    if (barAbove && ph <= above) y = br.top - root.top - ph - 6;
    else if (ph <= below) y = br.bottom - root.top + 6;
    else if (ph <= above) y = br.top - root.top - ph - 6;
    else if (below >= above) { pop.style.maxHeight = `${Math.max(120, below)}px`; ph = pop.offsetHeight; y = br.bottom - root.top + 6; }
    else { pop.style.maxHeight = `${Math.max(120, above)}px`; ph = pop.offsetHeight; y = br.top - root.top - ph - 6; }
    x = Math.max(8, Math.min(root.width - pw - 8, x));
    y = Math.max(8, y);
    pop.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  private closePop(): void {
    this.offPop?.();
    this.offPop = null;
    this.popAnchor?.removeClass('is-open');
    this.popAnchor = null;
    this.pop?.remove();
    this.pop = null;
  }

  private listItem(pop: HTMLElement, icon: string | string[], label: string, run: () => void, active = false, keys?: string): HTMLElement {
    const row = pop.createDiv({ cls: 'vc-ctx-row', attr: { role: 'button' } });
    setIconSafe(row.createDiv('vc-ctx-row-icon'), icon);
    row.createDiv({ cls: 'vc-ctx-row-label', text: label });
    if (keys) row.createDiv({ cls: 'vc-ctx-row-keys', text: keys });
    row.toggleClass('is-active', active);
    row.addEventListener('click', run);
    return row;
  }

  private arrangeList(pop: HTMLElement, close: () => void, groups: ArrangeDef['group'][]): void {
    pop.addClass('is-list');
    groups.forEach((g, i) => {
      if (i) pop.createDiv('vc-ctx-pop-sep');
      for (const d of ARRANGE.filter(x => x.group === g)) {
        this.listItem(pop, iconFor(d.icon), t(d.label), () => { runArrange(this.board, d.id); close(); }, false, d.keys);
      }
    });
  }

  /** Icon grid (alignment, pushing): icons that show what they do, names on hover. */
  private arrangeGrid(pop: HTMLElement, close: () => void, groups: ArrangeDef['group'][], cols: number): void {
    pop.addClass('is-grid');
    const grid = pop.createDiv('vc-ctx-grid');
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    for (const g of groups) {
      for (const d of ARRANGE.filter(x => x.group === g)) {
        const cell = grid.createDiv({ cls: 'vc-ctx-cell', attr: { role: 'button', 'aria-label': t(d.label) } });
        setIconSafe(cell, iconFor(d.icon));
        setTooltip(cell, d.keys ? `${t(d.label)}  ${d.keys}` : t(d.label), { placement: 'bottom' });
        cell.addEventListener('click', () => { runArrange(this.board, d.id); close(); });
      }
    }
  }

  /** Width and height for the selection, with the proportions lock. */
  private sizePanel(pop: HTMLElement, close: () => void): void {
    void close;
    pop.addClass('is-size');
    const b = this.board;
    const nodes = b.selectedNodes();
    const same = (f: (n: typeof nodes[0]) => number) => nodes.every(n => Math.round(f(n)) === Math.round(f(nodes[0]))) ? String(Math.round(f(nodes[0]))) : '';
    const grid = pop.createDiv('vc-ctx-size');
    const field = (label: string, value: string) => {
      grid.createDiv({ cls: 'vc-ctx-size-label', text: label });
      const input = grid.createEl('input', { type: 'number', cls: 'vc-ctx-size-input' });
      input.value = value;
      input.placeholder = t('Mixed');
      input.min = '8';
      return input;
    };
    const w = field(t('Width'), same(n => n.width));
    const lock = grid.createDiv({ cls: 'vc-ctx-lock', attr: { role: 'button', 'aria-label': t('Keep proportions') } });
    const h = field(t('Height'), same(n => n.height));
    let locked = this.sizeLocked;
    const paintLock = () => { lock.empty(); setIcon(lock, locked ? 'link' : 'unlink'); lock.toggleClass('is-active', locked); };
    paintLock();
    setTooltip(lock, t('Keep proportions'), { placement: 'bottom' });
    lock.addEventListener('click', () => { locked = !locked; this.sizeLocked = locked; paintLock(); });
    const apply = (which: 'w' | 'h') => {
      const v = Number((which === 'w' ? w : h).value);
      if (!Number.isFinite(v) || v < 8) return;
      // Enter and the following "change" event both land here: only real changes become an undo step.
      const todo = b.selectedNodes().filter(n => Math.round(which === 'w' ? n.width : n.height) !== Math.round(v));
      if (!todo.length) return;
      b.model.transact(() => {
        for (const n of todo) {
          if (which === 'w') { const k = v / n.width; n.width = v; if (locked) n.height = Math.round(n.height * k); }
          else { const k = v / n.height; n.height = v; if (locked) n.width = Math.round(n.width * k); }
          b.model.touch(n.id);
        }
      });
      const now = b.selectedNodes();
      const both = (f: (n: typeof now[0]) => number) => now.every(n => Math.round(f(n)) === Math.round(f(now[0]))) ? String(Math.round(f(now[0]))) : '';
      w.value = both(n => n.width);
      h.value = both(n => n.height);
    };
    for (const [input, which] of [[w, 'w'], [h, 'h']] as const) {
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { apply(which); input.select(); } });
      input.addEventListener('change', () => apply(which));
      input.addEventListener('pointerdown', e => e.stopPropagation());
    }
  }

  private sizeLocked = true;

  /** Boardmix's alignment panel: six alignments, then even spacing for three or more. */
  private alignPanel(pop: HTMLElement, count: number): void {
    pop.addClass('is-grid');
    pop.createDiv({ cls: 'vc-ctx-pop-title', text: t('Align') });
    this.iconGrid(pop, ['align-left', 'align-hcenter', 'align-right', 'align-top', 'align-vcenter', 'align-bottom'], 3);
    if (count >= 3) {
      pop.createDiv({ cls: 'vc-ctx-pop-title', text: t('Distribute') });
      this.iconGrid(pop, ['space-h', 'space-v'], 3);
    }
    pop.createDiv({ cls: 'vc-ctx-pop-title', text: t('Push together') });
    this.iconGrid(pop, ['push-left', 'push-right', 'push-up', 'push-down'], 4);
  }

  private iconGrid(pop: HTMLElement, ids: string[], cols: number): void {
    const grid = pop.createDiv('vc-ctx-grid');
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    for (const id of ids) {
      const d = ARRANGE.find(x => x.id === id);
      if (!d) continue;
      const cell = grid.createDiv({ cls: 'vc-ctx-cell', attr: { role: 'button', 'aria-label': t(d.label) } });
      setIconSafe(cell, iconFor(d.icon));
      setTooltip(cell, d.keys ? `${t(d.label)}  ${d.keys}` : t(d.label), { placement: 'bottom' });
      cell.addEventListener('click', () => runArrange(this.board, d.id));
    }
  }

  /** Boardmix's arrangement list, plus the PureRef orderings. */
  private arrangePanel(pop: HTMLElement, close: () => void): void {
    pop.addClass('is-list');
    const row = (id: string, label: string, icon?: string) => {
      const d = ARRANGE.find(x => x.id === id)!;
      this.listItem(pop, iconFor(icon ?? d.icon), label, () => { runArrange(this.board, d.id); close(); }, false, d.keys);
    };
    row('row', t('In a row'), 'more-horizontal');
    row('column', t('In a column'), 'ellipsis-vertical');
    row('optimal', t('Automatic (fit the view)'), 'layout-grid');
    row('stack', t('Stacked'), 'layers');
    pop.createDiv('vc-ctx-pop-sep');
    row('by-name', t('Arrange by name'));
    row('by-added', t('Arrange by order added'));
    row('by-path', t('Arrange by folder'));
  }

  private colorPanel(pop: HTMLElement, close: () => void): void {
    pop.addClass('is-colors');
    const b = this.board;
    const cur = b.selectedNodes()[0]?.color;
    const grid = pop.createDiv('vc-ctx-colors');
    for (const c of COLORS) {
      const sw = grid.createDiv({ cls: 'vc-ctx-color', attr: { role: 'button', 'aria-label': t(c.label) } });
      if (c.id) sw.style.background = presetColor(c.id); else sw.addClass('is-none');
      sw.toggleClass('is-active', (cur ?? undefined) === c.id);
      setTooltip(sw, t(c.label), { placement: 'bottom' });
      sw.addEventListener('click', () => { b.setColor(c.id); close(); });
    }
    const custom = grid.createDiv({ cls: 'vc-ctx-color is-custom', attr: { 'aria-label': t('Custom colour') } });
    setTooltip(custom, t('Custom colour'), { placement: 'bottom' });
    const input = custom.createEl('input', { type: 'color' });
    if (cur && cur.startsWith('#')) { input.value = cur.slice(0, 7); custom.addClass('is-active'); custom.style.background = cur; }
    input.addEventListener('change', () => { b.setColor(input.value); close(); });
  }
}
