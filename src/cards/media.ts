import { Menu, Modal, Notice, Setting, requestUrl, setIcon, setTooltip, type App } from 'obsidian';
import type { RawNode } from '../model/canvas-file';
import type { BarItem, CardContext, CardHandle, CardType } from './types';
import { applyCardColor, resolveFile, vcGet } from './util';
import { commitNode, missingFile } from './basic';
import { t } from '../i18n';
import { RichText } from '../richtext/editor';
import { VideoPlayer } from './video-player';
import { MediaInfoModal } from './media-info';

// ── image, video, audio ─────────────────────────────────────

type MediaKind = 'image' | 'video' | 'audio';

/** Height of what a media card adds to the picture: the link bar above and the description below. */
export function descriptionHeight(el: HTMLElement | undefined): number {
  if (!el) return 0;
  const h = (sel: string) => { const x = el.querySelector<HTMLElement>(sel); return x && x.isShown() ? x.offsetHeight : 0; };
  return h('.vc-media-link') + h('.vc-media-desc');
}

/**
 * Open a web address the way Obsidian is set up: in its Web viewer when that core plugin
 * is on and set to open external links, otherwise in the default browser.
 */
export function openUrl(app: App, url: string): void {
  type WV = { enabled?: boolean; instance?: { options?: { openExternalURLs?: boolean } } };
  const wv = (app as unknown as { internalPlugins?: { getPluginById?: (id: string) => WV | null } }).internalPlugins?.getPluginById?.('webviewer');
  if (wv?.enabled && wv.instance?.options?.openExternalURLs) {
    void app.workspace.getLeaf('tab').setViewState({ type: 'webviewer', active: true, state: { url, navigate: true } });
    return;
  }
  window.open(url);
}

/** Ask for a web address (empty = remove the link). */
class LinkModal extends Modal {
  constructor(app: App, private value: string, private done: (url: string | null) => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText(this.value ? t('Edit link') : t('Insert link'));
    let v = this.value;
    let input: HTMLInputElement | null = null;
    new Setting(this.contentEl).setName(t('Address')).addText(tx => {
      input = tx.inputEl;
      tx.inputEl.addClass('vc-link-input');
      tx.setPlaceholder('example.com').setValue(v).onChange(x => { v = x; });
      tx.inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); this.finish(v); } });
    });
    const buttons = new Setting(this.contentEl);
    if (this.value) buttons.addButton(b => b.setButtonText(t('Remove link')).setWarning().onClick(() => this.finish('')));
    buttons.addButton(b => b.setButtonText(t('Cancel')).onClick(() => this.close()))
      .addButton(b => b.setButtonText(t('Save')).setCta().onClick(() => this.finish(v)));
    window.setTimeout(() => { input?.focus(); input?.select(); }, 0);
  }
  private finish(v: string): void {
    let url = v.trim();
    if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
    this.close();
    this.done(url);
  }
  onClose(): void { this.contentEl.empty(); }
}

class MediaCard implements CardHandle {
  private node: RawNode;
  private frame: HTMLElement;
  private desc: HTMLElement;
  private linkBar: HTMLElement;
  /** The description: rich text like the text cards, with the same formatting bar while editing. */
  private descRich: RichText | null = null;
  private ro: ResizeObserver;
  private shownFile = '';
  private player: VideoPlayer | null = null;

  constructor(private kind: MediaKind, node: RawNode, private el: HTMLElement, private ctx: CardContext) {
    this.node = node;
    el.addClass('vc-media', `vc-${kind}`);
    this.linkBar = el.createDiv('vc-media-link');
    this.frame = el.createDiv('vc-media-frame');
    this.desc = el.createDiv('vc-media-desc');
    if (kind !== 'audio') {
      this.descRich = new RichText(this.desc, {
        app: ctx.app,
        sourcePath: ctx.sourcePath,
        component: ctx.component,
        markdown: this.descText(node),
        placeholder: t('Add a description…'),
        bounds: () => ctx.board.root.getBoundingClientRect(),
        onCommit: (md) => {
          const value = md.replace(/\s+$/, '');
          commitNode(this.ctx, this.node.id, (n) => {
            n.vc = { ...(n.vc ?? {}) };
            if (value) n.vc.desc = value; else delete n.vc.desc;
          });
        },
        onEditEnd: () => { this.render(); this.ctx.board.editingEnded(this.node.id); },
        onResize: () => this.fitDescription(),
      });
    }
    this.ro = new ResizeObserver(() => this.fitDescription());
    this.ro.observe(this.desc);
    this.ro.observe(this.linkBar);
    this.render();
  }

  private descText(n = this.node): string { return vcGet(n, 'desc', ''); }

