import type { Board } from '../board/board';
import type { RawNode } from '../model/canvas-file';
import { cardKindOf } from './util';
import { descriptionHeight } from './media';

/*
 * Cropping and flipping pictures, like PureRef: both only change what the card shows. The file is
 * never touched, and Reset brings the whole picture back.
 *
 * A crop is the part of the picture shown, as fractions of its width and height (0–1), in the
 * picture's own (unflipped) coordinates. A flip mirrors what the card shows.
 */

export interface Crop { x: number; y: number; w: number; h: number }

const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };

export function cropOf(n: RawNode): Crop {
  const c = n.vc?.crop as Partial<Crop> | undefined;
  if (!c || typeof c !== 'object') return FULL;
  const x = clamp01(Number(c.x)), y = clamp01(Number(c.y));
  const w = Math.min(1 - x, Math.max(0.001, Number(c.w) || 1)), h = Math.min(1 - y, Math.max(0.001, Number(c.h) || 1));
  return { x, y, w, h };
}

export function isCropped(n: RawNode): boolean {
  const c = cropOf(n);
  return c.x > 1e-4 || c.y > 1e-4 || c.w < 1 - 1e-4 || c.h < 1 - 1e-4;
}

export function flipOf(n: RawNode): { h: boolean; v: boolean } {
  return { h: n.vc?.flipH === true, v: n.vc?.flipV === true };
}

function clamp01(v: number): number { return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }

/**
 * Lay out a picture card's view: `view` (filling the frame, clipping, mirrored by a flip) holds `box`
 * (the whole picture, placed so only the crop shows).
 */
export function applyView(view: HTMLElement, box: HTMLElement, n: RawNode): void {
  const c = cropOf(n), f = flipOf(n);
  box.setCssStyles({
    left: `${-c.x / c.w * 100}%`, top: `${-c.y / c.h * 100}%`,
    width: `${100 / c.w}%`, height: `${100 / c.h}%`,
  });
  view.setCssStyles({ transform: f.h || f.v ? `scale(${f.h ? -1 : 1}, ${f.v ? -1 : 1})` : '' });
}

/** A flip as a CSS transform ('' for none). */
export function flipTransform(n: RawNode): string {
  const f = flipOf(n);
  return f.h || f.v ? `scale(${f.h ? -1 : 1}, ${f.v ? -1 : 1})` : '';
}

const isPicture = (n: RawNode) => cardKindOf(n) === 'image';
const isFlippable = (n: RawNode) => ['image', 'video'].includes(cardKindOf(n));

/** Flip the selected pictures and videos, horizontally or vertically (each toggles). */
export function flipSelection(board: Board, axis: 'h' | 'v'): void {
  const nodes = board.selectedNodes().filter(isFlippable);
  if (!nodes.length) return;
  const key = axis === 'h' ? 'flipH' : 'flipV';
  board.model.transact(() => {
    for (const n of nodes) {
      n.vc = { ...(n.vc ?? {}) };
      if (n.vc[key] === true) delete n.vc[key]; else n.vc[key] = true;
      board.model.touch(n.id);
    }
  });
}

export function hasFlippable(board: Board): boolean { return board.selectedNodes().some(isFlippable); }

export function canCrop(board: Board): boolean {
  return board.selection.size === 1 && board.selectedNodes().some(isPicture);
}

export function anyCropped(board: Board): boolean {
  return board.selectedNodes().some(n => isPicture(n) && isCropped(n));
}

function naturalSize(board: Board, id: string): { w: number; h: number } | null {
  const img = board.cards.get(id)?.el.querySelector<HTMLImageElement>('.vc-media-frame img');
  return img?.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : null;
}

