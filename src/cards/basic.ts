import { Component, MarkdownRenderer, TFile, setIcon } from 'obsidian';
import type { RawNode } from '../model/canvas-file';
import type { CardContext, CardHandle, CardType } from './types';
import { applyCardColor, fileKindOf, resolveFile } from './util';
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
      barItems: () => [{ id: 'rename', icon: 'pencil', label: t('Rename'), text: current.label || '', run: () => ctx.board.startEditing(current.id) }],
    };
  },
};

// ── Files ───────────────────────────────────────────────────

export function missingFile(el: HTMLElement, path: string | undefined): void {
  el.empty();
  const box = el.createDiv('vc-missing');
  setIcon(box.createDiv('vc-missing-icon'), 'file-x');
  box.createDiv({ cls: 'vc-missing-text', text: t('File not found') });
  if (path) box.createDiv({ cls: 'vc-missing-path', text: path });
}

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

/** A column: a group that stacks the cards dropped into it (layout in board/columns.ts). */
export const columnCard: CardType = {
  id: 'column',
  label: 'Column',
  icon: 'rows-3',
  defaultSize: { width: 300, height: 360 },
  create: () => ({ type: 'group', label: t('Column'), vc: { kind: 'column' } }),
  mount(node, el, ctx) {
    const handle = groupCard.mount(node, el, ctx);
    el.addClass('vc-column');
    return handle;
  },
};

export const BASIC_CARDS: CardType[] = [groupCard, columnCard, fileCard];
