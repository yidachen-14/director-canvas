/**
 * A small colour picker that lives inside our own panels (the system colour
 * panel can't be placed and covers what is being coloured): a saturation /
 * brightness square, a hue strip and a hex field. `onInput` fires while
 * dragging (for a live preview), `onCommit` once a choice is made.
 */

export interface ColorPickerOptions {
  onInput(hex: string): void;
  onCommit(hex: string): void;
}

function clamp(v: number, a = 0, b = 1): number { return Math.max(a, Math.min(b, v)); }

export function hexToHsv(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? parseInt(m[1], 16) : 0x8b5cf6;
  const r = (v >> 16) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

export function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

/** The last colour picked, with its hue: black, white and greys don't carry a hue of their own. */
let last: { hex: string; h: number; s: number; v: number } | null = null;

export function colorPicker(parent: HTMLElement, initial: string | undefined, opts: ColorPickerOptions): HTMLElement {
  const start = initial && /^#[0-9a-f]{6}$/i.test(initial) ? initial.toUpperCase() : '#8B5CF6';
  let [h, s, v] = last && last.hex === start ? [last.h, last.s, last.v] : hexToHsv(start);
  const remember = (hex: string) => { last = { hex, h, s, v }; };
  const wrap = parent.createDiv('vc-picker');
  const sv = wrap.createDiv('vc-picker-sv');
  const svThumb = sv.createDiv('vc-picker-thumb');
  const hue = wrap.createDiv('vc-picker-hue');
  const hueThumb = hue.createDiv('vc-picker-thumb');
  const row = wrap.createDiv('vc-picker-row');
  const dot = row.createDiv('vc-picker-dot');
  const field = row.createEl('input', { type: 'text', cls: 'vc-picker-hex', attr: { maxlength: '7', spellcheck: 'false' } });

  let frame = 0;
  const paint = () => {
    const hex = hsvToHex(h, s, v);
    sv.style.background = `hsl(${h}, 100%, 50%)`;
    svThumb.style.left = `${s * 100}%`;
    svThumb.style.top = `${(1 - v) * 100}%`;
    hueThumb.style.left = `${(h / 360) * 100}%`;
    dot.style.background = hex;
    if (wrap.ownerDocument.activeElement !== field) field.value = hex;
    return hex;
  };
  const live = () => {
    const hex = paint();
    cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => opts.onInput(hex));
  };
  const drag = (el: HTMLElement, set: (fx: number, fy: number) => void) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const at = (ev: PointerEvent) => {
        const r = el.getBoundingClientRect();
        set(clamp((ev.clientX - r.left) / r.width), clamp((ev.clientY - r.top) / r.height));
        live();
      };
      at(e);
      const move = (ev: PointerEvent) => at(ev);
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        cancelAnimationFrame(frame);
        const hex = hsvToHex(h, s, v);
        remember(hex);
        opts.onCommit(hex);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  };
  drag(sv, (fx, fy) => { s = fx; v = 1 - fy; });
  drag(hue, (fx) => { h = Math.min(359.9, fx * 360); });
  const fromField = (commit: boolean) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(field.value.trim());
    if (!m) return;
    [h, s, v] = hexToHsv(`#${m[1]}`);
    const hex = paint();
    if (commit) { remember(hex); opts.onCommit(hex); } else opts.onInput(hex);
  };
  field.addEventListener('input', () => fromField(false));
  field.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); fromField(true); } });
  field.addEventListener('change', () => fromField(true));
  paint();
  return wrap;
}
