import { App, ColorComponent, PluginSettingTab, Setting, setIcon } from 'obsidian';
import type VisualCanvasPlugin from './main';
import { DEFAULT_SETTINGS, type TextCardKind, type ToolbarPosition, type ToolbarSize } from './settings';
import { availableTools } from './board/tools';
import { setLanguage, t, type Language } from './i18n';

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

    // ── General ──
    new Setting(el).setName(t('General')).setHeading();
    new Setting(el)
      .setName(t('Open .canvas files with Visual Canvas'))
      .setDesc(t('Boards open here instead of the core Canvas. You can always switch a board back from its header.'))
      .addToggle(tg => tg.setValue(s.openCanvasByDefault).onChange(async (v) => { s.openCanvasByDefault = v; await this.save(false); }));

    // ── Toolbar ──
    new Setting(el).setName(t('Toolbar')).setHeading();
    new Setting(el)
      .setName(t('Position'))
      .addDropdown(d => d
        .addOption('bottom', t('Bottom')).addOption('top', t('Top')).addOption('left', t('Left')).addOption('right', t('Right'))
        .setValue(s.toolbarPosition)
        .onChange(async (v) => { s.toolbarPosition = v as ToolbarPosition; await this.save(); }));
    new Setting(el)
      .setName(t('Size'))
      .setDesc(t('L and M show names under the icons; S shows icons only.'))
      .addDropdown(d => d
        .addOption('L', 'L').addOption('M', 'M').addOption('S', 'S')
        .setValue(s.toolbarSize)
        .onChange(async (v) => { s.toolbarSize = v as ToolbarSize; await this.save(); }));
    this.toolList(el);

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
    let picker: ColorComponent | null = null;
    new Setting(el)
      .setName(t('Default sticky note colour'))
      .addColorPicker(c => { picker = c; c.setValue(s.defaultStickyColor).onChange(async (v) => { s.defaultStickyColor = v; await this.save(false); }); })
      .addExtraButton(b => b.setIcon('rotate-ccw').setTooltip(t('Reset')).onClick(async () => {
        s.defaultStickyColor = DEFAULT_SETTINGS.defaultStickyColor;
        picker?.setValue(s.defaultStickyColor);
        await this.save(false);
      }));

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
      .setName(t('Dot size'))
      .addSlider(sl => sl.setLimits(0, 4, 0.5).setValue(s.dotSize).setDynamicTooltip().onChange(async (v) => { s.dotSize = v; await this.save(); }));
    this.colorSetting(el, t('Dot colour'), 'dotColor');
    this.colorSetting(el, t('Background colour'), 'backgroundColor');
    new Setting(el)
      .setName(t('Snap to grid'))
      .addToggle(tg => tg.setValue(s.snapToGrid).onChange(async (v) => { s.snapToGrid = v; await this.save(); }));
    new Setting(el)
      .setName(t('Grid size'))
      .addSlider(sl => sl.setLimits(10, 80, 5).setValue(s.gridSize).setDynamicTooltip().onChange(async (v) => { s.gridSize = v; await this.save(); }));
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
      .setDesc(t('Ticked tools show on the toolbar in this order; the rest are under "…".'));
    const list = el.createDiv('vc-tool-list');
    const render = () => {
      list.empty();
      const tools = availableTools().filter(x => x.id !== 'select');
      const shown = s.toolbarTools.filter(id => tools.some(x => x.id === id));
      const ordered = [...shown.map(id => tools.find(x => x.id === id)!), ...tools.filter(x => !shown.includes(x.id))];
      ordered.forEach((tool) => {
        const row = list.createDiv('vc-tool-row');
        const cb = row.createEl('input', { type: 'checkbox' });
        cb.checked = shown.includes(tool.id);
        setIcon(row.createSpan('vc-tool-row-icon'), tool.icon);
        row.createSpan({ cls: 'vc-tool-row-name', text: t(tool.label) });
        cb.addEventListener('change', async () => {
          if (cb.checked) s.toolbarTools = [...shown, tool.id];
          else s.toolbarTools = shown.filter(id => id !== tool.id);
          if (!s.toolbarTools.includes('select')) s.toolbarTools.unshift('select');
          await this.save();
          render();
        });
        if (cb.checked) {
          const i = shown.indexOf(tool.id);
          const up = row.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': t('Move up') } });
          setIcon(up, 'chevron-up');
          up.toggleClass('is-disabled', i === 0);
          up.addEventListener('click', async () => {
            if (i === 0) return;
            const arr = [...shown];
            [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
            s.toolbarTools = ['select', ...arr.filter(id => id !== 'select')];
            await this.save(); render();
          });
          const down = row.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': t('Move down') } });
          setIcon(down, 'chevron-down');
          down.toggleClass('is-disabled', i === shown.length - 1);
          down.addEventListener('click', async () => {
            if (i >= shown.length - 1) return;
            const arr = [...shown];
            [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
            s.toolbarTools = ['select', ...arr.filter(id => id !== 'select')];
            await this.save(); render();
          });
        }
      });
    };
    render();
  }
}
