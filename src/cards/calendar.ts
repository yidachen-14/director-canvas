import { FuzzySuggestModal, Menu, TFile, setIcon, setTooltip, type App } from 'obsidian';
import type { RawNode } from '../model/canvas-file';
import type { BarItem, CardContext, CardHandle, CardType } from './types';
import { commitNode } from './basic';
import { IMAGE_EXT, presetColor, vcGet } from './util';
import { newId } from '../model/canvas-file';
import { getLanguage, t } from '../i18n';

// ── data ──────────────────────────────────────────────────────

export type Importance = 'low' | 'medium' | 'high';
export interface CalNote { id: string; date: string; text: string; color?: string; importance?: Importance; done?: boolean; }
export interface DayStyle { color?: string; importance?: Importance; image?: string; }

/** Something shown on a day: a calendar note, or a dated to-do in another card. */
export interface DatedItem {
  key: string;
  date: string;
  label: string;
  color?: string;
  importance?: Importance;
  done?: boolean;
  note?: CalNote;
  task?: { nodeId: string; line: number };
}

const pad2 = (n: number) => String(n).padStart(2, '0');
export const isISO = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const toUTC = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUTC = (ms: number) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; };
export const addDays = (iso: string, n: number) => fromUTC(toUTC(iso) + n * 86400000);
export const todayISO = () => { const n = new Date(); return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`; };
/** 0 = Monday … 6 = Sunday: weeks start on Monday. */
export const weekday = (iso: string) => (new Date(toUTC(iso)).getUTCDay() + 6) % 7;
export const weekStart = (iso: string) => addDays(iso, -weekday(iso));

/** A to-do line with a due date in the Tasks-plugin form: "- [ ] text 📅 2026-10-21". */
const TASK_RE = /^(\s*[-*+]\s+\[(.)\]\s+)(.*?)\s*📅\s*(\d{4}-\d{2}-\d{2})(.*)$/u;

export function datedTasks(n: RawNode): DatedItem[] {
  const out: DatedItem[] = [];
  const lines = (n.text ?? '').split('\n');
  lines.forEach((line, i) => {
    const m = TASK_RE.exec(line);
    if (!m || !isISO(m[4])) return;
    const label = (m[3] + m[5]).replace(/[*_`~=]|\[\[|\]\]/g, '').trim() || t('Untitled');
    out.push({ key: `${n.id}:${i}`, date: m[4], label, done: m[2] !== ' ', color: n.color, task: { nodeId: n.id, line: i } });
  });
  return out;
}

export function moveTaskDate(text: string, line: number, date: string): string {
  const lines = text.split('\n');
  if (lines[line]) lines[line] = lines[line].replace(/📅\s*\d{4}-\d{2}-\d{2}/u, `📅 ${date}`);
  return lines.join('\n');
}

export function toggleTaskDone(text: string, line: number): string {
  const lines = text.split('\n');
  const l = lines[line];
  if (l) lines[line] = l.replace(/\[(.)\]/, (_m, c: string) => (c === ' ' ? '[x]' : '[ ]'));
  return lines.join('\n');
}

/** What the core Canvas shows: the notes, by date. */
export function calendarText(title: string, notes: CalNote[]): string {
  const rows = [...notes].sort((a, b) => a.date.localeCompare(b.date)).map(n => `- ${n.date} ${n.done ? '~~' + n.text + '~~' : n.text}`);
  return [`### 📅 ${title}`, ...rows].join('\n');
}

const IMPORTANCE: { v: Importance | undefined; label: string }[] = [
  { v: undefined, label: 'No importance' }, { v: 'low', label: 'Low importance' },
  { v: 'medium', label: 'Medium importance' }, { v: 'high', label: 'High importance' },
];
const COLORS: (string | undefined)[] = [undefined, '1', '2', '3', '4', '5', '6'];
const colorCss = (c: string | undefined) => (!c ? '' : /^[1-6]$/.test(c) ? presetColor(c) : c);

class ImageModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private pick: (f: TFile) => void) { super(app); this.setPlaceholder(t('Choose an image')); }
  getItems(): TFile[] { return this.app.vault.getFiles().filter(f => IMAGE_EXT.includes(f.extension.toLowerCase())); }
  getItemText(f: TFile): string { return f.path; }
  onChooseItem(f: TFile): void { this.pick(f); }
}

// ── card ──────────────────────────────────────────────────────

