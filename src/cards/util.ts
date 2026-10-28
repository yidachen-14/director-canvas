import { TFile, type App } from 'obsidian';
import type { RawNode } from '../model/canvas-file';

/** CSS colour for a canvas colour value: '1'–'6' presets or a hex string. */
export function cssColor(color: string | undefined): string | null {
  if (!color) return null;
  if (/^[1-6]$/.test(color)) return presetColor(color);
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return color;
  return null;
}

/**
 * Obsidian's preset canvas colours live in --canvas-color-1…6. Older themes
 * store them as "r, g, b" triplets, newer ones as plain colours.
 */
export function presetColor(n: string): string {
  const raw = getComputedStyle(document.body).getPropertyValue(`--canvas-color-${n}`).trim();
  if (/^\d+\s*,\s*\d+\s*,\s*\d+$/.test(raw)) return `rgb(var(--canvas-color-${n}))`;
  return `var(--canvas-color-${n})`;
}

export function applyCardColor(el: HTMLElement, color: string | undefined): void {
  const c = cssColor(color);
  if (c) { el.style.setProperty('--vc-card-color', c); el.addClass('has-color'); }
  else { el.style.removeProperty('--vc-card-color'); el.removeClass('has-color'); }
}

export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic', 'tif', 'tiff'];
export const VIDEO_EXT = ['mp4', 'webm', 'mov', 'mkv', 'ogv', 'm4v'];
export const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'opus', '3gp'];

export type FileKind = 'image' | 'video' | 'audio' | 'markdown' | 'pdf' | 'canvas' | 'other';

export function fileKindOf(path: string): FileKind {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (ext === 'md') return 'markdown';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'canvas') return 'canvas';
  return 'other';
}

export function resolveFile(app: App, node: RawNode): TFile | null {
  if (!node.file) return null;
  const f = app.vault.getAbstractFileByPath(node.file);
  return f instanceof TFile ? f : null;
}

/** Card kind for a node: the Director Canvas kind, or one derived from the core node type. */
export function cardKindOf(node: RawNode): string {
  const vk = node.vc?.kind;
  if (typeof vk === 'string' && vk) return vk;
  switch (node.type) {
    case 'text': return 'note';
    case 'group': return 'group';
    case 'link': return 'link';
    case 'file': {
      const k = node.file ? fileKindOf(node.file) : 'other';
      return k === 'image' || k === 'video' || k === 'audio' ? k : 'file';
    }
    default: return 'unknown';
  }
}

/** Read a Director Canvas field with a fallback. */
export function vcGet<T>(node: RawNode, key: string, fallback: T): T {
  const v = node.vc?.[key];
  return (v === undefined ? fallback : v) as T;
}
