import { Notice, TFile, normalizePath, type App } from 'obsidian';
import type { Board } from './board';
import type { RawEdge, RawNode } from '../model/canvas-file';
import { nodeRect, unionRect } from '../model/board-model';
import type { Point } from './viewport';
import { fileKindOf } from '../cards/util';
import { t } from '../i18n';

const MARK = 'visual-canvas';

interface ClipPayload { [MARK]?: number; nodes: RawNode[]; edges: RawEdge[]; }

/** Copy the selection: JSON Canvas data the core Canvas can paste too. */
export function copySelection(board: Board, e: ClipboardEvent): boolean {
  const nodes = board.selectedNodes();
  if (!nodes.length) return false;
  const ids = new Set(nodes.map(n => n.id));
  const edges = board.model.edges.filter(ed => ids.has(ed.fromNode) && ids.has(ed.toNode));
  const payload: ClipPayload = { [MARK]: 1, nodes, edges };
  e.clipboardData?.setData('text/plain', JSON.stringify(payload));
  e.preventDefault();
  return true;
}

function parsePayload(text: string): ClipPayload | null {
  if (!text.trimStart().startsWith('{')) return null;
  try {
    const p = JSON.parse(text) as ClipPayload;
    if (Array.isArray(p.nodes) && Array.isArray(p.edges)) return p;
  } catch { /* not ours */ }
  return null;
}

/** Paste board data, files, images or text at `at` (world point). */
export async function pasteInto(board: Board, data: DataTransfer, at: Point): Promise<void> {
  const text = data.getData('text/plain');
  const payload = text ? parsePayload(text) : null;
  if (payload) { pasteNodes(board, payload, at); return; }

  const files = Array.from(data.files ?? []);
  if (files.length) { await addFiles(board, files, at); return; }

  const html = data.getData('text/html');
  if (text && /^https?:\/\/\S+$/.test(text.trim())) {
    board.createCard('link', at, { data: { type: 'link', url: text.trim() } });
    return;
  }
  if (text || html) {
    const kind = board.settings.pasteTextKind;
    board.createCard(kind, at, { data: { text }, size: textCardSize(text, kind) });
  }
}

/** A sensible size for a card holding pasted text. */
function textCardSize(text: string, kind: string): { width: number; height: number } {
  const lines = text.split('\n');
  const longest = Math.max(...lines.map(l => l.length));
  const width = Math.min(560, Math.max(kind === 'text' ? 120 : 260, Math.min(longest, 60) * 9 + 48));
  const height = Math.min(640, Math.max(kind === 'text' ? 40 : 120, lines.length * 26 + 40));
  return { width, height };
}

export function pasteNodes(board: Board, payload: ClipPayload, at: Point): void {
  const rect = unionRect(payload.nodes.map(n => nodeRect(n)));
  if (!rect) return;
  const dx = at.x - (rect.x + rect.width / 2), dy = at.y - (rect.y + rect.height / 2);
  const map = new Map<string, string>();
  board.model.transact(() => {
    for (const n of payload.nodes) {
      const copy = board.model.addNode({ ...structuredClone(n), id: undefined, x: n.x + dx, y: n.y + dy } as unknown as RawNode);
      map.set(n.id, copy.id);
    }
    for (const e of payload.edges) {
      const a = map.get(e.fromNode), b = map.get(e.toNode);
      if (a && b) board.model.addEdge({ ...structuredClone(e), id: undefined, fromNode: a, toNode: b } as never);
    }
  });
  board.select([...map.values()]);
}

// ── files ──────────────────────────────────────────────────

/**
 * Make a file name safe for the vault: NFC (macOS hands over decomposed
 * names), no characters Obsidian rejects, and not too long for the disk.
 */
export function safeFileName(name: string): string {
  let n = name.normalize('NFC').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) n = 'file';
  const dot = n.lastIndexOf('.');
  const ext = dot > 0 ? n.slice(dot) : '';
  let base = dot > 0 ? n.slice(0, dot) : n;
  const enc = new TextEncoder();
  while (enc.encode(base + ext).length > 200 && base.length > 1) base = base.slice(0, -1);
  return base.trim() + ext;
}

/** Store a dropped/pasted file in the vault's attachment folder. */
export async function saveAttachment(app: App, data: ArrayBuffer, name: string, sourcePath: string): Promise<TFile> {
  const fm = app.fileManager as unknown as { getAvailablePathForAttachment(n: string, s: string): Promise<string> };
  const path = normalizePath(await fm.getAvailablePathForAttachment(safeFileName(name), sourcePath));
  return app.vault.createBinary(path, data);
}