class CalendarCard implements CardHandle {
  private node: RawNode;
  /** The one day shown expanded ("+N more"), if any. */
  private openDay: string | null = null;
  private editingInput: HTMLInputElement | null = null;

  constructor(node: RawNode, private el: HTMLElement, private ctx: CardContext) {
    this.node = node;
    el.addClass('vc-cal');
    this.render();
    // Dated to-dos in other cards show here too: follow their changes.
    ctx.component.register(ctx.board.onChange((e) => {
      if (e.preview || this.editingInput) return;
      if (e.kind === 'nodes' && e.ids.length === 1 && e.ids[0] === this.node.id) return;
      this.render();
    }));
  }

  // ── state ─────────────────────────────────────────────

  private notes(): CalNote[] { return (vcGet(this.node, 'notes', []) as CalNote[]).filter(n => n && isISO(n.date)); }
  private days(): Record<string, DayStyle> { return (vcGet(this.node, 'days', {}) as Record<string, DayStyle>) ?? {}; }
  private title(): string { return (vcGet(this.node, 'title', '') as string) || t('Calendar'); }
  private anchor(): string { const a = vcGet(this.node, 'anchor', '') as string; return isISO(a) ? a : todayISO(); }
  private mode(): 'month' | 'week' { return vcGet<string>(this.node, 'mode', 'month') === 'week' ? 'week' : 'month'; }
  private locked(): boolean { return !!vcGet(this.node, 'locked', false); }

  private live(): boolean {
    const b = this.ctx.board;
    return b.selection.has(this.node.id) && b.selection.size === 1;
  }

  /** Change the calendar's own data as an undo step (and keep the core Canvas text in step). */
  private change(fn: (vc: Record<string, unknown>) => void): void {
    commitNode(this.ctx, this.node.id, (n) => {
      const vc = { ...(n.vc ?? {}) };
      fn(vc);
      n.vc = vc;
      n.text = calendarText((vc.title as string) || t('Calendar'), (vc.notes as CalNote[]) ?? []);
    });
  }

  /** Moving through months is saved but not an undo step. */
  private view(fn: (vc: Record<string, unknown>) => void): void {
    const m = this.ctx.board.model;
    m.quiet(() => {
      const n = m.node(this.node.id);
      if (!n) return;
      const vc = { ...(n.vc ?? {}) };
      fn(vc);
      n.vc = vc;
      m.touch(n.id);
    });
  }

  private items(): DatedItem[] {
    const out: DatedItem[] = this.notes().map(n => ({
      key: n.id, date: n.date, label: n.text || t('Untitled'), color: n.color, importance: n.importance, done: n.done, note: n,
    }));
    for (const n of this.ctx.board.model.nodes) if (n.id !== this.node.id && n.type === 'text' && n.text?.includes('📅')) out.push(...datedTasks(n));
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
  }

  // ── rendering ─────────────────────────────────────────

