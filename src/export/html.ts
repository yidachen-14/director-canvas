import type { Board } from '../board/board';
import { buildStage, offscreenHost, type Scope, scopeNodes } from './stage';
import { mediaElements, mimeOf, readResource, resourcePath, dataUrl, type OutFile } from './files';
import { t } from '../i18n';

/** All CSS the board uses right now: Obsidian's, the theme's and ours. */
function collectCss(): string {
  const out: string[] = [];
  for (const sheet of [...document.styleSheets]) {
    try {
      for (const rule of [...sheet.cssRules]) {
        // Fonts behind app:// can't load in a browser; system fonts take over.
        if (rule instanceof CSSFontFaceRule && /app:\/\//.test(rule.cssText)) continue;
        out.push(rule.cssText);
      }
    } catch { /* a sheet we may not read */ }
  }
  return out.join('\n');
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const VIEWER_CSS = `
html, body { margin: 0; height: 100%; overflow: hidden; }
body.vc-export-page { background: var(--background-primary); }
#vc-view { position: fixed; inset: 0; overflow: hidden; cursor: grab; touch-action: none; }
#vc-view.is-panning { cursor: grabbing; }
#vc-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.vc-x-bar { position: fixed; left: 12px; bottom: 12px; display: flex; gap: 6px; align-items: center; padding: 6px; border-radius: 10px;
  background: var(--background-primary); border: 1px solid var(--background-modifier-border); box-shadow: var(--shadow-s); z-index: 10; font: 13px var(--font-interface, system-ui); color: var(--text-normal); }
.vc-x-bar button { min-width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--interactive-normal); color: var(--text-normal); cursor: pointer; padding: 0 8px; }
.vc-x-bar input { width: 160px; height: 28px; box-sizing: border-box; border-radius: 6px; border: 1px solid var(--background-modifier-border); padding: 0 8px; background: var(--background-primary); color: var(--text-normal); }
.vc-x-zoom { min-width: 44px; text-align: center; color: var(--text-muted); }
.vc-x-count { color: var(--text-muted); min-width: 40px; }
#vc-mini { position: fixed; right: 12px; bottom: 12px; width: 200px; height: 140px; border-radius: 8px; z-index: 10; cursor: pointer;
  background: var(--background-secondary); border: 1px solid var(--background-modifier-border); box-shadow: var(--shadow-s); }
.vc-x-hit { outline: 3px solid var(--interactive-accent) !important; outline-offset: 4px; border-radius: 6px; }
.vc-x-hit.is-current { outline-color: var(--text-accent) !important; outline-width: 4px !important; }
`;

/** Pan, zoom, minimap and search for the exported page; `DATA` holds the bounds and card rectangles. */
const VIEWER_JS = `(() => {
const D = window.VC_DATA, view = document.getElementById('vc-view'), world = document.getElementById('vc-world');
const mini = document.getElementById('vc-mini'), mctx = mini.getContext('2d'), zl = document.querySelector('.vc-x-zoom');
let z = 1, tx = 0, ty = 0;
const clampZ = v => Math.max(0.05, Math.min(8, v));
function apply() { world.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + z + ')'; view.style.setProperty('--vc-zoom', z); zl.textContent = Math.round(z * 100) + '%'; drawMini(); }
function fit() { const W = view.clientWidth, H = view.clientHeight; z = clampZ(Math.min((W - 80) / D.b.w, (H - 80) / D.b.h, 1.5)); tx = W / 2 - (D.b.x + D.b.w / 2) * z; ty = H / 2 - (D.b.y + D.b.h / 2) * z; apply(); }
function zoomAt(f, cx, cy) { const nz = clampZ(z * f); tx = cx - (cx - tx) * nz / z; ty = cy - (cy - ty) * nz / z; z = nz; apply(); }
function centerOn(x, y) { tx = view.clientWidth / 2 - x * z; ty = view.clientHeight / 2 - y * z; apply(); }
function scrolls(el, dy) { while (el && el !== view) { const s = getComputedStyle(el); if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1 && !((dy < 0 && el.scrollTop <= 0) || (dy > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 1))) return true; el = el.parentElement; } return false; }
view.addEventListener('wheel', e => {
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002)), e.clientX, e.clientY); return; }
  if (scrolls(e.target, e.deltaY)) return;
  e.preventDefault(); tx -= e.deltaX; ty -= e.deltaY; apply();
}, { passive: false });
let drag = null;
view.addEventListener('pointerdown', e => { if (e.button !== 0 || e.target.closest('a, video, audio, input')) return; drag = { x: e.clientX, y: e.clientY, tx, ty }; view.setPointerCapture(e.pointerId); view.classList.add('is-panning'); });
view.addEventListener('pointermove', e => { if (!drag) return; tx = drag.tx + e.clientX - drag.x; ty = drag.ty + e.clientY - drag.y; apply(); });
view.addEventListener('pointerup', () => { drag = null; view.classList.remove('is-panning'); });
document.getElementById('vc-zin').onclick = () => zoomAt(1.25, view.clientWidth / 2, view.clientHeight / 2);
document.getElementById('vc-zout').onclick = () => zoomAt(0.8, view.clientWidth / 2, view.clientHeight / 2);
document.getElementById('vc-fit').onclick = fit;
// Minimap
function miniScale() { const r = mini.getBoundingClientRect(); const k = Math.min((r.width - 12) / D.b.w, (r.height - 12) / D.b.h); return { k, ox: (r.width - D.b.w * k) / 2, oy: (r.height - D.b.h * k) / 2, r }; }
function drawMini() {
  const dpr = window.devicePixelRatio || 1, m = miniScale();
  mini.width = m.r.width * dpr; mini.height = m.r.height * dpr; mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cs = getComputedStyle(document.body);
  mctx.fillStyle = cs.getPropertyValue('--text-faint') || '#888';
  for (const n of D.n) mctx.fillRect(m.ox + (n.x - D.b.x) * m.k, m.oy + (n.y - D.b.y) * m.k, Math.max(1, n.w * m.k), Math.max(1, n.h * m.k));
  const vx = -tx / z, vy = -ty / z, vw = view.clientWidth / z, vh = view.clientHeight / z;
  mctx.strokeStyle = cs.getPropertyValue('--interactive-accent') || '#7c3aed'; mctx.lineWidth = 1.5;
  mctx.strokeRect(m.ox + (vx - D.b.x) * m.k, m.oy + (vy - D.b.y) * m.k, vw * m.k, vh * m.k);
}
mini.addEventListener('pointerdown', e => { const m = miniScale(); const go = ev => centerOn(D.b.x + (ev.clientX - m.r.left - m.ox) / m.k, D.b.y + (ev.clientY - m.r.top - m.oy) / m.k); go(e); mini.setPointerCapture(e.pointerId); mini.onpointermove = ev => { if (ev.buttons) go(ev); }; });
// Search
const input = document.getElementById('vc-q'), count = document.querySelector('.vc-x-count');
let hits = [], cur = -1;
function search() {
  for (const h of hits) h.classList.remove('vc-x-hit', 'is-current');
  const q = input.value.trim().toLowerCase(); hits = []; cur = -1;
  if (q) hits = [...world.querySelectorAll('.vc-node')].filter(el => (el.textContent || '').toLowerCase().includes(q));
  for (const h of hits) h.classList.add('vc-x-hit');
  count.textContent = q ? (hits.length ? '0/' + hits.length : '0') : '';
  if (hits.length) next(1);
}
function next(d) {
  if (!hits.length) return;
  if (cur >= 0) hits[cur].classList.remove('is-current');
  cur = (cur + d + hits.length) % hits.length; const el = hits[cur]; el.classList.add('is-current');
  const n = D.n.find(x => x.id === el.dataset.id);
  if (n) { z = clampZ(Math.min(1.2, view.clientWidth * 0.7 / n.w, view.clientHeight * 0.7 / n.h)); centerOn(n.x + n.w / 2, n.y + n.h / 2); }
  count.textContent = (cur + 1) + '/' + hits.length;
}
input.addEventListener('input', search);
input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); next(e.shiftKey ? -1 : 1); } });
window.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); input.focus(); input.select(); } });
window.addEventListener('resize', drawMini);
fit();
})();`;

export interface HtmlExport { name: string; single: string; files(top: string): OutFile[] }

/**
 * A page that shows the board in any browser. `single`: one .html file with everything inside;
 * otherwise a folder with index.html and the pictures and videos next to it.
 */
export async function exportHtml(board: Board, scope: Scope, name: string, single: boolean): Promise<HtmlExport> {
  const host = offscreenHost();
  try {
    const nodes = scopeNodes(board, scope);
    const stage = buildStage(board, nodes, { padding: 0, background: false, host });
    const world = stage.world;
    world.id = 'vc-world';
    world.style.transform = '';
    const assets: { rel: string; data: Uint8Array }[] = [];
    const used = new Map<string, string>();
    for (const el of mediaElements(world)) {
      const src = el.getAttribute('src')!;
      const bytes = readResource(src);
      if (!bytes) continue;
      const path = resourcePath(src) ?? src;
      if (single) { el.setAttribute('src', dataUrl(bytes, mimeOf(path))); continue; }
      let rel = used.get(path);
      if (!rel) {
        const base = (path.split(/[\\/]/).pop() ?? 'file').replace(/[^\w.\-　-鿿]+/g, '_');
        rel = `assets/${used.size}-${base}`;
        used.set(path, rel);
        assets.push({ rel, data: bytes });
      }
      // Not "src" yet: the copy is in Obsidian's page, where relative paths would be fetched.
      el.removeAttribute('src');
      el.setAttribute('data-x-src', rel);
    }
    // Cards' rectangles for the minimap and search.
    const data = {
      b: { x: stage.bounds.x, y: stage.bounds.y, w: stage.bounds.width, h: stage.bounds.height },
      n: nodes.map(n => ({ id: n.id, x: n.x, y: n.y, w: n.width, h: n.height })),
    };
    const stageClass = stage.el.className.replace('vc-export-stage', '').trim();
    const html = `<!doctype html>
<html lang="${document.documentElement.lang || 'zh-TW'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Visual Canvas">
<title>${esc(name)}</title>
<style>${collectCss()}</style>
<style>${VIEWER_CSS}</style>
</head>
<body class="${esc(document.body.className)} vc-export-page">
<div id="vc-view" class="${esc(stageClass)}" style="${esc(stage.el.style.cssText.replace(/(^|;\s*)(width|height|position|left|top|overflow):[^;]*/g, '$1'))}">${world.outerHTML.replace(/ data-x-src=/g, ' src=')}</div>
<div class="vc-x-bar">
  <input id="vc-q" type="search" placeholder="${esc(t('Search the board'))}">
  <span class="vc-x-count"></span>
  <button id="vc-zout" title="${esc(t('Zoom out'))}">−</button><span class="vc-x-zoom">100%</span><button id="vc-zin" title="${esc(t('Zoom in'))}">+</button>
  <button id="vc-fit" title="${esc(t('Zoom to fit'))}">${esc(t('Fit'))}</button>
</div>
<canvas id="vc-mini"></canvas>
<script>window.VC_DATA = ${JSON.stringify(data)};</script>
<script>${VIEWER_JS}</script>
</body>
</html>`;
    return {
      name,
      single: html,
      files: (top: string) => [{ path: `${top}/index.html`, data: html }, ...assets.map(a => ({ path: `${top}/${a.rel}`, data: a.data }))],
    };
  } finally {
    host.remove();
  }
}
