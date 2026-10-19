import { setIcon } from 'obsidian';
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Command } from 'prosemirror-state';
import { insertRule, setAlign, setTextBlock, toggleList, toggleQuote } from './commands';
import { t } from '../i18n';

interface SlashItem { id: string; label: () => string; keywords: string; icon: string; run: Command; }

const ITEMS: SlashItem[] = [
  { id: 'p', label: () => t('Body text'), keywords: 'text paragraph 正文 內文 zw', icon: 'pilcrow', run: setTextBlock('paragraph') },
  { id: 'h1', label: () => t('Heading 1'), keywords: 'h1 heading title 標題 bt', icon: 'heading-1', run: setTextBlock('h1') },
  { id: 'h2', label: () => t('Heading 2'), keywords: 'h2 heading 標題 bt', icon: 'heading-2', run: setTextBlock('h2') },
  { id: 'h3', label: () => t('Heading 3'), keywords: 'h3 heading 標題 bt', icon: 'heading-3', run: setTextBlock('h3') },
  { id: 'ul', label: () => t('Bulleted list'), keywords: 'bullet list ul 項目 清單 qd', icon: 'list', run: toggleList('bullet') },
  { id: 'ol', label: () => t('Numbered list'), keywords: 'number ordered list ol 編號 清單 bh', icon: 'list-ordered', run: toggleList('ordered') },
  { id: 'todo', label: () => t('To-do list'), keywords: 'todo task check 待辦 dd', icon: 'list-checks', run: toggleList('task') },
  { id: 'quote', label: () => t('Quote'), keywords: 'quote blockquote 引用 yy', icon: 'quote', run: toggleQuote() },
  { id: 'code', label: () => t('Code block'), keywords: 'code 程式碼 cx', icon: 'code-2', run: setTextBlock('code') },
  { id: 'hr', label: () => t('Divider'), keywords: 'divider hr line 分隔線 fgx', icon: 'minus', run: insertRule() },
  { id: 'left', label: () => t('Align left'), keywords: 'left align 靠左 對齊 kz', icon: 'align-left', run: setAlign('left') },
  { id: 'center', label: () => t('Align centre'), keywords: 'center centre align 置中 對齊 zz', icon: 'align-center', run: setAlign('center') },
  { id: 'right', label: () => t('Align right'), keywords: 'right align 靠右 對齊 ky', icon: 'align-right', run: setAlign('right') },
];

interface SlashState { active: boolean; from: number; query: string; }
const key = new PluginKey<SlashState>('vc-slash');

/** Typing "/" at the start of a line or after a space opens a block menu. */
export function slashMenu(): Plugin<SlashState> {
  let menu: SlashMenu | null = null;
  return new Plugin<SlashState>({
    key,
    state: {
      init: () => ({ active: false, from: 0, query: '' }),
      apply(tr, prev, _old, state): SlashState {
        const meta = tr.getMeta(key) as Partial<SlashState> | 'close' | undefined;
        if (meta === 'close') return { active: false, from: 0, query: '' };
        if (meta) return { ...prev, ...meta, active: true } as SlashState;
        if (!prev.active) return prev;
        const from = tr.mapping.map(prev.from);
        const { $from, empty } = state.selection;
        if (!empty || $from.pos <= from) return { active: false, from: 0, query: '' };
        const text = state.doc.textBetween(from, $from.pos, '\n', '\n');
        if (!/^[/、]/.test(text) || /\s/.test(text.slice(1)) || text.length > 24) return { active: false, from: 0, query: '' };
        return { active: true, from, query: text.slice(1) };
      },
    },
    props: {
      handleTextInput(view, from, _to, text) {
        // "/" — or "、", which a Chinese input method types for the same key.
        if (text !== '/' && text !== '、') return false;
        const $pos = view.state.doc.resolve(from);
        if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return false;
        const before = $pos.parent.textBetween(0, $pos.parentOffset, '\n', '\n');
        if (before && !/\s$/.test(before)) return false;
        // Let the "/" be typed, then open the menu at it.
        setTimeout(() => view.dispatch(view.state.tr.setMeta(key, { from, query: '' })), 0);
        return false;
      },
      handleKeyDown(view, e) {
        const st = key.getState(view.state);
        if (!st?.active || !menu) return false;
        if (e.key === 'ArrowDown') { menu.move(1); return true; }
        if (e.key === 'ArrowUp') { menu.move(-1); return true; }
        if (e.key === 'Enter' || e.key === 'Tab') { menu.choose(); return true; }
        if (e.key === 'Escape') { view.dispatch(view.state.tr.setMeta(key, 'close')); return true; }
        return false;
      },
    },
    view(view) {
      return {
        update(v: EditorView, prevState: EditorState) {
          const st = key.getState(v.state);
          const prev = key.getState(prevState);
          if (!st?.active) { menu?.destroy(); menu = null; return; }
          if (!menu) menu = new SlashMenu(v, () => { menu?.destroy(); menu = null; });
          if (!prev?.active || prev.query !== st.query || !menu.shown) menu.render(st);
        },
        destroy() { menu?.destroy(); menu = null; void view; },
      };
    },
  });
}

