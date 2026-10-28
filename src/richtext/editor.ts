import { AllSelection, EditorState, Plugin, TextSelection, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, chainCommands, exitCode, setBlockType } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { splitListItem } from 'prosemirror-schema-list';
import { schema } from './schema';
import { parseMarkdown, serializeMarkdown, plainText } from './markdown';
import { markdownInputRules } from './inputrules';
import { slashMenu } from './slash';
import { SelectionToolbar } from './toolbar';
import { RawBlockView, TaskItemView, WikilinkView, type RichContext } from './nodeviews';
import { indentItem, outdentItem, setAlign, setTextBlock, toggle, toggleList, toggleTaskLines } from './commands';
import type { App, Component } from 'obsidian';

export interface RichTextOptions {
  app: App;
  sourcePath: string;
  component: Component;
  markdown: string;
  /** Text has changed and should be stored (end of editing, ticking a box, a drag). */
  onCommit(markdown: string): void;
  /** Editing ended (with or without changes). */
  onEditEnd?(): void;
  /** The content changed size while editing (to grow the card). */
  onResize?(): void;
  placeholder?: string;
  /** Screen area the floating toolbar must stay inside. */
  bounds?(): DOMRect | null;
}

/** Every live editor by its root element, so a drag can find where it lands. */
export const richRegistry = new WeakMap<HTMLElement, RichText>();

/**
 * One text card's content: shown read-only, editable on demand. The same
 * view is used for both so block handles and links work in either mode.
 */
export class RichText {
  readonly view: EditorView;
  editing = false;
  /** Markdown as last stored; edits compare against it. */
  private stored: string;
  private toolbar: SelectionToolbar | null = null;
  private ctx: RichContext;
  private hostEl: HTMLElement;

  constructor(host: HTMLElement, private opts: RichTextOptions) {
    this.hostEl = host;
    this.stored = opts.markdown;
    this.ctx = {
      app: opts.app,
      sourcePath: opts.sourcePath,
      component: opts.component,
      editing: () => this.editing,
      commitNow: () => this.commitIfChanged(),
    };
    const state = this.makeState(parseMarkdown(opts.markdown));
    this.view = new EditorView(host, {
      state,
      editable: () => this.editing,
      attributes: { class: 'vc-rich markdown-rendered', spellcheck: 'false' },
      dispatchTransaction: (tr) => this.dispatch(tr),
      nodeViews: {
        list_item: (node, view, getPos) => new TaskItemView(node, view, getPos, this.ctx),
        raw_block: (node) => new RawBlockView(node, this.ctx),
        wikilink: (node) => new WikilinkView(node, this.ctx),
      },
      clipboardTextParser: (text, $context) => {
        if ($context.parent.type.spec.code) return text ? new Slice(Fragment.from(schema.text(text)), 0, 0) : Slice.empty;
        const doc = parseMarkdown(text);
        const first = doc.firstChild, last = doc.lastChild;
        return new Slice(doc.content, first?.isTextblock ? 1 : 0, last?.isTextblock ? 1 : 0);
      },
      transformPastedHTML: (html) => html.replace(/<meta[^>]*>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, ''),
      handleDOMEvents: {
        blur: (_v, e) => {
          const next = (e).relatedTarget as HTMLElement | null;
          // Focus moving into our own floating UI is not leaving the editor.
          if (next && next.closest('.vc-format-bar, .vc-fb-popup, .vc-slash-menu')) return false;
          window.setTimeout(() => {
            const active = this.view.dom.ownerDocument.activeElement as HTMLElement | null;
            if (this.editing && !this.view.hasFocus() && !active?.closest('.vc-format-bar, .vc-fb-popup, .vc-slash-menu')) this.stopEditing();
          }, 0);
          return false;
        },
      },
    });
    this.view.dom.setAttr('data-placeholder', opts.placeholder ?? '');
    richRegistry.set(this.view.dom, this);
    this.updatePlaceholder();
  }

  private makeState(doc: PMNode): EditorState {
    return EditorState.create({
      doc,
      plugins: [
        history(),
        markdownInputRules(),
        slashMenu(),
        keymap(this.keys()),
        keymap(baseKeymap),
        new Plugin({ props: { handleKeyDown: (_v, e) => { e.stopPropagation(); return false; } } }),
      ],
    });
  }