const DEFAULT_SIZE: Record<string, { width: number; height: number }> = {
  image: { width: 400, height: 300 },
  video: { width: 480, height: 270 },
  audio: { width: 360, height: 96 },
  other: { width: 400, height: 400 },
};

/** Measure an image or video to give its card the right shape. */
async function mediaSize(app: App, file: TFile): Promise<{ width: number; height: number } | null> {
  const kind = fileKindOf(file.path);
  const src = app.vault.getResourcePath(file);
  const fit = (w: number, h: number) => {
    if (!w || !h) return null;
    const max = kind === 'image' ? 480 : 560;
    const s = Math.min(1, max / Math.max(w, h));
    return { width: Math.round(w * s), height: Math.round(h * s) };
  };
  if (kind === 'image') {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(fit(img.naturalWidth, img.naturalHeight));
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  if (kind === 'video') {
    return new Promise(resolve => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => resolve(fit(v.videoWidth, v.videoHeight));
      v.onerror = () => resolve(null);
      v.src = src;
    });
  }
  return null;
}

/** Add vault files as cards, laid out in a row starting at `at`. */
export async function addVaultFiles(board: Board, files: TFile[], at: Point): Promise<void> {
  const created: string[] = [];
  let x = at.x;
  const sizes = await Promise.all(files.map(f => mediaSize(board.app, f)));
  board.model.transact(() => {
    files.forEach((file, i) => {
      const kind = fileKindOf(file.path);
      const size = sizes[i] ?? DEFAULT_SIZE[kind] ?? DEFAULT_SIZE.other;
      const node = board.model.addNode({ type: 'file', file: file.path, x, y: at.y - size.height / 2, width: size.width, height: size.height });
      created.push(node.id);
      x += size.width + 24;
    });
  });
  board.select(created);
}

/** Files from the OS (Finder, clipboard): copy into the vault, then add as cards. */
export async function addFiles(board: Board, files: File[], at: Point): Promise<void> {
  const saved: TFile[] = [];
  for (const f of files) {
    try {
      saved.push(await saveAttachment(board.app, await f.arrayBuffer(), f.name || 'pasted', board.sourcePath));
    } catch (err) {
      console.error('Visual Canvas: could not save', f.name, err);
      new Notice(t('Could not add "{name}".', { name: f.name }));
    }
  }
  if (saved.length) await addVaultFiles(board, saved, at);
}

/** Wire copy/cut/paste and drag-and-drop to a board. */
export function attachClipboard(board: Board): void {
  const doc = board.root.ownerDocument;
  let lastPointer: Point | null = null;
  board.root.addEventListener('pointermove', (e) => { lastPointer = board.clientToWorld(e.clientX, e.clientY); });
  board.root.addEventListener('pointerleave', () => { lastPointer = null; });

  const focused = () => board.root.contains(doc.activeElement) && !board.editingId
    && !(doc.activeElement as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]');

  const onCopy = (e: ClipboardEvent) => { if (focused()) copySelection(board, e); };
  const onCut = (e: ClipboardEvent) => { if (focused() && copySelection(board, e)) board.deleteSelection(); };
  const onPaste = (e: ClipboardEvent) => {
    if (!focused() || !e.clipboardData) return;
    e.preventDefault();
    void pasteInto(board, e.clipboardData, lastPointer ?? board.viewCenter());
  };
  doc.addEventListener('copy', onCopy);
  doc.addEventListener('cut', onCut);
  doc.addEventListener('paste', onPaste);
  board.addDisposer(() => {
    doc.removeEventListener('copy', onCopy);
    doc.removeEventListener('cut', onCut);
    doc.removeEventListener('paste', onPaste);
  });

  // Drag and drop: Finder files, Obsidian's file explorer, links.
  board.root.addEventListener('dragover', (e) => {
    if (board.editingId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  board.root.addEventListener('drop', (e) => {
    if (board.editingId) return;
    e.preventDefault();
    const at = board.clientToWorld(e.clientX, e.clientY);
    const dm = (board.app as unknown as { dragManager?: { draggable?: { type: string; file?: TFile; files?: TFile[] } | null } }).dragManager;
    const drag = dm?.draggable;
    if (drag && (drag.type === 'file' || drag.type === 'files')) {
      const files = (drag.files ?? (drag.file ? [drag.file] : [])).filter((f): f is TFile => f instanceof TFile);
      if (files.length) { void addVaultFiles(board, files, at); return; }
    }
    if (e.dataTransfer) void pasteInto(board, e.dataTransfer, at);
  });
}
