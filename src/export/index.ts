import { Menu, Modal, Notice, Setting, type MenuItem, type Plugin } from 'obsidian';
import type { Board } from '../board/board';
import { contributeMenu } from '../board/menus';
import { t } from '../i18n';
import type { Scope } from './stage';
import { scopeNodes } from './stage';
import { exportPdf, type PageSize } from './pdf';
import { canvasBytes, renderCanvas } from './raster';
import { exportHtml } from './html';
import { buildBundle, zipFiles } from './bundle';
import { saveFile, saveFolder } from './files';

export type Format = 'pdf' | 'png' | 'html' | 'bundle';

const FORMATS: { id: Format; label: string; icon: string }[] = [
  { id: 'pdf', label: 'PDF', icon: 'file-text' },
  { id: 'png', label: 'PNG', icon: 'image' },
  { id: 'html', label: 'HTML', icon: 'globe' },
  { id: 'bundle', label: 'Bundle', icon: 'package' },
];

/** Which formats a scope offers (spec: HTML for the board and a selection, bundles for the whole board). */
export function formatsFor(scope: Scope): Format[] {
  if (scope.kind === 'object') return ['pdf', 'png'];
  if (scope.kind === 'selection') return ['pdf', 'png', 'html'];
  return ['pdf', 'png', 'html', 'bundle'];
}

interface Options {
  page: PageSize;
  background: boolean;
  scale: 1 | 2 | 3;
  htmlSingle: boolean;
  bundleZip: boolean;
  bundleEmbeds: boolean;
}

