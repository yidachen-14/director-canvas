import { setIcon, setTooltip } from 'obsidian';
import { TextSelection, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { schema } from './schema';
import {
  blockKind, clearFormatting, currentAlign, listKind, markActive, markAttrs, setAlign, setMark, setTextBlock, toggle, toggleList, toggleQuote, toggleTaskLines,
} from './commands';
import { t } from '../i18n';

export const TEXT_COLORS = ['#e03e3e', '#d9730d', '#dfab01', '#0f7b6c', '#0b6e99', '#6940a5', '#ad1a72', '#9b9a97'];
export const HIGHLIGHTS = ['#fbf3db', '#fde2dd', '#fdecc8', '#dbeddb', '#d3e5ef', '#e8deee', '#f5e0e9', '#e3e2e0'];
export const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64];

/**
 * The formatting bar that floats beside a text selection. It sits above the
 * selected lines (below when there is no room) so it never covers them.
 */
export class SelectionToolbar {
  private el: HTMLElement;
  private popup: HTMLElement | null = null;
  private buttons: { el: HTMLElement; active?: (s: EditorState) => boolean }[] = [];

  constructor(private view: EditorView, private bounds: () => DOMRect | null) {
    const doc = view.dom.ownerDocument;
    this.el = doc.body.createDiv('vc-format-bar');
    this.el.hide();
    // Clicking the bar must not take focus (or the selection) from the editor.
    this.el.addEventListener('mousedown', e => { if (!(e.target as HTMLElement).closest('input')) e.preventDefault(); });
    this.el.addEventListener('pointerdown', e => e.stopPropagation());
    this.build();
  }

  private run(cmd: (s: EditorState, d?: EditorView['dispatch']) => boolean): void {
    cmd(this.view.state, this.view.dispatch);
    this.view.focus();
  }

  private button(icon: string, label: string, onClick: (e: MouseEvent) => void, active?: (s: EditorState) => boolean): HTMLElement {
    const b = this.el.createDiv({ cls: 'vc-fb-btn', attr: { 'aria-label': label } });
    setIcon(b, icon);
    setTooltip(b, label, { placement: 'top' });
    b.addEventListener('click', (e) => { e.preventDefault(); onClick(e); this.update(); });
    this.buttons.push({ el: b, active });
    return b;
  }

  private sep(): void { this.el.createDiv('vc-fb-sep'); }

  private build(): void {
    const m = schema.marks;
    const style = this.el.createDiv({ cls: 'vc-fb-select', attr: { 'aria-label': t('Text style') } });
    style.addEventListener('click', () => this.openList(style, [
      ['paragraph', t('Body text')], ['h1', t('Heading 1')], ['h2', t('Heading 2')], ['h3', t('Heading 3')], ['code', t('Code block')],
    ], blockKind(this.view.state), v => this.run(setTextBlock(v))));
    this.styleLabel = style;
    this.sep();
    this.button('bold', t('Bold'), () => this.run(toggle('strong')), s => markActive(s, m.strong));
    this.button('italic', t('Italic'), () => this.run(toggle('em')), s => markActive(s, m.em));
    this.button('underline', t('Underline'), () => this.run(toggle('underline')), s => markActive(s, m.underline));
    this.button('strikethrough', t('Strikethrough'), () => this.run(toggle('strike')), s => markActive(s, m.strike));
    this.button('code', t('Inline code'), () => this.run(toggle('code')), s => markActive(s, m.code));
    this.sep();
    const hl = this.button('highlighter', t('Highlight'), () => this.openColors(hl, 'highlight'), s => markActive(s, m.highlight));
    const tc = this.button('baseline', t('Text colour'), () => this.openColors(tc, 'color'), s => markActive(s, m.color));
    const sz = this.button('a-large-small', t('Font size'), () => {
      const cur = markAttrs(this.view.state, m.size)?.size as number | undefined;
      this.openList(sz, [['', t('Default size')], ...SIZES.map(v => [String(v), `${v}`] as [string, string])], cur ? String(cur) : '', v => {
        this.run(setMark(m.size, v ? { size: Number(v) } : null));
      });
    }, s => markActive(s, m.size));
    this.sep();
    this.button('align-left', t('Align left'), () => this.run(setAlign('left')), s => currentAlign(s) === 'left');
    this.button('align-center', t('Align centre'), () => this.run(setAlign('center')), s => currentAlign(s) === 'center');
    this.button('align-right', t('Align right'), () => this.run(setAlign('right')), s => currentAlign(s) === 'right');
    this.sep();
    this.button('list', t('Bulleted list'), () => this.run(toggleList('bullet')), s => listKind(s) === 'bullet');
    this.button('list-ordered', t('Numbered list'), () => this.run(toggleList('ordered')), s => listKind(s) === 'ordered');
    this.button('list-checks', t('To-do list'), () => this.run(toggleTaskLines), s => listKind(s) === 'task');
    this.button('quote', t('Quote'), () => this.run(toggleQuote()));
    this.sep();
    this.button('link', t('Link'), () => this.editLink(), s => markActive(s, m.link));
    this.button('remove-formatting', t('Clear formatting'), () => this.run(clearFormatting));
  }

