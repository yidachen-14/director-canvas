import { Platform, type Scope } from 'obsidian';
import type { Board } from './board';
import { duplicateSelection } from './interactions';
import { ARRANGE, runArrange } from './arrange-commands';
import { availableTools, FIXED_TOOLS } from './tools';

/**
 * Every keyboard shortcut of a board, in one table. Keys are written "Mod+Alt+Shift+K":
 * Mod is ⌘ on a Mac and Ctrl elsewhere; the last part is the physical key (so ⌥ on a Mac,
 * which turns P into π, still matches P). Users can change any of them in Settings.
 */
export interface Shortcut {
  id: string;
  label: string;
  group: 'edit' | 'view' | 'tools' | 'arrange';
  /** Default keys (the first is shown). Empty: none until the user sets one. */
  keys: string[];
  run(board: Board): void;
}

export const SHORTCUT_GROUPS: { id: Shortcut['group']; label: string }[] = [
  { id: 'edit', label: 'Editing' },
  { id: 'view', label: 'View' },
  { id: 'tools', label: 'Tools' },
  { id: 'arrange', label: 'Arranging' },
];

const ARRANGE_DEFAULTS: Record<string, string> = {
  optimal: 'Mod+Alt+P', 'by-name': 'Mod+Alt+N', 'by-added': 'Mod+Alt+A', 'by-path': 'Mod+Alt+D', random: 'Mod+Alt+R', stack: 'Mod+Alt+S',
  'push-left': 'Mod+ArrowLeft', 'push-right': 'Mod+ArrowRight', 'push-up': 'Mod+ArrowUp', 'push-down': 'Mod+ArrowDown',
  'same-height': 'Mod+Alt+ArrowLeft', 'same-width': 'Mod+Alt+ArrowRight', 'same-size': 'Mod+Alt+ArrowUp',
  row: 'Mod+Alt+Shift+ArrowRight', column: 'Mod+Alt+Shift+ArrowDown',
};

/** One letter per tool (Hand also works by holding the space bar). */
const TOOL_DEFAULTS: Record<string, string> = {
  select: 'V', hand: 'H', text: 'T', note: 'N', sticky: 'S', callout: 'C', kanban: 'K', column: 'U', group: 'G',
  connect: 'L', pen: 'P', swatch: 'I', bookmark: 'B', mindmap: 'M', calendar: 'D',
};

/** "Select (V)": a tool's name with its key, for tooltips. Hand shows the space bar. */
export function toolTip(id: string, label: string, custom: Record<string, string>): string {
  if (id === 'hand') return `${label} (Space)`;
  const k = shortcutLabel(`tool-${id}`, custom);
  return k ? `${label} (${k})` : label;
}

export function allShortcuts(): Shortcut[] {
  const list: Shortcut[] = [
    { id: 'undo', label: 'Undo', group: 'edit', keys: ['Mod+Z'], run: b => b.undo() },
    { id: 'redo', label: 'Redo', group: 'edit', keys: ['Mod+Shift+Z', 'Mod+Y'], run: b => b.redo() },
    { id: 'select-all', label: 'Select all', group: 'edit', keys: ['Mod+A'], run: b => b.select(b.model.nodes.map(n => n.id)) },
    { id: 'duplicate', label: 'Duplicate', group: 'edit', keys: ['Mod+D'], run: b => duplicateSelection(b) },
    { id: 'group', label: 'Group the selection', group: 'edit', keys: ['Mod+G'], run: b => b.groupSelection() },
    { id: 'ungroup', label: 'Ungroup', group: 'edit', keys: ['Mod+Shift+G'], run: b => b.ungroupSelection() },
    { id: 'zoom-in', label: 'Zoom in', group: 'view', keys: ['Mod+='], run: b => b.zoomStep(1) },
    { id: 'zoom-out', label: 'Zoom out', group: 'view', keys: ['Mod+-'], run: b => b.zoomStep(-1) },
    { id: 'zoom-100', label: 'Zoom to 100%', group: 'view', keys: ['Mod+0'], run: b => b.setZoom(1, true) },
    { id: 'zoom-fit', label: 'Zoom to fit', group: 'view', keys: ['Shift+1'], run: b => b.zoomToFit(undefined, true) },
    { id: 'zoom-selection', label: 'Zoom to selection', group: 'view', keys: ['Shift+2'], run: b => { if (b.selection.size) b.zoomToFit([...b.selection], true); } },
    { id: 'search', label: 'Search the board', group: 'view', keys: ['Mod+F'], run: b => b.openSearch?.() },
  ];
  for (const tool of availableTools()) {
    if (tool.run) continue;
    const fixed = FIXED_TOOLS.includes(tool.id);
    list.push({
      id: `tool-${tool.id}`, label: tool.label, group: 'tools', keys: TOOL_DEFAULTS[tool.id] ? [TOOL_DEFAULTS[tool.id]] : [],
      run: b => { b.setTool(fixed || b.tool !== tool.id ? tool.id : 'select'); b.root.focus({ preventScroll: true }); },
    });
  }
  for (const d of ARRANGE) {
    list.push({ id: `arrange-${d.id}`, label: d.label, group: 'arrange', keys: ARRANGE_DEFAULTS[d.id] ? [ARRANGE_DEFAULTS[d.id]] : [], run: b => runArrange(b, d.id) });
  }
  return list;
}

