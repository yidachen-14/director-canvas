import { Menu, Notice, TFile, moment as obsidianMoment, normalizePath, setIcon } from 'obsidian';
import type { Moment } from 'moment';

// Obsidian bundles moment; its export is the moment function.
const moment = obsidianMoment as unknown as typeof import('moment');
import type { RawNode } from '../model/canvas-file';
import type { CardContext, CardHandle, CardType } from './types';
import { applyCardColor, vcGet } from './util';
import { commitNode } from './basic';
import { t } from '../i18n';

/** Clicks inside a card only count once the card is selected (the first click selects it). */
function live(ctx: CardContext, id: string): boolean {
  return ctx.board.selection.has(id) && ctx.board.selection.size === 1;
}

/** A button inside a card: clickable once the card is selected, never a double-click on the card. */
function stop(el: HTMLElement): void {
  el.addClass('vc-click');
  el.addEventListener('dblclick', e => e.stopPropagation());
}

// ── Swatch ──────────────────────────────────────────────────

export interface SwatchColor { hex: string; name?: string; }

const DEFAULT_SWATCH: SwatchColor[] = [
  { hex: '#264653' }, { hex: '#2A9D8F' }, { hex: '#E9C46A' }, { hex: '#F4A261' }, { hex: '#E76F51' },
];

/** What the core Canvas shows: one line per colour. */
export function swatchText(colors: SwatchColor[]): string {
  return colors.map(c => `- \`${c.hex.toUpperCase()}\`${c.name ? ` ${c.name}` : ''}`).join('\n');
}

/** Readable text colour on a background. */
export function inkFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#000';
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1d1d1d' : '#ffffff';
}

class SwatchCard implements CardHandle {
  private node: RawNode;
  constructor(node: RawNode, private el: HTMLElement, private ctx: CardContext) {
    this.node = node;
    el.addClass('vc-swatch');
    this.render();
  }

  private colors(): SwatchColor[] { return (vcGet(this.node, 'colors', null) as SwatchColor[] | null) ?? []; }

  private save(colors: SwatchColor[]): void {
    commitNode(this.ctx, this.node.id, (n) => {
      n.vc = { ...(n.vc ?? {}), colors };
      n.text = swatchText(colors);
    });
  }

  private pick(initial: string, done: (hex: string) => void): void {
    const input = this.el.createEl('input', { type: 'color', cls: 'vc-hidden-input' });
    input.value = initial;
    input.addEventListener('change', () => { done(input.value); input.remove(); });
    input.addEventListener('blur', () => window.setTimeout(() => input.remove(), 500));
    input.click();
  }

