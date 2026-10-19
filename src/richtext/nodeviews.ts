import { Component, MarkdownRenderer, TFile, type App } from 'obsidian';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { isDone } from './schema';
import { fileKindOf } from '../cards/util';

export interface RichContext {
  app: App;
  sourcePath: string;
  component: Component;
  /** Whether the editor is in editing mode right now. */
  editing(): boolean;
  /** A change made while not editing (ticking a box) that should be saved now. */
  commitNow(): void;
}

/** A task item: a real checkbox that works in both modes. */
export class TaskItemView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private box: HTMLInputElement | null = null;

  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined, private ctx: RichContext) {
    this.dom = document.createElement('li');
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'vc-task-body';
    this.render();
  }

  private render(): void {
    const checked = this.node.attrs.checked as string | null;
    this.dom.className = checked === null ? '' : `vc-task${isDone(checked) ? ' is-checked' : ''}`;
    if (checked === null) {
      this.box?.remove();
      this.box = null;
      if (this.contentDOM.parentElement !== this.dom) this.dom.appendChild(this.contentDOM);
      return;
    }
    if (!this.box) {
      this.box = document.createElement('input');
      this.box.type = 'checkbox';
      this.box.className = 'task-list-item-checkbox vc-interactive';
      this.box.contentEditable = 'false';
      this.box.addEventListener('mousedown', e => e.preventDefault());
      this.box.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = this.getPos();
        if (pos === undefined) return;
        const next = isDone(this.node.attrs.checked) ? ' ' : 'x';
        this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, checked: next }));
        if (!this.ctx.editing()) this.ctx.commitNow();
      });
      this.dom.prepend(this.box);
    }
    this.box.checked = isDone(checked);
    if (this.contentDOM.parentElement !== this.dom) this.dom.appendChild(this.contentDOM);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  ignoreMutation(m: MutationRecord | { type: 'selection'; target: Node }): boolean {
    return m.type !== 'selection' && !!this.box && (m.target === this.box || this.box.contains(m.target as Node));
  }
}

/** Markdown the editor keeps but does not edit: shown as Obsidian renders it. */
export class RawBlockView implements NodeView {
  dom: HTMLElement;
  private child = new Component();

  constructor(private node: PMNode, private ctx: RichContext) {
    this.dom = document.createElement('div');
    this.dom.className = 'vc-raw-block';
    this.dom.contentEditable = 'false';
    ctx.component.addChild(this.child);
    this.render();
  }

  private render(): void {
    this.dom.empty();
    const inner = this.dom.createDiv('vc-raw-render');
    void MarkdownRenderer.render(this.ctx.app, this.node.attrs.source, inner, this.ctx.sourcePath, this.child);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    if (node.attrs.source !== this.node.attrs.source) { this.node = node; this.render(); }
    return true;
  }

  stopEvent(): boolean { return false; }
  ignoreMutation(): boolean { return true; }
  destroy(): void { this.ctx.component.removeChild(this.child); }
}

/** [[link]] chips and ![[image]] embeds. */
export class WikilinkView implements NodeView {
  dom: HTMLElement;

  constructor(private node: PMNode, private ctx: RichContext) {
    this.dom = document.createElement('span');
    this.render();
  }

  private render(): void {
    const { target, alias, embed } = this.node.attrs as { target: string; alias: string | null; embed: boolean };
    this.dom.empty();
    const path = target.split('#')[0].split('|')[0];
    const file = this.ctx.app.metadataCache.getFirstLinkpathDest(path, this.ctx.sourcePath);
    if (embed && file instanceof TFile && fileKindOf(file.path) === 'image') {
      this.dom.className = 'vc-embed-image';
      const img = this.dom.createEl('img', { attr: { src: this.ctx.app.vault.getResourcePath(file), alt: alias ?? file.basename, draggable: 'false' } });
      const width = /^\d+$/.test(alias ?? '') ? Number(alias) : null;
      if (width) img.style.width = `${width}px`;
      return;
    }
    this.dom.className = `vc-wikilink internal-link${file ? '' : ' is-unresolved'}${embed ? ' is-embed' : ''}`;
    this.dom.setAttr('data-href', target);
    this.dom.setText((embed ? '↳ ' : '') + (alias || target));
    this.dom.onclick = (e) => {
      if (this.ctx.editing() && !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      e.stopPropagation();
      void this.ctx.app.workspace.openLinkText(target, this.ctx.sourcePath, e.metaKey || e.ctrlKey);
    };
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  ignoreMutation(): boolean { return true; }
}