  private render(): void {
    const n = this.node;
    applyCardColor(this.el.closest<HTMLElement>('.vc-node') ?? this.el, n.color);
    if (this.shownFile !== (n.file ?? '')) {
      this.shownFile = n.file ?? '';
      this.player?.destroy();
      this.player = null;
      this.frame.empty();
      const file = resolveFile(this.ctx.app, n);
      if (!file) missingFile(this.frame, n.file);
      else {
        const src = this.ctx.app.vault.getResourcePath(file);
        if (this.kind === 'image') {
          const img = this.frame.createEl('img', { attr: { src, draggable: 'false', alt: file.basename } });
          img.addEventListener('load', () => this.fitToMedia(img.naturalWidth, img.naturalHeight));
        } else if (this.kind === 'video') {
          this.player = new VideoPlayer(this.frame, src, this.ctx, n, (w, h) => this.fitToMedia(w, h));
        }
        else {
          const wrap = this.frame.createDiv('vc-audio-wrap');
          wrap.createDiv({ cls: 'vc-audio-name', text: file.name });
          wrap.createEl('audio', { attr: { src, controls: '', preload: 'metadata' } });
        }
      }
    }
    const editing = !!this.descRich?.editing;
    if (!editing) {
      const text = this.descText();
      this.descRich?.setMarkdown(text);
      this.desc.toggle(!!text);
    }
    this.renderLink();
    const card = this.el.closest<HTMLElement>('.vc-node');
    card?.toggleClass('has-media-frame', this.hasFrame());
    card?.toggleClass('has-media-extras', !!this.linkText() || !!this.descText() || editing);
  }

  private linkText(n = this.node): string { return vcGet(n, 'link', ''); }

  /** The frame around the whole card: on when chosen, or by default when the card has a colour. */
  private hasFrame(n = this.node): boolean {
    const f = n.vc?.frame;
    return typeof f === 'boolean' ? f : !!n.color;
  }

  /** A browser-tab-like strip above the picture with its link. */
  private renderLink(): void {
    const url = this.linkText();
    const bar = this.linkBar;
    if (bar.dataset.url === url) return;
    bar.dataset.url = url;
    bar.empty();
    bar.toggle(!!url);
    if (!url) return;
    const tab = bar.createDiv({ cls: 'vc-media-link-tab vc-click', attr: { role: 'link' } });
    setIcon(tab.createDiv('vc-media-link-icon'), 'globe');
    let label = url;
    try { const u = new URL(url); label = (u.host + (u.pathname === '/' ? '' : u.pathname) + u.search).replace(/^www\./, ''); } catch { /* keep */ }
    tab.createDiv({ cls: 'vc-media-link-text', text: label });
    setTooltip(tab, url, { placement: 'top' });
    tab.addEventListener('click', (e) => {
      const b = this.ctx.board;
      if (!(b.selection.has(this.node.id) && b.selection.size === 1)) return;
      e.stopPropagation();
      openUrl(this.ctx.app, url);
    });
    tab.addEventListener('dblclick', e => e.stopPropagation());
  }

  private editLink(): void {
    new LinkModal(this.ctx.app, this.linkText(), (url) => {
      if (url === null || url === this.linkText()) return;
      commitNode(this.ctx, this.node.id, (n) => {
        n.vc = { ...(n.vc ?? {}) };
        if (url) n.vc.link = url; else delete n.vc.link;
      });
    }).open();
  }

  private setFrame(on: boolean): void {
    commitNode(this.ctx, this.node.id, (n) => { n.vc = { ...(n.vc ?? {}), frame: on }; });
  }

