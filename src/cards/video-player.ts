import { Menu, Notice, addIcon, setIcon, setTooltip } from 'obsidian';
import type { RawNode } from '../model/canvas-file';
import type { CardContext } from './types';
import { commitNode } from './basic';
import { t } from '../i18n';
import { formatTime, videoData, type VideoData, type VideoMark } from './video-data';

/**
 * A light review player for video cards: a cover frame, point and range marks with notes,
 * frame stepping, playback speed and loops. Times are seconds (the board does not know a
 * video's frame rate); frame-accurate work stays in Director Vault.
 */

addIcon('vc-mark-in', '<path d="M62 18H38v64h24" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="M52 50h28" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>');
addIcon('vc-mark-out', '<path d="M38 18h24v64H38" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 50h28" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>');

const RATES = [0.25, 0.5, 1, 1.5, 2];
/** A point mark's note shows this long (seconds) around it while playing. */
const POINT_SPAN = 0.6;

const markTime = (m: VideoMark) => (m.out - m.in < 1e-3 ? formatTime(m.in) : `${formatTime(m.in)} – ${formatTime(m.out)}`);
const isPoint = (m: VideoMark) => m.out - m.in < 1e-3;
const newId = () => Math.random().toString(36).slice(2, 10);

export class VideoPlayer {
  readonly video: HTMLVideoElement;
  private stage: HTMLElement;
  private ctrl: HTMLElement;
  private track: HTMLElement;
  private fill: HTMLElement;
  private head: HTMLElement;
  private marksEl: HTMLElement;
  private pendingEl: HTMLElement;
  private muteBtn: HTMLElement;
  private volume: HTMLInputElement;
  /** Holding J: playing backwards by seeking (browsers can't play in reverse). */
  private reverse: { from: number; t0: number; rate: number; stop: (e: KeyboardEvent) => void } | null = null;
  private timeEl: HTMLElement;
  private playBtn: HTMLElement;
  private rateBtn: HTMLElement;
  private loopBtn: HTMLElement;
  private sub: HTMLElement;
  private pop: HTMLElement | null = null;
  private popSave: (() => void) | null = null;
  private notice: HTMLElement | null = null;

  private node: RawNode;
  private pendingIn: number | null = null;
  private openMark: string | null = null;
  private loop: { in: number; out: number } | null = null;
  /** Length of one frame, measured while playing; 30 fps until then. */
  private frameDur = 1 / 30;
  private raf = 0;
  private played = false;
  private dragging = false;

