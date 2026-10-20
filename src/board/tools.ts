import { FuzzySuggestModal, TFile, type App } from 'obsidian';
import type { Board } from './board';
import { getCardType } from '../cards/registry';
import { addFiles, addVaultFiles } from './clipboard';
import { t } from '../i18n';

/**
 * A toolbar tool. Mode tools (select, hand, connect, card kinds) stay active
 * until used; action tools (pick an image, a note) run once.
 */
export interface Tool {
  id: string;
  label: string;
  icon: string;
  /** Run instead of switching mode. */
  run?(board: Board): void;
  /** Hidden until the feature lands. */
  available?(): boolean;
}

function pickOsFiles(board: Board, accept: string): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.multiple = true;
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    if (files.length) void addFiles(board, files, board.viewCenter());
  });
  input.click();
}

class VaultFileModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private onPick: (f: TFile) => void) {
    super(app);
    this.setPlaceholder(t('Choose a file to add to the board'));
  }
  getItems(): TFile[] { return this.app.vault.getFiles(); }
  getItemText(f: TFile): string { return f.path; }
  onChooseItem(f: TFile): void { this.onPick(f); }
}

const cardTool = (id: string): Tool => ({
  id,
  get label() { return getCardType(id)?.label ?? id; },
  get icon() { return getCardType(id)?.icon ?? 'square'; },
  available: () => !!getCardType(id),
});

export const TOOLS: Tool[] = [
  { id: 'select', label: 'Select', icon: 'mouse-pointer-2' },
  { id: 'hand', label: 'Hand', icon: 'hand' },
  cardTool('text'),
  cardTool('note'),
  cardTool('sticky'),
  cardTool('callout'),
  cardTool('kanban'),
  cardTool('column'),
  cardTool('group'),
  { id: 'connect', label: 'Connect', icon: 'spline' },
  { id: 'pen', label: 'Pen', icon: 'pen-line', available: () => !!getCardType('drawing') },
  { id: 'image', label: 'Image', icon: 'image', run: b => pickOsFiles(b, 'image/*') },
  { id: 'video', label: 'Video', icon: 'film', run: b => pickOsFiles(b, 'video/*') },
  { id: 'audio', label: 'Audio', icon: 'music', run: b => pickOsFiles(b, 'audio/*') },
  { id: 'file', label: 'Note or file', icon: 'file-plus', run: b => new VaultFileModal(b.app, f => { void addVaultFiles(b, [f], b.viewCenter()); }).open() },
  cardTool('bookmark'),
  cardTool('mindmap'),
  cardTool('swatch'),
  cardTool('calendar'),
];

export function toolById(id: string): Tool | undefined {
  return TOOLS.find(x => x.id === id);
}

export function availableTools(): Tool[] {
  return TOOLS.filter(x => !x.available || x.available());
}
