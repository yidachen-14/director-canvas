import type { Board } from '../board/board';
import { buildStage, imagesReady, type Scope, scopeNodes } from './stage';
import { electronRemote } from './files';
import { canvasBytes, imagePdf, renderCanvas } from './raster';

export type PageSize = 'content' | 'A4' | 'A3' | 'Letter';

const PAPER_MM: Record<Exclude<PageSize, 'content'>, [number, number]> = { A4: [210, 297], A3: [297, 420], Letter: [215.9, 279.4] };
const MM = 96 / 25.4; // CSS px per mm
/** Chrome's PDF pages stop growing somewhere past 200 inches. */
const MAX_PAGE_PX = 14000;

/**
 * A PDF of a scope. With Electron's printing the text stays text (searchable, sharp);
 * otherwise the board is placed as a picture.
 */
export async function exportPdf(board: Board, scope: Scope, opts: { page: PageSize; background: boolean }): Promise<Uint8Array> {
  const remote = electronRemote();
  const wc = remote?.getCurrentWebContents?.();
  if (wc?.printToPDF) {
    try { return await printPdf(board, scope, opts, wc); } catch (e) { console.warn('Visual Canvas: vector PDF failed, using a picture', e); }
  }
  return rasterPdf(board, scope, opts);
}

function pageFor(w: number, h: number, page: PageSize): { pw: number; ph: number; scale: number; ox: number; oy: number } {
  if (page === 'content') {
    const scale = Math.min(1, MAX_PAGE_PX / w, MAX_PAGE_PX / h);
    return { pw: Math.ceil(w * scale), ph: Math.ceil(h * scale), scale, ox: 0, oy: 0 };
  }
  let [a, b] = PAPER_MM[page].map(v => v * MM);
  if (w > h) [a, b] = [b, a]; // landscape for wide boards
  const margin = 10 * MM;
  const scale = Math.min((a - margin * 2) / w, (b - margin * 2) / h);
  return { pw: a, ph: b, scale, ox: (a - w * scale) / 2, oy: (b - h * scale) / 2 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function printPdf(board: Board, scope: Scope, opts: { page: PageSize; background: boolean }, wc: any): Promise<Uint8Array> {
  const host = document.body.createDiv('vc-print-host');
  const style = document.head.createEl('style');
  try {
    const stage = buildStage(board, scopeNodes(board, scope), { padding: opts.page === 'content' ? 24 : 0, background: opts.background, host });
    const { width, height } = stage.bounds;
    const pg = pageFor(width, height, opts.page);
    Object.assign(stage.el.style, { position: 'absolute', left: `${pg.ox}px`, top: `${pg.oy}px`, transformOrigin: '0 0', transform: `scale(${pg.scale})` });
    Object.assign(host.style, { position: 'fixed', left: '-100000px', top: '0', width: `${pg.pw}px`, height: `${pg.ph}px`, overflow: 'hidden' });
    style.textContent = `
      @page { size: ${pg.pw.toFixed(2)}px ${pg.ph.toFixed(2)}px; margin: 0; }
      @media print {
        html, body { height: auto !important; overflow: visible !important; background: ${opts.background ? 'var(--background-primary)' : 'transparent'} !important; }
        body > *:not(.vc-print-host) { display: none !important; }
        body > .vc-print-host { display: block !important; position: relative !important; left: 0 !important; top: 0 !important; }
        .vc-print-host * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      }`;
    await imagesReady(stage.el);
    await new Promise(r => window.setTimeout(r, 120));
    const data = await wc.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 }, displayHeaderFooter: false });
    return new Uint8Array(data);
  } finally {
    host.remove();
    style.remove();
  }
}

async function rasterPdf(board: Board, scope: Scope, opts: { page: PageSize; background: boolean }): Promise<Uint8Array> {
  const r = await renderCanvas(board, scope, { scale: 2, background: true, padding: opts.page === 'content' ? 24 : 0 });
  const pg = pageFor(r.width, r.height, opts.page);
  const jpeg = await canvasBytes(r.canvas, 'image/jpeg', 0.92);
  // PDF points: 72 per inch; CSS px: 96 per inch.
  const pt = 72 / 96;
  if (opts.page === 'content') return imagePdf(jpeg, r.canvas.width, r.canvas.height, pg.pw * pt, pg.ph * pt);
  // Paper: draw the picture centred on the page.
  const c = createEl('canvas');
  const k = r.canvas.width / r.width;
  c.width = Math.round(pg.pw * k); c.height = Math.round(pg.ph * k);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(r.canvas, pg.ox * k, pg.oy * k, r.width * pg.scale * k, r.height * pg.scale * k);
  return imagePdf(await canvasBytes(c, 'image/jpeg', 0.92), c.width, c.height, pg.pw * pt, pg.ph * pt);
}