/** The keys in effect for a shortcut: the user's choice ('' = none), else the defaults. */
export function keysFor(s: Shortcut, custom: Record<string, string>): string[] {
  if (Object.prototype.hasOwnProperty.call(custom, s.id)) return custom[s.id] ? [custom[s.id]] : [];
  return s.keys;
}

const CODE_NAMES: Record<string, string> = {
  Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backquote: '`', NumpadAdd: '=', NumpadSubtract: '-',
};

/** "Mod+Shift+Z" for a key event (null for a bare modifier key). */
export function keyString(e: KeyboardEvent): string | null {
  const code = e.code;
  if (/^(Meta|Control|Alt|Shift|OS)(Left|Right)?$/.test(code) || !code) return null;
  let key: string;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^Numpad\d$/.test(code)) key = code.slice(6);
  else key = CODE_NAMES[code] ?? code;
  const mods: string[] = [];
  const mod = Platform.isMacOS ? e.metaKey : e.ctrlKey;
  if (mod) mods.push('Mod');
  if (Platform.isMacOS && e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, key].join('+');
}

const ARROWS: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };

/** How keys are shown: ⌥⌘P on a Mac, Ctrl+Alt+P elsewhere. */
export function keyLabel(keys: string): string {
  const parts = keys.split('+');
  const key = parts.pop()!;
  const k = ARROWS[key] ?? (key === 'Escape' ? 'Esc' : key);
  if (Platform.isMacOS) {
    const sym: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Mod: '⌘' };
    const order = ['Ctrl', 'Alt', 'Shift', 'Mod'];
    return order.filter(m => parts.includes(m)).map(m => sym[m]).join('') + k;
  }
  return [...parts.map(m => (m === 'Mod' ? 'Ctrl' : m)), k].join('+');
}

/** The first key of a shortcut, for menus and tooltips ('' when it has none). */
export function shortcutLabel(id: string, custom: Record<string, string>): string {
  const s = allShortcuts().find(x => x.id === id);
  const k = s ? keysFor(s, custom)[0] : undefined;
  return k ? keyLabel(k) : '';
}

/**
 * Shortcuts go through an Obsidian Scope on the view, so they win over global hotkeys while
 * the board has focus and pass through otherwise (and while typing in a card).
 */
export function installShortcuts(scope: Scope, board: () => Board | null): void {
  scope.register(null, null, (e: KeyboardEvent) => {
    const b = board();
    if (!b || b.editingId) return true;
    const el = document.activeElement as HTMLElement | null;
    if (!el || !b.root.contains(el)) return true;
    if (el !== b.root && el.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]:not([data-vc-armed])')) return true;
    const ks = keyString(e);
    if (!ks) return true;
    // Keys without ⌘/Ctrl type into an armed mind map topic; leave them to it.
    if (!ks.includes('Mod') && !ks.includes('Ctrl') && el.hasAttribute('data-vc-armed')) return true;
    const custom = b.settings.hotkeys;
    const hit = allShortcuts().find(s => keysFor(s, custom).includes(ks));
    if (!hit) return true;
    e.preventDefault();
    hit.run(b);
    return false;
  });
}
