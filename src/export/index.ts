import { Modal, Notice, Setting, type Menu, type Plugin } from 'obsidian';
import type { Board } from '../board/board';
import { contributeMenu } from '../board/menus';
import { contributeOverflow } from '../board/ui';
import { t } from '../i18n';
import type { Scope } from './stage';
import { boundsOf, scopeNodes } from './stage';
import { exportPdf, type PageSize } from './pdf';
import { canvasBytes, renderCanvas } from './raster';
import { exportHtml } from './html';
import { buildBundle, zipFiles } from './bundle';
import { saveFile, saveFolder, usableFolder } from './files';

export type Format = 'pdf' | 'png' | 'html' | 'bundle';

const FORMATS: { id: Format; label: string; icon: string }[] = [
  { id: 'pdf', label: 'PDF', icon: 'file-text' },
  { id: 'png', label: 'PNG', icon: 'image' },
  { id: 'html', label: 'HTML', icon: 'globe' },
  { id: 'bundle', label: 'Source files', icon: 'package' },
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
  scale: number;
}

/** PNG scales on offer; the largest ones suit a few selected cards. */
const PNG_SCALES = [1, 2, 3, 4, 5];
/** Beyond these a picture is too big to draw reliably (the app can run out of memory and hang). */
const PNG_MAX_SIDE = 16000;
const PNG_MAX_PIXELS = 64_000_000;
const PNG_PADDING = (scope: Scope) => (scope.kind === 'object' ? 16 : 32);

/** The largest scale a scope can be drawn at within the limits (below 1 for a very large board). */
export function pngMaxScale(board: Board, scope: Scope): number {
  const b = boundsOf(scopeNodes(board, scope), PNG_PADDING(scope));
  const k = Math.min(PNG_MAX_SIDE / b.width, PNG_MAX_SIDE / b.height, Math.sqrt(PNG_MAX_PIXELS / (b.width * b.height)));
  return Math.floor(k * 100) / 100;
}

/** The PNG's size in pixels at a scale, and whether it can be made. */
export function pngSize(board: Board, scope: Scope, scale: number): { w: number; h: number; ok: boolean } {
  const b = boundsOf(scopeNodes(board, scope), PNG_PADDING(scope));
  const w = Math.round(b.width * scale), h = Math.round(b.height * scale);
  return { w, h, ok: w <= PNG_MAX_SIDE && h <= PNG_MAX_SIDE && w * h <= PNG_MAX_PIXELS };
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
      if (!pngSize(board, scope, o.scale).ok) { working.hide(); new Notice(t('Too large for a PNG at this resolution. Pick a lower one, or select fewer cards.'), 8000); return; }
      const r = await renderCanvas(board, scope, { scale: o.scale, background: o.background, padding: PNG_PADDING(scope) });
      where = await saveFile(board.app, s.exportFolder, `${name}.png`, await canvasBytes(r.canvas, 'image/png'), { name: 'PNG', extensions: ['png'] });
    } else if (format === 'html') {
      const h = await exportHtml(board, scope, name);
      where = await saveFolder(board.app, s.exportFolder, name, top => h.files(top), zipFiles);
    } else {
      // The source files: the board with every note and attachment it uses, embeds included.
      const b = buildBundle(board.app, board, true);
      where = await saveFolder(board.app, s.exportFolder, b.name, top => b.files(top), zipFiles);
      if (where) new Notice(t('Bundled the board with {n} files.', { n: b.count }));
    }
    working.hide();
    if (where) new Notice(t('Exported: {path}', { path: where }), 6000);
  } catch (e) {
    working.hide();
    console.error('Director Canvas: export failed', e);
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
    this.o = { page: 'content', background: true, scale: s.pngScale };
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
      // Each resolution with the picture's size; the ones too big to draw are left out.
      const sizes = PNG_SCALES.map(k => ({ k, ...pngSize(this.board, this.what, k) }));
      // A board too large even at 1x still exports, at the largest size that is safe to draw.
      if (!sizes[0].ok) {
        const k = pngMaxScale(this.board, this.what);
        if (k > 0) sizes.unshift({ k, ...pngSize(this.board, this.what, k) });
      }
      const usable = sizes.filter(x => x.ok);
      if (!usable.some(x => x.k === o.scale)) o.scale = usable.length ? usable[usable.length - 1].k : 1;
      new Setting(el).setName(t('Resolution'))
        .addDropdown(d => {
          for (const x of sizes) {
            d.addOption(String(x.k), `${x.k < 1 ? `${Math.round(x.k * 100)}%` : `${x.k}x`} · ${x.w} × ${x.h}${x.ok ? '' : ` (${t('too large')})`}`);
            if (!x.ok) d.selectEl.querySelector<HTMLOptionElement>(`option[value="${x.k}"]`)?.setAttr('disabled', 'true');
          }
          d.setValue(String(o.scale)).onChange(v => { o.scale = Number(v); });
        });
      new Setting(el).setName(t('Background'))
        .addDropdown(d => d.addOptions({ board: t('The board’s background'), none: t('Transparent') })
          .setValue(o.background ? 'board' : 'none').onChange(v => { o.background = v === 'board'; }));
      if (!usable.length) el.createDiv({ cls: 'vc-export-note mod-warning', text: t('Too large for a PNG at this resolution. Pick a lower one, or select fewer cards.') });
    } else if (this.format === 'html') {
      el.createDiv({ cls: 'vc-export-note', text: t('A folder with index.html and the pictures and videos next to it.') });
      el.createDiv({ cls: 'vc-export-note', text: t('Opens in any browser: drag to move, ⌘/Ctrl + scroll to zoom, a minimap and search.') });
    } else {
      el.createDiv({ cls: 'vc-export-note', text: t('The board and every note and attachment it uses go into one folder, with paths changed to match. Put the folder at the top of any vault.') });
      el.createDiv({ cls: 'vc-export-note', text: t('Also pack the pictures and notes that the board’s notes embed.') });
    }

    const where = usableFolder(this.board.settings.exportFolder);
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

/** One entry that opens the export dialog (the format is picked there). */
function exportItem(menu: Menu, title: string, board: Board, scope: Scope): void {
  menu.addItem(item => item.setTitle(title).setIcon('download').setSection('export').onClick(() => new ExportModal(board, scope).open()));
}

/** Menu entries and commands. */
export function installExport(plugin: Plugin & { activeBoard(): Board | null }): void {
  contributeOverflow({ section: 'export', last: true, icon: 'download', label: 'Board export options…', run: (board) => new ExportModal(board, { kind: 'board' }).open() });
  contributeMenu({ where: 'board', section: 'export', add: (menu, board) => exportItem(menu, t('Board export options…'), board, { kind: 'board' }) });
  contributeMenu({
    where: 'card', section: 'export',
    add: (menu, board) => {
      if (board.selection.size !== 1) return;
      exportItem(menu, `${t('Export this object')}…`, board, { kind: 'object', id: [...board.selection][0] });
    },
  });
  contributeMenu({ where: 'multi', section: 'export', add: (menu, board) => exportItem(menu, `${t('Export the selection')}…`, board, { kind: 'selection' }) });

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
