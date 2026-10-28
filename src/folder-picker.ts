import { Modal, Setting, TFolder, setIcon, type App } from 'obsidian';
import { t } from './i18n';

/**
 * Pick folders of the vault by ticking them in a tree (with a filter box). A ticked folder
 * covers everything inside it, so its subfolders are shown as included.
 */
export class FolderPickModal extends Modal {
  private chosen: Set<string>;
  private filter = '';
  private expanded = new Set<string>();

  constructor(app: App, initial: string[], private done: (folders: string[]) => void | Promise<void>) {
    super(app);
    this.chosen = new Set(initial);
    // Open the way down to every chosen folder.
    for (const f of initial) { const parts = f.split('/'); for (let i = 1; i < parts.length; i++) this.expanded.add(parts.slice(0, i).join('/')); }
  }

  onOpen(): void {
    this.modalEl.addClass('vc-folder-modal');
    this.titleEl.setText(t('Choose folders'));
    const search = this.contentEl.createEl('input', { type: 'search', cls: 'vc-folder-search', attr: { placeholder: t('Filter…') } });
    search.addEventListener('input', () => { this.filter = search.value.trim().toLowerCase(); this.renderTree(); });
    this.contentEl.createDiv('vc-folder-tree');
    this.renderTree();
    new Setting(this.contentEl)
      .addButton(b => b.setButtonText(t('Cancel')).onClick(() => this.close()))
      .addButton(b => b.setButtonText(t('Done')).setCta().onClick(() => { this.close(); void this.done(this.result()); }));
  }

  onClose(): void { this.contentEl.empty(); }

  /** Chosen folders, without ones already inside another chosen folder. */
  private result(): string[] {
    const list = [...this.chosen].sort();
    return list.filter(f => !list.some(o => o !== f && f.startsWith(`${o}/`)));
  }

  private covered(path: string): boolean {
    for (const c of this.chosen) if (path.startsWith(`${c}/`)) return true;
    return false;
  }

  private renderTree(): void {
    const host = this.contentEl.querySelector<HTMLElement>('.vc-folder-tree')!;
    host.empty();
    const root = this.app.vault.getRoot();
    if (this.filter) {
      const all: TFolder[] = [];
      const walk = (f: TFolder) => { for (const c of f.children) if (c instanceof TFolder) { all.push(c); walk(c); } };
      walk(root);
      const hits = all.filter(f => f.path.toLowerCase().includes(this.filter)).sort((a, b) => a.path.localeCompare(b.path));
      if (!hits.length) host.createDiv({ cls: 'vc-folder-empty', text: t('No results') });
      for (const f of hits) this.row(host, f, 0, true);
      return;
    }
    const add = (folder: TFolder, depth: number) => {
      const subs = folder.children.filter((c): c is TFolder => c instanceof TFolder).sort((a, b) => a.name.localeCompare(b.name));
      for (const f of subs) {
        this.row(host, f, depth, false);
        if (this.expanded.has(f.path)) add(f, depth + 1);
      }
    };
    add(root, 0);
  }

  private row(host: HTMLElement, f: TFolder, depth: number, flat: boolean): void {
    const row = host.createDiv('vc-folder-row');
    row.style.paddingLeft = `${8 + depth * 18}px`;
    const hasSubs = f.children.some(c => c instanceof TFolder);
    const caret = row.createDiv('vc-folder-caret');
    if (hasSubs && !flat) {
      setIcon(caret, this.expanded.has(f.path) ? 'chevron-down' : 'chevron-right');
      caret.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.expanded.has(f.path)) this.expanded.delete(f.path); else this.expanded.add(f.path);
        this.renderTree();
      });
    }
    const cb = row.createEl('input', { type: 'checkbox' });
    const covered = this.covered(f.path);
    cb.checked = this.chosen.has(f.path) || covered;
    cb.disabled = covered;
    setIcon(row.createDiv('vc-folder-icon'), 'folder');
    row.createDiv({ cls: 'vc-folder-name', text: flat ? f.path : f.name });
    const toggle = () => {
      if (covered) return;
      if (this.chosen.has(f.path)) this.chosen.delete(f.path); else this.chosen.add(f.path);
      this.renderTree();
    };
    cb.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    row.addEventListener('click', toggle);
  }
}
