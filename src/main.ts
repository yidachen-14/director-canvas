import { Notice, Plugin, TFile, TFolder, normalizePath } from 'obsidian';
import { installRenameSync } from './rename-sync';
import { ARRANGE, runArrange } from './board/arrange-commands';
import { CanvasView } from './view/canvas-view';
import { VIEW_TYPE, installCanvasTakeover, switchCanvasView } from './takeover';
import { normalizeSettings, type VisualCanvasSettings } from './settings';
import { VisualCanvasSettingTab } from './settings-tab';
import { setLanguage, t } from './i18n';
import { registerAllCards } from './cards';
import { serializeCanvas, emptyCanvas } from './model/canvas-file';
import { installExport } from './export';
import type { Board } from './board/board';

export default class VisualCanvasPlugin extends Plugin {
  settings!: VisualCanvasSettings;

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    setLanguage(this.settings.language);
    registerAllCards();

    this.registerView(VIEW_TYPE, leaf => new CanvasView(leaf, this));
    this.register(installCanvasTakeover(path => this.takesOver(path)));
    this.addSettingTab(new VisualCanvasSettingTab(this.app, this));

    this.addRibbonIcon('layout-dashboard', t('New Director Canvas board'), () => { void this.createBoard(); });

    this.addCommand({ id: 'new-board', name: t('New board'), callback: () => { void this.createBoard(); } });
    this.addCommand({
      id: 'open-in-core-canvas',
      name: t('Open this board in core Canvas'),
      checkCallback: (checking) => {
        const leaf = this.app.workspace.getActiveViewOfType(CanvasView)?.leaf;
        if (!leaf) return false;
        if (!checking) void switchCanvasView(leaf, 'native');
        return true;
      },
    });
    this.addCommand({
      id: 'open-as-whiteboard',
      name: t('Open this board as a whiteboard'),
      checkCallback: (checking) => {
        const leaf = this.app.workspace.getMostRecentLeaf();
        if (!leaf || leaf.view.getViewType() !== 'canvas') return false;
        if (!checking) void switchCanvasView(leaf, 'visual');
        return true;
      },
    });

    installRenameSync(this);
    installExport(this);

    // Arranging (PureRef-style): every command can get its own keys in Settings → Hotkeys.
    for (const d of ARRANGE) {
      this.addCommand({
        id: `arrange-${d.id}`,
        name: t(d.label),
        icon: d.icon,
        checkCallback: (checking) => {
          const board = this.app.workspace.getActiveViewOfType(CanvasView)?.board;
          if (!board) return false;
          if (!checking) runArrange(board, d.id);
          return true;
        },
      });
    }

    // Right-click a .canvas file: open it with the other view.
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || file.extension !== 'canvas') return;
      menu.addItem(i => i.setTitle(t('Open in Director Canvas')).setIcon('layout-dashboard').setSection('open').onClick(async () => {
        const leaf = this.app.workspace.getLeaf('tab');
        await leaf.setViewState({ type: VIEW_TYPE, state: { file: file.path }, active: true });
      }));
      menu.addItem(i => i.setTitle(t('Open in core Canvas')).setIcon('layout-grid').setSection('open').onClick(async () => {
        const leaf = this.app.workspace.getLeaf('tab');
        await leaf.setViewState({ type: 'canvas', state: { file: file.path, vcNative: true }, active: true });
      }));
    }));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFolder)) return;
      menu.addItem(i => i.setTitle(t('New Director Canvas board')).setIcon('layout-dashboard').setSection('action-primary').onClick(() => { void this.createBoard(file); }));
    }));

    // Boards already open in the core view switch over when the plugin loads.
    this.app.workspace.onLayoutReady(() => {
      this.app.workspace.getLeavesOfType('canvas').forEach(leaf => {
        const file = (leaf.getViewState().state as { file?: string } | undefined)?.file;
        if (this.takesOver(file)) void switchCanvasView(leaf, 'visual');
      });
    });
  }

  onunload(): void {
    // Hand open boards back to the core view so no pane is left blank.
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(leaf => { void switchCanvasView(leaf, 'native'); });
  }

  /** Whether a board at `path` opens with Director Canvas. */
  /** The board in the active view, if any. */
  activeBoard(): Board | null {
    return this.app.workspace.getActiveViewOfType(CanvasView)?.board ?? null;
  }

  takesOver(path: string | undefined): boolean {
    if (!this.settings.openCanvasByDefault) return false;
    const folders = this.settings.takeoverFolders.map(f => f.replace(/^\/+|\/+$/g, '')).filter(Boolean);
    if (!folders.length) return true;
    if (!path) return false;
    return folders.some(f => path === f || path.startsWith(f + '/'));
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  boards(): CanvasView[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map(l => l.view).filter((v): v is CanvasView => v instanceof CanvasView);
  }

  /** Settings changed: redraw toolbars and appearance on every open board. */
  refreshBoards(): void {
    for (const v of this.boards()) v.board?.refreshUi();
  }

  /** Language changed: rebuild cards and UI text. */
  remountBoards(): void {
    for (const v of this.boards()) { v.board?.refreshUi(); v.board?.remountAll(); }
  }

  openSettings(): void {
    const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
    setting?.open();
    setting?.openTabById(this.manifest.id);
  }

  /** New board in Obsidian's default location for new files, opened with its name ready to edit. */
  async createBoard(folder?: TFolder): Promise<void> {
    try {
      const parent = folder ?? this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path ?? '');
      const dir = parent && !parent.isRoot() ? `${parent.path}/` : '';
      const base = t('Untitled board');
      let path = normalizePath(`${dir}${base}.canvas`);
      for (let i = 1; this.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${dir}${base} ${i}.canvas`);
      const file = await this.app.vault.create(path, serializeCanvas(emptyCanvas()));
      const leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, state: { file: file.path }, active: true });
      const view = leaf.view;
      if (view instanceof CanvasView) window.setTimeout(() => view.beginTitleRename(), 50);
    } catch (err) {
      new Notice(t('Could not create the board: {msg}', { msg: (err as Error).message }));
    }
  }
}
