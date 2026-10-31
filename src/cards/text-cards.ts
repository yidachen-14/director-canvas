import { Menu, setIcon, type MenuItem } from 'obsidian';
import type { RawNode } from '../model/canvas-file';
import type { BarItem, CardContext, CardHandle, CardType } from './types';
import { barRow } from './bar';
import { applyCardColor, vcGet } from './util';
import { commitNode } from './basic';
import { RichText } from '../richtext/editor';
import { attachBlockHandles } from '../richtext/block-drag';
import { alignDoc } from '../richtext/commands';
import type { Align } from '../richtext/schema';
import type { TextCardKind, VisualCanvasSettings } from '../settings';
import { t } from '../i18n';

// ── callout text ↔ inner Markdown ─────────────────────────────

export const CALLOUT_TYPES: { id: string; label: string; icon: string }[] = [
  { id: 'note', label: 'Note', icon: 'pencil' },
  { id: 'info', label: 'Info', icon: 'info' },
  { id: 'tip', label: 'Tip', icon: 'lightbulb' },
  { id: 'success', label: 'Success', icon: 'check' },
  { id: 'question', label: 'Question', icon: 'help-circle' },
  { id: 'warning', label: 'Warning', icon: 'alert-triangle' },
  { id: 'danger', label: 'Danger', icon: 'zap' },
  { id: 'bug', label: 'Bug', icon: 'bug' },
  { id: 'example', label: 'Example', icon: 'list' },
  { id: 'quote', label: 'Quote', icon: 'quote' },
];

/** "> [!tip] Title\n> body" → { type, title, body }. */
export function splitCallout(text: string): { type: string; title: string; body: string } {
  const lines = (text ?? '').split('\n');
  const m = /^>\s*\[!([\w-]+)\][+-]?\s*(.*)$/.exec(lines[0] ?? '');
  if (!m) return { type: 'note', title: '', body: text ?? '' };
  const body = lines.slice(1).map(l => l.replace(/^>\s?/, '')).join('\n');
  return { type: m[1].toLowerCase(), title: m[2], body };
}

export function joinCallout(type: string, title: string, body: string): string {
  const head = `> [!${type}]${title ? ' ' + title : ''}`;
  const rest = body ? body.split('\n').map(l => (l ? `> ${l}` : '>')).join('\n') : '';
  return rest ? `${head}\n${rest}` : head;
}

// ── shared behaviour ──────────────────────────────────────────

interface Flavor {
  id: TextCardKind | 'checklist';
  label: string;
  icon: string;
  defaultSize: { width: number; height: number };
  /** Size of a new card from the settings, when the user can choose it. */
  sizeFor?(settings: VisualCanvasSettings): { width: number; height: number };
  create(settings: VisualCanvasSettings): Partial<RawNode>;
  /** The box always fits the text, in both directions (Text). */
  autoSize?: boolean;
  /** Delete the card when it is left empty. */
  dropWhenEmpty?: boolean;
  /** No card colour (callouts take their colour from their type). */
  noColor?: boolean;
  placeholder: string;
}

/** Text for a new card of `kind` holding `markdown` (a dragged-out block, pasted text). */
export function textCardData(kind: string, markdown: string, settings: VisualCanvasSettings): Partial<RawNode> {
  switch (kind) {
    case 'text': return { type: 'text', text: markdown, vc: { kind: 'text', fontSize: settings.defaultTextSize } };
    case 'sticky': return { type: 'text', text: markdown, color: settings.defaultStickyColor, vc: { kind: 'sticky' } };
    case 'callout': return { type: 'text', text: joinCallout('tip', '', markdown), vc: { kind: 'callout' } };
    default: return { type: 'text', text: markdown };
  }
}

