import { TFile, type App } from 'obsidian';
import { zipSync } from 'fflate';
import type { Board } from '../board/board';
import type { CanvasFile } from '../model/canvas-file';
import type { OutFile } from './files';

const LINK_RE = /!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]|!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** Vault files a piece of Markdown points at. */
function linksIn(app: App, text: string, from: string): TFile[] {
  const out: TFile[] = [];
  for (const m of text.matchAll(LINK_RE)) {
    let target = (m[1] ?? m[2] ?? '').trim();
    if (!target || /^[a-z]+:/i.test(target)) continue; // web links
    try { target = decodeURIComponent(target); } catch { /* keep */ }
    target = target.replace(/#.*$/, '');
    const f = app.metadataCache.getFirstLinkpathDest(target, from) ?? app.vault.getAbstractFileByPath(target);
    if (f instanceof TFile) out.push(f);
  }
  return out;
}

/** Every string inside a value (to find file paths in Director Canvas data such as calendar pictures). */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

/** The files a board uses: file cards, linked and embedded notes and attachments, files in card data. */
export function filesUsed(app: App, board: Board, withEmbeds: boolean): TFile[] {
  const found = new Map<string, TFile>();
  const add = (f: TFile | null | undefined) => { if (f instanceof TFile && !found.has(f.path)) found.set(f.path, f); };
  const from = board.sourcePath;
  for (const n of board.model.nodes) {
    if (n.type === 'file' && n.file) { const af = app.vault.getAbstractFileByPath(n.file); if (af instanceof TFile) add(af); }
    if (n.text) for (const f of linksIn(app, n.text, from)) add(f);
    for (const s of strings(n.vc)) {
      if (s.length < 3 || s.length > 400 || !/\.[a-z0-9]{1,5}$/i.test(s)) continue;
      const f = app.vault.getAbstractFileByPath(s);
      if (f instanceof TFile) add(f);
    }
  }
  if (withEmbeds) {
    // What the included notes embed (pictures in a note, notes inside notes), one level deep each time.
    const queue = [...found.values()].filter(f => f.extension === 'md');
    while (queue.length) {
      const note = queue.shift()!;
      const cache = app.metadataCache.getFileCache(note);
      for (const e of cache?.embeds ?? []) {
        const f = app.metadataCache.getFirstLinkpathDest(e.link.replace(/#.*$/, ''), note.path);
        if (f && !found.has(f.path)) { add(f); if (f.extension === 'md') queue.push(f); }
      }
    }
  }
  found.delete(board.sourcePath);
  return [...found.values()];
}

export interface Bundle { name: string; count: number; files(top: string): Promise<OutFile[]> }

/**
 * The board and what it uses, in a folder named after the board. Inside, files keep their vault
 * paths under that folder, and the board's paths point there, so dropping the folder into any
 * vault's top level works as is.
 */
export function zipFiles(files: OutFile[]): Uint8Array {
  const tree: Record<string, Uint8Array> = {};
  const enc = new TextEncoder();
  for (const f of files) tree[f.path] = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
  return zipSync(tree, { level: 6 });
}

export function buildBundle(app: App, board: Board, withEmbeds: boolean): Bundle {
  const name = board.sourcePath.split('/').pop()!.replace(/\.canvas$/, '');
  const used = filesUsed(app, board, withEmbeds);
  const paths = new Set(used.map(f => f.path));
  return {
    name,
    count: used.length,
    files: async (top: string) => {
      const moved = (p: string) => `${top}/${p}`;
      const data = JSON.parse(JSON.stringify(board.model.toFile())) as CanvasFile;
      const remap = (v: unknown): unknown => {
        if (typeof v === 'string') return paths.has(v) ? moved(v) : v;
        if (Array.isArray(v)) return v.map(remap);
        if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x)]));
        return v;
      };
      for (const n of data.nodes) {
        if (n.type === 'file' && n.file && paths.has(n.file)) n.file = moved(n.file);
        if (n.vc) n.vc = remap(n.vc) as typeof n.vc;
      }
      const out: OutFile[] = [{ path: `${top}/${name}.canvas`, data: JSON.stringify(data, null, '\t') }];
      for (const f of used) out.push({ path: `${top}/${f.path}`, data: new Uint8Array(await app.vault.readBinary(f)) });
      return out;
    },
  };
}
