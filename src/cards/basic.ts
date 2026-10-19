import { Component, MarkdownRenderer, TFile, setIcon } from 'obsidian';
import type { RawNode } from '../model/canvas-file';
import type { CardContext, CardHandle, CardType } from './types';
import { applyCardColor, fileKindOf, resolveFile, vcGet } from './util';
import { t } from '../i18n';

// ── shared helpers ──────────────────────────────────────────

/** Make internal links in rendered Markdown open like they do in notes. */
export function wireLinks(el: HTMLElement, ctx: CardContext): void {
  el.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    if (a.hasClass('internal-link')) {
      e.preventDefault();
      const href = a.getAttr('data-href') ?? a.getAttr('href') ?? '';
      void ctx.app.workspace.openLinkText(href, ctx.sourcePath, e.metaKey || e.ctrlKey);
    }
  });
}

export async function renderMarkdown(ctx: CardContext, md: string, el: HTMLElement, component: Component): Promise<void> {
  el.empty();
  await MarkdownRenderer.render(ctx.app, md, el, ctx.sourcePath, component);
}

/** Commit a change to one node as an undo step. */
export function commitNode(ctx: CardContext, id: string, fn: (n: RawNode) => void, mergeKey?: string): void {
  const m = ctx.board.model;
  const n = m.node(id);
  if (!n) return;
  m.transact(() => { fn(n); m.touch(id); }, mergeKey ?? ctx.board.mergeKeyFor(id));
}

// ── Note: the core Canvas text card (Markdown) ─────────────

export const noteCard: CardType = {
  id: 'note',
  label: 'Note',
  icon: 'notebook-text',
  defaultSize: { width: 300, height: 180 },
  create: () => ({ type: 'text', text: '' }),
  mount(node, el, ctx) {
    let current = node;
    el.addClass('vc-note');
    const view = el.createDiv('vc-md markdown-rendered');
    let editor: HTMLTextAreaElement | null = null;
    let renderChild: Component | null = null;
    wireLinks(view, ctx);

    const render = () => {
      applyCardColor(el.parentElement ?? el, current.color);
      if (editor) return;
      if (renderChild) ctx.component.removeChild(renderChild);
      renderChild = new Component();
      ctx.component.addChild(renderChild);
      void renderMarkdown(ctx, current.text ?? '', view, renderChild);
    };
    render();

    const finish = () => {
      if (!editor) return;
      const ed = editor;
      editor = null; // before remove(): removing a focused element fires blur
      const value = ed.value;
      ed.remove();
      view.show();
      if (value !== (current.text ?? '')) commitNode(ctx, current.id, n => { n.text = value; });
      else render();
      ctx.board.editingEnded(current.id);
    };

    return {
      update(n) { current = n; render(); },
      destroy() { if (renderChild) ctx.component.removeChild(renderChild); },
      edit() {
        if (editor) return true;
        view.hide();
        editor = el.createEl('textarea', { cls: 'vc-note-source' });
        editor.value = current.text ?? '';
        editor.addEventListener('blur', finish);
        editor.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); finish(); }
        });
        editor.focus();
        return true;
      },
      isEditing: () => !!editor,
      stopEditing: finish,
      searchText: () => current.text ?? '',
    };
  },
};

// ── Text: borderless text placed straight on the board ─────

export const textCard: CardType = {
  id: 'text',
  label: 'Text',
  icon: 'type',
  defaultSize: { width: 240, height: 40 },
  create: ({ settings }) => ({ type: 'text', text: '', vc: { kind: 'text', fontSize: settings.defaultTextSize } }),
  mount(node, el, ctx) {
    let current = node;
    el.addClass('vc-textcard');
    const textEl = el.createDiv('vc-text');
    let editing = false;

    const render = () => {
      textEl.style.fontSize = `${vcGet(current, 'fontSize', ctx.board.settings.defaultTextSize)}px`;
      textEl.style.textAlign = vcGet(current, 'align', 'left');
      applyCardColor(el.parentElement ?? el, current.color);
      if (!editing) textEl.setText(current.text ?? '');
    };
    render();

    const fit = () => {
      // Grow the card to fit its text while typing.
      const n = ctx.board.model.node(current.id);
      if (!n) return;
      const h = Math.ceil(textEl.scrollHeight + 8);
      if (h > n.height) { n.height = h; (el.parentElement as HTMLElement).style.height = `${h}px`; }
    };

    const finish = () => {
      if (!editing) return;
      editing = false;
      textEl.contentEditable = 'false';
      const value = textEl.innerText.replace(/\n$/, '');
      ctx.board.editingEnded(current.id);
      if (!value.trim()) {
        const m = ctx.board.model;
        if (m.node(current.id)) m.transact(() => m.removeNodes([current.id]), ctx.board.mergeKeyFor(current.id));
        return;
      }
      const height = Math.max(current.height, Math.ceil(textEl.scrollHeight + 8));
      if (value !== current.text || height !== current.height) commitNode(ctx, current.id, n => { n.text = value; n.height = height; });
    };

    textEl.addEventListener('input', fit);
    textEl.addEventListener('blur', finish);
    textEl.addEventListener('keydown', (e) => {
      if (!editing) return;
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); textEl.blur(); }
    });
    textEl.addEventListener('paste', (e) => {
      if (!editing) return;
      const text = e.clipboardData?.getData('text/plain');
      if (text == null) return;
      e.preventDefault();
      document.execCommand('insertText', false, text);
    });

    return {
      update(n) { current = n; render(); },
      destroy() { /* nothing */ },
      edit() {
        editing = true;
        textEl.contentEditable = 'plaintext-only';
        textEl.focus();
        const sel = window.getSelection();
        const r = document.createRange();
        r.selectNodeContents(textEl);
        r.collapse(false);
        sel?.removeAllRanges(); sel?.addRange(r);
        return true;
      },
      isEditing: () => editing,
      stopEditing: () => textEl.blur(),
      searchText: () => current.text ?? '',
    };
  },
};