  constructor(host: HTMLElement, src: string, private ctx: CardContext, node: RawNode, private onSize: (w: number, h: number) => void) {
    this.node = node;
    this.stage = host.createDiv('vc-video-stage');
    // Anonymous CORS keeps frames readable, so the cover can be saved as a picture.
    this.video = this.stage.createEl('video', { attr: { crossorigin: 'anonymous', preload: 'metadata', playsinline: '' } });
    this.video.src = src;
    this.sub = this.stage.createDiv('vc-video-sub');
    // The controls hang under the card while it is selected, so they never cover the picture.
    this.ctrl = createDiv('vc-video-ctrl vc-interactive');
    this.attachPanel(host);

    // Track: marks above, then the progress bar.
    this.track = this.ctrl.createDiv('vc-vt');
    this.marksEl = this.track.createDiv('vc-vt-marks');
    const bar = this.track.createDiv('vc-vt-bar');
    this.fill = bar.createDiv('vc-vt-fill');
    this.pendingEl = this.track.createDiv('vc-vt-pending');
    this.head = this.track.createDiv('vc-vt-head');

    const row = this.ctrl.createDiv('vc-vc-row');
    this.playBtn = this.button(row, 'play', t('Play / pause (Space)'), () => this.togglePlay());
    this.button(row, 'chevron-left', t('Previous frame (←)'), () => this.step(-1));
    this.button(row, 'chevron-right', t('Next frame (→)'), () => this.step(1));
    this.timeEl = row.createDiv('vc-vc-time');
    row.createDiv('vc-vc-spacer');
    this.button(row, 'vc-mark-in', t('Mark in (I)'), () => this.markIn());
    this.button(row, 'vc-mark-out', t('Mark out (O)'), () => this.markOut());
    this.button(row, 'flag', t('Add a mark (M)'), () => this.addPoint());
    this.loopBtn = this.button(row, 'repeat', t('Loop'), () => this.toggleLoop());
    this.rateBtn = this.button(row, '', t('Playback speed'), (e) => this.rateMenu(e));
    this.rateBtn.addClass('vc-vc-rate');
    this.button(row, 'image', t('Set as cover'), () => void this.setCover());
    this.muteBtn = this.button(row, 'volume-2', t('Mute'), () => { this.video.muted = !this.video.muted; });
    this.volume = row.createEl('input', { cls: 'vc-vc-volume', type: 'range', attr: { min: '0', max: '1', step: '0.05', 'aria-label': t('Volume') } });
    this.volume.value = String(this.video.volume);
    this.volume.addEventListener('input', () => { this.video.volume = Number(this.volume.value); this.video.muted = this.video.volume === 0; });
    this.button(row, 'maximize', t('Full screen'), () => this.fullScreen());

    this.wire();
    this.renderMarks();
    this.renderCover();
    this.renderTime();
  }

  private button(parent: HTMLElement, icon: string, label: string, run: (e: MouseEvent) => void): HTMLElement {
    const b = parent.createDiv({ cls: 'vc-vc-btn clickable-icon', attr: { 'aria-label': label, role: 'button' } });
    if (icon) setIcon(b, icon);
    setTooltip(b, label, { placement: 'top' });
    b.addEventListener('click', (e) => { e.stopPropagation(); run(e); });
    return b;
  }

  private get duration(): number {
    const d = this.video.duration;
    return Number.isFinite(d) && d > 0 ? d : 0;
  }

  private get data(): VideoData { return videoData(this.node); }

  private get soleSelected(): boolean {
    const b = this.ctx.board;
    return b.selection.size === 1 && b.selection.has(this.node.id);
  }

  // ── events ──────────────────────────────────────────────

