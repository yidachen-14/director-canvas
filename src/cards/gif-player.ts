import { Menu, Notice, setIcon, setTooltip, type TFile } from 'obsidian';
import type { Board } from '../board/board';
import { addFiles } from '../board/clipboard';
import { t } from '../i18n';
import type { CardContext } from './types';

/*
 * Animated GIFs, like PureRef: they play on their own, and a selected GIF gets a small bar to pause,
 * step frame by frame, change speed and scrub a frame timeline. A frame can be copied or added to the
 * board as a picture of its own.
 *
 * A playing GIF is the browser's own <img> (cheapest). Once paused, stepped or slowed down, frames come
 * from WebCodecs' ImageDecoder and are drawn on a canvas over it, and the <img> is taken out of the
 * page so it no longer animates (that is what "Pause all GIFs" saves).
 */

interface DecodedFrame { image: CanvasImageSource & { duration: number | null; close(): void; displayWidth: number; displayHeight: number } }
interface GifDecoder {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  completed: Promise<void>;
  decode(o: { frameIndex: number; completeFramesOnly?: boolean }): Promise<DecodedFrame>;
  close(): void;
}
type DecoderCtor = new (init: { data: ArrayBuffer; type: string }) => GifDecoder;

const RATES = [0.25, 0.5, 1, 1.5, 2, 4];
/** Browsers play a GIF frame of 10 ms or less at 100 ms. */
const MIN_DELAY = 20, SHORT_DELAY = 100;

const players = new WeakMap<Board, Set<GifPlayer>>();
const pausedBoards = new WeakSet<Board>();

function decoderCtor(): DecoderCtor | null {
  return (window as unknown as { ImageDecoder?: DecoderCtor }).ImageDecoder ?? null;
}

export function isGif(file: TFile | null): boolean { return !!file && file.extension.toLowerCase() === 'gif'; }

/** Whether the board has any GIFs (its menu then offers to pause or play them all). */
export function boardHasGifs(board: Board): boolean { return (players.get(board)?.size ?? 0) > 0; }

/** Pause every GIF on the board (new ones on it start paused too), or play them all again. */
export function setBoardGifsPaused(board: Board, paused: boolean): void {
  if (paused) pausedBoards.add(board); else pausedBoards.delete(board);
  for (const p of players.get(board) ?? []) { if (paused) p.pause(); else p.playAll(); }
}

export function boardGifsPaused(board: Board): boolean { return pausedBoards.has(board); }

export class GifPlayer {
  private canvas: HTMLCanvasElement;
  private bar: HTMLElement;
  private timeline: HTMLElement;
  private fill: HTMLElement;
  private head: HTMLElement;
  private playBtn: HTMLElement;
  private rateBtn: HTMLElement;
  private countEl: HTMLElement;
  private timelineBtn: HTMLElement;

  private decoder: GifDecoder | null = null;
  private loading: Promise<boolean> | null = null;
  private count = 0;
  private delays: number[] = [];
  private index = 0;
  /** The frame index isn't known yet (paused from the <img>, before the decoder was ready). */
  private indexUnknown = false;
  private pausedAt = 0;
  private startedAt = performance.now();
  private native = true;
  private playing = true;
  private rate = 1;
  private timer = 0;
  private drawSeq = 0;
  private visible = true;
  private io: IntersectionObserver;
  private dead = false;
  private board: Board;