  private render(): void {
    this.el.empty();
    applyCardColor(this.el.closest<HTMLElement>('.vc-node') ?? this.el, this.node.color);
    const grid = this.el.createDiv('vc-swatch-grid');
    const colors = this.colors();
    colors.forEach((c, i) => {
      const chip = grid.createDiv('vc-swatch-chip');
      const block = chip.createDiv('vc-swatch-block vc-click');
      block.style.background = c.hex;
      block.style.color = inkFor(c.hex);
      block.setAttr('aria-label', t('Click to copy · double-click to change'));
      const tools = block.createDiv('vc-swatch-tools');
      const del = tools.createDiv({ cls: 'vc-swatch-tool', attr: { 'aria-label': t('Remove colour') } });
      setIcon(del, 'x');
      del.addEventListener('click', (e) => {
        if (!live(this.ctx, this.node.id)) return;
        e.stopPropagation();
        this.save(colors.filter((_, j) => j !== i));
      });
      block.addEventListener('click', (e) => {
        if (!live(this.ctx, this.node.id) || (e.target as HTMLElement).closest('.vc-swatch-tool')) return;
        void navigator.clipboard.writeText(c.hex.toUpperCase());
        new Notice(t('Copied {hex}', { hex: c.hex.toUpperCase() }));
      });
      block.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.pick(c.hex, hex => this.save(colors.map((x, j) => (j === i ? { ...x, hex } : x))));
      });
      const name = chip.createDiv({ cls: 'vc-swatch-name vc-click', text: c.name || '' });
      name.toggleClass('is-empty', !c.name);
      name.setAttr('data-placeholder', t('Name'));
      chip.createDiv({ cls: 'vc-swatch-hex', text: c.hex.toUpperCase() });
      name.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const input = createEl('input', { type: 'text', cls: 'vc-swatch-name-input' });
        input.value = c.name ?? '';
        name.replaceWith(input);
        input.focus();
        let done = false;
        const finish = (ok: boolean) => {
          if (done) return; done = true;
          const v = input.value.trim();
          if (ok && v !== (c.name ?? '')) this.save(colors.map((x, j) => (j === i ? { ...x, name: v || undefined } : x)));
          else this.render();
        };
        input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); });
        input.addEventListener('blur', () => finish(true));
        input.addEventListener('pointerdown', ev => ev.stopPropagation());
      });
    });
    const add = grid.createDiv({ cls: 'vc-swatch-add', attr: { 'aria-label': t('Add colour') } });
    setIcon(add, 'plus');
    add.addEventListener('click', (e) => {
      if (!live(this.ctx, this.node.id)) return;
      e.stopPropagation();
      this.pick('#888888', hex => this.save([...colors, { hex }]));
    });
    stop(add);
  }

  update(n: RawNode): void { this.node = n; this.render(); }
  destroy(): void { /* nothing */ }
  searchText(): string { return this.colors().map(c => `${c.hex} ${c.name ?? ''}`).join(' '); }

  menu(menu: Menu): void {
    menu.addItem(i => i.setTitle(t('Add colour')).setIcon('plus').setSection('edit').onClick(() => this.pick('#888888', hex => this.save([...this.colors(), { hex }]))));
    menu.addItem(i => i.setTitle(t('Copy all colours')).setIcon('copy').setSection('edit').onClick(() => {
      void navigator.clipboard.writeText(this.colors().map(c => c.hex.toUpperCase()).join('\n'));
      new Notice(t('Copied.'));
    }));
  }
}

export const swatchCard: CardType = {
  id: 'swatch',
  label: 'Colour swatch',
  icon: 'palette',
  defaultSize: { width: 440, height: 200 },
  create: () => ({ type: 'text', text: swatchText(DEFAULT_SWATCH), vc: { kind: 'swatch', colors: DEFAULT_SWATCH } }),
  mount: (node, el, ctx) => new SwatchCard(node, el, ctx),
};

// ── Calendar ────────────────────────────────────────────────

interface DailyOptions { format?: string; folder?: string; template?: string; }

function dailyOptions(ctx: CardContext): DailyOptions {
  const p = (ctx.app as unknown as { internalPlugins?: { getPluginById?: (id: string) => { enabled?: boolean; instance?: { options?: DailyOptions } } | null } })
    .internalPlugins?.getPluginById?.('daily-notes');
  return p?.instance?.options ?? {};
}

function dailyPath(ctx: CardContext, day: Moment): string {
  const o = dailyOptions(ctx);
  const name = day.format(o.format || 'YYYY-MM-DD');
  return normalizePath(`${o.folder ? o.folder + '/' : ''}${name}.md`);
}

async function openDaily(ctx: CardContext, day: Moment, newTab: boolean): Promise<void> {
  const path = dailyPath(ctx, day);
  let file = ctx.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    const o = dailyOptions(ctx);
    let body = '';
    if (o.template) {
      const tpl = ctx.app.metadataCache.getFirstLinkpathDest(o.template, '');
      if (tpl) {
        body = (await ctx.app.vault.read(tpl))
          .replace(/{{\s*date\s*}}/gi, day.format(o.format || 'YYYY-MM-DD'))
          .replace(/{{\s*title\s*}}/gi, day.format(o.format || 'YYYY-MM-DD'))
          .replace(/{{\s*time\s*}}/gi, moment().format('HH:mm'));
      }
    }
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (folder && !ctx.app.vault.getAbstractFileByPath(folder)) await ctx.app.vault.createFolder(folder);
    file = await ctx.app.vault.create(path, body);
  }
  if (file instanceof TFile) await ctx.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(file);
}

function calendarText(month: string): string {
  return `### 📅 ${moment(month, 'YYYY-MM').format('YYYY-MM')}`;
}