/** Show the whole picture again, at the same scale and with the shown part where it was. */
export function resetCrop(board: Board): void {
  const nodes = board.selectedNodes().filter(n => isPicture(n) && isCropped(n));
  if (!nodes.length) return;
  board.model.transact(() => {
    for (const n of nodes) {
      const c = cropOf(n), f = flipOf(n);
      const extra = descriptionHeight(board.cards.get(n.id)?.el);
      const pw = n.width, ph = n.height - extra;
      const fw = pw / c.w, fh = ph / c.h;
      // Where the whole picture sits, as shown (a flip mirrors the crop's place in it).
      const cx = f.h ? 1 - c.x - c.w : c.x, cy = f.v ? 1 - c.y - c.h : c.y;
      n.x -= cx * fw; n.y -= cy * fh;
      n.width = fw; n.height = fh + extra;
      n.vc = { ...(n.vc ?? {}) };
      delete n.vc.crop;
      board.model.touch(n.id);
    }
  });
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

let cropping: { finish: (apply: boolean) => void } | null = null;

/** End a crop in progress (applying it), e.g. when the board closes or the selection changes. */
export function finishCrop(apply = true): void { cropping?.finish(apply); }

/**
 * Crop mode for the selected picture: the whole picture shows dimmed around the card, and the
 * frame's edges and corners are dragged to choose the part to show (drag inside it to move it).
 * Enter or a click outside applies; Escape cancels.
 */
export function startCrop(board: Board): void {
  finishCrop(true);
  const n = board.selectedNodes().find(isPicture);
  if (!n || board.selection.size !== 1) return;
  const nat = naturalSize(board, n.id);
  const cardEl = board.cards.get(n.id)?.el;
  if (!nat || !cardEl) return;
  const img = cardEl.querySelector<HTMLImageElement>('.vc-media-frame img');
  const src = img?.currentSrc || img?.src;
  if (!src) return;
  const id = n.id;
  const c = cropOf(n), f = flipOf(n);
  const extra = descriptionHeight(cardEl);
  // The whole picture in world units, as shown (mirrored with the card).
  const fw = n.width / c.w, fh = (n.height - extra) / c.h;
  const sx = f.h ? 1 - c.x - c.w : c.x, sy = f.v ? 1 - c.y - c.h : c.y;
  const full = { x: n.x - sx * fw, y: n.y - sy * fh, w: fw, h: fh };
  // The part shown, in world units.
  let r = { x: n.x, y: n.y, w: n.width, h: n.height - extra };

  const layer = board.worldEl.createDiv('vc-crop-layer');
  layer.setCssStyles({ left: `${full.x}px`, top: `${full.y}px`, width: `${full.w}px`, height: `${full.h}px` });
  const flip = f.h || f.v ? `scale(${f.h ? -1 : 1}, ${f.v ? -1 : 1})` : '';
  const dim = layer.createEl('img', { cls: 'vc-crop-dim', attr: { src, draggable: 'false' } });
  const lit = layer.createEl('img', { cls: 'vc-crop-lit', attr: { src, draggable: 'false' } });
  dim.setCssStyles({ transform: flip });
  lit.setCssStyles({ transform: flip });
  const frame = layer.createDiv('vc-crop-frame');
  for (const h of HANDLES) frame.createDiv({ cls: `vc-crop-handle is-${h}`, attr: { 'data-h': h } });
  for (const k of ['v1', 'v2', 'h1', 'h2']) frame.createDiv(`vc-crop-third is-${k}`);
  cardEl.closest<HTMLElement>('.vc-node')?.addClass('is-cropping');
  board.root.addClass('is-cropping');

  const render = () => {
    const lx = r.x - full.x, ly = r.y - full.y;
    frame.setCssStyles({ left: `${lx}px`, top: `${ly}px`, width: `${r.w}px`, height: `${r.h}px` });
    // The clip is in the picture's own (unflipped) coordinates, so a flip swaps its sides.
    let top = ly, right = full.w - lx - r.w, bottom = full.h - ly - r.h, left = lx;
    if (f.h) [left, right] = [right, left];
    if (f.v) [top, bottom] = [bottom, top];
    lit.setCssStyles({ clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px)` });
  };
  render();

  const minW = () => 12 / board.vp.zoom;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (!layer.contains(t)) { finish(true); return; }
    e.stopPropagation();
    e.preventDefault();
    const h = (t.dataset.h as Handle | undefined) ?? (frame.contains(t) ? 'move' : null);
    if (!h) return;
    const start = board.clientToWorld(e.clientX, e.clientY);
    const o = { ...r };
    const move = (ev: PointerEvent) => {
      const p = board.clientToWorld(ev.clientX, ev.clientY);
      const dx = p.x - start.x, dy = p.y - start.y;
      const m = minW();
      let { x, y, w, h: hh } = o;
      if (h === 'move') {
        x = Math.max(full.x, Math.min(full.x + full.w - w, o.x + dx));
        y = Math.max(full.y, Math.min(full.y + full.h - hh, o.y + dy));
      } else {
        if (h.includes('w')) { x = Math.max(full.x, Math.min(o.x + o.w - m, o.x + dx)); w = o.x + o.w - x; }
        if (h.includes('e')) w = Math.max(m, Math.min(full.x + full.w - o.x, o.w + dx));
        if (h.includes('n')) { y = Math.max(full.y, Math.min(o.y + o.h - m, o.y + dy)); hh = o.y + o.h - y; }
        if (h.includes('s')) hh = Math.max(m, Math.min(full.y + full.h - o.y, o.h + dy));
        // Shift keeps the frame's proportions from a corner.
        if (ev.shiftKey && h.length === 2) {
          const ratio = o.w / o.h;
          if (w / hh > ratio) w = hh * ratio; else hh = w / ratio;
          if (h.includes('w')) x = o.x + o.w - w;
          if (h.includes('n')) y = o.y + o.h - hh;
        }
      }
      r = { x, y, w, h: hh };
      render();
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  };
  // Enter and Escape belong to the crop (not to editing the card or clearing the selection).
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    finish(e.key === 'Enter');
  };
  const win = board.root.ownerDocument.defaultView ?? window;
  const doc = board.root.ownerDocument;
  doc.addEventListener('pointerdown', onDown, true);
  win.addEventListener('keydown', onKey, true);

  const finish = (apply: boolean) => {
    if (cropping?.finish !== finish) return;
    cropping = null;
    doc.removeEventListener('pointerdown', onDown, true);
    win.removeEventListener('keydown', onKey, true);
    layer.remove();
    cardEl.closest<HTMLElement>('.vc-node')?.removeClass('is-cropping');
    board.root.removeClass('is-cropping');
    if (!apply) return;
    const node = board.model.node(id);
    if (!node) return;
    // Back to the picture's own coordinates (a flip mirrors them).
    let cx = (r.x - full.x) / full.w, cy = (r.y - full.y) / full.h;
    const cw = r.w / full.w, ch = r.h / full.h;
    if (f.h) cx = 1 - cx - cw;
    if (f.v) cy = 1 - cy - ch;
    const next: Crop = { x: round(cx), y: round(cy), w: round(cw), h: round(ch) };
    const same = Math.abs(next.x - c.x) < 1e-4 && Math.abs(next.y - c.y) < 1e-4 && Math.abs(next.w - c.w) < 1e-4 && Math.abs(next.h - c.h) < 1e-4;
    if (same) return;
    board.model.transact(() => {
      node.vc = { ...(node.vc ?? {}) };
      if (next.x < 1e-4 && next.y < 1e-4 && next.w > 1 - 1e-4 && next.h > 1 - 1e-4) delete node.vc.crop;
      else node.vc.crop = next;
      node.x = r.x; node.y = r.y; node.width = r.w; node.height = r.h + extra;
      board.model.touch(id);
    });
  };
  cropping = { finish };
}

const round = (v: number) => Math.round(v * 1e5) / 1e5;