// ── Sticky note ─────────────────────────────────────────────

export const stickyCard: CardType = {
  id: 'sticky',
  label: 'Sticky note',
  icon: 'sticky-note',
  defaultSize: { width: 220, height: 220 },
  create: ({ settings }) => ({ type: 'text', text: '', color: settings.defaultStickyColor, vc: { kind: 'sticky' } }),
  mount(node, el, ctx) {
    el.addClass('vc-sticky');
    return noteCard.mount(node, el, ctx);
  },
};

// ── Group ───────────────────────────────────────────────────

export const groupCard: CardType = {
  id: 'group',
  label: 'Group',
  icon: 'box-select',
  defaultSize: { width: 480, height: 320 },
  create: () => ({ type: 'group', label: t('Group') }),
  mount(node, el, ctx) {
    let current = node;
    el.addClass('vc-group');
    const label = el.createDiv('vc-group-label');
    let input: HTMLInputElement | null = null;
    const render = () => {
      applyCardColor(el.parentElement ?? el, current.color);
      if (!input) label.setText(current.label || '');
      label.toggleClass('is-empty', !current.label);
    };
    render();
    const finish = (save: boolean) => {
      if (!input) return;
      const inp = input;
      input = null; // before remove(): removing a focused element fires blur
      const value = inp.value.trim();
      inp.remove();
      label.show();
      if (save && value !== (current.label ?? '')) commitNode(ctx, current.id, n => { if (value) n.label = value; else delete n.label; });
      else render();
      ctx.board.editingEnded(current.id);
    };
    return {
      update(n) { current = n; render(); },
      destroy() { /* nothing */ },
      edit() {
        if (input) return true;
        label.hide();
        input = el.createEl('input', { cls: 'vc-group-label-input', type: 'text' });
        input.value = current.label ?? '';
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); finish(true); }
          if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        });
        input.addEventListener('blur', () => finish(true));
        input.focus();
        input.select();
        return true;
      },
      isEditing: () => !!input,
      stopEditing: () => finish(true),
      searchText: () => current.label ?? '',
    };
  },
};

// ── Files ───────────────────────────────────────────────────

function missingFile(el: HTMLElement, path: string | undefined): void {
  el.empty();
  const box = el.createDiv('vc-missing');
  setIcon(box.createDiv('vc-missing-icon'), 'file-x');
  box.createDiv({ cls: 'vc-missing-text', text: t('File not found') });
  if (path) box.createDiv({ cls: 'vc-missing-path', text: path });
}

function mediaCard(id: 'image' | 'video' | 'audio', icon: string, size: { width: number; height: number }): CardType {
  return {
    id, label: id === 'image' ? 'Image' : id === 'video' ? 'Video' : 'Audio', icon, defaultSize: size,
    mount(node, el, ctx) {
      let current = node;
      el.addClass('vc-media', `vc-${id}`);
      const render = () => {
        el.empty();
        const file = resolveFile(ctx.app, current);
        if (!file) { missingFile(el, current.file); return; }
        const src = ctx.app.vault.getResourcePath(file);
        if (id === 'image') {
          el.createEl('img', { attr: { src, draggable: 'false', alt: file.basename } });
        } else if (id === 'video') {
          el.createEl('video', { attr: { src, controls: '', preload: 'metadata' } });
        } else {
          const wrap = el.createDiv('vc-audio-wrap');
          wrap.createDiv({ cls: 'vc-audio-name', text: file.name });
          wrap.createEl('audio', { attr: { src, controls: '', preload: 'metadata' } });
        }
      };
      render();
      return {
        update(n) { const changed = n.file !== current.file; current = n; if (changed) render(); },
        destroy() { el.querySelectorAll('video,audio').forEach(m => (m as HTMLMediaElement).pause()); },
        searchText: () => current.file ?? '',
      };
    },
  };
}