  private render(): void {
    const el = this.el;
    el.empty();
    const card = el.closest<HTMLElement>('.vc-node');
    if (card) { const c = colorCss(this.node.color); if (c) card.style.setProperty('--vc-card-color', c); else card.style.removeProperty('--vc-card-color'); card.toggleClass('has-color', !!c); }
    const anchor = this.anchor(), mode = this.mode(), locked = this.locked();

    const head = el.createDiv('vc-cal-head');
    const title = head.createDiv({ cls: 'vc-cal-title vc-click', text: this.title() });
    title.addEventListener('dblclick', (e) => { e.stopPropagation(); this.editTitle(title); });

    const month = head.createDiv({ cls: 'vc-cal-month vc-click', text: mode === 'month' ? this.monthLabel(anchor) : this.weekLabel(anchor) });
    month.toggleClass('is-locked', locked);
    if (!locked) {
      setTooltip(month, t('Jump to a month'), { placement: 'top' });
      month.addEventListener('click', (e) => { if (!this.live()) return; e.stopPropagation(); this.jumpMonth(month); });
    }
    head.createDiv('vc-cal-spacer');
    const nav = head.createDiv('vc-cal-nav');
    const btn = (icon: string | null, text: string | null, label: string, run: () => void, disabled = false) => {
      const b = nav.createDiv({ cls: 'vc-cal-btn vc-click', attr: { role: 'button', 'aria-label': label } });
      if (icon) setIcon(b, icon); if (text) b.setText(text);
      setTooltip(b, label, { placement: 'top' });
      b.toggleClass('is-disabled', disabled);
      b.addEventListener('click', (e) => { if (!this.live() || disabled) return; e.stopPropagation(); run(); });
      b.addEventListener('dblclick', ev => ev.stopPropagation());
      return b;
    };
    const first = (iso: string) => `${iso.slice(0, 7)}-01`;
    btn('chevron-left', null, t('Previous'), () => this.view(vc => { vc.anchor = mode === 'month' ? first(addDays(first(anchor), -1)) : addDays(anchor, -7); }), locked);
    btn(null, t('Today'), t('Today'), () => this.view(vc => { delete vc.anchor; }), locked);
    btn('chevron-right', null, t('Next'), () => this.view(vc => { vc.anchor = mode === 'month' ? first(addDays(first(anchor), 32)) : addDays(anchor, 7); }), locked);
    btn(locked ? 'lock' : 'lock-open', null, locked ? t('Unlock the month') : t('Lock the month (no accidental paging)'), () => this.view(vc => { vc.locked = !locked; })).toggleClass('is-active', locked);
    const seg = head.createDiv('vc-cal-seg');
    for (const m of ['month', 'week'] as const) {
      const s = seg.createDiv({ cls: 'vc-cal-segbtn vc-click', text: m === 'month' ? t('Month') : t('Week') });
      s.toggleClass('is-active', mode === m);
      s.addEventListener('click', (e) => { if (!this.live()) return; e.stopPropagation(); if (m !== mode) this.view(vc => { vc.mode = m; }); });
      s.addEventListener('dblclick', ev => ev.stopPropagation());
    }

    const wd = el.createDiv('vc-cal-weekdays');
    for (const name of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) wd.createDiv({ cls: 'vc-cal-wd', text: t(name) });
    const grid = el.createDiv('vc-cal-grid');
    grid.toggleClass('is-week', mode === 'week');
    const start = mode === 'week' ? weekStart(anchor) : weekStart(first(anchor));
    const count = mode === 'week' ? 7 : 42;
    const today = todayISO();
    const byDay = new Map<string, DatedItem[]>();
    for (const it of this.items()) { const l = byDay.get(it.date) ?? []; l.push(it); byDay.set(it.date, l); }
    const styles = this.days();

    for (let i = 0; i < count; i++) {
      const date = addDays(start, i);
      const cell = grid.createDiv({ cls: 'vc-cal-cell', attr: { 'data-date': date } });
      if (date === today) cell.addClass('is-today');
      if (mode === 'month' && date.slice(0, 7) !== anchor.slice(0, 7)) cell.addClass('is-out');
      if (weekday(date) >= 5) cell.addClass('is-weekend');
      const st = styles[date];
      if (st?.color) { cell.addClass('has-color'); cell.style.setProperty('--vc-day-color', colorCss(st.color)); }
      if (st?.importance) cell.addClass(`is-imp-${st.importance}`);
      if (st?.image) {
        const f = this.ctx.app.vault.getAbstractFileByPath(st.image);
        if (f instanceof TFile) {
          cell.addClass('has-image');
          cell.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.55)), url("${this.ctx.app.vault.getResourcePath(f)}")`;
        }
      }
      cell.createDiv({ cls: 'vc-cal-daynum', text: String(Number(date.slice(8))) });
      const add = cell.createDiv({ cls: 'vc-cal-add vc-click', attr: { 'aria-label': t('Add a note') } });
      setIcon(add, 'plus');
      add.addEventListener('click', (e) => { if (!this.live()) return; e.stopPropagation(); this.addNote(cell, date); });
      add.addEventListener('dblclick', ev => ev.stopPropagation());
      cell.addEventListener('contextmenu', (e) => {
        if ((e.target as HTMLElement).closest('.vc-cal-chip')) return;
        e.preventDefault(); e.stopPropagation();
        this.dayMenu(e, cell, date);
      });

      const list = byDay.get(date) ?? [];
      const max = mode === 'week' ? list.length : 3;
      const open = this.openDay === date;
      const body = cell.createDiv('vc-cal-daybody');
      const chips = body.createDiv('vc-cal-chips');
      for (const it of open ? list : list.slice(0, max)) this.chip(chips, it);
      if (list.length > max) {
        const more = body.createDiv({ cls: 'vc-cal-more vc-click', text: open ? t('Show less') : t('+{n} more', { n: list.length - max }) });
        more.addEventListener('click', (e) => { if (!this.live()) return; e.stopPropagation(); this.openDay = open ? null : date; this.render(); });
        more.addEventListener('dblclick', ev => ev.stopPropagation());
      }
      cell.toggleClass('is-expanded', open);
    }
  }

  private monthLabel(iso: string): string {
    const d = new Date(toUTC(iso));
    return d.toLocaleDateString(getLanguage() === 'en' ? 'en' : 'zh-TW', { year: 'numeric', month: 'long', timeZone: 'UTC' });
  }

  private weekLabel(iso: string): string {
    const s = weekStart(iso), e = addDays(s, 6);
    const f = (x: string) => new Date(toUTC(x)).toLocaleDateString(getLanguage() === 'en' ? 'en' : 'zh-TW', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `${f(s)} – ${f(e)}`;
  }

  private chip(host: HTMLElement, it: DatedItem): void {
    const chip = host.createDiv({ cls: 'vc-cal-chip vc-click', attr: { 'data-key': it.key } });
    const c = colorCss(it.color);
    if (c) chip.style.setProperty('--vc-chip-color', c);
    if (it.importance) chip.addClass(`is-imp-${it.importance}`);
    if (it.done) chip.addClass('is-done');
    if (it.task) { chip.addClass('is-task'); setIcon(chip.createDiv('vc-cal-chip-icon'), it.done ? 'check-square' : 'square'); }
    chip.createDiv({ cls: 'vc-cal-chip-label', text: it.label });
    setTooltip(chip, it.task ? `${it.label} · ${t('from another card')}` : it.label, { placement: 'top' });
    chip.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); this.itemMenu(e, it); });
    chip.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (it.note) this.editNoteText(chip, it.note);
      else if (it.task) this.revealTask(it);
    });
    chip.addEventListener('pointerdown', (e) => this.dragChip(e, chip, it));
  }

  // ── editing ───────────────────────────────────────────

  private inlineInput(host: HTMLElement, value: string, done: (v: string | null) => void, cls = 'vc-cal-input'): void {
    const input = host.createEl('input', { type: 'text', cls });
    input.value = value;
    this.editingInput = input;
    let finished = false;
    const finish = (ok: boolean) => {
      if (finished) return; finished = true;
      this.editingInput = null;
      const v = input.value.trim();
      input.remove();
      done(ok ? v : null);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', e => e.stopPropagation());
    input.addEventListener('dblclick', e => e.stopPropagation());
    window.setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  private addNote(cell: HTMLElement, date: string): void {
    this.inlineInput(cell, '', (v) => {
      if (v) this.change(vc => { vc.notes = [...((vc.notes as CalNote[]) ?? []), { id: newId(), date, text: v }]; });
      else this.render();
    }, 'vc-cal-input is-new');
  }

  private editNoteText(chip: HTMLElement, note: CalNote): void {
    chip.empty();
    this.inlineInput(chip, note.text, (v) => {
      if (v !== null && v !== note.text) this.patchNote(note.id, n => { if (v) n.text = v; });
      else this.render();
    });
  }

  private editTitle(titleEl: HTMLElement): void {
    titleEl.empty();
    this.inlineInput(titleEl, (vcGet(this.node, 'title', '') as string), (v) => {
      if (v !== null) this.change(vc => { if (v) vc.title = v; else delete vc.title; });
      else this.render();
    });
  }

  private jumpMonth(label: HTMLElement): void {
    const input = createEl('input', { type: 'month', cls: 'vc-cal-month-input' });
    input.value = this.anchor().slice(0, 7);
    label.replaceWith(input);
    this.editingInput = input;
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return; done = true;
      this.editingInput = null;
      if (ok && /^\d{4}-\d{2}$/.test(input.value)) this.view(vc => { vc.anchor = `${input.value}-01`; });
      else this.render();
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    input.addEventListener('change', () => finish(true));
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', e => e.stopPropagation());
    window.setTimeout(() => input.focus(), 0);
  }

  private patchNote(id: string, fn: (n: CalNote) => void): void {
    this.change((vc) => {
      vc.notes = ((vc.notes as CalNote[]) ?? []).map((n) => { if (n.id !== id) return n; const c = { ...n }; fn(c); return c; });
    });
  }

  private patchDay(date: string, fn: (s: DayStyle) => void): void {
    this.change((vc) => {
      const days = { ...((vc.days as Record<string, DayStyle>) ?? {}) };
      const s = { ...(days[date] ?? {}) };
      fn(s);
      if (!s.color && !s.importance && !s.image) delete days[date]; else days[date] = s;
      if (Object.keys(days).length) vc.days = days; else delete vc.days;
    });
  }

  /** Move an item to another day: a note's date, or the 📅 date in a to-do line. */
  private moveItem(it: DatedItem, date: string): void {
    if (it.date === date) return;
    if (it.note) { this.patchNote(it.note.id, n => { n.date = date; }); return; }
    if (it.task) {
      const { nodeId, line } = it.task;
      commitNode(this.ctx, nodeId, (n) => { n.text = moveTaskDate(n.text ?? '', line, date); });
    }
  }

  private revealTask(it: DatedItem): void {
    const n = it.task && this.ctx.board.model.node(it.task.nodeId);
    if (!n) return;
    this.ctx.board.select([n.id]);
    this.ctx.board.reveal({ x: n.x, y: n.y, width: n.width, height: n.height });
  }

  private dragChip(e: PointerEvent, chip: HTMLElement, it: DatedItem): void {
    if (e.button !== 0 || !this.live()) return;
    e.stopPropagation();
    const doc = chip.ownerDocument;
    const sx = e.clientX, sy = e.clientY;
    let ghost: HTMLElement | null = null;
    let over: HTMLElement | null = null;
    const move = (ev: PointerEvent) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        ghost = doc.body.createDiv('vc-cal-ghost');
        ghost.setText(it.label);
        chip.addClass('is-dragging');
      }
      ghost.style.transform = `translate(${ev.clientX + 10}px, ${ev.clientY + 6}px)`;
      const cell = (doc.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('.vc-cal-cell');
      const target = cell && this.el.contains(cell) ? cell : null;
      if (target !== over) { over?.removeClass('is-drop'); target?.addClass('is-drop'); over = target; }
    };
    const up = () => {
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      over?.removeClass('is-drop');
      if (!ghost) return;
      (ghost as HTMLElement).remove();
      chip.removeClass('is-dragging');
      const date = over?.dataset.date;
      if (date) this.moveItem(it, date);
    };
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
  }

  // ── menus ─────────────────────────────────────────────

  private colorMenu(m: Menu, current: string | undefined, set: (c: string | undefined) => void): void {
    for (const c of COLORS) {
      const name = !c ? 'No colour' : ['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Purple'][Number(c) - 1];
      m.addItem(i => {
        i.setTitle(t(name)).setChecked(current === c).onClick(() => set(c));
        const icon = (i as unknown as { dom?: HTMLElement }).dom?.querySelector('.menu-item-icon');
        if (icon) { const sw = (icon as HTMLElement).createSpan('vc-menu-swatch'); if (c) sw.style.background = presetColor(c); else sw.addClass('is-none'); }
      });
    }
  }

  private submenu(menu: Menu, title: string, icon: string, build: (m: Menu) => void): void {
    let sub: Menu | null = null;
    menu.addItem(i => { i.setTitle(title).setIcon(icon); sub = (i as unknown as { setSubmenu?: () => Menu }).setSubmenu?.() ?? null; });
    build(sub ?? menu);
  }

  private dayMenu(e: MouseEvent, cell: HTMLElement, date: string): void {
    const style = this.days()[date];
    const menu = new Menu();
    menu.addItem(i => i.setTitle(t('Add a note')).setIcon('plus').onClick(() => { this.ctx.board.select([this.node.id]); this.addNote(cell, date); }));
    menu.addSeparator();
    this.submenu(menu, t('Day colour'), 'palette', m => this.colorMenu(m, style?.color, c => this.patchDay(date, s => { s.color = c; })));
    this.submenu(menu, t('Importance'), 'flag', (m) => {
      for (const o of IMPORTANCE) m.addItem(i => i.setTitle(t(o.label)).setChecked(style?.importance === o.v).onClick(() => this.patchDay(date, s => { s.importance = o.v; })));
    });
    menu.addItem(i => i.setTitle(style?.image ? t('Change day picture…') : t('Day picture…')).setIcon('image').onClick(() => {
      new ImageModal(this.ctx.app, f => this.patchDay(date, s => { s.image = f.path; })).open();
    }));
    if (style?.image) menu.addItem(i => i.setTitle(t('Remove day picture')).setIcon('x').onClick(() => this.patchDay(date, s => { delete s.image; })));
    if (style) {
      menu.addSeparator();
      menu.addItem(i => i.setTitle(t('Clear day style')).setIcon('eraser').onClick(() => this.patchDay(date, s => { delete s.color; delete s.importance; delete s.image; })));
    }
    menu.showAtMouseEvent(e);
  }

  private itemMenu(e: MouseEvent, it: DatedItem): void {
    const menu = new Menu();
    menu.addItem(i => i.setTitle(t('Change date…')).setIcon('calendar').onClick(() => this.pickDate(e, it)));
    if (it.note) {
      const note = it.note;
      menu.addItem(i => i.setTitle(t('Edit text')).setIcon('pencil').onClick(() => {
        const chip = this.el.querySelector<HTMLElement>(`.vc-cal-chip[data-key="${note.id}"]`);
        if (chip) this.editNoteText(chip, note);
      }));
      menu.addItem(i => i.setTitle(note.done ? t('Mark as not done') : t('Mark as done')).setIcon('check').onClick(() => this.patchNote(note.id, n => { n.done = !n.done || undefined; })));
      menu.addSeparator();
      this.submenu(menu, t('Colour'), 'palette', m => this.colorMenu(m, note.color, c => this.patchNote(note.id, n => { n.color = c; })));
      this.submenu(menu, t('Importance'), 'flag', (m) => {
        for (const o of IMPORTANCE) m.addItem(i => i.setTitle(t(o.label)).setChecked(note.importance === o.v).onClick(() => this.patchNote(note.id, n => { n.importance = o.v; })));
      });
      menu.addSeparator();
      menu.addItem(i => i.setTitle(t('Delete note')).setIcon('trash-2').setWarning(true).onClick(() => {
        this.openDay = note.date;
        this.change(vc => { vc.notes = ((vc.notes as CalNote[]) ?? []).filter(n => n.id !== note.id); });
      }));
    } else if (it.task) {
      const { nodeId, line } = it.task;
      menu.addItem(i => i.setTitle(it.done ? t('Mark as not done') : t('Mark as done')).setIcon('check').onClick(() => {
        commitNode(this.ctx, nodeId, (n) => { n.text = toggleTaskDone(n.text ?? '', line); });
      }));
      menu.addItem(i => i.setTitle(t('Show its card')).setIcon('arrow-up-right').onClick(() => this.revealTask(it)));
    }
    menu.showAtMouseEvent(e);
  }

  private pickDate(e: MouseEvent, it: DatedItem): void {
    const input = this.ctx.board.uiEl.createEl('input', { type: 'date', cls: 'vc-cal-date-input' });
    const r = this.ctx.board.root.getBoundingClientRect();
    input.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
    input.value = it.date;
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return; done = true;
      const v = input.value;
      input.remove();
      if (ok && isISO(v)) this.moveItem(it, v);
    };
    input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); });
    input.addEventListener('change', () => finish(true));
    input.addEventListener('blur', () => finish(false));
    input.addEventListener('pointerdown', ev => ev.stopPropagation());
    window.setTimeout(() => { input.focus(); (input as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); }, 0);
  }

  // ── CardHandle ────────────────────────────────────────

  update(n: RawNode): void { this.node = n; if (!this.editingInput) this.render(); }
  destroy(): void { /* listeners go with the card's component */ }
  isEditing(): boolean { return !!this.editingInput; }
  stopEditing(): void { this.editingInput?.blur(); }
  searchText(): string { return `${this.title()} ${this.notes().map(n => n.text).join(' ')}`; }

  barItems(): BarItem[] {
    const mode = this.mode(), locked = this.locked();
    return [
      { id: 'today', icon: 'calendar-check', label: t('Today'), run: () => this.view(vc => { delete vc.anchor; }) },
      { id: 'mode', icon: mode === 'month' ? 'calendar-days' : 'calendar-range', label: t('Month or week'), text: mode === 'month' ? t('Month') : t('Week'), run: () => this.view(vc => { vc.mode = mode === 'month' ? 'week' : 'month'; }) },
      { id: 'lock', icon: locked ? 'lock' : 'lock-open', label: locked ? t('Unlock the month') : t('Lock the month (no accidental paging)'), active: locked, run: () => this.view(vc => { vc.locked = !locked; }) },
    ];
  }
}

export const calendarCard: CardType = {
  id: 'calendar',
  label: 'Calendar',
  icon: 'calendar-days',
  defaultSize: { width: 640, height: 520 },
  create: () => ({ type: 'text', text: calendarText(t('Calendar'), []), vc: { kind: 'calendar' } }),
  mount: (node, el, ctx) => new CalendarCard(node, el, ctx),
};
