import { FileSystemAdapter, Notice, Platform, normalizePath, type App } from 'obsidian';
import { t } from '../i18n';

 
type NodeFs = typeof import('fs');
type NodePath = typeof import('path');
type NodeOs = typeof import('os');

/** Node and Electron modules, reached through the desktop app's own require (absent on mobile). */
function nodeModule<T>(name: string): T | null {
  const req = (window as unknown as { require?: (id: string) => unknown }).require;
  try { return req ? (req(name) as T) : null; } catch { return null; }
}
const nodeFs = (): NodeFs | null => nodeModule<NodeFs>('fs');
const nodePath = (): NodePath | null => nodeModule<NodePath>('path');

export interface FileFilter { name: string; extensions: string[] }
interface ElectronDialog {
  showSaveDialog(o: { defaultPath?: string; filters?: FileFilter[] }): Promise<{ canceled: boolean; filePath?: string }>;
  showOpenDialog(o: { title?: string; properties?: string[] }): Promise<{ canceled: boolean; filePaths?: string[] }>;
}
export interface ElectronWebContents {
  printToPDF(o: Record<string, unknown>): Promise<Uint8Array>;
}
export interface ElectronRemote {
  dialog?: ElectronDialog;
  getCurrentWebContents?(): ElectronWebContents | undefined;
}

/** Electron's remote module, when Obsidian provides it (desktop). */
export function electronRemote(): ElectronRemote | null {
  return nodeModule<{ remote?: ElectronRemote }>('electron')?.remote ?? null;
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  bmp: 'image/bmp', avif: 'image/avif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', flac: 'audio/flac', pdf: 'application/pdf',
};
export const mimeOf = (path: string) => MIME[(path.split('.').pop() ?? '').toLowerCase()] ?? 'application/octet-stream';

/** The file on disk behind an Obsidian resource URL (app://…/abs/path?mtime). */
export function resourcePath(src: string): string | null {
  if (!/^(app|file):\/\//.test(src)) return null;
  try {
    const u = new URL(src);
    let p = decodeURIComponent(u.pathname);
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1); // Windows: /C:/…
    return p;
  } catch { return null; }
}