export const imageCard = mediaCard('image', 'image', { width: 400, height: 300 });
export const videoCard = mediaCard('video', 'film', { width: 480, height: 270 });
export const audioCard = mediaCard('audio', 'music', { width: 360, height: 96 });

interface EmbedLike extends Component { loadFile?: (file: TFile, subpath?: string) => unknown; }

/** Markdown notes, PDFs, boards and other files. */
export const fileCard: CardType = {
  id: 'file',
  label: 'File',
  icon: 'file-text',
  defaultSize: { width: 400, height: 400 },
  mount(node, el, ctx) {
    let current = node;
    el.addClass('vc-file');
    let embed: EmbedLike | null = null;
    const render = () => {
      if (embed) { ctx.component.removeChild(embed); embed = null; }
      el.empty();
      const file = resolveFile(ctx.app, current);
      if (!file) { missingFile(el, current.file); return; }
      const header = el.createDiv('vc-file-header');
      setIcon(header.createSpan('vc-file-icon'), fileKindOf(file.path) === 'pdf' ? 'file-text' : 'file');
      const name = header.createSpan({ cls: 'vc-file-name', text: file.basename });
      name.addEventListener('click', (e) => {
        e.stopPropagation();
        void ctx.app.workspace.getLeaf(e.metaKey || e.ctrlKey ? 'tab' : false).openFile(file);
      });
      const host = el.createDiv('vc-file-embed');
      const kind = fileKindOf(file.path);
      if (kind === 'canvas' || kind === 'other') {
        host.addClass('is-plain');
        host.createDiv({ cls: 'vc-file-ext', text: file.extension.toUpperCase() });
        return;
      }
      // The core embed registry gives the same embeds notes use (Markdown, PDF).
      const registry = (ctx.app as unknown as { embedRegistry?: { embedByExtension?: Record<string, (c: unknown, f: TFile, s?: string) => EmbedLike> } }).embedRegistry;
      const make = registry?.embedByExtension?.[file.extension];
      if (make) {
        try {
          embed = make({ app: ctx.app, containerEl: host, sourcePath: ctx.sourcePath, linktext: file.path, depth: 1, displayMode: false, showInline: false }, file, current.subpath);
          ctx.component.addChild(embed);
          void embed.loadFile?.(file, current.subpath);
          return;
        } catch (err) {
          console.warn('Visual Canvas: embed failed, falling back', err);
          embed = null;
        }
      }
      if (kind === 'markdown') {
        void ctx.app.vault.cachedRead(file).then(md => renderMarkdown(ctx, md, host.createDiv('markdown-rendered'), ctx.component));
      }
    };
    render();
    return {
      update(n) { const changed = n.file !== current.file || n.subpath !== current.subpath; current = n; if (changed) render(); },
      destroy() { if (embed) ctx.component.removeChild(embed); },
      searchText: () => current.file ?? '',
    };
  },
};

// ── Link (web page) ─────────────────────────────────────────

export const linkCard: CardType = {
  id: 'link',
  label: 'Link',
  icon: 'link',
  defaultSize: { width: 400, height: 120 },
  mount(node, el) {
    let current = node;
    el.addClass('vc-link');
    const render = () => {
      el.empty();
      const url = current.url ?? '';
      let host = url;
      try { host = new URL(url).host; } catch { /* keep raw */ }
      const box = el.createDiv('vc-link-box');
      setIcon(box.createDiv('vc-link-icon'), 'globe');
      const text = box.createDiv('vc-link-text');
      text.createDiv({ cls: 'vc-link-host', text: host });
      const a = text.createEl('a', { cls: 'vc-link-url', text: url, href: url });
      a.addEventListener('click', (e) => { e.stopPropagation(); });
    };
    render();
    return {
      update(n) { current = n; render(); },
      destroy() { /* nothing */ },
      searchText: () => current.url ?? '',
    };
  },
};

// ── Anything not understood (yet): show its text so nothing looks lost ──

export const fallbackCardType: CardType = {
  id: 'unknown',
  label: 'Card',
  icon: 'square',
  defaultSize: { width: 300, height: 180 },
  mount(node, el, ctx) {
    let current = node;
    el.addClass('vc-fallback');
    const view = el.createDiv('vc-md markdown-rendered');
    const render = () => {
      applyCardColor(el.parentElement ?? el, current.color);
      void renderMarkdown(ctx, current.text ?? current.label ?? current.url ?? current.file ?? '', view, ctx.component);
    };
    render();
    return {
      update(n) { current = n; render(); },
      destroy() { /* nothing */ },
      searchText: () => current.text ?? '',
    };
  },
};

export const BASIC_CARDS: CardType[] = [noteCard, textCard, stickyCard, groupCard, imageCard, videoCard, audioCard, fileCard, linkCard];