function baseName(board: Board, scope: Scope): string {
  const name = board.sourcePath.split('/').pop()!.replace(/\.canvas$/, '');
  if (scope.kind === 'board') return name;
  if (scope.kind === 'selection') return `${name} – ${t('selection')}`;
  const n = board.model.node(scope.id);
  const label = (n?.label || n?.file?.split('/').pop()?.replace(/\.[^.]+$/, '') || (n?.text ?? '').replace(/[#*>\-[\]!`]/g, '').trim().split('\n')[0] || t('object')).slice(0, 40);
  return `${name} – ${label}`;
}
const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'export';

/** Do the export and say where it went. */
export async function runExport(board: Board, scope: Scope, format: Format, o: Options): Promise<void> {
  const s = board.settings;
  const name = safe(baseName(board, scope));
  if (!scopeNodes(board, scope).length) { new Notice(t('Nothing to export.')); return; }
  const working = new Notice(t('Exporting…'), 0);
  try {
    let where: string | null = null;
    if (format === 'pdf') {
      const data = await exportPdf(board, scope, { page: o.page, background: o.background });
      where = await saveFile(board.app, s.exportFolder, `${name}.pdf`, data, { name: 'PDF', extensions: ['pdf'] });
    } else if (format === 'png') {
      const r = await renderCanvas(board, scope, { scale: o.scale, background: o.background, padding: scope.kind === 'object' ? 16 : 32 });
      if (r.scale < o.scale) new Notice(t('The board is very large: exported at {n}x.', { n: Math.round(r.scale * 100) / 100 }));
      where = await saveFile(board.app, s.exportFolder, `${name}.png`, await canvasBytes(r.canvas, 'image/png'), { name: 'PNG', extensions: ['png'] });
    } else if (format === 'html') {
      const h = await exportHtml(board, scope, name, o.htmlSingle);
      if (o.htmlSingle) where = await saveFile(board.app, s.exportFolder, `${name}.html`, h.single, { name: 'HTML', extensions: ['html'] });
      else where = await saveFolder(board.app, s.exportFolder, name, top => h.files(top), zipFiles);
    } else {
      const b = buildBundle(board.app, board, o.bundleEmbeds);
      if (o.bundleZip) where = await saveFile(board.app, s.exportFolder, `${b.name}.zip`, zipFiles(await b.files(b.name)), { name: 'ZIP', extensions: ['zip'] });
      else where = await saveFolder(board.app, s.exportFolder, b.name, top => b.files(top), zipFiles);
      if (where) new Notice(t('Bundled the board with {n} files.', { n: b.count }));
    }
    working.hide();
    if (where) new Notice(t('Exported: {path}', { path: where }), 6000);
  } catch (e) {
    working.hide();
    console.error('Visual Canvas: export failed', e);
    new Notice(t('Export failed: {msg}', { msg: e instanceof Error ? e.message : String(e) }), 8000);
  }
}

/** Export dialog: format, its options, and where it goes. */
export class ExportModal extends Modal {
  private format: Format;
  private o: Options;

  constructor(private board: Board, private what: Scope, format?: Format) {
    super(board.app);
    const list = formatsFor(what);
    this.format = format && list.includes(format) ? format : list[0];
    const s = board.settings;
    this.o = { page: 'content', background: true, scale: s.pngScale, htmlSingle: s.htmlMode === 'single', bundleZip: false, bundleEmbeds: false };
  }

  onOpen(): void { this.render(); }
  onClose(): void { this.contentEl.empty(); }

  private render(): void {
    const el = this.contentEl;
    el.empty();
    el.addClass('vc-export-modal');
    const scopeLabel = this.what.kind === 'board' ? t('The whole board')
      : this.what.kind === 'selection' ? t('{n} selected', { n: this.board.selection.size }) : t('This object');
    this.titleEl.setText(`${t('Export')} · ${scopeLabel}`);

    const chips = el.createDiv('vc-export-formats');
    for (const f of FORMATS.filter(x => formatsFor(this.what).includes(x.id))) {
      const c = chips.createDiv({ cls: 'vc-export-format', attr: { role: 'button' } });
      c.createDiv({ cls: 'vc-export-format-name', text: t(f.label) });
      c.toggleClass('is-active', this.format === f.id);
      c.addEventListener('click', () => { this.format = f.id; this.render(); });
    }

    const o = this.o;
    if (this.format === 'pdf') {
      new Setting(el).setName(t('Page size')).setDesc(t('Fit the content: one page exactly as large as the board.'))
        .addDropdown(d => d.addOptions({ content: t('Fit the content'), A4: 'A4', A3: 'A3', Letter: 'Letter' }).setValue(o.page).onChange(v => { o.page = v as PageSize; }));
      new Setting(el).setName(t('Background')).addToggle(x => x.setValue(o.background).onChange(v => { o.background = v; }));
    } else if (this.format === 'png') {
      new Setting(el).setName(t('Resolution'))
        .addDropdown(d => d.addOptions({ 1: '1x', 2: '2x', 3: '3x' }).setValue(String(o.scale)).onChange(v => { o.scale = Number(v) as 1 | 2 | 3; }));
      new Setting(el).setName(t('Background')).setDesc(t('Off: a transparent picture.')).addToggle(x => x.setValue(o.background).onChange(v => { o.background = v; }));
    } else if (this.format === 'html') {
      new Setting(el).setName(t('Form')).setDesc(t('A folder keeps pictures and videos as files next to index.html; a single file holds everything.'))
        .addDropdown(d => d.addOptions({ folder: t('Folder (index.html + files)'), single: t('Single file') }).setValue(o.htmlSingle ? 'single' : 'folder').onChange(v => { o.htmlSingle = v === 'single'; }));
      el.createDiv({ cls: 'vc-export-note', text: t('Opens in any browser: drag to move, ⌘/Ctrl + scroll to zoom, a minimap and search.') });
    } else {
      new Setting(el).setName(t('Form'))
        .addDropdown(d => d.addOptions({ folder: t('Folder'), zip: 'ZIP' }).setValue(o.bundleZip ? 'zip' : 'folder').onChange(v => { o.bundleZip = v === 'zip'; }));
      new Setting(el).setName(t('Include files embedded in notes')).setDesc(t('Also pack the pictures and notes that the board’s notes embed.'))
        .addToggle(x => x.setValue(o.bundleEmbeds).onChange(v => { o.bundleEmbeds = v; }));
      el.createDiv({ cls: 'vc-export-note', text: t('The board and every note and attachment it uses go into one folder, with paths changed to match. Put the folder at the top of any vault.') });
    }

    const where = this.board.settings.exportFolder.trim();
    el.createDiv({ cls: 'vc-export-note', text: where ? t('Saves to: {path}', { path: where }) : t('You choose where to save it.') });
    new Setting(el)
      .addButton(b => b.setButtonText(t('Cancel')).onClick(() => this.close()))
      .addButton(b => b.setButtonText(t('Export')).setCta().onClick(() => {
        const { board, what: scope, format } = this;
        const opts = { ...this.o };
        this.close();
        void runExport(board, scope, format, opts);
      }));
  }
}

type SubItem = MenuItem & { setSubmenu?: () => Menu };

function exportSubmenu(menu: Menu, title: string, board: Board, scope: Scope): void {
  menu.addItem((item: SubItem) => {
    item.setTitle(title).setIcon('download').setSection('export');
    const formats = formatsFor(scope);
    if (item.setSubmenu) {
      const sub = item.setSubmenu();
      for (const f of FORMATS.filter(x => formats.includes(x.id))) {
        sub.addItem(i => i.setTitle(`${t(f.label)}…`).setIcon(f.icon).onClick(() => new ExportModal(board, scope, f.id).open()));
      }
    } else item.onClick(() => new ExportModal(board, scope).open());
  });
}

/** Menu entries and commands. */
export function installExport(plugin: Plugin & { activeBoard(): Board | null }): void {
  contributeMenu({ where: 'board', section: 'export', add: (menu, board) => exportSubmenu(menu, t('Export the whole board'), board, { kind: 'board' }) });
  contributeMenu({
    where: 'card', section: 'export',
    add: (menu, board) => {
      if (board.selection.size !== 1) return;
      exportSubmenu(menu, t('Export this object'), board, { kind: 'object', id: [...board.selection][0] });
    },
  });
  contributeMenu({ where: 'multi', section: 'export', add: (menu, board) => exportSubmenu(menu, t('Export the selection'), board, { kind: 'selection' }) });

  for (const f of FORMATS) {
    plugin.addCommand({
      id: `export-board-${f.id}`,
      name: t('Export the whole board as {format}', { format: t(f.label) }),
      checkCallback: (checking) => {
        const b = plugin.activeBoard();
        if (!b) return false;
        if (!checking) new ExportModal(b, { kind: 'board' }, f.id).open();
        return true;
      },
    });
  }
  plugin.addCommand({
    id: 'export-selection',
    name: t('Export the selection'),
    checkCallback: (checking) => {
      const b = plugin.activeBoard();
      if (!b || !b.selection.size) return false;
      if (!checking) new ExportModal(b, b.selection.size === 1 ? { kind: 'object', id: [...b.selection][0] } : { kind: 'selection' }).open();
      return true;
    },
  });
}