class SlashMenu {
  private el: HTMLElement;
  private items: SlashItem[] = [];
  private index = 0;
  shown = false;

  constructor(private view: EditorView, private onClose: () => void) {
    this.el = view.dom.ownerDocument.body.createDiv('vc-slash-menu');
    this.el.addEventListener('mousedown', e => e.preventDefault());
    this.el.addEventListener('pointerdown', e => e.stopPropagation());
  }

  render(st: SlashState): void {
    const q = st.query.toLowerCase();
    this.items = ITEMS.filter(i => !q || i.label().toLowerCase().includes(q) || i.keywords.toLowerCase().includes(q));
    this.index = 0;
    this.el.empty();
    if (!this.items.length) { this.el.createDiv({ cls: 'vc-slash-empty', text: t('No results') }); }
    this.items.forEach((item, i) => {
      const row = this.el.createDiv({ cls: 'vc-slash-item' + (i === 0 ? ' is-selected' : '') });
      setIcon(row.createDiv('vc-slash-icon'), item.icon);
      row.createDiv({ cls: 'vc-slash-label', text: item.label() });
      row.addEventListener('mouseenter', () => this.select(i));
      row.addEventListener('click', () => { this.index = i; this.choose(); });
    });
    const c = this.view.coordsAtPos(st.from);
    this.el.style.left = `${c.left}px`;
    this.el.style.top = `${c.bottom + 6}px`;
    this.shown = true;
    requestAnimationFrame(() => {
      const r = this.el.getBoundingClientRect();
      if (r.bottom > window.innerHeight - 8) this.el.style.top = `${c.top - r.height - 6}px`;
    });
  }

  private select(i: number): void {
    this.index = i;
    Array.from(this.el.querySelectorAll('.vc-slash-item')).forEach((el, j) => el.toggleClass('is-selected', j === i));
  }

  move(d: number): void {
    if (!this.items.length) return;
    this.select((this.index + d + this.items.length) % this.items.length);
    this.el.querySelectorAll('.vc-slash-item')[this.index]?.scrollIntoView({ block: 'nearest' });
  }

  choose(): void {
    const item = this.items[this.index];
    const st = key.getState(this.view.state);
    if (!item || !st) { this.view.dispatch(this.view.state.tr.setMeta(key, 'close')); return; }
    // Remove the typed "/query", then run the command.
    const to = this.view.state.selection.from;
    this.view.dispatch(this.view.state.tr.delete(st.from, to).setMeta(key, 'close'));
    item.run(this.view.state, this.view.dispatch, this.view);
    this.view.focus();
    this.onClose();
  }

  destroy(): void {
    this.el.remove();
    this.shown = false;
  }
}