  constructor(private frame: HTMLElement, private img: HTMLImageElement, private file: TFile, private ctx: CardContext, private nodeId: string) {
    this.board = ctx.board;
    frame.addClass('vc-gif');
    this.canvas = frame.createEl('canvas', { cls: 'vc-gif-canvas' });
    img.addEventListener('load', () => { this.startedAt = performance.now(); });

    this.bar = frame.createDiv('vc-gif-ui vc-interactive');
    this.timeline = this.bar.createDiv('vc-gif-tl');
    const track = this.timeline.createDiv('vc-gif-tl-bar');
    this.fill = track.createDiv('vc-gif-tl-fill');
    this.head = this.timeline.createDiv('vc-gif-tl-head');
    const row = this.bar.createDiv('vc-gif-row');
    this.rateBtn = this.button(row, '', t('Playback speed'), (e) => this.rateMenu(e));
    this.rateBtn.addClass('vc-gif-rate');
    this.button(row, 'skip-back', t('Previous frame (←)'), () => void this.step(-1));
    this.playBtn = this.button(row, 'pause', t('Play / pause (Space)'), () => this.toggle());
    this.button(row, 'skip-forward', t('Next frame (→)'), () => void this.step(1));
    row.createDiv('vc-gif-spacer');
    this.countEl = row.createDiv('vc-gif-count');
    this.timelineBtn = this.button(row, 'gallery-horizontal', t('Frame timeline'), () => this.toggleTimeline());
    this.timeline.hide();
    this.wireTimeline();
    // The bar shows only for a GIF that actually moves.
    this.bar.hide();
    void this.probe();

    this.io = new IntersectionObserver((entries) => {
      const v = entries.some(e => e.isIntersecting);
      if (v === this.visible) return;
      this.visible = v;
      if (v && this.playing && !this.native) this.schedule(0);
    });
    this.io.observe(frame);

    let set = players.get(this.board);
    if (!set) players.set(this.board, set = new Set());
    set.add(this);
    if (pausedBoards.has(this.board)) {
      if (img.complete && img.naturalWidth) this.pause();
      else img.addEventListener('load', () => { if (pausedBoards.has(this.board)) this.pause(); }, { once: true });
    }
    this.renderUi();
  }

  private button(parent: HTMLElement, icon: string, label: string, run: (e: MouseEvent) => void): HTMLElement {
    const b = parent.createDiv({ cls: 'vc-gif-btn clickable-icon', attr: { 'aria-label': label, role: 'button' } });
    if (icon) setIcon(b, icon);
    setTooltip(b, label, { placement: 'top' });
    b.addEventListener('click', (e) => { e.stopPropagation(); run(e); });
    b.addEventListener('dblclick', (e) => e.stopPropagation());
    return b;
  }

  /** Count the frames (cheaply, without decoding them) so a still GIF gets no bar. */
  private async probe(): Promise<void> {
    if (!decoderCtor()) return;
    const ok = await this.load();
    if (ok && !this.dead) { this.bar.toggle(this.count > 1); this.renderUi(); }
  }