export function readResource(src: string): Uint8Array | null {
  const p = resourcePath(src);
  const fs = nodeFs();
  if (!p || !fs) return null;
  try { return new Uint8Array(fs.readFileSync(p)); } catch { return null; }
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function dataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${toBase64(bytes)}`;
}

/** Every local picture / video / audio source under `root`. */
export function mediaElements(root: HTMLElement): (HTMLImageElement | HTMLVideoElement | HTMLAudioElement | HTMLSourceElement)[] {
  return [...root.querySelectorAll<HTMLImageElement | HTMLVideoElement | HTMLAudioElement | HTMLSourceElement>('img, video, audio, source')]
    .filter(el => /^(app|file):\/\//.test(el.getAttribute('src') ?? ''));
}

/** Replace local sources with data URLs (pictures always; videos and audio when not too big). */
export function inlineMedia(root: HTMLElement, maxMediaBytes = 25 * 1024 * 1024): void {
  for (const el of mediaElements(root)) {
    const src = el.getAttribute('src')!;
    const bytes = readResource(src);
    if (!bytes) continue;
    if (el.tagName !== 'IMG' && bytes.length > maxMediaBytes) continue;
    el.setAttribute('src', dataUrl(bytes, mimeOf(resourcePath(src) ?? src)));
  }
}

// ── Saving ─────────────────────────────────────────────────────────────

export interface OutFile { path: string; data: Uint8Array | string }

const enc = new TextEncoder();
const bytesOf = (d: Uint8Array | string) => (typeof d === 'string' ? enc.encode(d) : d);
const isAbsolute = (p: string) => /^(\/|~|[A-Za-z]:[\\/])/.test(p);
const expandHome = (p: string) => (p.startsWith('~') ? (nodeModule<NodeOs>('os')?.homedir() ?? '~') + p.slice(1) : p);

/** Where exports go on phones and tablets when no vault folder is set: there is no save dialog there. */
export const MOBILE_EXPORT_FOLDER = 'Exports';

/**
 * The export folder to write into, or '' to ask. A path outside the vault only works on the desktop;
 * on phones and tablets everything goes into a vault folder.
 */
export function usableFolder(exportFolder: string): string {
  const f = exportFolder.trim();
  if (!Platform.isMobile && nodeFs()) return f;
  return f && !isAbsolute(f) ? f : MOBILE_EXPORT_FOLDER;
}

/** A name that doesn't overwrite: "name (2).ext". */
function freeName(exists: (p: string) => boolean, dir: string, name: string, join: (a: string, b: string) => string): string {
  if (!exists(join(dir, name))) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; i < 1000; i++) { const n = `${base} (${i})${ext}`; if (!exists(join(dir, n))) return n; }
  return name;
}

/** Files for a top-level name (a file name, or a folder that paths start with). */
export type MakeFiles = (top: string) => OutFile[] | Promise<OutFile[]>;

async function writeToFolder(app: App, folder: string, topName: string, make: MakeFiles): Promise<string> {
  if (isAbsolute(folder)) {
    const fs = nodeFs()!, path = nodePath()!;
    const dir = expandHome(folder);
    fs.mkdirSync(dir, { recursive: true });
    const top = freeName(p => fs.existsSync(p), dir, topName, path.join);
    for (const f of await make(top)) {
      const full = path.join(dir, f.path);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, bytesOf(f.data));
    }
    return path.join(dir, top);
  }
  // A folder in the vault.
  const adapter = app.vault.adapter;
  const dir = normalizePath(folder);
  if (!(await adapter.exists(dir))) await app.vault.createFolder(dir);
  let top = topName;
  const dot = topName.lastIndexOf('.');
  for (let i = 2; await adapter.exists(normalizePath(`${dir}/${top}`)); i++) {
    top = dot > 0 ? `${topName.slice(0, dot)} (${i})${topName.slice(dot)}` : `${topName} (${i})`;
  }
  for (const f of await make(top)) {
    const full = normalizePath(`${dir}/${f.path}`);
    const parent = full.split('/').slice(0, -1).join('/');
    if (parent && !(await adapter.exists(parent))) await adapter.mkdir(parent);
    const b = bytesOf(f.data);
    await adapter.writeBinary(full, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  }
  return `${dir}/${top}`;
}

function download(name: string, data: Uint8Array | string, mime: string): void {
  const b = bytesOf(data);
  const blob = new Blob([b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer], { type: mime });
  const a = createEl('a', { attr: { href: URL.createObjectURL(blob), download: name } });
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

/**
 * Save one file: into the export folder from the settings, or where the user picks.
 * Returns where it went (null when cancelled).
 */
export async function saveFile(app: App, exportFolder: string, name: string, data: Uint8Array | string, filter: FileFilter): Promise<string | null> {
  const folder = usableFolder(exportFolder);
  if (folder) return writeToFolder(app, folder, name, (top) => [{ path: top, data }]);
  const remote = electronRemote();
  const fs = nodeFs();
  if (remote?.dialog && fs) {
    const res = await remote.dialog.showSaveDialog({ defaultPath: name, filters: [filter] });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, bytesOf(data));
    return res.filePath;
  }
  download(name, data, filter.extensions[0] === 'pdf' ? 'application/pdf' : 'application/octet-stream');
  return name;
}

/**
 * Save a folder of files. `make(top)` gets the folder's final name (it may become "name (2)")
 * and returns files whose paths start with it. Without a folder dialog: one ZIP.
 */
export async function saveFolder(app: App, exportFolder: string, top: string, make: MakeFiles, zip: (files: OutFile[]) => Uint8Array): Promise<string | null> {
  const folder = usableFolder(exportFolder);
  if (folder) return writeToFolder(app, folder, top, make);
  const remote = electronRemote();
  const fs = nodeFs(), path = nodePath();
  if (remote?.dialog && fs && path) {
    const res = await remote.dialog.showOpenDialog({ title: t('Choose where to save'), properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths?.[0]) return null;
    return writeToFolder(app, res.filePaths[0], top, make);
  }
  new Notice(t('No folder dialog here: saving a ZIP file instead.'));
  return saveFile(app, '', `${top}.zip`, zip(await make(top)), { name: 'ZIP', extensions: ['zip'] });
}

/** The vault's folder on disk, if it has one. */
export function vaultBasePath(app: App): string | null {
  if (typeof FileSystemAdapter === 'undefined') return null;
  return app.vault.adapter instanceof FileSystemAdapter ? app.vault.adapter.getBasePath() : null;
}