  /**
   * The description is part of the card: the card is always the picture's
   * height plus the description's. The description height already counted in
   * the card is kept in vc.descH, so this stays right across reloads.
   */
  private fitDescription(): void {
    const h = (this.desc.isShown() ? Math.ceil(this.desc.offsetHeight) : 0) + (this.linkBar.isShown() ? Math.ceil(this.linkBar.offsetHeight) : 0);
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

  /** The picture's or video's own pixel size (null until it has loaded). */
  private natural(): { width: number; height: number; duration?: number } | null {
    const img = this.frame.querySelector('img');
    if (img?.naturalWidth) return { width: img.naturalWidth, height: img.naturalHeight };
    const v = this.frame.querySelector('video');
    if (v?.videoWidth) return { width: v.videoWidth, height: v.videoHeight, duration: Number.isFinite(v.duration) ? v.duration : undefined };
    return null;
  }

  /** The card at the media's own size (plus its link bar and description). */
  originalSize(): { width: number; height: number; media: { width: number; height: number } } | null {
    const nat = this.natural();
    if (!nat) return null;
    const extra = Number(this.ctx.board.model.node(this.node.id)?.vc?.descH) || 0;
    return { width: nat.width, height: nat.height + extra, media: { width: nat.width, height: nat.height } };
  }

  private showInfo(): void {
    const file = resolveFile(this.ctx.app, this.node);
    if (!file || this.kind === 'audio') return;
    new MediaInfoModal(this.ctx.app, file, this.kind, this.natural()).open();
  }

  update(n: RawNode): void {
    this.node = n;
    this.render();
    this.player?.update(n);
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
    this.player?.destroy();
    this.descRich?.destroy();
    this.el.querySelectorAll('video,audio').forEach(m => (m as HTMLMediaElement).pause());
  }

  /** Editing a picture means writing its description (rich text, with the formatting bar). */
  edit(at?: { clientX: number; clientY: number }): boolean {
    if (!this.descRich) return false;
    if (this.descRich.editing) return true;
    this.desc.show();
    this.el.closest<HTMLElement>('.vc-node')?.addClass('has-media-extras');
    // A click on the picture itself puts the caret at the end of the description.
    const inDesc = at && this.desc.getBoundingClientRect().top <= at.clientY;
    this.descRich.startEditing(inDesc ? at : undefined);
    return true;
  }

  isEditing(): boolean { return !!this.descRich?.editing; }

  onKey(e: KeyboardEvent): boolean { return this.player?.onKey(e) ?? false; }

  stopEditing(): void { this.descRich?.stopEditing(); }

  searchText(): string { return `${this.node.file ?? ''} ${this.descText()}`; }

  barItems(): BarItem[] {
    const items: BarItem[] = [];
    const file = resolveFile(this.ctx.app, this.node);
    const open: BarItem | null = file ? { id: 'open', icon: 'external-link', label: t('Open file'), run: () => void this.ctx.app.workspace.getLeaf('tab').openFile(file) } : null;
    if (this.kind === 'audio') return open ? [open] : [];
    // Its own tools | frame, frame colour, size, layer | (duplicate, delete, more follow).
    items.push({ id: 'desc', icon: 'text', label: t(this.descText() ? 'Edit description' : 'Add description'), active: !!this.descText(), run: () => this.ctx.board.startEditing(this.node.id) });
    items.push({ id: 'link', icon: 'link', label: t(this.linkText() ? 'Edit link' : 'Insert link'), active: !!this.linkText(), run: () => this.editLink() });
    if (open) items.push(open);
    items.push({ id: '@sep', icon: '', label: '' });
    const on = this.hasFrame();
    items.push({ id: 'frame', icon: 'square', label: t(on ? 'Hide the frame' : 'Show a frame'), active: on, run: () => this.setFrame(!on) });
    items.push({ id: '@color', icon: '', label: '' }, { id: '@size', icon: '', label: '' }, { id: '@layer', icon: '', label: '' });
    if (file) items.push({ id: 'info', icon: 'info', label: t('Information'), run: () => this.showInfo() });
    items.push({ id: '@sep', icon: '', label: '' });
    return items;
  }

  menu(menu: Menu): void {
    if (this.kind === 'audio') return;
    menu.addItem(i => i.setTitle(t(this.descText() ? 'Edit description' : 'Add description')).setIcon('text').setSection('edit')
      .onClick(() => this.ctx.board.startEditing(this.node.id)));
    menu.addItem(i => i.setTitle(t(this.linkText() ? 'Edit link' : 'Insert link')).setIcon('link').setSection('edit').onClick(() => this.editLink()));
    if (this.descText()) {
      menu.addItem(i => i.setTitle(t('Remove description')).setIcon('x').setSection('edit')
        .onClick(() => commitNode(this.ctx, this.node.id, (n) => { n.vc = { ...(n.vc ?? {}) }; delete n.vc.desc; })));
    }
    const player = this.player;
    if (player) {
      menu.addItem(i => i.setTitle(t('Set as cover')).setIcon('image').setSection('edit').onClick(() => void player.setCover()));
      if (player.hasCover()) menu.addItem(i => i.setTitle(t('Remove cover')).setIcon('image-off').setSection('edit').onClick(() => player.removeCover()));
    }
    const file = resolveFile(this.ctx.app, this.node);
    if (file) menu.addItem(i => i.setTitle(t('Information')).setIcon('info').setSection('edit').onClick(() => this.showInfo()));
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

export interface LinkMeta {
  title?: string; description?: string; image?: string; icon?: string; site?: string; failed?: boolean; fetched?: number;
  /** Local copies of the picture and icon (paths for the vault adapter), so previews stay when offline. */
  imageFile?: string; iconFile?: string;
}

const EXT_OF: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/avif': 'avif' };

function hashOf(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** Keep a copy of a preview picture in the plugin's cache folder; returns its path, or undefined. */
async function cacheImage(ctx: CardContext, url: string): Promise<string | undefined> {
  const adapter = ctx.app.vault.adapter;
  const dir = `${ctx.board.plugin.manifest.dir}/cache`;
  try {
    const res = await requestUrl({ url, method: 'GET', throw: false });
    if (res.status >= 400 || !res.arrayBuffer.byteLength) return undefined;
    const type = (res.headers['content-type'] ?? res.headers['Content-Type'] ?? '').split(';')[0].trim().toLowerCase();
    const ext = EXT_OF[type] ?? (url.match(/\.(png|jpe?g|gif|webp|svg|ico|avif)(?:[?#]|$)/i)?.[1]?.toLowerCase().replace('jpeg', 'jpg'));
    if (!ext) return undefined;
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    const path = `${dir}/${hashOf(url)}.${ext}`;
    await adapter.writeBinary(path, res.arrayBuffer);
    return path;
  } catch { return undefined; }
}

/** Save local copies of a bookmark's picture and icon (once), and remember where they are. */
async function cachePreview(ctx: CardContext, id: string): Promise<void> {
  const n = ctx.board.model.node(id);
  const meta = n ? vcGet<LinkMeta | null>(n, 'meta', null) : null;
  if (!n || !meta) return;
  const key = `cache:${id}`;
  if (inflight.has(key)) return;
  inflight.add(key);
  try {
    const imageFile = meta.image && !meta.imageFile ? await cacheImage(ctx, meta.image) : undefined;
    const iconFile = meta.icon && !meta.iconFile ? await cacheImage(ctx, meta.icon) : undefined;
    if (!imageFile && !iconFile) return;
    const m = ctx.board.model;
    const cur = m.node(id);
    if (!cur) return;
    m.quiet(() => {
      const mm = { ...((cur.vc?.meta ?? {}) as LinkMeta) };
      if (imageFile) mm.imageFile = imageFile;
      if (iconFile) mm.iconFile = iconFile;
      cur.vc = { ...(cur.vc ?? {}), meta: mm };
      m.touch(id);
    });
  } finally { inflight.delete(key); }
}

/** The picture to show: the local copy when there is one, else the web address. */
function previewSrc(ctx: CardContext, file: string | undefined, web: string | undefined): string | undefined {
  if (file) return ctx.app.vault.adapter.getResourcePath(file);
  return web;
}

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
    if (vcGet<string>(n, 'kind', '') === 'bookmark') {
      if (meta.image && n.height < 200) n.height = 300;
      else if (n.height < 110) n.height = 120;
    }
    m.touch(id);
  });
  if (meta.image || meta.icon) void cachePreview(ctx, id);
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
    else if ((meta.image && !meta.imageFile) || (meta.icon && !meta.iconFile)) void cachePreview(this.ctx, n.id);

    const box = this.el.createDiv('vc-bookmark-box');
    const imageSrc = previewSrc(this.ctx, meta.imageFile, meta.image);
    if (imageSrc) {
      const pic = box.createDiv('vc-bookmark-image');
      const img = pic.createEl('img', { attr: { src: imageSrc, draggable: 'false', referrerpolicy: 'no-referrer' } });
      img.addEventListener('error', () => pic.remove());
    }
    const body = box.createDiv('vc-bookmark-body');
    const title = body.createEl('a', { cls: 'vc-bookmark-title', text: meta.title || host, href: url });
    title.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openUrl(this.ctx.app, url); });
    if (meta.description) body.createDiv({ cls: 'vc-bookmark-desc', text: meta.description });
    else if (!meta.fetched) body.createDiv({ cls: 'vc-bookmark-desc is-loading', text: t('Loading preview…') });
    else if (meta.failed) body.createDiv({ cls: 'vc-bookmark-desc', text: t('No preview available for this page.') });
    const foot = body.createDiv('vc-bookmark-foot');
    const iconSrc = previewSrc(this.ctx, meta.iconFile, meta.icon);
    if (iconSrc) {
      const ic = foot.createEl('img', { cls: 'vc-bookmark-icon', attr: { src: iconSrc, referrerpolicy: 'no-referrer' } });
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
      { id: 'open', icon: 'external-link', label: t('Open in browser'), run: () => openUrl(this.ctx.app, url) },
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
    menu.addItem(i => i.setTitle(t('Open in browser')).setIcon('external-link').setSection('open').onClick(() => openUrl(this.ctx.app, url)));
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
  // Starts as a slim address box; grows to fit the preview once it has one.
  defaultSize: { width: 340, height: 48 },
  create: () => ({ type: 'link', url: '', vc: { kind: 'bookmark' } }),
  mount: (node, el, ctx) => new BookmarkCard(node, el, ctx),
};

/** Links from the core Canvas show as bookmarks too. */
export const linkCard: CardType = { ...bookmarkCard, id: 'link', label: 'Link', create: undefined };

export const MEDIA_CARDS: CardType[] = [imageCard, videoCard, audioCard, bookmarkCard, linkCard];