  private load(): Promise<boolean> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const Ctor = decoderCtor();
      if (!Ctor) return false;
      try {
        const data = await this.ctx.app.vault.readBinary(this.file);
        const d = new Ctor({ data, type: 'image/gif' });
        await d.tracks.ready;
        await d.completed;
        if (this.dead) { d.close(); return false; }
        this.decoder = d;
        this.count = d.tracks.selectedTrack?.frameCount ?? 0;
        this.delays = new Array<number>(this.count).fill(0);
        return this.count > 0;
      } catch (err) {
        console.warn('Director Canvas: could not read the GIF', this.file.path, err);
        return false;
      }
    })();
    return this.loading;
  }

  private delay(i: number): number {
    const d = this.delays[i] || SHORT_DELAY;
    return d <= 10 ? SHORT_DELAY : Math.max(MIN_DELAY, d);
  }

  /** Every frame's delay (decoding each once), for finding where the <img> was when it was paused. */
  private async scanDelays(): Promise<void> {
    if (!this.decoder || this.delays.every(d => d > 0)) return;
    for (let i = 0; i < this.count; i++) {
      if (this.delays[i]) continue;
      const f = await this.decoder.decode({ frameIndex: i });
      this.delays[i] = (f.image.duration ?? 0) / 1000 || SHORT_DELAY;
      f.image.close();
      if (this.dead) return;
    }
  }

  /** Draw frame i on the canvas (the newest request wins). */
  private async draw(i: number): Promise<void> {
    if (!this.decoder) return;
    const seq = ++this.drawSeq;
    try {
      const f = await this.decoder.decode({ frameIndex: i });
      if (seq !== this.drawSeq || this.dead) { f.image.close(); return; }
      const im = f.image;
      if (!this.delays[i]) this.delays[i] = (im.duration ?? 0) / 1000 || SHORT_DELAY;
      const c = this.canvas;
      if (c.width !== im.displayWidth || c.height !== im.displayHeight) { c.width = im.displayWidth; c.height = im.displayHeight; }
      const g = c.getContext('2d');
      if (g) { g.clearRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0); }
      im.close();
    } catch { /* a frame that won't decode: keep the last one */ }
  }

  /** Show the canvas instead of the <img> (which then stops animating). */
  private toCanvas(): void {
    if (!this.native) return;
    this.native = false;
    this.frame.addClass('is-gif-canvas');
  }

  private toNative(): void {
    window.clearTimeout(this.timer);
    this.native = true;
    this.playing = true;
    this.frame.removeClass('is-gif-canvas');
    // Back in the page, the <img> starts over.
    this.startedAt = performance.now();
    this.renderUi();
  }

  /** Freeze the frame on screen right now: drawing the <img> paints its current frame. */
  private snapshot(): void {
    const img = this.img;
    if (!img.naturalWidth) return;
    const c = this.canvas;
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    try { c.getContext('2d')?.drawImage(img, 0, 0); } catch { /* keep */ }
  }

  /** Where the <img> is in its loop, once the frame delays are known. */
  private async resolveIndex(): Promise<void> {
    if (!this.indexUnknown) return;
    if (!(await this.load())) return;
    await this.scanDelays();
    if (!this.indexUnknown) return;
    const total = this.delays.reduce((a, _d, i) => a + this.delay(i), 0);
    let tm = total ? (this.pausedAt - this.startedAt) % total : 0;
    let i = 0;
    while (i < this.count - 1 && tm >= this.delay(i)) { tm -= this.delay(i); i++; }
    this.index = i;
    this.indexUnknown = false;
    this.renderUi();
  }

  pause(): void {
    if (this.native) {
      this.pausedAt = performance.now();
      this.snapshot();
      this.indexUnknown = true;
      this.toCanvas();
    }
    this.playing = false;
    window.clearTimeout(this.timer);
    this.renderUi();
  }

  async play(): Promise<void> {
    if (!(await this.load())) { this.toNative(); return; }
    await this.resolveIndex();
    if (this.dead) return;
    this.toCanvas();
    this.playing = true;
    this.renderUi();
    this.schedule(this.delay(this.index) / this.rate);
  }

  /** "Play all GIFs": the plain <img> again where nothing else is asked of it (cheapest). */
  playAll(): void {
    if (this.rate === 1) this.toNative(); else void this.play();
  }

  private toggle(): void {
    if (this.playing) this.pause(); else void this.play();
  }

  private schedule(ms: number): void {
    window.clearTimeout(this.timer);
    if (!this.playing || this.native || !this.visible || this.dead) return;
    this.timer = window.setTimeout(() => void this.advance(), ms);
  }

  private async advance(): Promise<void> {
    if (!this.playing || this.native) return;
    const started = performance.now();
    this.index = (this.index + 1) % this.count;
    await this.draw(this.index);
    this.renderPosition();
    this.schedule(Math.max(0, this.delay(this.index) / this.rate - (performance.now() - started)));
  }

  async step(by: number): Promise<void> {
    this.pause();
    if (!(await this.load())) return;
    await this.resolveIndex();
    this.index = ((this.index + by) % this.count + this.count) % this.count;
    await this.draw(this.index);
    this.renderUi();
  }

  async seek(i: number): Promise<void> {
    if (this.playing) this.pause();
    if (!(await this.load())) return;
    this.indexUnknown = false;
    this.index = Math.max(0, Math.min(this.count - 1, i));
    this.renderPosition();
    await this.draw(this.index);
  }

  private setRate(r: number): void {
    this.rate = r;
    if (this.playing && this.native && r !== 1) void this.play();
    this.renderUi();
  }

  private rateMenu(e: MouseEvent): void {
    const menu = new Menu();
    for (const r of RATES) menu.addItem(i => i.setTitle(`${r}×`).setChecked(this.rate === r).onClick(() => this.setRate(r)));
    menu.showAtMouseEvent(e);
  }

  private toggleTimeline(): void {
    const show = !this.timeline.isShown();
    this.timeline.toggle(show);
    this.timelineBtn.toggleClass('is-active', show);
    if (show) void this.load().then(() => this.renderUi());
  }

  private wireTimeline(): void {
    const at = (e: PointerEvent) => {
      const r = this.timeline.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
      return Math.min(this.count - 1, Math.floor(f * this.count));
    };
    this.timeline.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      this.timeline.setPointerCapture(e.pointerId);
      void this.seek(at(e));
      const move = (ev: PointerEvent) => { const i = at(ev); if (i !== this.index) void this.seek(i); };
      const up = () => {
        this.timeline.removeEventListener('pointermove', move);
        this.timeline.removeEventListener('pointerup', up);
        this.timeline.removeEventListener('pointercancel', up);
      };
      this.timeline.addEventListener('pointermove', move);
      this.timeline.addEventListener('pointerup', up);
      this.timeline.addEventListener('pointercancel', up);
    });
    this.timeline.addEventListener('dblclick', (e) => e.stopPropagation());
  }

  private renderPosition(): void {
    const known = !this.native && !this.indexUnknown && this.count > 0;
    this.countEl.setText(known ? `${this.index + 1} / ${this.count}` : this.count ? `${this.count}` : '');
    const f = known && this.count > 1 ? this.index / (this.count - 1) : 0;
    this.fill.setCssStyles({ width: `${f * 100}%` });
    this.head.setCssStyles({ left: `${f * 100}%` });
    this.head.toggle(known);
  }

  private renderUi(): void {
    setIcon(this.playBtn, this.playing ? 'pause' : 'play');
    this.rateBtn.setText(`x${this.rate}`);
    this.renderPosition();
  }

  /** Keys while the card is the only selection. */
  onKey(e: KeyboardEvent): boolean {
    if (e.metaKey || e.ctrlKey || e.altKey || !this.bar.isShown()) return false;
    switch (e.code) {
      case 'Space': this.toggle(); return true;
      case 'ArrowLeft': void this.step(e.shiftKey ? -10 : -1); return true;
      case 'ArrowRight': void this.step(e.shiftKey ? 10 : 1); return true;
      default: return false;
    }
  }

  /** Whether this GIF has frames to step through (the menu then offers its frame). */
  get animated(): boolean { return this.count > 1; }

  /** The frame on screen as a PNG. */
  private async frameBlob(): Promise<Blob | null> {
    if (this.native) this.snapshot();
    return new Promise(res => this.canvas.toBlob(b => res(b), 'image/png'));
  }

  async copyFrame(): Promise<void> {
    const blob = await this.frameBlob();
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      new Notice(t('Frame copied.'));
    } catch (err) {
      console.warn('Director Canvas: could not copy the frame', err);
    }
  }

  /** The frame on screen as a picture card of its own, beside the GIF. */
  async addFrame(): Promise<void> {
    const blob = await this.frameBlob();
    const n = this.ctx.board.model.node(this.nodeId);
    if (!blob) return;
    const num = this.native || this.indexUnknown ? '' : `-${this.index + 1}`;
    const f = new File([blob], `${this.file.basename}${num}.png`, { type: 'image/png' });
    const at = n ? { x: n.x + n.width + 24, y: n.y + n.height / 2 } : this.ctx.board.viewCenter();
    await addFiles(this.ctx.board, [f], at);
  }

  destroy(): void {
    this.dead = true;
    window.clearTimeout(this.timer);
    this.io.disconnect();
    players.get(this.board)?.delete(this);
    this.decoder?.close();
    this.decoder = null;
    this.canvas.remove();
    this.bar.remove();
    this.frame.removeClass('vc-gif', 'is-gif-canvas');
  }
}