/** A sensible card size for some Markdown. */
export function textCardSize(kind: string, markdown: string): { width: number; height: number } {
  const lines = markdown.replace(/<[^>]+>/g, '').replace(/[*_=~`#>]/g, '').split('\n');
  const longest = Math.max(0, ...lines.map(l => [...l].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)));
  const width = Math.min(560, Math.max(kind === 'text' ? 160 : 260, Math.min(longest, 64) * 8.5 + 48));
  const perLine = Math.max(1, Math.floor((width - 40) / 8.5));
  const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil([...l].length * 1.6 / perLine)), 0);
  const height = Math.min(kind === 'text' ? 2000 : 640, Math.max(kind === 'text' ? 36 : 100, rows * 26 + 36));
  return { width: Math.round(width), height: Math.round(height) };
}

function richCard(f: Flavor): CardType {
  return {
    id: f.id,
    label: f.label,
    icon: f.icon,
    defaultSize: f.defaultSize,
    sizeFor: f.sizeFor ? (settings) => f.sizeFor!(settings) : undefined,
    noColor: f.noColor,
    create: ({ settings }) => f.create(settings),
    mount(node, el, ctx) {
      return new RichCard(f, node, el, ctx);
    },
  };
}

class RichCard implements CardHandle {
  private rich: RichText;
  private host: HTMLElement;
  private calloutHead: HTMLElement | null = null;
  private detachHandles: () => void;
  private stopObserving: (() => void) | null = null;

  constructor(private f: Flavor, private node: RawNode, private el: HTMLElement, private ctx: CardContext) {
    el.addClass('vc-richcard', `vc-rc-${f.id}`);
    let body = el;
    if (f.id === 'callout') {
      // Obsidian's own callout styling: .callout[data-callout=type]
      const box = el.createDiv('callout vc-callout');
      this.calloutHead = box.createDiv('callout-title');
      body = box.createDiv('callout-content');
    }
    this.host = body.createDiv('vc-rich-host');
    this.rich = new RichText(this.host, {
      app: ctx.app,
      sourcePath: ctx.sourcePath,
      component: ctx.component,
      markdown: this.editableText(node),
      placeholder: t(f.placeholder),
      bounds: () => ctx.board.root.getBoundingClientRect(),
      onCommit: (md) => this.store(md),
      onEditEnd: () => this.editEnded(),
      onResize: () => this.fit(),
    });
    if (f.autoSize) {
      const ro = new ResizeObserver(() => this.fit());
      ro.observe(this.host);
      this.stopObserving = () => ro.disconnect();
    }
    this.detachHandles = attachBlockHandles(this.rich, el, {
      batch: (fn) => ctx.board.model.transact(fn),
      overlay: () => ctx.board.overlayEl,
      dropOnBoard: (x, y, md) => this.dropOnBoard(x, y, md),
      // Only on the card you are working on, so they don't get in the way elsewhere (columns, other cards).
      active: () => this.rich.editing || (ctx.board.selection.size === 1 && ctx.board.selection.has(this.node.id)),
    });
    this.render();
  }

  // ── data ──────────────────────────────────────────────────

  private editableText(n: RawNode): string {
    return this.f.id === 'callout' ? splitCallout(n.text ?? '').body : (n.text ?? '');
  }

  private store(md: string): void {
    const { ctx, f } = this;
    commitNode(ctx, this.node.id, (n) => {
      if (f.id === 'callout') {
        const c = splitCallout(n.text ?? '');
        n.text = joinCallout(vcGet(n, 'calloutType', c.type), c.title, md);
      } else {
        n.text = md;
      }
      const sz = f.autoSize ? this.contentSize() : null;
      if (sz) { n.width = sz.width; n.height = sz.height; }
    });
    // Its text dragged out to elsewhere: an empty Text card is not kept.
    if (f.dropWhenEmpty && !this.rich.editing && !md.trim()) {
      const m = ctx.board.model;
      if (m.node(this.node.id)) m.transact(() => m.removeNodes([this.node.id]), ctx.board.mergeKeyFor(this.node.id));
    }
  }

  private editEnded(): void {
    const { ctx, f } = this;
    ctx.board.editingEnded(this.node.id);
    if (f.dropWhenEmpty && this.rich.isEmpty()) {
      const m = ctx.board.model;
      if (m.node(this.node.id)) m.transact(() => m.removeNodes([this.node.id]), ctx.board.mergeKeyFor(this.node.id));
    }
  }

  /**
   * Natural size of the text (the host is laid out at max-content), or null while it is not
   * laid out at all (a board in a background tab): measuring then gives 0, never the real size.
   */
  private contentSize(): { width: number; height: number } | null {
    if (!this.host.isConnected || !this.host.getClientRects().length) return null;
    return { width: Math.max(16, Math.ceil(this.host.offsetWidth)), height: Math.max(16, Math.ceil(this.host.offsetHeight)) };
  }

  /** Text cards: the box follows the text in both directions. */
  private fit(): void {
    if (!this.f.autoSize) return;
    const sz = this.contentSize();
    const m = this.ctx.board.model;
    const n = m.node(this.node.id);
    if (!sz || !n || (Math.abs(sz.width - n.width) < 1 && Math.abs(sz.height - n.height) < 1)) return;
    // Saved, but not an undo step: the size only follows the text (and repairs a wrong size on file).
    m.quiet(() => { n.width = sz.width; n.height = sz.height; m.touch(n.id); });
  }

  private render(): void {
    const n = this.node;
    const card = this.el.parentElement ?? this.el;
    applyCardColor(card, n.color);
    if (this.f.id === 'text') this.host.style.fontSize = `${vcGet(n, 'fontSize', this.ctx.board.settings.defaultTextSize)}px`;
    if (this.f.id === 'callout' && this.calloutHead) {
      const c = splitCallout(n.text ?? '');
      const type = vcGet(n, 'calloutType', c.type);
      const def = CALLOUT_TYPES.find(x => x.id === type) ?? CALLOUT_TYPES[0];
      const box = this.calloutHead.parentElement!;
      box.setAttr('data-callout', type);
      this.calloutHead.empty();
      setIcon(this.calloutHead.createDiv('callout-icon'), def.icon);
      this.calloutHead.createDiv({ cls: 'callout-title-inner', text: c.title || t(def.label) });
    }
  }

  // ── CardHandle ────────────────────────────────────────────

  update(n: RawNode): void {
    this.node = n;
    this.render();
    this.rich.setMarkdown(this.editableText(n));
  }

  resized(): void { /* layout follows CSS */ }

  measure(): { width: number; height: number } | undefined {
    if (!this.f.autoSize) return undefined;
    // The host carries the font size; make sure it has the latest one before measuring.
    this.host.style.fontSize = `${vcGet(this.node, 'fontSize', this.ctx.board.settings.defaultTextSize)}px`;
    return this.contentSize() ?? undefined;
  }

  fitHeight(): number | undefined {
    const rich = this.host.querySelector<HTMLElement>('.vc-rich');
    const card = this.el.closest<HTMLElement>('.vc-node');
    if (this.f.autoSize || !rich || !card) return undefined;
    // The text fills at least the card (min-height); lift that to read its own height.
    rich.addClass('is-measuring');
    const textH = rich.offsetHeight;
    rich.removeClass('is-measuring');
    // Whatever surrounds the text (callout title, borders) stays as it is.
    return Math.ceil(card.offsetHeight - this.host.clientHeight + textH);
  }

  destroy(): void {
    this.stopObserving?.();
    this.detachHandles();
    this.rich.destroy();
  }

  edit(at?: { clientX: number; clientY: number }): boolean {
    this.rich.startEditing(at);
    return true;
  }

  isEditing(): boolean { return this.rich.editing; }

  stopEditing(): void { this.rich.stopEditing(); }

  searchText(): string { return this.rich.plainText(); }

  contentMarkdown(): string { return this.rich.markdown(); }

  barItems(): BarItem[] {
    const { ctx, f } = this;
    const items: BarItem[] = [];
    const kinds: [TextCardKind, string, string][] = [
      ['text', 'Text', 'type'], ['note', 'Note', 'file-text'], ['sticky', 'Sticky note', 'sticky-note'], ['callout', 'Callout', 'lightbulb'],
    ];
    const cur = kinds.find(k => k[0] === f.id) ?? kinds[1];
    items.push({
      id: 'kind', icon: cur[2], label: t('Turn into'), text: t(cur[1]),
      dropdown: (pop, close) => {
        pop.addClass('is-list');
        for (const [kind, label, icon] of kinds) {
          barRow(pop, icon, t(label), kind === f.id, () => { close(); if (kind !== f.id) convertTextCard(ctx, this.node.id, kind, this.rich.markdown()); });
        }
      },
    });
    if (f.id === 'callout') {
      const c = splitCallout(this.node.text ?? '');
      const type = vcGet(this.node, 'calloutType', c.type);
      const def = CALLOUT_TYPES.find(x => x.id === type) ?? CALLOUT_TYPES[0];
      items.push({
        id: 'callout', icon: def.icon, label: t('Callout type'),
        dropdown: (pop, close) => {
          pop.addClass('is-list');
          for (const d of CALLOUT_TYPES) {
            barRow(pop, d.icon, t(d.label), d.id === type, () => {
              close();
              commitNode(ctx, this.node.id, (n) => {
                const cc = splitCallout(n.text ?? '');
                n.vc = { ...(n.vc ?? {}), calloutType: d.id };
                n.text = joinCallout(d.id, cc.title, cc.body);
              });
            });
          }
        },
      });
    }
    if (f.id === 'text') {
      const size = vcGet(this.node, 'fontSize', ctx.board.settings.defaultTextSize);
      items.push({
        id: 'size', icon: 'a-large-small', label: t('Font size'), text: String(Math.round(size)),
        dropdown: (pop, close) => {
          pop.addClass('is-list', 'is-short');
          for (const v of [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80, 96, 128]) {
            barRow(pop, null, `${v}`, v === size, () => { close(); commitNode(ctx, this.node.id, (n) => { n.vc = { ...(n.vc ?? {}), fontSize: v }; }); });
          }
        },
      });
    }
    const align = this.rich.alignment();
    const alignIcon = align === 'center' ? 'align-center' : align === 'right' ? 'align-right' : 'align-left';
    items.push({
      id: 'align', icon: alignIcon, label: t('Align'),
      dropdown: (pop, close) => {
        pop.addClass('is-list');
        for (const [a, label, icon] of [['left', 'Align left', 'align-left'], ['center', 'Align centre', 'align-center'], ['right', 'Align right', 'align-right']] as [Align, string, string][]) {
          barRow(pop, icon, t(label), a === align, () => { close(); this.rich.applyAndCommit(st => alignDoc(st, a)); });
        }
      },
    });
    // To-dos are in the text formatting bar (select some text), not here.
    return items;
  }

  menu(menu: Menu): void {
    const { ctx, f } = this;
    const sub = (title: string, icon: string, build: (m: Menu) => void) => {
      let s: Menu | null = null;
      menu.addItem(i => { i.setTitle(title).setIcon(icon).setSection('style'); s = (i as MenuItem & { setSubmenu?: () => Menu }).setSubmenu?.() ?? null; });
      build(s ?? menu);
    };
    sub(t('Align'), 'align-left', (m) => {
      for (const [a, label] of [['left', 'Align left'], ['center', 'Align centre'], ['right', 'Align right']] as [Align, string][]) {
        m.addItem(i => i.setTitle(t(label)).onClick(() => this.rich.applyAndCommit(s => alignDoc(s, a))));
      }
    });
    if (f.id === 'text') {
      const cur = vcGet(this.node, 'fontSize', ctx.board.settings.defaultTextSize);
      sub(t('Font size'), 'a-large-small', (m) => {
        for (const size of [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80]) {
          m.addItem(i => i.setTitle(`${size}`).setChecked(size === cur).onClick(() => commitNode(ctx, this.node.id, (n) => {
            n.vc = { ...(n.vc ?? {}), fontSize: size };
          })));
        }
      });
    }
    if (f.id === 'callout') {
      const c = splitCallout(this.node.text ?? '');
      const cur = vcGet(this.node, 'calloutType', c.type);
      sub(t('Callout type'), 'info', (m) => {
        for (const def of CALLOUT_TYPES) {
          m.addItem(i => i.setTitle(t(def.label)).setChecked(def.id === cur).onClick(() => commitNode(ctx, this.node.id, (n) => {
            const cc = splitCallout(n.text ?? '');
            n.vc = { ...(n.vc ?? {}), calloutType: def.id };
            n.text = joinCallout(def.id, cc.title, cc.body);
          })));
        }
      });
    }
    sub(t('Turn into'), 'repeat', (m) => {
      for (const kind of ['text', 'note', 'sticky', 'callout'] as TextCardKind[]) {
        if (kind === f.id) continue;
        const label = { text: 'Text', note: 'Note', sticky: 'Sticky note', callout: 'Callout' }[kind];
        m.addItem(i => i.setTitle(t(label)).onClick(() => convertTextCard(ctx, this.node.id, kind, this.rich.markdown())));
      }
    });
  }

  /** A block dragged out of this card onto empty board. */
  private dropOnBoard(x: number, y: number, md: string): boolean {
    const board = this.ctx.board;
    const r = board.root.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
    const kind = board.settings.dragOutKind;
    const size = textCardSize(kind, md);
    const w = board.clientToWorld(x, y);
    board.createCard(kind, { x: w.x + size.width / 2 - 12, y: w.y + size.height / 2 - 12 }, { data: textCardData(kind, md, board.settings), size });
    return true;
  }
}

/** Change a text card's kind, keeping its content. */
export function convertTextCard(ctx: CardContext, id: string, kind: TextCardKind, markdown: string): void {
  const s = ctx.board.settings;
  commitNode(ctx, id, (n) => {
    const data = textCardData(kind, markdown, s);
    n.text = data.text;
    const keep = { ...(n.vc ?? {}) };
    delete keep.kind; delete keep.calloutType; delete keep.fontSize;
    n.vc = { ...keep, ...(data.vc ?? {}) };
    if (!data.vc?.kind) delete n.vc.kind;
    if (Object.keys(n.vc).length === 0) delete n.vc;
    if (kind === 'sticky') n.color = s.defaultStickyColor;
    else if (n.color === s.defaultStickyColor) delete n.color;
  });
}

// ── the flavours ──────────────────────────────────────────────

export const textCard = richCard({
  id: 'text', label: 'Text', icon: 'type', placeholder: 'Type something…',
  defaultSize: { width: 140, height: 32 },
  create: (s) => ({ type: 'text', text: '', vc: { kind: 'text', fontSize: s.defaultTextSize } }),
  autoSize: true, dropWhenEmpty: true,
});

export const noteCard = richCard({
  id: 'note', label: 'Note', icon: 'file-text', placeholder: 'Type "/" for blocks…',
  defaultSize: { width: 320, height: 200 },
  sizeFor: s => s.noteSize,
  create: () => ({ type: 'text', text: '' }),
});

export const stickyCard = richCard({
  id: 'sticky', label: 'Sticky note', icon: 'sticky-note', placeholder: 'Write a note…',
  defaultSize: { width: 220, height: 220 },
  sizeFor: s => s.stickySize,
  create: (s) => ({ type: 'text', text: '', color: s.defaultStickyColor, vc: { kind: 'sticky' } }),
});

export const calloutCard = richCard({
  id: 'callout', label: 'Callout', icon: 'lightbulb', placeholder: 'Write…',
  defaultSize: { width: 340, height: 140 },
  sizeFor: s => s.calloutSize,
  noColor: true,
  create: () => ({ type: 'text', text: '> [!tip]', vc: { kind: 'callout' } }),
});

export const checklistCard = richCard({
  id: 'checklist', label: 'Checklist', icon: 'list-checks', placeholder: 'To do…',
  defaultSize: { width: 280, height: 200 },
  create: () => ({ type: 'text', text: '- [ ] ', vc: { kind: 'checklist' } }),
});

export const TEXT_CARDS: CardType[] = [textCard, noteCard, stickyCard, calloutCard, checklistCard];
