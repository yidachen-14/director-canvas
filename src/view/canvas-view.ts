import { attachInsets } from '../board/insets';
import { Notice, Scope, TextFileView, type TFile, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type VisualCanvasPlugin from '../main';
import { VIEW_TYPE, switchCanvasView } from '../takeover';
import { parseCanvas, serializeCanvas, emptyCanvas } from '../model/canvas-file';
import { settleSidesForSave } from '../board/connections';
import { Board } from '../board/board';
import { attachInteractions } from '../board/interactions';
import { installColumns } from '../board/columns';
import { attachClipboard } from '../board/clipboard';
import { attachContextMenu } from '../board/menus';
import { attachCorner, attachToolbar } from '../board/ui';
import { SpacingHandles } from '../board/spacing';
import { ContextBar } from '../board/context-bar';
import { t } from '../i18n';
import { installShortcuts } from '../board/shortcuts';

interface SavedViewport { x: number; y: number; zoom: number; }

export class CanvasView extends TextFileView {
  board: Board | null = null;
  private pendingViewport: SavedViewport | null = null;
  private savedPill: HTMLElement | null = null;
  private pillTimer = 0;
  private lastSaved = '';

  constructor(leaf: WorkspaceLeaf, readonly plugin: VisualCanvasPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return this.file?.basename ?? 'Director Canvas'; }
  getIcon(): string { return 'layout-dashboard'; }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('vc-view');
    const board = new Board(this, this.plugin, this.contentEl);
    this.board = board;
    installColumns(board);
    attachInteractions(board);
    attachClipboard(board);
    attachContextMenu(board);
    attachToolbar(board);
    attachCorner(board);
    new ContextBar(board);
    new SpacingHandles(board);
    attachInsets(board);
    this.savedPill = this.contentEl.createDiv({ cls: 'vc-saved-pill', text: t('Saved') });
    this.addAction('layout-grid', t('Open in core Canvas'), () => { void switchCanvasView(this.leaf, 'native'); });
    this.setupTitleRename();
    this.scope = new Scope(this.app.scope);
    installShortcuts(this.scope, () => this.board);
    // Keep the board sized to its pane.
    const ro = new ResizeObserver(() => { board.applyViewport(); this.tryInitialView(); });
    ro.observe(this.contentEl);
    this.register(() => ro.disconnect());
  }

  /** Leaving the file (closing, switching to the core Canvas): write pending changes first. */
  async onUnloadFile(file: TFile): Promise<void> {
    if (this.board && this.file === file) {
      this.board.stopEditing();
      await this.save();
    }
    await super.onUnloadFile(file);
  }

  async onClose(): Promise<void> {
    if (this.board && this.file) {
      this.board.stopEditing();
      try { await this.save(); } catch (err) { console.error('Director Canvas: save on close failed', err); }
    }
    this.board?.destroy();
    this.board = null;
  }

  // ── data ──────────────────────────────────────────────────

  getViewData(): string {
    return this.board ? serializeCanvas(this.board.model.toFile(), settleSidesForSave) : this.data;
  }

  setViewData(data: string, clear: boolean): void {
    if (!this.board) return;
    if (!clear && data === this.lastSaved) return; // our own write echoing back
    let parsed;
    try {
      parsed = parseCanvas(data);
    } catch (err) {
      new Notice(t('This board could not be read: {msg}', { msg: (err as Error).message }));
      parsed = emptyCanvas();
    }
    this.board.load(parsed, !clear);
    if (clear) {
      this.board.clearSelection();
      this.needsInitialView = true;
      window.requestAnimationFrame(() => this.tryInitialView());
    }
  }

  private needsInitialView = false;

  /** First view of a board: the saved viewport, or everything in view. Waits until the pane has a size. */
  private tryInitialView(): void {
    const board = this.board;
    if (!board || !this.needsInitialView) return;
    const { width, height } = board.screenSize();
    if (width < 50 || height < 50) return;
    this.needsInitialView = false;
    if (this.pendingViewport) {
      Object.assign(board.vp, this.pendingViewport);
      board.applyViewport();
      this.pendingViewport = null;
    } else {
      board.zoomToFit();
    }
  }

  clear(): void {
    this.board?.stopEditing();
  }

  async save(clear?: boolean): Promise<void> {
    const before = this.data;
    await super.save(clear);
    const now = this.getViewData();
    this.lastSaved = now;
    if (now !== before) this.flashSaved();
  }

  private flashSaved(): void {
    const pill = this.savedPill;
    if (!pill) return;
    pill.addClass('is-visible');
    window.clearTimeout(this.pillTimer);
    this.pillTimer = window.setTimeout(() => pill.removeClass('is-visible'), 1600);
  }

  // ── view state (viewport survives restarts) ───────────────

  getState(): Record<string, unknown> {
    const state = super.getState();
    if (this.board) state.viewport = this.board.vp.toJSON();
    return state;
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const vp = (state as { viewport?: SavedViewport } | null)?.viewport;
    if (vp && Number.isFinite(vp.x) && Number.isFinite(vp.y) && Number.isFinite(vp.zoom)) this.pendingViewport = vp;
    await super.setState(state, result);
  }

  // ── title: click the name in the header to rename the file ──

  private setupTitleRename(): void {
    const title = (this as unknown as { titleEl?: HTMLElement }).titleEl;
    if (!title) return;
    title.addClass('vc-title');
    title.addEventListener('click', () => this.beginTitleRename());
  }

  beginTitleRename(): void {
    const title = (this as unknown as { titleEl?: HTMLElement }).titleEl;
    const file = this.file;
    if (!title || !file || title.isContentEditable) return;
    title.contentEditable = 'plaintext-only';
    title.setText(file.basename);
    title.focus();
    const range = document.createRange();
    range.selectNodeContents(title);
    const sel = window.getSelection();
    sel?.removeAllRanges(); sel?.addRange(range);
    let done = false;
    const finish = async (save: boolean) => {
      if (done) return; done = true;
      title.contentEditable = 'false';
      const name = (title.textContent ?? '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim();
      title.setText(file.basename);
      if (!save || !name || name === file.basename) return;
      const parent = file.parent?.path && file.parent.path !== '/' ? `${file.parent.path}/` : '';
      const path = `${parent}${name}.${file.extension}`;
      if (this.app.vault.getAbstractFileByPath(path)) { new Notice(t('A file named "{name}" already exists.', { name })); return; }
      try { await this.app.fileManager.renameFile(file, path); }
      catch (err) { new Notice(t('Could not rename: {msg}', { msg: (err as Error).message })); }
    };
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); void finish(true); title.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); void finish(false); title.blur(); }
    });
    title.addEventListener('blur', () => { void finish(true); }, { once: true });
  }
}
