import { App, ColorComponent, PluginSettingTab, Setting, setIcon, type SettingDefinitionItem } from 'obsidian';
import type VisualCanvasPlugin from './main';
import { arrangeGapOf, DEFAULT_SETTINGS, type TextCardKind, type ToolbarPosition, type ToolbarSize } from './settings';
import { orderedTools } from './board/tools';
import { LANGUAGE_OPTIONS, setLanguage, t, type LanguageSetting } from './i18n';
import { ShortcutsModal } from './shortcuts-modal';
import { FolderPickModal } from './folder-picker';

const TEXT_KINDS: TextCardKind[] = ['text', 'note', 'sticky', 'callout'];
const KIND_LABEL: Record<TextCardKind, string> = { text: 'Text', note: 'Note', sticky: 'Sticky note', callout: 'Callout' };

/** One row: its name and description (for search too), and how to fill its controls. */
interface Row { name: string; desc?: string; render: (st: Setting) => unknown }
interface Section { heading?: string; rows: Row[] }

export class VisualCanvasSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: VisualCanvasPlugin) {
    super(app, plugin);
  }

  private async save(redrawBoards = true): Promise<void> {
    await this.plugin.saveSettings();
    if (redrawBoards) this.plugin.refreshBoards();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    this.containerEl.addClass('vc-settings');
    // Obsidian draws these rows (and finds them in its settings search).
    return this.sections().map(sec => ({
      type: 'group' as const,
      heading: sec.heading,
      items: sec.rows.map(r => ({ name: r.name, desc: r.desc, render: (st: Setting) => { this.fill(st, r); } })),
    }));
  }

  private fill(st: Setting, r: Row): void {
    st.setName(r.name);
    if (r.desc) st.setDesc(r.desc);
    r.render(st);
  }

  private sections(): Section[] {
    const s = this.plugin.settings;
    let paintRibbon: () => void = () => {};
    let paintGap: () => void = () => {};
    const kindRow = (name: string, desc: string, key: 'doubleClickKind' | 'pasteTextKind' | 'dragOutKind'): Row => ({
      name, desc,
      render: st => st.addDropdown(d => {
        for (const k of TEXT_KINDS) d.addOption(k, t(KIND_LABEL[k]));
        d.setValue(s[key]).onChange(async (v) => { s[key] = v as TextCardKind; await this.save(false); });
      }),
    });
    return [
      {
        rows: [
          {
            name: t('Language'),
            render: st => st.addDropdown(d => d
              .addOption('auto', t('Same as Obsidian'))
              .addOptions(LANGUAGE_OPTIONS)
              .setValue(s.language)
              .onChange(async (v) => {
                s.language = v as LanguageSetting;
                setLanguage(s.language);
                await this.save();
                this.plugin.remountBoards();
                this.update();
              })),
          },
          {
            name: t('Open .canvas files with Director Canvas'),
            desc: t('Boards open here instead of the core Canvas. You can always switch a board back from its header.'),
            render: st => st.addToggle(tg => tg.setValue(s.openCanvasByDefault).onChange(async (v) => {
              s.openCanvasByDefault = v;
              await this.save(false);
              this.plugin.syncRibbon();
              paintRibbon();
            })),
          },
          {
            name: t('Show "Create new Director Canvas" in the left ribbon'),
            desc: t('It can be hidden only while .canvas files open with Director Canvas; otherwise it is the way to make a new board.'),
            render: st => {
              let toggle: { setValue(v: boolean): unknown; setDisabled(d: boolean): unknown } | null = null;
              st.addToggle(tg => {
                toggle = tg;
                tg.onChange(async (v) => {
                  if (!s.openCanvasByDefault) return;
                  s.showRibbon = v;
                  await this.save(false);
                  this.plugin.syncRibbon();
                });
              });
              paintRibbon = () => {
                toggle?.setValue(!s.openCanvasByDefault || s.showRibbon);
                toggle?.setDisabled(!s.openCanvasByDefault);
                st.settingEl.toggleClass('is-disabled', !s.openCanvasByDefault);
              };
              paintRibbon();
            },
          },
          {
            name: t('Only in these folders'),
            desc: t('Boards in these folders (and the folders inside them) open with Director Canvas. None chosen: every board.'),
            render: st => {
              const chips = st.descEl.createDiv('vc-folder-chips');
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
              st.addButton(b => b.setButtonText(t('Choose folders…')).onClick(() => {
                new FolderPickModal(this.app, s.takeoverFolders, async (list) => {
                  s.takeoverFolders = list;
                  await this.save(false);
                  paintChips();
                }).open();
              }));
            },
          },
        ],
      },
      {
        heading: t('Toolbar'),
        rows: [
          {
            name: t('Position'),
            render: st => st.addDropdown(d => d
              .addOption('top', t('Top')).addOption('bottom', t('Bottom')).addOption('left', t('Left')).addOption('right', t('Right'))
              .setValue(s.toolbarPosition)
              .onChange(async (v) => { s.toolbarPosition = v as ToolbarPosition; await this.save(); })),
          },
          {
            name: t('Size'),
            desc: t('S shows icons only; M and L show names under the icons.'),
            render: st => st.addDropdown(d => d
              .addOption('S', 'S').addOption('M', 'M').addOption('L', 'L')
              .setValue(s.toolbarSize)
              .onChange(async (v) => { s.toolbarSize = v as ToolbarSize; await this.save(); })),
          },
          {
            name: t('Tools on the toolbar'),
            desc: t('Select and Hand always come first. Ticked tools follow in this order; the rest are under "…".'),
            render: st => { st.settingEl.addClass('vc-tool-setting'); this.toolList(st.infoEl); },
          },
        ],
      },
      {
        heading: t('Keyboard shortcuts'),
        rows: [{
          name: t('Board shortcuts'),
          desc: t('See every shortcut and change its keys.'),
          render: st => st.addButton(b => b.setButtonText(t('Edit shortcuts…')).onClick(() => new ShortcutsModal(this.app, this.plugin).open())),
        }],
      },
      {
        heading: t('Text cards'),
        rows: [
          kindRow(t('Double-click on the board creates'), t('The kind of card a double-click on an empty spot makes.'), 'doubleClickKind'),
          kindRow(t('Pasted text becomes'), t('The kind of card made when you paste text onto the board.'), 'pasteTextKind'),
          kindRow(t('Paragraphs dragged out of a card become'), t('The kind of card made when you drag a paragraph out onto the board.'), 'dragOutKind'),
          {
            name: t('Default size of Text'),
            desc: t('Font size of new Text cards, in pixels.'),
            render: st => st.addText(tx => {
              tx.inputEl.type = 'number';
              tx.inputEl.min = '8'; tx.inputEl.max = '96';
              tx.setValue(String(s.defaultTextSize)).onChange(async (v) => {
                const n = Number(v);
                if (Number.isFinite(n) && n >= 8 && n <= 96) { s.defaultTextSize = Math.round(n); await this.save(false); }
              });
            }),
          },
          this.sizeRow(t('Default size of Notes'), 'noteSize'),
          this.sizeRow(t('Default size of Sticky notes'), 'stickySize'),
          this.sizeRow(t('Default size of Callouts'), 'calloutSize'),
          {
            name: t('Default sticky note colour'),
            render: st => {
              let picker: ColorComponent | null = null;
              st.addColorPicker(c => { picker = c; c.setValue(s.defaultStickyColor).onChange(async (v) => { s.defaultStickyColor = v; await this.save(false); }); })
                .addExtraButton(b => b.setIcon('rotate-ccw').setTooltip(t('Reset')).onClick(async () => {
                  s.defaultStickyColor = DEFAULT_SETTINGS.defaultStickyColor;
                  picker?.setValue(s.defaultStickyColor);
                  await this.save(false);
                }));
            },
          },
        ],
      },
      {
        heading: t('Pictures'),
        rows: [
          {
            name: t('Corner radius'),
            desc: t('Rounding of image and video corners. 0 turns rounding off.'),
            render: st => st.addSlider(sl => { sl.setLimits(0, 24, 1).setValue(s.imageRadius).onChange(async (v) => { s.imageRadius = v; await this.save(); }); }),
          },
          {
            name: t('Shadow'),
            desc: t('A soft shadow under images and videos.'),
            render: st => st.addToggle(tg => tg.setValue(s.imageShadow).onChange(async (v) => { s.imageShadow = v; await this.save(); })),
          },
        ],
      },
      {
        heading: t('Connections'),
        rows: [{
          name: t('Shape of new connections'),
          desc: t('Each connection can be changed afterwards in its properties bar.'),
          render: st => st.addDropdown(d => d
            .addOption('straight', t('Straight')).addOption('curve', t('Curved')).addOption('elbow', t('Elbow'))
            .setValue(s.defaultRoute)
            .onChange(async (v) => { s.defaultRoute = v as typeof s.defaultRoute; await this.save(false); })),
        }],
      },
      {
        heading: t('Attachments'),
        rows: [{
          name: t('Update boards when files are renamed or moved'),
          desc: t('Paths of cards and [[links]] in every board follow the file, including boards that are not open.'),
          render: st => st.addToggle(tg => tg.setValue(s.autoRelink).onChange(async (v) => { s.autoRelink = v; await this.save(false); })),
        }],
      },
      {
        heading: t('Board'),
        rows: [
          {
            name: t('Pan with mouse button'),
            desc: t('Holding the space bar and dragging always pans.'),
            render: st => st.addDropdown(d => d
              .addOption('middle', t('Middle button')).addOption('right', t('Right button')).addOption('none', t('None'))
              .setValue(s.panButton)
              .onChange(async (v) => { s.panButton = v as typeof s.panButton; await this.save(false); })),
          },
          {
            name: t('Grid'),
            render: st => st.addDropdown(d => d.addOption('dots', t('Dots')).addOption('lines', t('Square grid'))
              .setValue(s.gridStyle).onChange(async (v) => { s.gridStyle = v as typeof s.gridStyle; await this.save(); })),
          },
          {
            name: t('Dot size'),
            desc: t('0 hides the grid.'),
            render: st => st.addSlider(sl => { sl.setLimits(0, 4, 0.5).setValue(s.dotSize).onChange(async (v) => { s.dotSize = v; await this.save(); }); }),
          },
          {
            name: t('Grid contrast'),
            desc: t('How strongly the dots or lines stand out, in percent. It follows the light or dark mode.'),
            render: st => st.addSlider(sl => { sl.setLimits(5, 60, 1).setValue(s.gridContrast).onChange(async (v) => { s.gridContrast = v; await this.save(); }); }),
          },
          {
            name: t('Background'),
            render: st => st.addDropdown(d => d.addOption('theme', t('Follows the theme')).addOption('pure', t('Pure white or black'))
              .setValue(s.background).onChange(async (v) => { s.background = v as typeof s.background; await this.save(); })),
          },
          {
            name: t('Snap to grid'),
            render: st => st.addToggle(tg => tg.setValue(s.snapToGrid).onChange(async (v) => { s.snapToGrid = v; await this.save(); })),
          },
          this.numberRow(t('Grid size'), t('In pixels. Arranging can use the same spacing, so cards line up with the grid.'), () => s.gridSize, 4, 200, async (n) => {
            s.gridSize = n;
            await this.save();
            paintGap(); // the gap shown follows a grid-sized gap
          }),
        ],
      },
      {
        heading: t('Arranging'),
        rows: [
          {
            name: t('Gap between arranged cards'),
            desc: t('Used by pushing, rows, columns and the automatic arrangements (px).'),
            render: st => {
              let input: HTMLInputElement | null = null;
              const paint = () => {
                if (!input) return;
                input.value = String(arrangeGapOf(s));
                input.disabled = s.arrangeGapMode === 'grid';
              };
              st.addDropdown(d => d.addOption('grid', t('Same as the grid')).addOption('custom', t('Custom'))
                .setValue(s.arrangeGapMode).onChange(async (v) => {
                  if (v === 'custom' && s.arrangeGapMode === 'grid') s.arrangeGap = s.gridSize;
                  s.arrangeGapMode = v as typeof s.arrangeGapMode;
                  paint();
                  await this.save(false);
                }));
              st.addText(tx => {
                const el = tx.inputEl;
                input = el;
                el.type = 'number'; el.min = '0'; el.max = '400';
                el.addClass('vc-number-input');
                el.addEventListener('change', () => void (async () => {
                  const n = Math.round(Number(el.value));
                  if (!Number.isFinite(n) || n < 0) { paint(); return; }
                  s.arrangeGap = Math.min(400, n);
                  await this.save(false);
                })());
              });
              paint();
              paintGap = paint;
            },
          },
          {
            name: t('Same size: measure from'),
            render: st => st.addDropdown(d => d
              .addOption('first', t('The first selected')).addOption('average', t('The average'))
              .setValue(s.normalizeBase)
              .onChange(async (v) => { s.normalizeBase = v as typeof s.normalizeBase; await this.save(false); })),
          },
        ],
      },
      {
        heading: t('Export'),
        rows: [
          {
            name: t('Export folder'),
            desc: t('Empty: ask every time. A folder in the vault (Exports) or a full path on this computer (~/Desktop).'),
            render: st => st.addText(tx => tx.setPlaceholder(t('Ask every time')).setValue(s.exportFolder).onChange(async (v) => { s.exportFolder = v.trim(); await this.save(false); })),
          },
          {
            name: t('PNG resolution'),
            render: st => st.addDropdown(d => d.addOptions({ 1: '1x', 2: '2x', 3: '3x', 4: '4x', 5: '5x' }).setValue(String(s.pngScale))
              .onChange(async (v) => { s.pngScale = Number(v); await this.save(false); })),
          },
        ],
      },
    ];
  }

  /** Width × height of new cards of a kind, in pixels. */
  private sizeRow(name: string, key: 'noteSize' | 'stickySize' | 'calloutSize'): Row {
    const s = this.plugin.settings;
    return {
      name, desc: t('Width × height of new cards, in pixels.'),
      render: setting => {
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
          return input;
        };
        const w = field('width', 60);
        box.createSpan({ cls: 'vc-size-x', text: '×' });
        const h = field('height', 40);
        setting.addExtraButton(b => b.setIcon('rotate-ccw').setTooltip(t('Reset')).onClick(async () => {
          s[key] = { ...DEFAULT_SETTINGS[key] };
          await this.save(false);
          w.value = String(s[key].width);
          h.value = String(s[key].height);
        }));
      },
    };
  }

  /** A whole number typed in (applied when the field is left or Enter is pressed). */
  private numberRow(name: string, desc: string, get: () => number, min: number, max: number, set: (n: number) => Promise<void>): Row {
    return {
      name, desc,
      render: st => st.addText(tx => {
        const input = tx.inputEl;
        input.type = 'number'; input.min = String(min); input.max = String(max);
        input.addClass('vc-number-input');
        input.value = String(get());
        input.addEventListener('change', () => void (async () => {
          const n = Math.round(Number(input.value));
          if (!Number.isFinite(n) || n < min) { input.value = String(get()); return; }
          input.value = String(Math.min(max, n));
          await set(Math.min(max, n));
        })());
      }),
    };
  }

  /** Choose which tools sit on the toolbar and in what order: tick to show, drag the handle to reorder. */
  private toolList(el: HTMLElement): void {
    const s = this.plugin.settings;
    const list = el.createDiv('vc-tool-list');
    const ids = () => Array.from(list.children).map(r => (r as HTMLElement).dataset.id!).filter(Boolean);
    const commit = async () => {
      const order = ids();
      s.toolbarOrder = order;
      s.toolbarTools = order.filter(id => s.toolbarTools.includes(id));
      await this.save();
    };
    for (const tool of orderedTools(s)) {
      const row = list.createDiv({ cls: 'vc-tool-row', attr: { 'data-id': tool.id } });
      const grip = row.createDiv({ cls: 'vc-tool-row-grip', attr: { 'aria-label': t('Drag to move') } });
      setIcon(grip, 'grip-vertical');
      const cb = row.createEl('input', { type: 'checkbox' });
      cb.checked = s.toolbarTools.includes(tool.id);
      setIcon(row.createSpan('vc-tool-row-icon'), tool.icon);
      row.createSpan({ cls: 'vc-tool-row-name', text: t(tool.label) });
      // Ticking only shows or hides the tool: it keeps its place in the list.
      cb.addEventListener('change', () => void (async () => {
        const on = new Set(s.toolbarTools);
        if (cb.checked) on.add(tool.id); else on.delete(tool.id);
        s.toolbarTools = ids().filter(id => on.has(id));
        s.toolbarOrder = ids();
        await this.save();
      })());
      grip.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const startY = e.clientY;
        const pid = e.pointerId;
        row.addClass('is-dragging');
        // On the window: moving the row in the list would drop a pointer capture on the handle.
        const win = grip.ownerDocument.defaultView ?? window;
        let offset = 0;
        const move = (ev: PointerEvent) => {
          if (ev.pointerId !== pid) return;
          // Swap places with a neighbour once the row passes its middle.
          const y = ev.clientY;
          const prev = row.previousElementSibling as HTMLElement | null;
          const next = row.nextElementSibling as HTMLElement | null;
          if (prev && y < prev.getBoundingClientRect().top + prev.offsetHeight / 2) { offset += prev.offsetHeight + 2; list.insertBefore(row, prev); }
          else if (next && y > next.getBoundingClientRect().top + next.offsetHeight / 2) { offset -= next.offsetHeight + 2; list.insertBefore(next, row); }
          row.style.transform = `translateY(${y - startY + offset}px)`;
        };
        const up = (ev: PointerEvent) => {
          if (ev.pointerId !== pid) return;
          win.removeEventListener('pointermove', move, true);
          win.removeEventListener('pointerup', up, true);
          win.removeEventListener('pointercancel', up, true);
          row.removeClass('is-dragging');
          row.setCssStyles({ transform: '' });
          void commit();
        };
        win.addEventListener('pointermove', move, true);
        win.addEventListener('pointerup', up, true);
        win.addEventListener('pointercancel', up, true);
      });
    }
  }
}