class CalendarCard implements CardHandle {
  private node: RawNode;
  constructor(node: RawNode, private el: HTMLElement, private ctx: CardContext) {
    this.node = node;
    el.addClass('vc-calendar');
    this.render();
    // New daily notes appear as dots.
    const refresh = () => this.render();
    ctx.component.registerEvent(ctx.app.vault.on('create', refresh));
    ctx.component.registerEvent(ctx.app.vault.on('delete', refresh));
  }

  private month(): Moment {
    const m = moment(vcGet(this.node, 'month', moment().format('YYYY-MM')) as string, 'YYYY-MM');
    return m.isValid() ? m : moment().startOf('month');
  }

  /** Changing the shown month is saved but is not an undo step. */
  private go(month: Moment): void {
    const m = this.ctx.board.model;
    m.quiet(() => {
      const n = m.node(this.node.id);
      if (!n) return;
      const key = month.format('YYYY-MM');
      n.vc = { ...(n.vc ?? {}), month: key };
      n.text = calendarText(key);
      m.touch(n.id);
    });
  }

  private render(): void {
    this.el.empty();
    applyCardColor(this.el.closest<HTMLElement>('.vc-node') ?? this.el, this.node.color);
    const month = this.month();
    const box = this.el.createDiv('vc-cal-box');
    const head = box.createDiv('vc-cal-head');
    const prev = head.createDiv({ cls: 'vc-cal-nav clickable-icon', attr: { 'aria-label': t('Previous month') } });
    setIcon(prev, 'chevron-left');
    head.createDiv({ cls: 'vc-cal-title', text: month.format(t('MMMM YYYY')) });
    const today = head.createDiv({ cls: 'vc-cal-today', text: t('Today') });
    const next = head.createDiv({ cls: 'vc-cal-nav clickable-icon', attr: { 'aria-label': t('Next month') } });
    setIcon(next, 'chevron-right');
    const nav = (el: HTMLElement, fn: () => void) => {
      el.addEventListener('click', (e) => { if (!live(this.ctx, this.node.id)) return; e.stopPropagation(); fn(); });
      stop(el);
    };
    nav(prev, () => this.go(month.clone().subtract(1, 'month')));
    nav(next, () => this.go(month.clone().add(1, 'month')));
    nav(today, () => this.go(moment().startOf('month')));

    const first = moment.localeData().firstDayOfWeek();
    const grid = box.createDiv('vc-cal-grid');
    for (let i = 0; i < 7; i++) grid.createDiv({ cls: 'vc-cal-wd', text: moment().day((first + i) % 7).format('dd') });
    const start = month.clone().startOf('month');
    const offset = (start.day() - first + 7) % 7;
    const cursor = start.clone().subtract(offset, 'days');
    const now = moment();
    for (let i = 0; i < 42; i++) {
      const day = cursor.clone();
      const cell = grid.createDiv('vc-cal-day');
      cell.createSpan({ text: String(day.date()) });
      if (day.month() !== month.month()) cell.addClass('is-other');
      if (day.isSame(now, 'day')) cell.addClass('is-today');
      if (day.day() === 0 || day.day() === 6) cell.addClass('is-weekend');
      if (this.ctx.app.vault.getAbstractFileByPath(dailyPath(this.ctx, day))) cell.createDiv('vc-cal-dot');
      cell.setAttr('aria-label', day.format('YYYY-MM-DD'));
      cell.addEventListener('click', (e) => {
        if (!live(this.ctx, this.node.id)) return;
        e.stopPropagation();
        void openDaily(this.ctx, day, e.metaKey || e.ctrlKey);
      });
      stop(cell);
      cursor.add(1, 'day');
    }
  }

  update(n: RawNode): void { this.node = n; this.render(); }
  destroy(): void { /* nothing */ }
  searchText(): string { return this.month().format('YYYY-MM'); }
}

export const calendarCard: CardType = {
  id: 'calendar',
  label: 'Calendar',
  icon: 'calendar-days',
  defaultSize: { width: 320, height: 320 },
  create: () => {
    const month = moment().format('YYYY-MM');
    return { type: 'text', text: calendarText(month), vc: { kind: 'calendar', month } };
  },
  mount: (node, el, ctx) => new CalendarCard(node, el, ctx),
};

