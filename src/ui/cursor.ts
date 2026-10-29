import { getIcon } from 'obsidian';

const cache = new Map<string, string>();

/**
 * A CSS cursor for placing a card: a small cross at the hot spot (where the card's
 * top-left corner lands) with the tool's icon beside it.
 */
export function placeCursor(icon: string): string {
  const hit = cache.get(icon);
  if (hit) return hit;
  const svg = getIcon(icon);
  let inner = '';
  if (svg) {
    const body = Array.from(svg.children).map(c => c.outerHTML).join('');
    const vb = (svg.getAttribute('viewBox') ?? '0 0 24 24').split(/[\s,]+/).map(Number);
    const size = vb[2] || 24;
    if (size === 24) {
      // A Lucide icon: twice, a white halo behind and the dark icon on top, so it reads on any background.
      inner = `<g transform="translate(9 9) scale(0.75)" fill="none" stroke-linecap="round" stroke-linejoin="round">`
        + `<g stroke="#fff" stroke-width="5">${body}</g><g stroke="#1f1f1f" stroke-width="2">${body}</g></g>`;
    } else {
      // The plugin's own icons (drawn on a 100-unit grid, with their own strokes): on a small white tile.
      const k = 16 / size;
      inner = `<rect x="8.5" y="8.5" width="21" height="21" rx="5" fill="#fff" stroke="#1f1f1f" stroke-opacity="0.25"/>`
        + `<g transform="translate(11 11) scale(${k})" style="color:#1f1f1f">${body}</g>`;
    }
  }
  const cross = '<path d="M1 1h7M1 1v7" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/><path d="M1 1h7M1 1v7" stroke="#1f1f1f" stroke-width="1.5" stroke-linecap="round"/>';
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${cross}${inner}</svg>`;
  const css = `url("data:image/svg+xml,${encodeURIComponent(xml)}") 1 1, crosshair`;
  cache.set(icon, css);
  return css;
}