  private keys(): Record<string, (s: EditorState, d?: (tr: Transaction) => void) => boolean> {
    const n = schema.nodes;
    return {
      'Mod-z': undo,
      'Mod-Shift-z': redo,
      'Mod-y': redo,
      'Mod-b': toggle('strong'),
      'Mod-i': toggle('em'),
      'Mod-u': toggle('underline'),
      'Mod-Shift-x': toggle('strike'),
      'Mod-e': toggle('code'),
      'Mod-Shift-h': toggle('highlight'),
      'Mod-Alt-0': setTextBlock('paragraph'),
      'Mod-Alt-1': setTextBlock('h1'),
      'Mod-Alt-2': setTextBlock('h2'),
      'Mod-Alt-3': setTextBlock('h3'),
      'Mod-Shift-7': toggleList('ordered'),
      'Mod-Shift-8': toggleList('bullet'),
      'Mod-Shift-9': toggleTaskLines,
      'Mod-Shift-l': setAlign('left'),
      'Mod-Shift-e': setAlign('center'),
      'Mod-Shift-r': setAlign('right'),
      'Enter': (state, dispatch) => {
        // A new item after a task item is a task too; after a plain item, plain.
        const $from = state.selection.$from;
        let task = false;
        for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === n.list_item) { task = $from.node(d).attrs.checked !== null; break; }
        return splitListItem(n.list_item, { checked: task ? ' ' : null })(state, dispatch);
      },
      'Tab': (s, d) => { indentItem(s, d); return true; },
      'Shift-Tab': (s, d) => { outdentItem(s, d); return true; },
      'Shift-Enter': chainCommands(exitCode, (state, dispatch) => {
        if (dispatch) dispatch(state.tr.replaceSelectionWith(n.hard_break.create()).scrollIntoView());
        return true;
      }),
      'Mod-Enter': exitCode,
      'Backspace': (state, dispatch) => {
        // Backspace at the start of a heading or code block turns it back into body text.
        const { $from, empty } = state.selection;
        if (!empty || $from.parentOffset > 0) return false;
        if ($from.parent.type === n.heading || $from.parent.type === n.code_block) return setBlockType(n.paragraph)(state, dispatch);
        return false;
      },
      'Escape': () => { this.stopEditing(); return true; },
    };
  }

  private dispatch(tr: Transaction): void {
    const state = this.view.state.apply(tr);
    this.view.updateState(state);
    if (tr.docChanged) { this.updatePlaceholder(); if (this.editing) this.opts.onResize?.(); }
    this.toolbar?.update();
  }

  private updatePlaceholder(): void {
    const empty = this.view.state.doc.childCount === 1 && this.view.state.doc.firstChild!.isTextblock && this.view.state.doc.firstChild!.content.size === 0;
    this.view.dom.toggleClass('is-empty', empty);
  }

  /** Current content as Markdown. */
  markdown(): string {
    return serializeMarkdown(this.view.state.doc);
  }

  plainText(): string {
    return plainText(this.view.state.doc);
  }

  /** New stored text from outside (undo, file change). Ignored while editing. */
  setMarkdown(md: string): void {
    if (this.editing || md === this.stored) return;
    this.stored = md;
    this.view.updateState(this.makeState(parseMarkdown(md)));
    this.updatePlaceholder();
  }

  /** Enter editing; the caret goes where the user clicked, else to the end. */
  startEditing(at?: { clientX: number; clientY: number }): void {
    if (this.editing) return;
    this.editing = true;
    this.toolbar ??= new SelectionToolbar(this.view, () => this.opts.bounds?.() ?? null);
    this.view.setProps({});
    this.hostEl.addClass('is-editing');
    this.view.focus();
    let sel = TextSelection.atEnd(this.view.state.doc);
    if (at) {
      const hit = this.view.posAtCoords({ left: at.clientX, top: at.clientY });
      if (hit) sel = TextSelection.near(this.view.state.doc.resolve(hit.pos));
    }
    this.view.dispatch(this.view.state.tr.setSelection(sel));
  }

  /** Leave editing and store the text if it changed. */
  stopEditing(): void {
    if (!this.editing) return;
    this.editing = false;
    this.toolbar?.destroy();
    this.toolbar = null;
    this.view.setProps({});
    this.hostEl.removeClass('is-editing');
    // Drop the text selection so nothing stays highlighted.
    const sel = this.view.dom.ownerDocument.getSelection();
    if (sel && this.view.dom.contains(sel.anchorNode)) sel.removeAllRanges();
    this.commitIfChanged();
    this.opts.onEditEnd?.();
  }

  /** Store the current text if it differs from what was stored. */
  commitIfChanged(): void {
    const md = this.markdown();
    if (md === this.stored) return;
    this.stored = md;
    this.opts.onCommit(md);
  }

  /** Apply a change built from the current state (alignment from a menu), then store it. */
  applyAndCommit(build: (state: EditorState) => Transaction | null): void {
    const tr = build(this.view.state);
    if (!tr) return;
    this.view.dispatch(tr);
    if (!this.editing) this.commitIfChanged();
  }

  /** Run an editing command on the whole text (from outside the editor), then store it. */
  runOnAll(cmd: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean): void {
    const view = this.view;
    const keep = view.state.selection;
    view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
    cmd(view.state, tr => view.dispatch(tr));
    try { view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(Math.min(keep.from, view.state.doc.content.size))))); } catch { /* selection gone */ }
    if (!this.editing) this.commitIfChanged();
  }

  /** Alignment of the first block (what the whole card reads as). */
  alignment(): 'left' | 'center' | 'right' {
    let a: string | null = null;
    this.view.state.doc.descendants((n) => { if (a === null && n.isTextblock) { a = (n.attrs.align as string) || 'left'; } return a === null; });
    return (a ?? 'left');
  }

  /** Whether every top-level block is a to-do list. */
  allTasks(): boolean {
    const doc = this.view.state.doc;
    let all = doc.childCount > 0;
    let any = false;
    doc.forEach((n) => {
      if (n.type === schema.nodes.paragraph || n.type === schema.nodes.ordered_list) { all = false; return; }
      if (n.type !== schema.nodes.bullet_list) return; // headings, code… don't count
      any = true;
      n.forEach((li) => { if (li.attrs.checked === null) all = false; });
    });
    if (!any) all = false;
    return all;
  }

  isEmpty(): boolean {
    return !this.markdown().trim();
  }

  destroy(): void {
    this.toolbar?.destroy();
    richRegistry.delete(this.view.dom);
    this.view.destroy();
  }
}