// ── Kanban ──────────────────────────────────────────────────

export interface KanbanItem { text: string; done: boolean | null; }
export interface KanbanColumn { title: string; items: KanbanItem[]; }

/** "## Column" headings with "- [ ] item" lists under them. */
export function parseKanban(md: string): KanbanColumn[] {
  const cols: KanbanColumn[] = [];
  let cur: KanbanColumn | null = null;
  let last: KanbanItem | null = null;
  for (const line of (md ?? '').split('\n')) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) { cur = { title: h[1].trim(), items: [] }; cols.push(cur); last = null; continue; }
    const it = /^\s*[-*+]\s+(?:\[([ xX])\]\s*)?(.*)$/.exec(line);
    if (it) {
      if (!cur) { cur = { title: '', items: [] }; cols.push(cur); }
      last = { text: it[2], done: it[1] === undefined ? null : it[1] !== ' ' };
      cur.items.push(last);
      continue;
    }
    // Indented lines continue the item above (multi-line cards).
    if (last && /^\s{2,}\S/.test(line)) last.text += '\n' + line.trim();
  }
  return cols;
}

export function serializeKanban(cols: KanbanColumn[]): string {
  return cols.map((c) => {
    const items = c.items.map((i) => {
      const [first, ...rest] = i.text.split('\n');
      const box = i.done === null ? '' : i.done ? '[x] ' : '[ ] ';
      return [`- ${box}${first}`, ...rest.map(r => `  ${r}`)].join('\n');
    });
    return [`## ${c.title}`, ...items].join('\n');
  }).join('\n\n');
}

class KanbanCard implements CardHandle {
  private node: RawNode;
  private editing: HTMLTextAreaElement | HTMLInputElement | null = null;

  constructor(node: RawNode, private el: HTMLElement, private ctx: CardContext) {
    this.node = node;
    el.addClass('vc-kanban');
    this.render();
  }

  private cols(): KanbanColumn[] { return parseKanban(this.node.text ?? ''); }

  private save(cols: KanbanColumn[]): void {
    commitNode(this.ctx, this.node.id, (n) => { n.text = serializeKanban(cols); });
  }

  private render(): void {
    this.editing = null;
    this.el.empty();
    applyCardColor(this.el.closest<HTMLElement>('.vc-node') ?? this.el, this.node.color);
    const cols = this.cols();
    const board = this.el.createDiv('vc-kb-board');
    cols.forEach((col, ci) => {
      const c = board.createDiv({ cls: 'vc-kb-col', attr: { 'data-col': String(ci) } });
      const head = c.createDiv('vc-kb-head');
      const title = head.createDiv({ cls: 'vc-kb-title vc-click', text: col.title || t('Untitled') });
      head.createDiv({ cls: 'vc-kb-count', text: String(col.items.length) });
      const more = head.createDiv({ cls: 'vc-kb-more clickable-icon', attr: { 'aria-label': t('Column options') } });
      setIcon(more, 'more-horizontal');
      more.addEventListener('click', (e) => {
        if (!live(this.ctx, this.node.id)) return;
        e.stopPropagation();
        this.columnMenu(e, ci);
      });
      stop(more);
      title.addEventListener('dblclick', (e) => { e.stopPropagation(); this.editColumnTitle(title, ci); });

      const list = c.createDiv({ cls: 'vc-kb-list', attr: { 'data-col': String(ci) } });
      col.items.forEach((item, ii) => {
        const card = list.createDiv({ cls: 'vc-kb-item vc-click', attr: { 'data-col': String(ci), 'data-item': String(ii) } });
        if (item.done !== null) {
          const cb = card.createEl('input', { type: 'checkbox', cls: 'task-list-item-checkbox' });
          cb.checked = item.done;
          card.toggleClass('is-done', item.done);
          cb.addEventListener('click', (e) => {
            e.stopPropagation();
            const next = this.cols();
            next[ci].items[ii].done = cb.checked;
            this.save(next);
          });
          cb.addEventListener('pointerdown', e => e.stopPropagation());
        }
        card.createDiv({ cls: 'vc-kb-text', text: item.text || ' ' });
        const del = card.createDiv({ cls: 'vc-kb-del vc-click', attr: { 'aria-label': t('Delete card') } });
        setIcon(del, 'x');
        del.addEventListener('click', (e) => {
          if (!live(this.ctx, this.node.id)) return;
          e.stopPropagation();
          const next = this.cols();
          next[ci].items.splice(ii, 1);
          this.save(next);
        });
        card.addEventListener('dblclick', (e) => { e.stopPropagation(); this.editItem(card, ci, ii); });
        card.addEventListener('pointerdown', (e) => this.startItemDrag(e, card, ci, ii));
      });
      const add = c.createDiv({ cls: 'vc-kb-add', text: t('+ Add a card') });
      add.addEventListener('click', (e) => {
        if (!live(this.ctx, this.node.id)) return;
        e.stopPropagation();
        const next = this.cols();
        next[ci].items.push({ text: '', done: false });
        this.save(next);
        // Type into it straight away.
        window.setTimeout(() => {
          const el = this.el.querySelector<HTMLElement>(`.vc-kb-item[data-col="${ci}"][data-item="${next[ci].items.length - 1}"]`);
          if (el) this.editItem(el, ci, next[ci].items.length - 1);
        }, 0);
      });
      stop(add);
    });
    const addCol = board.createDiv({ cls: 'vc-kb-addcol', text: t('+ Add a column') });
    addCol.addEventListener('click', (e) => {
      if (!live(this.ctx, this.node.id)) return;
      e.stopPropagation();
      this.save([...cols, { title: t('New column'), items: [] }]);
    });
    stop(addCol);
  }

