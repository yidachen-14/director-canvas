import { Menu, Notice, requestUrl, setIcon } from 'obsidian';
import type { RawNode } from '../model/canvas-file';
import type { BarItem, CardContext, CardHandle, CardType } from './types';
import { applyCardColor, resolveFile, vcGet } from './util';
import { commitNode, missingFile } from './basic';
import { t } from '../i18n';

// ── image, video, audio ─────────────────────────────────────

type MediaKind = 'image' | 'video' | 'audio';

/** Height of a media card's description area (0 when it has none). */
export function descriptionHeight(el: HTMLElement | undefined): number {
  return el?.querySelector<HTMLElement>('.vc-media-desc')?.offsetHeight ?? 0;
}

class MediaCard implements CardHandle {
  private node: RawNode;
  private frame: HTMLElement;
  private desc: HTMLElement;
  private editor: HTMLTextAreaElement | null = null;
  private ro: ResizeObserver;
  private shownFile = '';

  constructor(private kind: MediaKind, node: RawNode, private el: HTMLElement, private ctx: CardContext) {
    this.node = node;
    el.addClass('vc-media', `vc-${kind}`);
    this.frame = el.createDiv('vc-media-frame');
    this.desc = el.createDiv('vc-media-desc');
    this.ro = new ResizeObserver(() => this.fitDescription());
    this.ro.observe(this.desc);
    this.render();
  }

  private descText(n = this.node): string { return vcGet(n, 'desc', '') as string; }

  private render(): void {
    const n = this.node;
    applyCardColor(this.el.closest<HTMLElement>('.vc-node') ?? this.el, n.color);
    if (this.shownFile !== (n.file ?? '')) {
      this.shownFile = n.file ?? '';
      this.frame.empty();
      const file = resolveFile(this.ctx.app, n);
      if (!file) missingFile(this.frame, n.file);
      else {
        const src = this.ctx.app.vault.getResourcePath(file);
        if (this.kind === 'image') {
          const img = this.frame.createEl('img', { attr: { src, draggable: 'false', alt: file.basename } });
          img.addEventListener('load', () => this.fitToMedia(img.naturalWidth, img.naturalHeight));
        } else if (this.kind === 'video') {
          const v = this.frame.createEl('video', { attr: { src, controls: '', preload: 'metadata' } });
          v.addEventListener('loadedmetadata', () => this.fitToMedia(v.videoWidth, v.videoHeight));
        }
        else {
          const wrap = this.frame.createDiv('vc-audio-wrap');
          wrap.createDiv({ cls: 'vc-audio-name', text: file.name });
          wrap.createEl('audio', { attr: { src, controls: '', preload: 'metadata' } });
        }
      }
    }
    if (!this.editor) {
      const text = this.descText();
      this.desc.setText(text);
      this.desc.toggle(!!text);
    }
  }

  /**
   * The description is part of the card: the card is always the picture's
   * height plus the description's. The description height already counted in
   * the card is kept in vc.descH, so this stays right across reloads.
   */
  private fitDescription(): void {
    const h = this.desc.isShown() ? Math.ceil(this.desc.offsetHeight) : 0;
    const n = this.ctx.board.model.node(this.node.id);
    if (!n || !this.el.isConnected) return;
    const counted = Number(n.vc?.descH) || 0;
    if (h === counted) return;
    n.height = Math.max(24, n.height - counted + h);
    n.vc = { ...(n.vc ?? {}) };
    if (h) n.vc.descH = h; else delete n.vc.descH;
    const card = this.el.closest<HTMLElement>('.vc-node');
    if (card) card.style.height = `${n.height}px`;
    this.ctx.board.renderEdges();
  }

  /**
   * A picture card always has the picture's own proportions (plus its
   * description), so nothing is letterboxed and the rounded corners sit on
   * the picture itself.
   */
  private fitToMedia(w: number, h: number): void {
    if (!w || !h) return;
    const m = this.ctx.board.model;
    const n = m.node(this.node.id);
    if (!n) return;
    const descH = Number(n.vc?.descH) || 0;
    const want = Math.round(n.width * h / w + descH);
    if (Math.abs(want - n.height) <= 1) return;
    m.quiet(() => { n.height = want; m.touch(n.id); });
  }

  update(n: RawNode): void {
    this.node = n;
    this.render();
    this.refit();
  }

