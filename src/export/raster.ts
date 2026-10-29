import { toCanvas } from 'html-to-image';
import type { Board } from '../board/board';
import { buildStage, imagesReady, offscreenHost, type Scope, scopeNodes } from './stage';

/** Browsers refuse canvases much larger than this on a side. */
const MAX_SIDE = 16000;
/** Each piece is drawn on its own, so no single drawing grows huge (output pixels per side). */
const TILE = 4096;

export interface RasterResult { canvas: HTMLCanvasElement; scale: number; width: number; height: number }

/**
 * Pictures in the copy at the size they will be drawn, not their full original size: a board of
 * large photos would otherwise hold every one of them, full size, several times over in memory.
 */
async function shrinkImages(root: HTMLElement, scale: number): Promise<void> {
  const imgs = [...root.querySelectorAll('img')];
  await Promise.all(imgs.map(async (el) => {
    const src = el.getAttribute('src') ?? '';
    if (!src || src.startsWith('blob:')) return;
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const pic = new Image();
    pic.decoding = 'async';
    pic.src = src;
    try { await pic.decode(); } catch { return; }
    const nw = pic.naturalWidth, nh = pic.naturalHeight;
    if (!nw || !nh) return;
    // Enough pixels for the box at this scale (covering it, for cropped pictures), never more than the original.
    const k = Math.min(1, Math.max((box.width * scale) / nw, (box.height * scale) / nh) * 1.05);
    if (k > 0.9 && src.startsWith('data:')) return;
    const c = createEl('canvas');
    c.width = Math.max(1, Math.round(nw * k));
    c.height = Math.max(1, Math.round(nh * k));
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(pic, 0, 0, c.width, c.height);
    const alpha = /\.(png|gif|webp|svg)(\?|#|$)/i.test(src) || src.startsWith('data:image/png');
    try { el.setAttribute('src', alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92)); } catch { /* a tainted picture stays as it is */ }
    c.width = c.height = 0;
  }));
  // Videos without a still can't be drawn; their sources would only be carried along.
  for (const v of [...root.querySelectorAll('video, audio')]) v.removeAttribute('src');
}

/** Draw a scope of the board to a canvas, `scale` pixels per board unit, piece by piece. */
export async function renderCanvas(board: Board, scope: Scope, opts: { scale: number; background: boolean; padding: number }): Promise<RasterResult> {
  const host = offscreenHost();
  try {
    const nodes = scopeNodes(board, scope);
    const stage = buildStage(board, nodes, { padding: opts.padding, background: opts.background, host });
    const { width, height } = stage.bounds;
    const scale = Math.max(0.05, Math.min(opts.scale, MAX_SIDE / width, MAX_SIDE / height));
    await shrinkImages(stage.el, scale);
    await imagesReady(stage.el);
    const W = Math.max(1, Math.round(width * scale)), H = Math.max(1, Math.round(height * scale));
    const out = createEl('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('canvas export failed');
    const background = opts.background ? stage.el.style.background || undefined : undefined;
    const step = TILE / scale;
    const baseX = stage.bounds.x, baseY = stage.bounds.y;
    const rects = nodes.map(n => ({ id: n.id, x: n.x - baseX, y: n.y - baseY, w: n.width, h: n.height }));
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const tw = Math.min(step, width - x), th = Math.min(step, height - y);
        stage.el.setCssStyles({ width: `${tw}px`, height: `${th}px` });
        stage.world.setCssStyles({ transform: `translate(${-baseX - x}px, ${-baseY - y}px)` });
        // Only the cards that reach into this piece (with a margin for shadows and labels).
        const m = 80;
        const away = new Set(rects.filter(r => r.x > x + tw + m || r.x + r.w < x - m || r.y > y + th + m || r.y + r.h < y - m).map(r => r.id));
        const piece = await toCanvas(stage.el, {
          width: tw, height: th, pixelRatio: scale, skipFonts: true, cacheBust: false, backgroundColor: background,
          filter: (n) => {
            if (!n.instanceOf(HTMLElement)) return true;
            if (n.classList.contains('vc-mm-overlay') && !n.childElementCount) return false;
            return !(n.classList.contains('vc-node') && away.has(n.dataset.id ?? ''));
          },
        });
        ctx.drawImage(piece, Math.round(x * scale), Math.round(y * scale));
        piece.width = piece.height = 0;
        // Let the app breathe between pieces.
        await new Promise(r => window.setTimeout(r, 0));
      }
    }
    return { canvas: out, scale, width, height };
  } finally {
    host.remove();
  }
}

export async function canvasBytes(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, type, quality));
  if (!blob) throw new Error('canvas export failed');
  return new Uint8Array(await blob.arrayBuffer());
}

/** A one-page PDF holding a JPEG (when vector printing isn't available). */
export function imagePdf(jpeg: Uint8Array, pxW: number, pxH: number, pageW: number, pageH: number): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (b: Uint8Array | string) => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); len += u.length; };
  const obj = (n: number, body: string | (() => void)) => {
    offsets[n] = len;
    push(`${n} 0 obj\n`);
    if (typeof body === 'string') push(body); else body();
    push('\nendobj\n');
  };
  const content = `q ${pageW.toFixed(2)} 0 0 ${pageH.toFixed(2)} 0 0 cm /Im0 Do Q`;
  push('%PDF-1.4\n%âãÏÓ\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    push('\nendstream');
  });
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = len;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map(i => `${String(offsets[i]).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
