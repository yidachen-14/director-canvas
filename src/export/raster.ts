import { toCanvas } from 'html-to-image';
import type { Board } from '../board/board';
import { buildStage, imagesReady, offscreenHost, type Scope, scopeNodes } from './stage';
import { inlineMedia } from './files';

/** Browsers refuse canvases much larger than this on a side. */
const MAX_SIDE = 16000;

export interface RasterResult { canvas: HTMLCanvasElement; scale: number; width: number; height: number }

/** Draw a scope of the board to a canvas, `scale` pixels per board unit. */
export async function renderCanvas(board: Board, scope: Scope, opts: { scale: number; background: boolean; padding: number }): Promise<RasterResult> {
  const host = offscreenHost();
  try {
    const stage = buildStage(board, scopeNodes(board, scope), { padding: opts.padding, background: opts.background, host });
    inlineMedia(stage.el);
    await imagesReady(stage.el);
    const { width, height } = stage.bounds;
    const scale = Math.max(0.1, Math.min(opts.scale, MAX_SIDE / width, MAX_SIDE / height));
    const canvas = await toCanvas(stage.el, {
      width, height, pixelRatio: scale, skipFonts: true, cacheBust: false,
      backgroundColor: opts.background ? stage.el.style.background || undefined : undefined,
      // Board styles are already inline or in the document's sheets.
      filter: (n) => !(n.instanceOf(HTMLElement) && n.classList.contains('vc-mm-overlay') && !n.childElementCount),
    });
    return { canvas, scale, width, height };
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