  resized(n: RawNode): void { this.node = n; }

  /** Fit again to an already loaded picture (after an undo, a reload from disk, a width change). */
  private refit(): void {
    const img = this.frame.querySelector('img');
    if (img?.naturalWidth) { window.setTimeout(() => this.fitToMedia(img.naturalWidth, img.naturalHeight), 0); return; }
    const v = this.frame.querySelector('video');
    if (v?.videoWidth) window.setTimeout(() => this.fitToMedia(v.videoWidth, v.videoHeight), 0);
  }

  destroy(): void {
    this.ro.disconnect();
    this.el.querySelectorAll('video,audio').forEach(m => (m as HTMLMediaElement).pause());
  }

  /** Editing a picture means writing its description. */
  edit(): boolean {
    if (this.kind === 'audio') return false;
    if (this.editor) return true;
    this.desc.empty();
    this.desc.show();
    const ta = this.desc.createEl('textarea', { cls: 'vc-media-desc-input', attr: { rows: '1', placeholder: t('Add a description…') } });
    ta.value = this.descText();
    this.editor = ta;
    const grow = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); this.stopEditing(); }
    });
    ta.addEventListener('pointerdown', e => e.stopPropagation());
    ta.addEventListener('blur', () => this.stopEditing());
    grow();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    return true;
  }

  isEditing(): boolean { return !!this.editor; }

  stopEditing(): void {
    const ta = this.editor;
    if (!ta) return;
    this.editor = null;
    const value = ta.value.replace(/\s+$/, '');
    ta.remove();
    const before = this.descText();
    if (value !== before) {
      commitNode(this.ctx, this.node.id, (n) => {
        n.vc = { ...(n.vc ?? {}) };
        if (value) n.vc.desc = value; else delete n.vc.desc;
      });
    } else {
      this.render();
    }
    this.ctx.board.editingEnded(this.node.id);
  }

  searchText(): string { return `${this.node.file ?? ''} ${this.descText()}`; }

  barItems(): BarItem[] {
    const items: BarItem[] = [];
    if (this.kind !== 'audio') {
      items.push({ id: 'desc', icon: 'text', label: t(this.descText() ? 'Edit description' : 'Add description'), active: !!this.descText(), run: () => this.ctx.board.startEditing(this.node.id) });
    }
    const file = resolveFile(this.ctx.app, this.node);
    if (file) items.push({ id: 'open', icon: 'external-link', label: t('Open file'), run: () => void this.ctx.app.workspace.getLeaf('tab').openFile(file) });
    return items;
  }

  menu(menu: Menu): void {
    if (this.kind === 'audio') return;
    menu.addItem(i => i.setTitle(t(this.descText() ? 'Edit description' : 'Add description')).setIcon('text').setSection('edit')
      .onClick(() => this.ctx.board.startEditing(this.node.id)));
    if (this.descText()) {
      menu.addItem(i => i.setTitle(t('Remove description')).setIcon('x').setSection('edit')
        .onClick(() => commitNode(this.ctx, this.node.id, (n) => { n.vc = { ...(n.vc ?? {}) }; delete n.vc.desc; })));
    }
    const file = resolveFile(this.ctx.app, this.node);
    if (file) {
      menu.addItem(i => i.setTitle(t('Open file')).setIcon('external-link').setSection('open')
        .onClick(() => void this.ctx.app.workspace.getLeaf('tab').openFile(file)));
      menu.addItem(i => i.setTitle(t('Reveal in file explorer')).setIcon('folder-open').setSection('open')
        .onClick(() => {
          const explorer = (this.ctx.app as unknown as { internalPlugins?: { getPluginById?: (id: string) => { instance?: { revealInFolder?: (f: unknown) => void } } | null } }).internalPlugins?.getPluginById?.('file-explorer');
          explorer?.instance?.revealInFolder?.(file);
        }));
    }
  }
}

function mediaType(kind: MediaKind, icon: string, size: { width: number; height: number }): CardType {
  return {
    id: kind, label: kind === 'image' ? 'Image' : kind === 'video' ? 'Video' : 'Audio', icon, defaultSize: size,
    mount: (node, el, ctx) => new MediaCard(kind, node, el, ctx),
  };
}

