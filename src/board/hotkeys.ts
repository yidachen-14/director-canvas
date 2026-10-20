import { Scope, type Modifier } from 'obsidian';
import type { Board } from './board';
import { duplicateSelection } from './interactions';
import { runArrange } from './arrange-commands';

/**
 * ⌘ shortcuts go through an Obsidian Scope on the view, so they win over
 * global hotkeys while the board has focus and pass through otherwise.
 */
export function installHotkeys(scope: Scope, board: () => Board | null): void {
  const active = (): Board | null => {
    const b = board();
    if (!b || b.editingId) return null;
    const el = document.activeElement as HTMLElement | null;
    if (!el || !b.root.contains(el)) return null;
    if (el !== b.root && el.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) return null;
    return b;
  };
  const bind = (mods: Modifier[], key: string, fn: (b: Board) => void) => {
    scope.register(mods, key, () => {
      const b = active();
      if (!b) return true; // not ours: let Obsidian handle it
      fn(b);
      return false;
    });
  };
  bind(['Mod'], 'z', b => b.undo());
  bind(['Mod', 'Shift'], 'z', b => b.redo());
  bind(['Mod'], 'y', b => b.redo());
  bind(['Mod'], 'a', b => b.select(b.model.nodes.map(n => n.id)));
  bind(['Mod'], 'd', b => duplicateSelection(b));
  bind(['Mod'], 'g', b => b.groupSelection());
  bind(['Mod'], '=', b => b.zoomBy(1.25));
  bind(['Mod'], '-', b => b.zoomBy(0.8));
  bind(['Mod'], '0', b => b.setZoom(1));
  bind(['Mod'], 'f', b => b.openSearch?.());

  // Arranging, PureRef's keys. ⌥⌘+letter is matched by physical key in interactions.ts
  // (on a Mac, Option turns P into π, which Obsidian's matcher never sees).
  bind(['Mod'], 'ArrowLeft', b => runArrange(b, 'push-left'));
  bind(['Mod'], 'ArrowRight', b => runArrange(b, 'push-right'));
  bind(['Mod'], 'ArrowUp', b => runArrange(b, 'push-up'));
  bind(['Mod'], 'ArrowDown', b => runArrange(b, 'push-down'));
  bind(['Mod', 'Alt'], 'ArrowLeft', b => runArrange(b, 'same-height'));
  bind(['Mod', 'Alt'], 'ArrowRight', b => runArrange(b, 'same-width'));
  bind(['Mod', 'Alt'], 'ArrowUp', b => runArrange(b, 'same-size'));
  bind(['Mod', 'Alt', 'Shift'], 'ArrowRight', b => runArrange(b, 'row'));
  bind(['Mod', 'Alt', 'Shift'], 'ArrowDown', b => runArrange(b, 'column'));
}
