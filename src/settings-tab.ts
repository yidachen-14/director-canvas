import { App, ColorComponent, PluginSettingTab, Setting, setIcon } from 'obsidian';
import type VisualCanvasPlugin from './main';
import { DEFAULT_SETTINGS, type TextCardKind, type ToolbarPosition, type ToolbarSize } from './settings';
import { availableTools, FIXED_TOOLS } from './board/tools';
import { setLanguage, t, type Language } from './i18n';
import { ShortcutsModal } from './shortcuts-modal';
import { FolderPickModal } from './folder-picker';

const TEXT_KINDS: TextCardKind[] = ['text', 'note', 'sticky', 'callout'];
const KIND_LABEL: Record<TextCardKind, string> = { text: 'Text', note: 'Note', sticky: 'Sticky note', callout: 'Callout' };

export class VisualCanvasSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: VisualCanvasPlugin) {
    super(app, plugin);
  }

  private async save(redrawBoards = true): Promise<void> {
    await this.plugin.saveSettings();
    if (redrawBoards) this.plugin.refreshBoards();
  }

  display(): void {
    const el = this.containerEl;
    el.empty();
    el.addClass('vc-settings');
    const s = this.plugin.settings;

    new Setting(el)
      .setName(t('Language'))
      .addDropdown(d => d
        .addOption('zh-TW', '繁體中文')
        .addOption('en', 'English')
        .setValue(s.language)
        .onChange(async (v) => {
          s.language = v as Language;
          setLanguage(s.language);
          await this.save();
          this.plugin.remountBoards();
          this.display();
        }));

    new Setting(el)
      .setName(t('Open .canvas files with Visual Canvas'))
      .setDesc(t('Boards open here instead of the core Canvas. You can always switch a board back from its header.'))
      .addToggle(tg => tg.setValue(s.openCanvasByDefault).onChange(async (v) => { s.openCanvasByDefault = v; await this.save(false); }));
    const folders = new Setting(el)
      .setName(t('Only in these folders'))
      .setDesc(t('Boards in these folders (and the folders inside them) open with Visual Canvas. None chosen: every board.'));
    const chips = folders.descEl.createDiv('vc-folder-chips');
    const paintChips = () => {
      chips.empty();
      for (const f of s.takeoverFolders) {
        const chip = chips.createDiv('vc-folder-chip');
        setIcon(chip.createSpan('vc-folder-chip-icon'), 'folder');
        chip.createSpan({ text: f });
        const x = chip.createSpan({ cls: 'vc-folder-chip-x', attr: { 'aria-label': t('Remove') } });
        setIcon(x, 'x');
        x.addEventListener('click', () => void (async () => {
          s.takeoverFolders = s.takeoverFolders.filter(v => v !== f);
          await this.save(false);
          paintChips();
        })());
      }
    };
    paintChips();
    folders.addButton(b => b.setButtonText(t('Choose folders…')).onClick(() => {
      new FolderPickModal(this.app, s.takeoverFolders, async (list) => {
        s.takeoverFolders = list;
        await this.save(false);
        paintChips();
      }).open();
    }));

    // ── Toolbar ──
    new Setting(el).setName(t('Toolbar')).setHeading();
    new Setting(el)
      .setName(t('Position'))
      .addDropdown(d => d
        .addOption('top', t('Top')).addOption('bottom', t('Bottom')).addOption('left', t('Left')).addOption('right', t('Right'))
        .setValue(s.toolbarPosition)
        .onChange(async (v) => { s.toolbarPosition = v as ToolbarPosition; await this.save(); }));
    new Setting(el)
      .setName(t('Size'))
      .setDesc(t('S shows icons only; M and L show names under the icons.'))
      .addDropdown(d => d
        .addOption('S', 'S').addOption('M', 'M').addOption('L', 'L')
        .setValue(s.toolbarSize)
        .onChange(async (v) => { s.toolbarSize = v as ToolbarSize; await this.save(); }));
    this.toolList(el);

    // ── Shortcuts ──
    new Setting(el).setName(t('Keyboard shortcuts')).setHeading();
    new Setting(el)
      .setName(t('Board shortcuts'))
      .setDesc(t('See every shortcut and change its keys.'))
      .addButton(b => b.setButtonText(t('Edit shortcuts…')).onClick(() => new ShortcutsModal(this.app, this.plugin).open()));

    // ── Text ──
    new Setting(el).setName(t('Text cards')).setHeading();
    const kindDropdown = (name: string, desc: string, key: 'doubleClickKind' | 'pasteTextKind' | 'dragOutKind') => {
      new Setting(el).setName(name).setDesc(desc).addDropdown(d => {
        for (const k of TEXT_KINDS) d.addOption(k, t(KIND_LABEL[k]));
        d.setValue(s[key]).onChange(async (v) => { s[key] = v as TextCardKind; await this.save(false); });
      });
    };
    kindDropdown(t('Double-click on the board creates'), t('The kind of card a double-click on an empty spot makes.'), 'doubleClickKind');
    kindDropdown(t('Pasted text becomes'), t('The kind of card made when you paste text onto the board.'), 'pasteTextKind');
    kindDropdown(t('Paragraphs dragged out of a card become'), t('The kind of card made when you drag a paragraph out onto the board.'), 'dragOutKind');
    new Setting(el)
      .setName(t('Default size of Text'))
      .setDesc(t('Font size of new Text cards, in pixels.'))
      .addText(tx => {
        tx.inputEl.type = 'number';
        tx.inputEl.min = '8'; tx.inputEl.max = '96';
        tx.setValue(String(s.defaultTextSize)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 8 && n <= 96) { s.defaultTextSize = Math.round(n); await this.save(false); }
        });
      });
    this.sizeSetting(el, t('Default size of Notes'), 'noteSize');
    this.sizeSetting(el, t('Default size of Sticky notes'), 'stickySize');
    this.sizeSetting(el, t('Default size of Callouts'), 'calloutSize');
    let picker: ColorComponent | null = null;
    new Setting(el)
      .setName(t('Default sticky note colour'))
      .addColorPicker(c => { picker = c; c.setValue(s.defaultStickyColor).onChange(async (v) => { s.defaultStickyColor = v; await this.save(false); }); })
      .addExtraButton(b => b.setIcon('rotate-ccw').setTooltip(t('Reset')).onClick(async () => {
        s.defaultStickyColor = DEFAULT_SETTINGS.defaultStickyColor;
        picker?.setValue(s.defaultStickyColor);
        await this.save(false);
      }));

    // ── Pictures ──
    new Setting(el).setName(t('Pictures')).setHeading();
    new Setting(el)
      .setName(t('Corner radius'))
      .setDesc(t('Rounding of image and video corners. 0 turns rounding off.'))
      .addSlider(sl => sl.setLimits(0, 24, 1).setValue(s.imageRadius).onChange(async (v) => { s.imageRadius = v; await this.save(); }));
    new Setting(el)
      .setName(t('Shadow'))
      .setDesc(t('A soft shadow under images and videos.'))
      .addToggle(tg => tg.setValue(s.imageShadow).onChange(async (v) => { s.imageShadow = v; await this.save(); }));

    // ── Connections ──
    new Setting(el).setName(t('Connections')).setHeading();
    new Setting(el)
      .setName(t('Shape of new connections'))
      .setDesc(t('Each connection can be changed afterwards in its properties bar.'))
      .addDropdown(d => d
        .addOption('straight', t('Straight')).addOption('curve', t('Curved')).addOption('elbow', t('Elbow'))
        .setValue(s.defaultRoute)
        .onChange(async (v) => { s.defaultRoute = v as typeof s.defaultRoute; await this.save(false); }));

    // ── Attachments ──
    new Setting(el).setName(t('Attachments')).setHeading();
    new Setting(el)
      .setName(t('Update boards when files are renamed or moved'))
      .setDesc(t('Paths of cards and [[links]] in every board follow the file, including boards that are not open.'))
      .addToggle(tg => tg.setValue(s.autoRelink).onChange(async (v) => { s.autoRelink = v; await this.save(false); }));

    // ── Canvas ──
    new Setting(el).setName(t('Board')).setHeading();
    new Setting(el)
      .setName(t('Pan with mouse button'))
      .setDesc(t('Holding the space bar and dragging always pans.'))
      .addDropdown(d => d
        .addOption('middle', t('Middle button')).addOption('right', t('Right button')).addOption('none', t('None'))
        .setValue(s.panButton)
        .onChange(async (v) => { s.panButton = v as typeof s.panButton; await this.save(false); }));
    new Setting(el)
      .setName(t('Grid'))
      .addDropdown(d => d.addOption('dots', t('Dots')).addOption('lines', t('Square grid'))
        .setValue(s.gridStyle).onChange(async (v) => { s.gridStyle = v as typeof s.gridStyle; await this.save(); }));
    new Setting(el)
      .setName(t('Dot size'))
      .setDesc(t('0 hides the grid.'))
      .addSlider(sl => sl.setLimits(0, 4, 0.5).setValue(s.dotSize).onChange(async (v) => { s.dotSize = v; await this.save(); }));
    this.colorSetting(el, t('Dot colour'), 'dotColor');
    this.colorSetting(el, t('Background colour'), 'backgroundColor');
    new Setting(el)
      .setName(t('Snap to grid'))
      .addToggle(tg => tg.setValue(s.snapToGrid).onChange(async (v) => { s.snapToGrid = v; await this.save(); }));
    new Setting(el)
      .setName(t('Grid size'))
      .addSlider(sl => sl.setLimits(10, 80, 5).setValue(s.gridSize).onChange(async (v) => { s.gridSize = v; await this.save(); }));

    // ── Arranging ──
    new Setting(el).setName(t('Arranging')).setHeading();
    new Setting(el)
      .setName(t('Gap between arranged cards'))
      .setDesc(t('Used by pushing, rows, columns and the automatic arrangements (px).'))
      .addSlider(sl => sl.setLimits(0, 80, 2).setValue(s.arrangeGap).onChange(async (v) => { s.arrangeGap = v; await this.save(false); }));
    new Setting(el)
      .setName(t('Same size: measure from'))
      .addDropdown(d => d
        .addOption('first', t('The first selected')).addOption('average', t('The average'))
        .setValue(s.normalizeBase)
        .onChange(async (v) => { s.normalizeBase = v as typeof s.normalizeBase; await this.save(false); }));

    // ── Export ──
    new Setting(el).setName(t('Export')).setHeading();
    new Setting(el)
      .setName(t('Export folder'))
      .setDesc(t('Empty: ask every time. A folder in the vault (Exports) or a full path on this computer (~/Desktop).'))
      .addText(tx => tx.setPlaceholder(t('Ask every time')).setValue(s.exportFolder).onChange(async (v) => { s.exportFolder = v.trim(); await this.save(false); }));
    new Setting(el)
      .setName(t('PNG resolution'))
      .addDropdown(d => d.addOptions({ 1: '1x', 2: '2x', 3: '3x' }).setValue(String(s.pngScale))
        .onChange(async (v) => { s.pngScale = Number(v) as 1 | 2 | 3; await this.save(false); }));
    new Setting(el)
      .setName(t('HTML export'))
      .addDropdown(d => d.addOptions({ folder: t('Folder (index.html + files)'), single: t('Single file') }).setValue(s.htmlMode)
        .onChange(async (v) => { s.htmlMode = v as typeof s.htmlMode; await this.save(false); }));
  }

  /** Width × height of new cards of a kind, in pixels. */
  private sizeSetting(el: HTMLElement, name: string, key: 'noteSize' | 'stickySize' | 'calloutSize'): void {
    const s = this.plugin.settings;
    const setting = new Setting(el).setName(name).setDesc(t('Width × height of new cards, in pixels.'));
    const box = setting.controlEl.createDiv('vc-size-inputs');
    const field = (dim: 'width' | 'height', min: number) => {
      const input = box.createEl('input', { type: 'number', attr: { min: String(min), max: '2000', step: '10' } });
      input.value = String(s[key][dim]);
      input.addEventListener('change', () => void (async () => {
        const n = Math.round(Number(input.value));
        if (!Number.isFinite(n) || n < min) { input.value = String(s[key][dim]); return; }
        s[key] = { ...s[key], [dim]: Math.min(2000, n) };
        await this.save(false);
      })());
    };
    field('width', 60);
    box.createSpan({ cls: 'vc-size-x', text: '×' });
    field('height', 40);
    setting.addExtraButton(b => b.setIcon('rotate-ccw').setTooltip(t('Reset')).onClick(async () => {
      s[key] = { ...DEFAULT_SETTINGS[key] };
      await this.save(false);
      this.display();
    }));
  }

  /** An optional colour: a picker plus a button back to the theme's colour. */
  private colorSetting(el: HTMLElement, name: string, key: 'dotColor' | 'backgroundColor'): void {
    const s = this.plugin.settings;
    let picker: ColorComponent | null = null;
    const setting = new Setting(el).setName(name).setDesc(s[key] ? '' : t('Follows the theme'));
    setting
      .addColorPicker(c => { picker = c; c.setValue(s[key] || '#888888').onChange(async (v) => { s[key] = v; setting.setDesc(''); await this.save(); }); })
      .addExtraButton(b => b.setIcon('rotate-ccw').setTooltip(t('Follow the theme')).onClick(async () => {
        s[key] = '';
        picker?.setValue('#888888');
        setting.setDesc(t('Follows the theme'));
        await this.save();
      }));
  }

  /** Choose which tools sit on the toolbar and in what order. */
  private toolList(el: HTMLElement): void {
    const s = this.plugin.settings;
    new Setting(el)
      .setName(t('Tools on the toolbar'))
      .setDesc(t('Select and Hand always come first. Ticked tools follow in this order; the rest are under "…".'));
    const list = el.createDiv('vc-tool-list');
    const render = () => {
      list.empty();
      const tools = availableTools().filter(x => !FIXED_TOOLS.includes(x.id));
      const shown = s.toolbarTools.filter(id => tools.some(x => x.id === id));
      const ordered = [...shown.map(id => tools.find(x => x.id === id)!), ...tools.filter(x => !shown.includes(x.id))];
      ordered.forEach((tool) => {
        const row = list.createDiv('vc-tool-row');
        const cb = row.createEl('input', { type: 'checkbox' });
        cb.checked = shown.includes(tool.id);
        setIcon(row.createSpan('vc-tool-row-icon'), tool.icon);
        row.createSpan({ cls: 'vc-tool-row-name', text: t(tool.label) });
        cb.addEventListener('change', () => void (async () => {
          if (cb.checked) s.toolbarTools = [...shown, tool.id];
          else s.toolbarTools = shown.filter(id => id !== tool.id);
          await this.save();
          render();
        })());
        if (cb.checked) {
          const i = shown.indexOf(tool.id);
          const up = row.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': t('Move up') } });
          setIcon(up, 'chevron-up');
          up.toggleClass('is-disabled', i === 0);
          up.addEventListener('click', () => void (async () => {
            if (i === 0) return;
            const arr = [...shown];
            [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
            s.toolbarTools = arr;
            await this.save(); render();
          })());
          const down = row.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': t('Move down') } });
          setIcon(down, 'chevron-down');
          down.toggleClass('is-disabled', i === shown.length - 1);
          down.addEventListener('click', () => void (async () => {
            if (i >= shown.length - 1) return;
            const arr = [...shown];
            [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
            s.toolbarTools = arr;
            await this.save(); render();
          })());
        }
      });
    };
    render();
  }
}