  private editItem(card: HTMLElement, ci: number, ii: number): void {
    if (this.editing) return;
    const textEl = card.querySelector<HTMLElement>('.vc-kb-text');
    if (!textEl) return;
    const ta = createEl('textarea', { cls: 'vc-kb-input' });
    ta.value = this.cols()[ci]?.items[ii]?.text ?? '';
    textEl.replaceWith(ta);
    this.editing = ta;
    const grow = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; };
    grow();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return; done = true;
      this.editing = null;
      const v = ta.value.replace(/\s+$/, '');
      const next = this.cols();
      const item = next[ci]?.items[ii];
      if (!item) { this.render(); return; }
      if (ok && v !== item.text) {
        if (!v) next[ci].items.splice(ii, 1); else item.text = v;
        this.save(next);
      } else if (!item.text && !v) {
        next[ci].items.splice(ii, 1);
        this.save(next);
      } else this.render();
    };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    ta.addEventListener('blur', () => finish(true));
    ta.addEventListener('pointerdown', e => e.stopPropagation());
  }

  private editColumnTitle(titleEl: HTMLElement, ci: number): void {
    if (this.editing) return;
    const input = createEl('input', { type: 'text', cls: 'vc-kb-title-input' });
    input.value = this.cols()[ci]?.title ?? '';
    titleEl.replaceWith(input);
    this.editing = input;
    input.focus();
    input.select();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return; done = true;
      this.editing = null;
      const next = this.cols();
      const v = input.value.trim();
      if (ok && next[ci] && v && v !== next[ci].title) { next[ci].title = v; this.save(next); } else this.render();
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.isComposing) finish(true); if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', e => e.stopPropagation());
  }

  private columnMenu(e: MouseEvent, ci: number): void {
    const menu = new Menu();
    const cols = this.cols();
    menu.addItem(i => i.setTitle(t('Rename column')).setIcon('pencil').onClick(() => {
      const title = this.el.querySelector<HTMLElement>(`.vc-kb-col[data-col="${ci}"] .vc-kb-title`);
      if (title) this.editColumnTitle(title, ci);
    }));
    if (ci > 0) menu.addItem(i => i.setTitle(t('Move left')).setIcon('arrow-left').onClick(() => { const n = this.cols(); [n[ci - 1], n[ci]] = [n[ci], n[ci - 1]]; this.save(n); }));
    if (ci < cols.length - 1) menu.addItem(i => i.setTitle(t('Move right')).setIcon('arrow-right').onClick(() => { const n = this.cols(); [n[ci + 1], n[ci]] = [n[ci], n[ci + 1]]; this.save(n); }));
    menu.addItem(i => i.setTitle(t('Clear done cards')).setIcon('check-check').onClick(() => { const n = this.cols(); n[ci].items = n[ci].items.filter(x => !x.done); this.save(n); }));
    menu.addItem(i => i.setTitle(t('Delete column')).setIcon('trash-2').setWarning(true).onClick(() => { const n = this.cols(); n.splice(ci, 1); this.save(n); }));
    menu.showAtMouseEvent(e);
  }

  /** Drag a card to another place in its column or to another column. */
  private startItemDrag(e: PointerEvent, card: HTMLElement, ci: number, ii: number): void {
    if (e.button !== 0 || this.editing || !live(this.ctx, this.node.id)) return;
    if ((e.target as HTMLElement).closest('input, .vc-kb-del')) return;
    e.stopPropagation();
    const doc = card.ownerDocument;
    const sx = e.clientX, sy = e.clientY;
    let ghost: HTMLElement | null = null;
    const line = doc.body.createDiv('vc-drop-line');
    line.hide();
    let target: { col: number; index: number } | null = null;
    const move = (ev: PointerEvent) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        ghost = doc.body.createDiv('vc-block-ghost');
        ghost.setText(card.textContent?.slice(0, 60) || '…');
        card.addClass('is-dragging');
      }
      ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 8}px)`;
      target = null;
      const lists = Array.from(this.el.querySelectorAll<HTMLElement>('.vc-kb-list'));
      for (const list of lists) {
        const colEl = list.closest<HTMLElement>('.vc-kb-col')!;
        const r = colEl.getBoundingClientRect();
        if (ev.clientX < r.left || ev.clientX > r.right) continue;
        const items = Array.from(list.querySelectorAll<HTMLElement>('.vc-kb-item'));
        let index = items.length;
        let lineY = items.length ? items[items.length - 1].getBoundingClientRect().bottom + 3 : list.getBoundingClientRect().top + 4;
        for (let k = 0; k < items.length; k++) {
          const ir = items[k].getBoundingClientRect();
          if (ev.clientY < ir.top + ir.height / 2) { index = k; lineY = ir.top - 3; break; }
        }
        target = { col: Number(list.dataset.col), index };
        const lr = list.getBoundingClientRect();
        line.style.left = `${lr.left + 4}px`;
        line.style.top = `${lineY}px`;
        line.style.width = `${lr.width - 8}px`;
        line.show();
        break;
      }
      if (!target) line.hide();
    };
    const up = () => {
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      line.remove();
      if (!ghost) return;
      (ghost as HTMLElement).remove();
      card.removeClass('is-dragging');
      const tgt = target as { col: number; index: number } | null;
      if (!tgt) return;
      const next = this.cols();
      const [item] = next[ci].items.splice(ii, 1);
      let index = tgt.index;
      if (tgt.col === ci && index > ii) index--;
      next[tgt.col].items.splice(index, 0, item);
      this.save(next);
    };
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
  }

  update(n: RawNode): void { this.node = n; if (!this.editing) this.render(); }
  destroy(): void { /* nothing */ }
  isEditing(): boolean { return !!this.editing; }
  stopEditing(): void { this.editing?.blur(); }
  searchText(): string { return this.node.text ?? ''; }

  menu(menu: Menu): void {
    menu.addItem(i => i.setTitle(t('Add a column')).setIcon('columns-3').setSection('edit').onClick(() => this.save([...this.cols(), { title: t('New column'), items: [] }])));
  }
}

export const kanbanCard: CardType = {
  id: 'kanban',
  label: 'Kanban',
  icon: 'square-kanban',
  defaultSize: { width: 880, height: 380 },
  create: () => ({
    type: 'text',
    text: serializeKanban([{ title: t('To do'), items: [] }, { title: t('Doing'), items: [] }, { title: t('Done'), items: [] }]),
    vc: { kind: 'kanban' },
  }),
  mount: (node, el, ctx) => new KanbanCard(node, el, ctx),
};

export const WIDGET_CARDS: CardType[] = [swatchCard, calendarCard, kanbanCard];
