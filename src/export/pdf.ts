import type { Board } from '../board/board';
import { buildStage, imagesReady, type Scope, scopeNodes } from './stage';
import { electronRemote, type ElectronWebContents } from './files';
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
    try { return await printPdf(board, scope, opts, wc); } catch (e) { console.warn('Director Canvas: vector PDF failed, using a picture', e); }
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

async function printPdf(board: Board, scope: Scope, opts: { page: PageSize; background: boolean }, wc: ElectronWebContents): Promise<Uint8Array> {
  const host = document.body.createDiv('vc-print-host');
  // Printing shows only the stage (rules in styles.css); the page size goes to Electron.
  document.body.addClass('vc-printing');
  document.body.toggleClass('vc-print-bg', opts.background);
  try {
    const stage = buildStage(board, scopeNodes(board, scope), { padding: opts.page === 'content' ? 24 : 0, background: opts.background, host });
    const { width, height } = stage.bounds;
    const pg = pageFor(width, height, opts.page);
    stage.el.setCssStyles({ position: 'absolute', left: `${pg.ox}px`, top: `${pg.oy}px`, transformOrigin: '0 0', transform: `scale(${pg.scale})` });
    host.setCssStyles({ position: 'fixed', left: '-100000px', top: '0', width: `${pg.pw}px`, height: `${pg.ph}px`, overflow: 'hidden' });
    await imagesReady(stage.el);
    await new Promise(r => window.setTimeout(r, 120));
    const data = await wc.printToPDF({
      printBackground: true,
      pageSize: { width: pg.pw / 96, height: pg.ph / 96 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      displayHeaderFooter: false,
    });
    return new Uint8Array(data);
  } finally {
    host.remove();
    document.body.removeClass('vc-printing', 'vc-print-bg');
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
