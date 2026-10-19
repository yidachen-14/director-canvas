export interface Point { x: number; y: number; }

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;

/** Pan and zoom. A world point p shows on screen at p * zoom + (x, y). */
export class Viewport {
  x = 0;
  y = 0;
  zoom = 1;

  toWorld(sx: number, sy: number): Point {
    return { x: (sx - this.x) / this.zoom, y: (sy - this.y) / this.zoom };
  }

  toScreen(wx: number, wy: number): Point {
    return { x: wx * this.zoom + this.x, y: wy * this.zoom + this.y };
  }

  /** Zoom by `factor` keeping the screen point (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const z = clampZoom(this.zoom * factor);
    const w = this.toWorld(sx, sy);
    this.zoom = z;
    this.x = sx - w.x * z;
    this.y = sy - w.y * z;
  }

  panBy(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
  }

  /** Fit a world rect into a screen area with padding; never zooms past 100%. */
  fit(rect: { x: number; y: number; width: number; height: number }, w: number, h: number, pad = 64, maxZoom = 1): void {
    const zw = (w - pad * 2) / Math.max(1, rect.width);
    const zh = (h - pad * 2) / Math.max(1, rect.height);
    this.zoom = clampZoom(Math.min(zw, zh, maxZoom));
    this.x = w / 2 - (rect.x + rect.width / 2) * this.zoom;
    this.y = h / 2 - (rect.y + rect.height / 2) * this.zoom;
  }

  toJSON(): { x: number; y: number; zoom: number } {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }
}

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/**
 * Dot grid that keeps a steady look at every zoom: the dots stay the same
 * size on screen and their spacing stays between MIN and 2×MIN pixels — as
 * the board zooms out, every other dot fades away; zooming in, new dots fade
 * in between the old ones.
 */
export function gridLayers(gridSize: number, zoom: number, minPx = 18): { coarse: number; fine: number; fineAlpha: number } {
  let step = gridSize * zoom;
  while (step < minPx) step *= 2;
  while (step >= minPx * 2) step /= 2;
  // `step` is now in [min, 2·min). The fine layer at `step` fades in as it
  // grows away from the minimum; the coarse layer at 2·step is always shown.
  const fineAlpha = Math.min(1, Math.max(0, (step - minPx) / (minPx * 0.6)));
  return { coarse: step * 2, fine: step, fineAlpha };
}
