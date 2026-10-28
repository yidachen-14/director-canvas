import { Modal, Setting, setIcon, setTooltip, type App } from 'obsidian';
import type VisualCanvasPlugin from './main';
import { allShortcuts, keyLabel, keyString, keysFor, SHORTCUT_GROUPS, type Shortcut } from './board/shortcuts';
import { t } from './i18n';

/**
 * Every board shortcut with its keys. Click a key to record a new one; the arrow resets
 * it to the default. Kept out of the main settings page so that page stays short.
 */
export class ShortcutsModal extends Modal {
  private filter = '';
  private recording: string | null = null;
  private offKey: (() => void) | null = null;

  constructor(app: App, private plugin: VisualCanvasPlugin) { super(app); }

  onOpen(): void {
    this.modalEl.addClass('vc-keys-modal');
    this.titleEl.setText(t('Keyboard shortcuts'));
    const search = this.contentEl.createEl('input', { type: 'search', cls: 'vc-keys-search', attr: { placeholder: t('Filter…') } });
    search.addEventListener('input', () => { this.filter = search.value.trim().toLowerCase(); this.renderList(); });
    this.contentEl.createDiv('vc-keys-list');
    this.renderList();
  }

  onClose(): void { this.stopRecording(); this.contentEl.empty(); }

  private get custom(): Record<string, string> { return this.plugin.settings.hotkeys; }

  private async save(): Promise<void> {
    await this.plugin.saveSettings();
    this.plugin.refreshBoards();
  }

  private renderList(): void {
    const list = this.contentEl.querySelector<HTMLElement>('.vc-keys-list')!;
    list.empty();
    const all = allShortcuts();
    // Which key strings are used more than once (a conflict to point out).
    const uses = new Map<string, number>();
    for (const s of all) for (const k of keysFor(s, this.custom)) uses.set(k, (uses.get(k) ?? 0) + 1);
    for (const g of SHORTCUT_GROUPS) {
      const items = all.filter(s => s.group === g.id && (!this.filter || t(s.label).toLowerCase().includes(this.filter) || s.label.toLowerCase().includes(this.filter)));
      if (!items.length) continue;
      list.createDiv({ cls: 'vc-keys-group', text: t(g.label) });
      for (const s of items) this.row(list, s, uses);
    }
  }

  private row(list: HTMLElement, s: Shortcut, uses: Map<string, number>): void {
    const row = new Setting(list).setName(t(s.label));
    row.settingEl.addClass('vc-keys-row');
    const keys = keysFor(s, this.custom);
    const chip = row.controlEl.createDiv({ cls: 'vc-keys-chip', attr: { role: 'button' } });
    if (this.recording === s.id) { chip.addClass('is-recording'); chip.setText(t('Press keys…')); }
    else if (keys.length) chip.setText(keys.map(keyLabel).join(' · '));
    else { chip.addClass('is-empty'); chip.setText(t('Not set')); }
    if (keys.some(k => (uses.get(k) ?? 0) > 1)) { chip.addClass('is-conflict'); setTooltip(chip, t('Used by more than one command')); }
    chip.addEventListener('click', () => this.startRecording(s.id));

    const changed = Object.prototype.hasOwnProperty.call(this.custom, s.id);
    const clear = row.controlEl.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': t('Remove') } });
    setIcon(clear, 'x');
    clear.toggleClass('is-hidden', !keys.length);
    clear.addEventListener('click', () => { void (async () => { this.custom[s.id] = ''; await this.save(); this.renderList(); })(); });
    const reset = row.controlEl.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': t('Restore default') } });
    setIcon(reset, 'rotate-ccw');
    reset.toggleClass('is-hidden', !changed);
    reset.addEventListener('click', () => { void (async () => {delete this.custom[s.id]; await this.save(); this.renderList(); })(); });
  }

  private startRecording(id: string): void {
    this.stopRecording();
    this.recording = id;
    this.renderList();
    // Through the modal's own key scope, which sees keys before Obsidian's hotkeys do.
    const handler = this.scope.register(null, null, (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) { this.stopRecording(); this.renderList(); return false; }
      const ks = keyString(e);
      if (!ks) return false; // just a modifier so far
      this.custom[id] = ks;
      this.stopRecording();
      void this.save().then(() => this.renderList());
      return false;
    });
    this.offKey = () => this.scope.unregister(handler);
  }

  private stopRecording(): void {
    this.offKey?.();
    this.offKey = null;
    this.recording = null;
  }
}