  private styleLabel: HTMLElement | null = null;

  /** Show or hide the bar for the current selection. */
  update(): void {
    const state = this.view.state;
    const sel = state.selection;
    const show = this.view.hasFocus() && sel instanceof TextSelection && !sel.empty && this.view.editable;
    if (!show) { this.hide(); return; }
    for (const b of this.buttons) if (b.active) b.el.toggleClass('is-active', b.active(state));
    if (this.styleLabel) {
      const k = blockKind(state);
      const names: Record<string, string> = { paragraph: t('Body text'), h1: t('Heading 1'), h2: t('Heading 2'), h3: t('Heading 3'), h4: 'H4', h5: 'H5', h6: 'H6', code: t('Code block') };
      this.styleLabel.setText(names[k] ?? k);
    }
    this.el.show();
    this.position();
  }

  private position(): void {
    const { from, to } = this.view.state.selection;
    const a = this.view.coordsAtPos(from), b = this.view.coordsAtPos(to);
    const top = Math.min(a.top, b.top), bottom = Math.max(a.bottom, b.bottom);
    const left = Math.min(a.left, b.left), right = Math.max(a.right, b.right);
    const bar = this.el.getBoundingClientRect();
    const area = this.bounds() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    let y = top - bar.height - 10;
    if (y < area.top + 4) y = bottom + 10;
    let x = (left + right) / 2 - bar.width / 2;
    x = Math.max(area.left + 4, Math.min(x, area.right - bar.width - 4));
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }

  hide(): void {
    this.el.hide();
    this.closePopup();
  }

  destroy(): void {
    this.closePopup();
    this.el.remove();
  }

  // ── popups ──────────────────────────────────────────────

  private closePopup(): void {
    this.popup?.remove();
    this.popup = null;
  }

  private openPopup(anchor: HTMLElement): HTMLElement {
    this.closePopup();
    const p = this.el.ownerDocument.body.createDiv('vc-fb-popup');
    p.addEventListener('mousedown', e => { if (!(e.target as HTMLElement).closest('input')) e.preventDefault(); });
    p.addEventListener('pointerdown', e => e.stopPropagation());
    const r = anchor.getBoundingClientRect();
    p.style.left = `${r.left}px`;
    p.style.top = `${r.bottom + 6}px`;
    this.popup = p;
    // Keep inside the window.
    requestAnimationFrame(() => {
      const pr = p.getBoundingClientRect();
      if (pr.right > window.innerWidth - 4) p.style.left = `${window.innerWidth - pr.width - 4}px`;
      if (pr.bottom > window.innerHeight - 4) p.style.top = `${r.top - pr.height - 6}px`;
    });
    return p;
  }

  private openList(anchor: HTMLElement, items: [string, string][], current: string, pick: (v: string) => void): void {
    const p = this.openPopup(anchor);
    p.addClass('is-list');
    for (const [v, label] of items) {
      const row = p.createDiv({ cls: 'vc-fb-item' + (v === current ? ' is-active' : ''), text: label });
      row.addEventListener('click', () => { pick(v); this.closePopup(); this.update(); });
    }
  }

  private openColors(anchor: HTMLElement, kind: 'highlight' | 'color'): void {
    const p = this.openPopup(anchor);
    p.addClass('is-colors');
    const type = kind === 'highlight' ? schema.marks.highlight : schema.marks.color;
    const apply = (attrs: Record<string, unknown> | null) => { this.run(setMark(type, attrs)); this.closePopup(); this.update(); };
    const none = p.createDiv({ cls: 'vc-fb-swatch is-none', attr: { 'aria-label': t('None') } });
    none.addEventListener('click', () => apply(null));
    if (kind === 'highlight') {
      const def = p.createDiv({ cls: 'vc-fb-swatch is-default', attr: { 'aria-label': t('Default highlight') } });
      def.addEventListener('click', () => apply({ color: null }));
    }
    for (const c of kind === 'highlight' ? HIGHLIGHTS : TEXT_COLORS) {
      const sw = p.createDiv({ cls: 'vc-fb-swatch' });
      sw.style.background = c;
      sw.addEventListener('click', () => apply({ color: c }));
    }
    const custom = p.createEl('input', { type: 'color', cls: 'vc-fb-custom', attr: { 'aria-label': t('Custom colour') } });
    custom.addEventListener('change', () => apply({ color: custom.value }));
  }

  private editLink(): void {
    const m = schema.marks.link;
    const current = markAttrs(this.view.state, m)?.href as string | undefined;
    const p = this.openPopup(this.el);
    p.addClass('is-link');
    const input = p.createEl('input', { type: 'text', placeholder: 'https://…' });
    input.value = current ?? '';
    const { from, to } = this.view.state.selection;
    const done = (save: boolean) => {
      const href = input.value.trim();
      this.closePopup();
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, from, to)));
      if (save) setMark(m, href ? { href, title: null } : null)(this.view.state, this.view.dispatch);
      this.view.focus();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
    });
    window.setTimeout(() => input.focus(), 0);
  }
}
