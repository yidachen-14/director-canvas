import { TFile, TFolder, type TAbstractFile } from 'obsidian';
import { VIEW_TYPE } from './takeover';
import type VisualCanvasPlugin from './main';
import { parseCanvas, serializeCanvas, type CanvasFile } from './model/canvas-file';
import { base, relinkCanvas, type Move } from './model/relink';
import { settleSidesForSave } from './board/connections';
import { CanvasView } from './view/canvas-view';

/**
 * Keep every board's file paths and [[links]] right when files or folders
 * are renamed or moved — open boards and ones not open alike.
 */
export function installRenameSync(plugin: VisualCanvasPlugin): void {
  let pending: Move[] = [];
  let timer = 0;

  const flush = async () => {
    const moves = pending;
    pending = [];
    if (!moves.length) return;
    const open = new Set<string>();
    // Open boards: change their model, so undo and saving work as usual.
    for (const leaf of plugin.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (!(view instanceof CanvasView) || !view.board || !view.file) continue;
      open.add(view.file.path);
      const board = view.board;
      const probe: CanvasFile = { nodes: board.model.nodes.map(n => ({ ...n })), edges: [] };
      if (!relinkCanvas(probe, moves)) continue;
      board.model.transact(() => {
        for (const n of board.model.nodes) {
          const before = JSON.stringify([n.file, n.text]);
          relinkCanvas({ nodes: [n], edges: [] }, moves);
          if (JSON.stringify([n.file, n.text]) !== before) board.model.touch(n.id);
        }
      });
    }
    // Everything else: rewrite the file on disk.
    for (const f of plugin.app.vault.getFiles()) {
      if (f.extension !== 'canvas' || open.has(f.path)) continue;
      try {
        const text = await plugin.app.vault.cachedRead(f);
        if (!moves.some(m => text.includes(JSON.stringify(m.from).slice(1, -1)) || text.includes(base(m.from)))) continue;
        await plugin.app.vault.process(f, (current) => {
          let data: CanvasFile;
          try { data = parseCanvas(current); } catch { return current; }
          return relinkCanvas(data, moves) ? serializeCanvas(data, settleSidesForSave) : current;
        });
      } catch (err) {
        console.error('Director Canvas: could not update links in', f.path, err);
      }
    }
  };

  plugin.registerEvent(plugin.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
    if (!plugin.settings.autoRelink) return;
    if (file instanceof TFile && file.extension === 'canvas' && !oldPath.endsWith('.canvas')) return;
    pending.push({ from: oldPath, to: file.path, folder: file instanceof TFolder });
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { void flush(); }, 400);
  }));
  plugin.register(() => window.clearTimeout(timer));
}