export const imageCard = mediaType('image', 'image', { width: 400, height: 300 });
export const videoCard = mediaType('video', 'film', { width: 480, height: 270 });
export const audioCard = mediaType('audio', 'music', { width: 360, height: 96 });

// ── bookmark (web link with a preview) ──────────────────────

export interface LinkMeta { title?: string; description?: string; image?: string; icon?: string; site?: string; failed?: boolean; fetched?: number; }

/** Read title, description, picture and icon from a page's HTML. */
export function parseLinkMeta(html: string, pageUrl: string): LinkMeta {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = (...names: string[]) => {
    for (const name of names) {
      const el = doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
      const v = el?.getAttribute('content')?.trim();
      if (v) return v;
    }
    return undefined;
  };
  const abs = (u: string | undefined | null) => {
    if (!u) return undefined;
    try { return new URL(u, pageUrl).href; } catch { return undefined; }
  };
  const iconEl = doc.querySelector('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
  return {
    title: meta('og:title', 'twitter:title') ?? doc.querySelector('title')?.textContent?.trim() ?? undefined,
    description: meta('og:description', 'twitter:description', 'description'),
    image: abs(meta('og:image', 'og:image:url', 'twitter:image', 'twitter:image:src')),
    icon: abs(iconEl?.getAttribute('href')) ?? abs('/favicon.ico'),
    site: meta('og:site_name', 'application-name'),
  };
}

const inflight = new Set<string>();

async function fetchMeta(ctx: CardContext, id: string, url: string): Promise<void> {
  if (inflight.has(id)) return;
  inflight.add(id);
  let meta: LinkMeta;
  try {
    const res = await requestUrl({ url, method: 'GET', throw: false, headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' } });
    meta = res.status < 400 ? parseLinkMeta(res.text, url) : { failed: true };
  } catch {
    meta = { failed: true };
  } finally {
    inflight.delete(id);
  }
  meta.fetched = Date.now();
  const m = ctx.board.model;
  const n = m.node(id);
  if (!n || n.url !== url) return;
  m.quiet(() => {
    n.vc = { ...(n.vc ?? {}), meta };
    // A preview with a picture needs room for it.
    if (meta.image && n.height < 200 && vcGet<string>(n, 'kind', '') === 'bookmark') n.height = 300;
    m.touch(id);
  });
}

class BookmarkCard implements CardHandle {
  private node: RawNode;
  private input: HTMLInputElement | null = null;

  constructor(node: RawNode, private el: HTMLElement, private ctx: CardContext) {
    this.node = node;
    el.addClass('vc-bookmark');
    this.render();
  }

  private meta(): LinkMeta { return (vcGet(this.node, 'meta', null) as LinkMeta | null) ?? {}; }

  private render(): void {
    const n = this.node;
    this.el.empty();
    applyCardColor(this.el.closest<HTMLElement>('.vc-node') ?? this.el, n.color);
    const url = n.url ?? '';
    if (!url) { this.askUrl(); return; }
    let host = url;
    try { host = new URL(url).host.replace(/^www\./, ''); } catch { /* keep raw */ }
    const meta = this.meta();
    if (!meta.fetched) void fetchMeta(this.ctx, n.id, url);

    const box = this.el.createDiv('vc-bookmark-box');
    if (meta.image) {
      const pic = box.createDiv('vc-bookmark-image');
      const img = pic.createEl('img', { attr: { src: meta.image, draggable: 'false', referrerpolicy: 'no-referrer' } });
      img.addEventListener('error', () => pic.remove());
    }
    const body = box.createDiv('vc-bookmark-body');
    const title = body.createEl('a', { cls: 'vc-bookmark-title', text: meta.title || host, href: url });
    title.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); window.open(url); });
    if (meta.description) body.createDiv({ cls: 'vc-bookmark-desc', text: meta.description });
    else if (!meta.fetched) body.createDiv({ cls: 'vc-bookmark-desc is-loading', text: t('Loading preview…') });
    else if (meta.failed) body.createDiv({ cls: 'vc-bookmark-desc', text: t('No preview available for this page.') });
    const foot = body.createDiv('vc-bookmark-foot');
    if (meta.icon) {
      const ic = foot.createEl('img', { cls: 'vc-bookmark-icon', attr: { src: meta.icon, referrerpolicy: 'no-referrer' } });
      ic.addEventListener('error', () => { ic.remove(); setIcon(foot.createSpan({ cls: 'vc-bookmark-icon-fallback' }), 'globe'); });
    } else {
      setIcon(foot.createSpan({ cls: 'vc-bookmark-icon-fallback' }), 'globe');
    }
    foot.createSpan({ cls: 'vc-bookmark-host', text: meta.site ? `${meta.site} · ${host}` : host });
  }

  /** An empty bookmark asks for its address. */
  private askUrl(): void {
    const box = this.el.createDiv('vc-bookmark-ask');
    setIcon(box.createDiv('vc-bookmark-ask-icon'), 'link');
    const input = box.createEl('input', { type: 'url', placeholder: t('Paste a web address and press Enter') });
    this.input = input;
    input.addEventListener('pointerdown', e => e.stopPropagation());
    input.addEventListener('dblclick', e => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.setUrl(input.value); }
      if (e.key === 'Escape') { e.preventDefault(); input.blur(); }
    });
    window.setTimeout(() => { if (this.ctx.board.selection.has(this.node.id)) input.focus(); }, 30);
  }

  private setUrl(raw: string): void {
    let url = raw.trim();
    if (!url) return;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
    try { new URL(url); } catch { new Notice(t('That does not look like a web address.')); return; }
    this.input = null;
    commitNode(this.ctx, this.node.id, (n) => {
      n.url = url;
      n.vc = { ...(n.vc ?? {}) };
      delete n.vc.meta;
    });
  }

  update(n: RawNode): void { this.node = n; this.render(); }
  destroy(): void { /* nothing */ }
  edit(): boolean {
    if (!this.node.url) { this.input?.focus(); return true; }
    return false;
  }
  searchText(): string { const m = this.meta(); return `${this.node.url ?? ''} ${m.title ?? ''} ${m.description ?? ''}`; }

  barItems(): BarItem[] {
    const url = this.node.url;
    if (!url) return [];
    return [
      { id: 'open', icon: 'external-link', label: t('Open in browser'), run: () => window.open(url) },
      { id: 'copy', icon: 'link', label: t('Copy address'), run: () => { void navigator.clipboard.writeText(url); new Notice(t('Copied.')); } },
      {
        id: 'refresh', icon: 'refresh-cw', label: t('Refresh preview'),
        run: () => this.ctx.board.model.quiet(() => { const n = this.ctx.board.model.node(this.node.id); if (n) { n.vc = { ...(n.vc ?? {}) }; delete n.vc.meta; this.ctx.board.model.touch(n.id); } }),
      },
    ];
  }

  menu(menu: Menu): void {
    const url = this.node.url;
    if (!url) return;
    menu.addItem(i => i.setTitle(t('Open in browser')).setIcon('external-link').setSection('open').onClick(() => window.open(url)));
    menu.addItem(i => i.setTitle(t('Copy address')).setIcon('copy').setSection('open').onClick(() => { void navigator.clipboard.writeText(url); new Notice(t('Copied.')); }));
    menu.addItem(i => i.setTitle(t('Refresh preview')).setIcon('refresh-cw').setSection('open').onClick(() => {
      this.ctx.board.model.quiet(() => { const n = this.ctx.board.model.node(this.node.id); if (n) { n.vc = { ...(n.vc ?? {}) }; delete n.vc.meta; this.ctx.board.model.touch(n.id); } });
    }));
    menu.addItem(i => i.setTitle(t('Change address')).setIcon('pencil').setSection('open').onClick(() => {
      commitNode(this.ctx, this.node.id, (n) => { n.url = ''; n.vc = { ...(n.vc ?? {}) }; delete n.vc.meta; });
    }));
  }
}

export const bookmarkCard: CardType = {
  id: 'bookmark',
  label: 'Bookmark',
  icon: 'bookmark',
  defaultSize: { width: 320, height: 120 },
  create: () => ({ type: 'link', url: '', vc: { kind: 'bookmark' } }),
  mount: (node, el, ctx) => new BookmarkCard(node, el, ctx),
};

/** Links from the core Canvas show as bookmarks too. */
export const linkCard: CardType = { ...bookmarkCard, id: 'link', label: 'Link', create: undefined };

export const MEDIA_CARDS: CardType[] = [imageCard, videoCard, audioCard, bookmarkCard, linkCard];
