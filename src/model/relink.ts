import type { CanvasFile, RawNode } from './canvas-file';

/** One rename: a file, or a folder (everything under it moves too). */
export interface Move { from: string; to: string; folder: boolean; }

/** New path for `path` after the moves, or null when it did not move. */
export function movedPath(path: string, moves: Move[]): string | null {
  let out = path, changed = false;
  for (const m of moves) {
    if (m.folder) {
      if (out.startsWith(m.from + '/')) { out = m.to + out.slice(m.from.length); changed = true; }
    } else if (out === m.from) { out = m.to; changed = true; }
  }
  return changed ? out : null;
}

const stripMd = (p: string) => p.replace(/\.md$/i, '');
export const base = (p: string) => stripMd(p.split('/').pop() ?? p);

/**
 * Rewrite [[links]] in Markdown that point at a moved file. A link written as
 * a full path keeps being a full path; a bare name is renamed only if the
 * file's name changed.
 */
export function relinkText(text: string, moves: Move[]): string {
  return text.replace(/(!?\[\[)([^\]|#^]+)([#^][^\]|]*)?(\|[^\]]*)?\]\]/g, (all, open: string, target: string, sub = '', alias = '') => {
    const t = target.trim();
    for (const m of moves) {
      if (m.folder) {
        const hit = movedPath(t, [m]) ?? movedPath(t + '.md', [m]);
        if (hit) return `${open}${t.endsWith('.md') ? hit : stripMd(hit)}${sub}${alias}]]`;
        continue;
      }
      if (t === m.from || t === stripMd(m.from)) return `${open}${t === m.from ? m.to : stripMd(m.to)}${sub}${alias}]]`;
      if (!t.includes('/') && t === base(m.from) && base(m.from) !== base(m.to)) return `${open}${base(m.to)}${sub}${alias}]]`;
    }
    return all;
  });
}

/** Apply moves to a board's data. Returns true when anything changed. */
export function relinkCanvas(data: CanvasFile, moves: Move[]): boolean {
  let changed = false;
  const fix = (n: RawNode) => {
    if (n.file) {
      const p = movedPath(n.file, moves);
      if (p) { n.file = p; changed = true; }
    }
    if (typeof n.text === 'string' && n.text.includes('[[')) {
      const t = relinkText(n.text, moves);
      if (t !== n.text) { n.text = t; changed = true; }
    }
  };
  data.nodes.forEach(fix);
  return changed;
}