  private wire(): void {
    const v = this.video;
    v.addEventListener('loadedmetadata', () => {
      if (!v.videoWidth) { this.unsupported(); return; }
      this.onSize(v.videoWidth, v.videoHeight);
      const cover = this.data.cover;
      if (cover && !this.played) v.currentTime = Math.min(cover.t, this.duration);
      this.renderMarks();
      this.renderCover();
      this.renderTime();
    });
    v.addEventListener('error', () => this.unsupported());
    v.addEventListener('play', () => { this.played = true; this.renderPlay(); this.tick(); });
    v.addEventListener('pause', () => { this.renderPlay(); this.renderTime(); });
    v.addEventListener('seeked', () => this.renderTime());
    v.addEventListener('ratechange', () => this.renderRate());
    v.addEventListener('ended', () => this.renderPlay());
    v.addEventListener('volumechange', () => this.renderVolume());
    // Full screen uses the browser's own controls.
    this.stage.addEventListener('fullscreenchange', () => { v.controls = document.fullscreenElement === this.stage; });
    this.measureFrames();

    // A click on the picture of the selected card plays or pauses; the first click only
    // selects, and a drag still moves the card.
    let down: { x: number; y: number; was: boolean } | null = null;
    this.stage.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, was: this.soleSelected }; }, true);
    this.stage.addEventListener('click', (e) => {
      if (!down || this.ctrl.contains(e.target as Node) || this.pop?.contains(e.target as Node)) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 3;
      if (down.was && !moved && !this.notice) { this.closePop(); this.togglePlay(); }
      down = null;
    });

    this.track.addEventListener('pointerdown', (e) => this.pressTrack(e));
    // Clicking the controls keeps the keys (Space, ←, →, I, O, M, J, K, L) with the board.
    this.ctrl.addEventListener('pointerdown', (e) => {
      if (!(e.target as HTMLElement).closest('input, textarea')) window.setTimeout(() => this.ctx.board.root.focus({ preventScroll: true }), 0);
    });
    this.ctrl.addEventListener('dblclick', e => e.stopPropagation());
    this.renderRate();
  }

  /** Learn the frame length from the frames the browser actually shows while playing. */
  private measureFrames(): void {
    type RVFC = (cb: (now: number, meta: { mediaTime: number; presentedFrames: number }) => void) => number;
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: RVFC };
    if (!v.requestVideoFrameCallback) return;
    let last: { t: number; n: number } | null = null;
    const samples: number[] = [];
    const cb = (_: number, meta: { mediaTime: number; presentedFrames: number }) => {
      if (!this.video.isConnected) return;
      if (last && meta.presentedFrames === last.n + 1 && v.playbackRate === 1) {
        const d = meta.mediaTime - last.t;
        if (d > 1 / 130 && d < 1 / 8) {
          samples.push(d);
          if (samples.length > 30) samples.shift();
          const sorted = [...samples].sort((a, b) => a - b);
          this.frameDur = sorted[Math.floor(sorted.length / 2)];
        }
      }
      last = { t: meta.mediaTime, n: meta.presentedFrames };
      v.requestVideoFrameCallback!(cb);
    };
    v.requestVideoFrameCallback(cb);
  }

  private tick(): void {
    cancelAnimationFrame(this.raf);
    const loop = () => {
      const v = this.video;
      if (this.loop && v.currentTime >= this.loop.out) v.currentTime = this.loop.in;
      this.renderTime();
      if (!v.paused && !v.ended && v.isConnected) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private unsupported(): void {
    if (this.notice) return;
    this.notice = this.stage.createDiv('vc-video-unsupported');
    setIcon(this.notice.createDiv('vc-video-unsupported-icon'), 'film');
    this.notice.createDiv({ text: t('This video format can’t play on the board.') });
    this.notice.createDiv({ cls: 'vc-video-unsupported-hint', text: t('Convert it to H.264 or HEVC (MP4) and add it again.') });
    this.stage.addClass('is-unsupported');
    this.ctrl.addClass('is-unsupported');
  }

  // ── playback ────────────────────────────────────────────

  togglePlay(): void {
    if (this.notice) return;
    const v = this.video;
    if (v.paused || v.ended) {
      if (this.loop && (v.currentTime < this.loop.in || v.currentTime >= this.loop.out)) v.currentTime = this.loop.in;
      void v.play();
    } else v.pause();
  }

  private seek(time: number): void {
    const d = this.duration;
    this.video.currentTime = Math.max(0, d ? Math.min(time, d) : time);
    this.renderTime();
  }

  /** Move by whole frames, landing in the middle of a frame so the browser shows the right one. */
  step(n: number): void {
    const v = this.video;
    if (!v.paused) v.pause();
    const fd = this.frameDur;
    const frame = Math.floor(v.currentTime / fd + 1e-3);
    this.seek((frame + n + 0.5) * fd);
  }

  private setRate(r: number): void {
    this.video.playbackRate = r;
    this.renderRate();
  }

  /** L: play, then faster. */
  private shuttle(): void {
    const v = this.video;
    const i = RATES.indexOf(v.playbackRate);
    if (v.paused) { if (v.playbackRate < 1) this.setRate(1); this.togglePlay(); return; }
    this.setRate(RATES[Math.min(RATES.length - 1, (i < 0 ? 2 : i) + 1)]);
  }

  /**
   * J: back half a second at once; held down, it keeps going back in real time (⇧: half speed),
   * seeking again as soon as each frame is shown.
   */
  private startReverse(rate: number): void {
    if (this.reverse || this.notice) return;
    const v = this.video;
    if (!v.paused) v.pause();
    const from = Math.max(0, v.currentTime - 0.5);
    this.seek(from);
    const stop = (e: KeyboardEvent) => { if (e.code === 'KeyJ') this.stopReverse(); };
    window.addEventListener('keyup', stop, true);
    window.addEventListener('blur', this.stopReverseBound);
    this.reverse = { from, t0: performance.now() + 250, rate, stop };
    const tick = () => {
      const r = this.reverse;
      if (!r || !v.isConnected) return;
      const now = performance.now();
      if (now > r.t0 && !v.seeking) {
        const target = r.from - ((now - r.t0) / 1000) * r.rate;
        if (target <= 0) { this.seek(0); this.stopReverse(); return; }
        v.currentTime = target;
        this.renderTime();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private stopReverseBound = () => this.stopReverse();

  private stopReverse(): void {
    if (!this.reverse) return;
    window.removeEventListener('keyup', this.reverse.stop, true);
    window.removeEventListener('blur', this.stopReverseBound);
    this.reverse = null;
  }

  private fullScreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void this.stage.requestFullscreen();
  }

  private renderVolume(): void {
    const v = this.video;
    setIcon(this.muteBtn, v.muted || v.volume === 0 ? 'volume-x' : v.volume < 0.5 ? 'volume-1' : 'volume-2');
    this.volume.value = String(v.muted ? 0 : v.volume);
  }

  /** Put the controls under the card (outside its clipped body). */
  private attachPanel(host: HTMLElement): void {
    const card = host.closest<HTMLElement>('.vc-node');
    if (card) { if (this.ctrl.parentElement !== card) card.appendChild(this.ctrl); return; }
    window.setTimeout(() => { if (host.isConnected) this.attachPanel(host); }, 0);
  }

  private rateMenu(e: MouseEvent): void {
    const menu = new Menu();
    for (const r of RATES) {
      menu.addItem(i => i.setTitle(`${r}×`).setChecked(this.video.playbackRate === r).onClick(() => this.setRate(r)));
    }
    menu.showAtMouseEvent(e);
  }

  private toggleLoop(): void {
    if (this.loop || this.video.loop) { this.loop = null; this.video.loop = false; this.renderLoop(); return; }
    const m = this.openMark ? this.data.marks?.find(x => x.id === this.openMark) : undefined;
    if (m && !isPoint(m)) this.loop = { in: m.in, out: m.out };
    else this.video.loop = true;
    this.renderLoop();
  }

  private loopMark(m: VideoMark): void {
    this.loop = { in: m.in, out: m.out };
    this.video.loop = false;
    this.seek(m.in);
    this.renderLoop();
    if (this.video.paused) this.togglePlay();
  }

  // ── marks ───────────────────────────────────────────────

  private commit(fn: (d: VideoData) => void): void {
    commitNode(this.ctx, this.node.id, (n) => {
      const d: VideoData = structuredClone(videoData(n));
      fn(d);
      if (d.marks && !d.marks.length) delete d.marks;
      n.vc = { ...(n.vc ?? {}) };
      if (d.cover || d.marks) n.vc.video = d as Record<string, unknown>; else delete n.vc.video;
    });
  }

  markIn(): void {
    this.pendingIn = this.video.currentTime;
    this.renderMarks();
  }

  markOut(): void {
    const now = this.video.currentTime;
    if (this.pendingIn === null) {
      const m = this.openMark ? this.data.marks?.find(x => x.id === this.openMark) : undefined;
      if (m && now > m.in) { this.commit(d => { const x = d.marks?.find(y => y.id === m.id); if (x) x.out = now; }); return; }
      new Notice(t('Press I first to set where the range starts.'));
      return;
    }
    const a = Math.min(this.pendingIn, now), b = Math.max(this.pendingIn, now);
    this.pendingIn = null;
    this.addMark(a, b);
  }

  addPoint(): void {
    const now = this.video.currentTime;
    this.addMark(now, now);
  }

  private addMark(a: number, b: number): void {
    if (this.notice) return;
    if (!this.video.paused) this.video.pause();
    const id = newId();
    this.commit(d => { (d.marks ??= []).push({ id, in: a, out: b, note: '' }); });
    this.openPop(id);
  }

  private removeMark(id: string): void {
    this.closePop(false);
    this.commit(d => { d.marks = (d.marks ?? []).filter(m => m.id !== id); });
  }

  private sortedMarks(): VideoMark[] {
    return [...(this.data.marks ?? [])].sort((a, b) => a.in - b.in || a.out - b.out);
  }

  private pct(time: number): number {
    const d = this.duration;
    return d ? Math.max(0, Math.min(100, (time / d) * 100)) : 0;
  }

  private renderMarks(): void {
    this.marksEl.empty();
    for (const m of this.sortedMarks()) {
      const el = this.marksEl.createDiv({ cls: isPoint(m) ? 'vc-vt-point' : 'vc-vt-range', attr: { 'data-id': m.id } });
      el.style.left = `${this.pct(m.in)}%`;
      if (!isPoint(m)) el.style.width = `${Math.max(0.4, this.pct(m.out) - this.pct(m.in))}%`;
      el.toggleClass('is-open', m.id === this.openMark);
      el.toggleClass('has-note', !!m.note.trim());
    }
    this.pendingEl.toggle(this.pendingIn !== null);
    if (this.pendingIn !== null) this.pendingEl.style.left = `${this.pct(this.pendingIn)}%`;
  }

  private renderCover(): void {
    const c = this.data.cover;
    const adapter = this.ctx.app.vault.adapter;
    const poster = c?.image ? adapter.getResourcePath(c.image) : '';
    if (poster) this.video.poster = poster; else this.video.removeAttribute('poster');
  }

  private renderTime(): void {
    const now = this.video.currentTime;
    const d = this.duration;
    this.fill.style.width = `${this.pct(now)}%`;
    this.head.style.left = `${this.pct(now)}%`;
    this.timeEl.setText(`${formatTime(now)} / ${formatTime(d)}`);
    // Notes of the marks under the playhead read like subtitles.
    if (this.pop) { this.sub.hide(); return; }
    const notes = this.sortedMarks()
      .filter(m => m.note.trim() && (isPoint(m) ? Math.abs(now - m.in) <= POINT_SPAN : now >= m.in && now <= m.out))
      .map(m => m.note.trim());
    this.sub.setText(notes.join('\n'));
    this.sub.toggle(notes.length > 0);
  }

  private renderPlay(): void {
    this.stage.toggleClass('is-playing', !this.video.paused && !this.video.ended);
    setIcon(this.playBtn, this.video.paused || this.video.ended ? 'play' : 'pause');
  }

  private renderRate(): void {
    this.rateBtn.setText(`${this.video.playbackRate}×`);
  }

  private renderLoop(): void {
    this.loopBtn.toggleClass('is-active', !!this.loop || this.video.loop);
  }

  // ── track ───────────────────────────────────────────────

  private timeAt(clientX: number): number {
    const r = this.track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))) * this.duration;
  }

  private pressTrack(e: PointerEvent): void {
    if (e.button !== 0 || !this.duration) return;
    e.stopPropagation();
    e.preventDefault();
    const markEl = (e.target as HTMLElement).closest<HTMLElement>('.vc-vt-point, .vc-vt-range');
    const mark = markEl ? this.data.marks?.find(m => m.id === markEl.dataset.id) : undefined;
    const x0 = e.clientX;
    let moved = false;
    this.track.setPointerCapture(e.pointerId);

    if (!mark) {
      this.closePop();
      const wasPlaying = !this.video.paused;
      if (wasPlaying) this.video.pause();
      this.seek(this.timeAt(e.clientX));
      const move = (ev: PointerEvent) => this.seek(this.timeAt(ev.clientX));
      const up = () => {
        this.track.removeEventListener('pointermove', move);
        this.track.removeEventListener('pointerup', up);
        if (wasPlaying) void this.video.play();
      };
      this.track.addEventListener('pointermove', move);
      this.track.addEventListener('pointerup', up);
      return;
    }

    // On a mark: click = jump there (⇧ loops a range); drag an end = trim; drag the middle = move.
    const r = markEl!.getBoundingClientRect();
    const edge = isPoint(mark) ? 'move' : e.clientX - r.left < 6 ? 'in' : r.right - e.clientX < 6 ? 'out' : 'move';
    const start = this.timeAt(e.clientX);
    let a = mark.in, b = mark.out;
    this.dragging = true;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      const now = this.timeAt(ev.clientX);
      const d = this.duration;
      if (edge === 'in') a = Math.min(now, mark.out);
      else if (edge === 'out') b = Math.max(now, mark.in);
      else {
        const shift = Math.max(-mark.in, Math.min(d - mark.out, now - start));
        a = mark.in + shift; b = mark.out + shift;
      }
      markEl!.style.left = `${this.pct(a)}%`;
      if (!isPoint(mark)) markEl!.style.width = `${Math.max(0.4, this.pct(b) - this.pct(a))}%`;
      this.seek(edge === 'out' ? b : a);
    };
    const up = () => {
      this.dragging = false;
      this.track.removeEventListener('pointermove', move);
      this.track.removeEventListener('pointerup', up);
      if (moved) {
        this.commit(d => { const x = d.marks?.find(y => y.id === mark.id); if (x) { x.in = a; x.out = b; } });
        if (this.loop && this.openMark === mark.id) this.loop = { in: a, out: b };
        return;
      }
      if (e.shiftKey && !isPoint(mark)) { this.loopMark(mark); return; }
      if (!this.video.paused) this.video.pause();
      this.seek(mark.in);
      this.openPop(mark.id);
    };
    this.track.addEventListener('pointermove', move);
    this.track.addEventListener('pointerup', up);
  }

  // ── note popover ────────────────────────────────────────

  private openPop(id: string): void {
    this.closePop();
    const m = this.data.marks?.find(x => x.id === id);
    if (!m) return;
    this.openMark = id;
    const pop = this.pop = this.ctrl.createDiv('vc-vt-pop vc-interactive');
    const head = pop.createDiv('vc-vt-pop-head');
    head.createDiv({ cls: 'vc-vt-pop-time', text: markTime(m) });
    head.createDiv('vc-vc-spacer');
    if (!isPoint(m)) this.button(head, 'repeat', t('Loop this range (⇧-click)'), () => this.loopMark(m));
    this.button(head, 'trash-2', t('Delete mark'), () => this.removeMark(id));
    this.button(head, 'x', t('Close'), () => this.closePop());
    const area = pop.createEl('textarea', { cls: 'vc-vt-note', attr: { placeholder: t('Add a note…'), rows: '3' } });
    area.value = m.note;
    const save = () => {
      const v = area.value.replace(/\s+$/, '');
      const cur = this.data.marks?.find(x => x.id === id);
      if (cur && cur.note !== v) this.commit(d => { const x = d.marks?.find(y => y.id === id); if (x) x.note = v; });
    };
    this.popSave = save;
    area.addEventListener('blur', () => { if (this.pop === pop) save(); });
    area.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); this.closePop(); this.ctx.board.root.focus({ preventScroll: true }); }
    });
    for (const ev of ['pointerdown', 'dblclick', 'wheel'] as const) pop.addEventListener(ev, e => e.stopPropagation());
    this.placePop(m);
    this.renderMarks();
    this.renderTime();
    window.setTimeout(() => area.focus({ preventScroll: true }), 0);
  }

  private placePop(m: VideoMark): void {
    if (!this.pop) return;
    const w = this.ctrl.clientWidth;
    const pw = Math.min(280, w);
    this.pop.style.width = `${pw}px`;
    const x = (this.pct(m.in) / 100) * this.track.clientWidth + this.track.offsetLeft;
    this.pop.style.left = `${Math.max(0, Math.min(w - pw, x - pw / 2))}px`;
  }

  private closePop(save = true): void {
    if (!this.pop) return;
    const done = this.popSave;
    const pop = this.pop;
    this.pop = null;
    this.popSave = null;
    if (save) done?.();
    pop.remove();
    this.openMark = null;
    this.renderMarks();
    this.renderTime();
  }

  // ── cover ───────────────────────────────────────────────

  /** Keep the current frame as the card's cover: a still in the plugin cache when the browser allows it. */
  async setCover(): Promise<void> {
    const v = this.video;
    if (this.notice || !v.videoWidth) return;
    const time = v.currentTime;
    let image: string | undefined;
    try {
      const scale = Math.min(1, 1280 / v.videoWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(v.videoWidth * scale);
      c.height = Math.round(v.videoHeight * scale);
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', 0.86));
      if (blob) {
        const adapter = this.ctx.app.vault.adapter;
        const dir = `${this.ctx.board.plugin.manifest.dir}/cache`;
        if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
        image = `${dir}/cover-${this.node.id}-${Date.now().toString(36)}.jpg`;
        await adapter.writeBinary(image, await blob.arrayBuffer());
      }
    } catch { image = undefined; /* a cross-origin frame: keep the time only */ }
    const old = this.data.cover?.image;
    this.commit(d => { d.cover = image ? { t: time, image } : { t: time }; });
    if (old && old !== image) void this.ctx.app.vault.adapter.remove(old).catch(() => undefined);
    new Notice(t('Cover set to {time}.', { time: formatTime(time) }));
  }

  removeCover(): void {
    const old = this.data.cover?.image;
    this.commit(d => { delete d.cover; });
    if (old) void this.ctx.app.vault.adapter.remove(old).catch(() => undefined);
  }

  hasCover(): boolean { return !!this.data.cover; }

  // ── card hooks ──────────────────────────────────────────

  update(n: RawNode): void {
    this.node = n;
    if (this.openMark && !this.data.marks?.some(m => m.id === this.openMark)) this.closePop(false);
    if (!this.dragging) this.renderMarks();
    const m = this.openMark ? this.data.marks?.find(x => x.id === this.openMark) : undefined;
    if (m && this.pop) { this.pop.querySelector('.vc-vt-pop-time')?.setText(markTime(m)); this.placePop(m); }
    this.renderCover();
    this.renderTime();
  }

  /** Keys while the card is the only selection (the player's own shortcuts, like Director Vault). */
  onKey(e: KeyboardEvent): boolean {
    if (e.metaKey || e.ctrlKey || e.altKey || this.notice) return false;
    switch (e.code) {
      case 'Space': this.togglePlay(); return true;
      case 'ArrowLeft': this.step(e.shiftKey ? -10 : -1); return true;
      case 'ArrowRight': this.step(e.shiftKey ? 10 : 1); return true;
      case 'KeyI': this.markIn(); return true;
      case 'KeyO': this.markOut(); return true;
      case 'KeyM': this.addPoint(); return true;
      case 'KeyJ': if (!e.repeat) this.startReverse(e.shiftKey ? 0.5 : 1); return true;
      case 'KeyK': this.video.pause(); return true;
      case 'KeyL': this.shuttle(); return true;
      default: return false;
    }
  }

  destroy(): void {
    this.stopReverse();
    this.ctrl.remove();
    cancelAnimationFrame(this.raf);
    this.video.pause();
  }
}
