import { addIcon, setIcon, setTooltip } from 'obsidian';
import type { BarItem } from '../cards/types';
import { t } from '../i18n';
import {
  type MMBoundary, type MMDash, type MMData, type MMLayout, type MMLine, type MMShape, type MMSize, type MMTopic, type MMStyle,
  MM_THEMES, anyTopic, branchSideways, eachTopic, findIn, resolveStyles, themeById,
} from './model';
import type { MindMapControl } from './card';
import { colorPicker } from '../ui/color-picker';

// ── Icons (100 × 100) ─────────────────────────────────────────────────

const S = (d: string, w = 7) => `<path d="${d}" fill="none" stroke="currentColor" style="stroke-width:${w}px" stroke-linecap="round" stroke-linejoin="round"/>`;
const R = (x: number, y: number, w: number, h: number, rx: number, sw = 7, fill = 'none') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="currentColor" style="stroke-width:${sw}px"/>`;

const ICONS: Record<string, string> = {
  'vc-mm-summary': R(6, 12, 34, 18, 6, 6) + R(6, 41, 34, 18, 6, 6) + R(6, 70, 34, 18, 6, 6)
    + S('M48 14 Q56 14 56 22 V42 Q56 50 64 50 Q56 50 56 58 V78 Q56 86 48 86', 6) + R(70, 41, 26, 18, 6, 6),
  'vc-mm-boundary': `<rect x="8" y="16" width="84" height="68" rx="14" fill="none" stroke="currentColor" stroke-width="6" stroke-dasharray="12 9"/>` + R(24, 32, 52, 14, 5, 6) + R(24, 56, 52, 14, 5, 6),
  'vc-mm-theme': R(6, 40, 28, 20, 10) + S('M34 50 C48 50 46 22 60 22 M34 50 H60 M34 50 C48 50 46 78 60 78') + R(62, 14, 30, 16, 6, 6) + R(62, 42, 30, 16, 6, 6) + R(62, 70, 30, 16, 6, 6),
  // A frame drawn in different strokes (dashed sides, a heavy base): "the outline", not a shape.
  'vc-mm-border': `<path d="M14 72 V30 Q14 22 22 22 H78 Q86 22 86 30 V72" fill="none" stroke="currentColor" style="stroke-width:6px" stroke-dasharray="9 8" stroke-linecap="round"/>` + S('M12 80 H88', 11),
  'vc-mm-shape': R(10, 30, 80, 40, 20, 8),
  'vc-mm-line': S('M12 50 C40 50 40 18 88 18 M12 50 H88 M12 50 C40 50 40 82 88 82'),
  'vc-mm-branch': S('M14 30 H38 C52 30 52 14 66 14 H88 M38 30 C52 30 52 46 66 46 H88') + `<rect x="12" y="68" width="76" height="16" rx="4" fill="currentColor"/>`,
  // Layouts
  'vc-mm-l-right': R(6, 40, 26, 20, 8, 6) + S('M32 50 C44 50 44 20 58 20 H90 M32 50 H90 M32 50 C44 50 44 80 58 80 H90', 6),
  'vc-mm-l-both': R(36, 40, 28, 20, 8, 6) + S('M64 50 C74 50 74 24 84 24 H96 M64 50 C74 50 74 76 84 76 H96 M36 50 C26 50 26 24 16 24 H4 M36 50 C26 50 26 76 16 76 H4', 6),
  'vc-mm-l-down': R(34, 8, 32, 20, 6, 6) + S('M50 28 V46 M16 46 H84 M16 46 V60 M50 46 V60 M84 46 V60', 6) + R(4, 62, 24, 18, 4, 6) + R(38, 62, 24, 18, 4, 6) + R(72, 62, 24, 18, 4, 6),
  'vc-mm-l-timeline': S('M4 50 H96', 6) + R(4, 40, 22, 20, 6, 6) + R(38, 40, 22, 20, 6, 6) + R(72, 40, 22, 20, 6, 6) + S('M46 60 V80 H58 M80 60 V80 H90', 5),
  'vc-mm-l-list': R(6, 6, 38, 20, 6, 6) + S('M20 26 V40 H34 M20 40 V62 H34 M44 62 V80 H56', 6) + R(36, 32, 40, 16, 4, 5) + R(36, 54, 40, 16, 4, 5) + R(58, 72, 34, 16, 4, 5),
  // Shapes
  'vc-mm-s-rect': R(10, 28, 80, 44, 0, 7),
  'vc-mm-s-rounded-sm': R(10, 28, 80, 44, 8, 7),
  'vc-mm-s-rounded': R(10, 28, 80, 44, 16, 7),
  'vc-mm-s-pill': R(10, 28, 80, 44, 22, 7),
  'vc-mm-s-underline': S('M12 66 H88', 8) + `<path d="M28 34 H72 M28 50 H60" fill="none" stroke="currentColor" style="stroke-width:6px;opacity:.45" stroke-linecap="round"/>`,
  // Lines
  'vc-mm-ln-curve': S('M10 50 C40 50 40 16 90 16 M10 50 C40 50 40 84 90 84'),
  'vc-mm-ln-straight': S('M10 50 L90 16 M10 50 L90 84'),
  'vc-mm-ln-arc': S('M10 50 Q14 16 44 16 H90 M10 50 Q14 84 44 84 H90'),
  'vc-mm-ln-elbow': S('M10 50 H40 V16 H90 M40 50 V84 H90'),
  'vc-mm-ln-rounded': S('M10 50 H40 V30 Q40 16 54 16 H90 M40 50 V70 Q40 84 54 84 H90'),
  'vc-mm-ln-brace': S('M10 50 H34 M50 16 Q40 16 40 26 V44 Q40 50 34 50 Q40 50 40 56 V74 Q40 84 50 84 M50 16 H90 M50 84 H90'),
  // Border dashes (same proportions as drawn on a topic)
  'vc-mm-d-solid': S('M8 50 H92', 8),
  'vc-mm-d-dotted': `<path d="M10 50 H92" fill="none" stroke="currentColor" style="stroke-width:8px" stroke-dasharray="0.1 14" stroke-linecap="round"/>`,
  'vc-mm-d-short': `<path d="M8 50 H92" fill="none" stroke="currentColor" style="stroke-width:8px" stroke-dasharray="7 7"/>`,
  'vc-mm-d-dashed': `<path d="M8 50 H92" fill="none" stroke="currentColor" style="stroke-width:8px" stroke-dasharray="13 8"/>`,
  'vc-mm-d-long': `<path d="M8 50 H92" fill="none" stroke="currentColor" style="stroke-width:8px" stroke-dasharray="21 9"/>`,
  'vc-mm-d-dashdot': `<path d="M8 50 H92" fill="none" stroke="currentColor" style="stroke-width:8px" stroke-dasharray="14 8 0.1 8" stroke-linecap="round"/>`,
  // Border thickness
  'vc-mm-w-1': S('M10 50 H90', 3),
  'vc-mm-w-2': S('M10 50 H90', 6),
  'vc-mm-w-3': S('M10 50 H90', 9),
  'vc-mm-w-4': S('M10 50 H90', 12),
  'vc-mm-w-5': S('M10 50 H90', 15),
};

let iconsAdded = false;
export function addMindMapIcons(): void {
  if (iconsAdded) return;
  iconsAdded = true;
  for (const [id, svg] of Object.entries(ICONS)) addIcon(id, svg);
}

// ── Choices ───────────────────────────────────────────────────────────

export const PALETTE = [
  '#000000', '#2B2B2B', '#4D4D4D', '#737373', '#999999', '#BFBFBF', '#D9D9D9', '#E8E8E8', '#F2F2F2', '#FFFFFF',
  '#FFC9C9', '#FFD8C2', '#FFE3A3', '#FFF3A3', '#C3F0C8', '#B9F0E4', '#BDE4FF', '#CCDBFF', '#DCD6FF', '#F7D4F0',
  '#F25C5C', '#F57F4F', '#F5A040', '#F5C830', '#33C48B', '#20C4C4', '#4FA3F7', '#6B8CF7', '#9B7BF7', '#E26BD3',
];

const LAYOUTS: { id: MMLayout; label: string }[] = [
  { id: 'right', label: 'Mind map (right)' },
  { id: 'both', label: 'Mind map (both sides)' },
  { id: 'down', label: 'Org chart' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'list', label: 'Outline' },
];
const SIZES: { id: MMSize; label: string }[] = [
  { id: 'compact', label: 'Compact' }, { id: 'normal', label: 'Normal' }, { id: 'large', label: 'Large' },
];
const SHAPES: { id: MMShape; label: string }[] = [
  { id: 'rect', label: 'Rectangle' }, { id: 'rounded-sm', label: 'Small corners' }, { id: 'rounded', label: 'Large corners' },
  { id: 'pill', label: 'Capsule' }, { id: 'underline', label: 'Underline' },
];
const LINES: { id: MMLine; label: string }[] = [
  { id: 'curve', label: 'Curve' }, { id: 'straight', label: 'Straight' }, { id: 'arc', label: 'Arc' },
  { id: 'elbow', label: 'Right angle' }, { id: 'rounded', label: 'Rounded corner' }, { id: 'brace', label: 'Brace' },
];
// Solid, dotted, then dashes from short to long.
const DASHES: { id: MMDash; label: string }[] = [
  { id: 'solid', label: 'Solid' }, { id: 'dotted', label: 'Dotted' }, { id: 'short', label: 'Short dashes' },
  { id: 'dashed', label: 'Dashed' }, { id: 'long', label: 'Long dashes' },
];
/** Border thickness choices, shown as lines of that weight. */
const BORDER_WIDTHS = [1, 2, 3, 4, 5];

// ── Helpers ───────────────────────────────────────────────────────────

const same = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function primaryOf(ctl: MindMapControl): string {
  return ctl.selected()[0] ?? ctl.mapData().root.id;
}

function rawStyle(ctl: MindMapControl): MMStyle {
  return anyTopic(ctl.mapData(), primaryOf(ctl))?.style ?? {};
}

function resolved(ctl: MindMapControl) {
  return resolveStyles(ctl.mapData()).get(primaryOf(ctl))!;
}

/** Change the style of every selected topic (only shown, not stored, when previewing). */
function styleSelected(ctl: MindMapControl, fn: (s: MMStyle) => void, preview = false): void {
  const ids = ctl.selected();
  const change = (d: MMData) => {
    for (const id of ids) {
      const tp = anyTopic(d, id);
      if (!tp) continue;
      const s = { ...(tp.style ?? {}) };
      fn(s);
      for (const k of Object.keys(s) as (keyof MMStyle)[]) if (s[k] === undefined) delete s[k];
      tp.style = Object.keys(s).length ? s : undefined;
    }
  };
  if (preview) ctl.preview(change); else ctl.apply(change);
}

/** Branch settings: the whole map from the central topic, otherwise the selected branches and below. */
function branchSelected(ctl: MindMapControl, key: 'line' | 'branchColor', value: string | undefined, preview = false): void {
  const rootSel = ctl.rootSelected();
  const ids = ctl.selected();
  const change = (d: MMData) => {
    if (rootSel) {
      if (value === undefined) delete d[key]; else (d as unknown as Record<string, string>)[key] = value;
      eachTopic(d.root, tp => { delete tp[key]; });
      return;
    }
    for (const id of ids) {
      const f = findIn(d, id);
      if (!f) continue;
      eachTopic(f.topic, tp => { delete tp[key]; });
      if (value !== undefined) (f.topic as unknown as Record<string, string>)[key] = value;
    }
  };
  if (preview) ctl.preview(change); else ctl.apply(change);
}

function section(pop: HTMLElement, title: string, extra?: string): HTMLElement {
  const head = pop.createDiv('vc-mm-pop-head');
  head.createSpan({ text: title });
  if (extra) head.createSpan({ cls: 'vc-mm-pop-note', text: extra });
  return head;
}

function iconGrid(pop: HTMLElement, cols: number, items: { id: string; icon: string; label: string }[], active: string | undefined, pick: (id: string) => void): void {
  const grid = pop.createDiv('vc-mm-icon-grid');
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  for (const it of items) {
    const cell = grid.createDiv({ cls: 'vc-mm-icon-cell', attr: { role: 'button', 'aria-label': it.label } });
    setIcon(cell, it.icon);
    setTooltip(cell, it.label, { placement: 'top' });
    cell.toggleClass('is-active', it.id === active);
    cell.addEventListener('click', () => pick(it.id));
  }
}

function palette(pop: HTMLElement, current: string | undefined, pick: (c: string) => void): void {
  const grid = pop.createDiv('vc-mm-palette');
  for (const c of PALETTE) {
    const sw = grid.createDiv({ cls: 'vc-mm-swatch', attr: { role: 'button', 'aria-label': c } });
    sw.style.background = c;
    sw.toggleClass('is-active', same(c, current));
    sw.addEventListener('click', () => pick(c));
  }
}

/** Which panel has its colour picker open (kept while the panel redraws after each change). */
let openPicker: string | null = null;

/** "Custom": a picker inside the panel; dragging previews, letting go applies. */
function customColor(pop: HTMLElement, row: HTMLElement, key: string, current: string | undefined, set: (c: string, preview: boolean) => void): void {
  const chip = row.createDiv({ cls: 'vc-mm-chip vc-mm-custom', attr: { role: 'button' } });
  const dot = chip.createSpan('vc-mm-custom-dot');
  if (current && /^#/.test(current) && !PALETTE.some(p => same(p, current))) dot.style.background = current;
  chip.createSpan({ text: t('Custom') });
  let picker: HTMLElement | null = null;
  const show = () => { picker = colorPicker(pop, current, { onInput: c => set(c, true), onCommit: c => set(c, false) }); };
  const isCustom = !!current && /^#/.test(current) && !PALETTE.some(p => same(p, current));
  chip.toggleClass('is-active', openPicker === key || isCustom);
  if (openPicker === key) show();
  chip.addEventListener('click', () => {
    if (openPicker === key) { openPicker = null; picker?.remove(); picker = null; chip.toggleClass('is-active', isCustom); return; }
    openPicker = key;
    // Choosing "Custom" uses a custom colour at once (the current one, or the picker's), so the
    // other choices ("Theme default", "No fill") stop being the selected ones straight away.
    set(current && /^#[0-9a-f]{6}$/i.test(current) ? current : '#8B5CF6', false);
  });
}

function slider(pop: HTMLElement, label: string, value: number, set: (v: number) => void): void {
  const row = pop.createDiv('vc-mm-slider');
  row.createSpan({ cls: 'vc-mm-slider-label', text: label });
  const input = row.createEl('input', { type: 'range', attr: { min: '0', max: '100', step: '5' } });
  input.value = String(Math.round(value * 100));
  const out = row.createSpan({ cls: 'vc-mm-slider-value', text: `${input.value}%` });
  input.addEventListener('input', () => out.setText(`${input.value}%`));
  input.addEventListener('change', () => set(Number(input.value) / 100));
}

function chip(row: HTMLElement, text: string, active: boolean, run: () => void): HTMLElement {
  const c = row.createDiv({ cls: 'vc-mm-chip', text, attr: { role: 'button' } });
  c.toggleClass('is-active', active);
  c.addEventListener('click', run);
  return c;
}

// ── Theme previews ────────────────────────────────────────────────────

const NS = 'http://www.w3.org/2000/svg';
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

/** A small picture of a theme: the central topic, three branches, three topics. */
function themePreview(parent: HTMLElement, id: string): void {
  const th = themeById(id);
  const sv = el('svg', { viewBox: '0 0 120 60', width: 120, height: 60 }, parent);
  const rootY = 30, ys = [12, 30, 48];
  const rx = (shape: MMShape, h: number) => shape === 'rect' ? 0 : shape === 'rounded-sm' ? 2 : shape === 'rounded' ? 4 : h / 2;
  const colors = ys.map((_, i) => th.palette ? th.palette[i % th.palette.length] : th.branchColor);
  const a = { x: 40, y: rootY };
  ys.forEach((y, i) => {
    const l1 = th.l1;
    const bx = 64;
    const by = l1.shape === 'underline' ? y + 5 : y;
    const path = th.line === 'brace' ? `M${bx - 10},${by} H${bx}` : branchSideways(a, { x: bx, y: by }, th.line, 52);
    el('path', { d: path, fill: 'none', style: `stroke:${colors[i]};stroke-width:${th.rootLineWidth * 0.7}px`, 'stroke-linecap': 'round' }, sv);
  });
  if (th.line === 'brace') el('path', { d: 'M58,12 Q54,12 54,16 V26 Q54,30 50,30 Q54,30 54,34 V44 Q54,48 58,48 M40,30 H50', fill: 'none', style: `stroke:${th.branchColor};stroke-width:1.2px` }, sv);
  // central topic
  const r = th.root;
  if (r.shape === 'underline') {
    el('path', { d: 'M6,36 H40', style: `stroke:${th.branchColor};stroke-width:2.5px` }, sv);
    el('rect', { x: 10, y: 26, width: 24, height: 4, rx: 2, style: 'fill:var(--text-muted)' }, sv);
  } else {
    el('rect', { x: 6, y: 22, width: 34, height: 16, rx: rx(r.shape, 16), style: `fill:${r.fill === 'none' ? 'transparent' : r.fill};stroke:${r.border ? (r.borderColor === 'branch' ? th.branchColor : r.borderColor) : 'none'};stroke-width:${r.border ? 1.6 : 0}px` }, sv);
    el('rect', { x: 14, y: 28.5, width: 18, height: 3, rx: 1.5, style: `fill:${r.text ?? 'var(--text-muted)'};opacity:.85` }, sv);
  }
  ys.forEach((y, i) => {
    const l1 = th.l1;
    if (l1.shape === 'underline') {
      el('path', { d: `M64,${y + 5} H112`, style: `stroke:${colors[i]};stroke-width:1.6px` }, sv);
      el('rect', { x: 68, y: y - 2, width: 30, height: 3, rx: 1.5, style: 'fill:var(--text-faint)' }, sv);
    } else {
      const fill = l1.fillFromBranch ? colors[i] : l1.fill === 'none' ? 'transparent' : l1.fill;
      const stroke = l1.border ? (l1.borderColor === 'branch' ? colors[i] : l1.borderColor) : 'none';
      el('rect', { x: 64, y: y - 6, width: 48, height: 12, rx: rx(l1.shape, 12), style: `fill:${fill};stroke:${stroke};stroke-width:${l1.border ? 1.2 : 0}px` }, sv);
      el('rect', { x: 72, y: y - 1.5, width: 26, height: 3, rx: 1.5, style: `fill:${l1.text ?? 'var(--text-faint)'};opacity:.8` }, sv);
    }
  });
}

// ── Panels ────────────────────────────────────────────────────────────

function themePanel(pop: HTMLElement, ctl: MindMapControl): void {
  pop.addClass('vc-mm-pop', 'is-theme');
  const d = ctl.mapData();
  section(pop, t('Layout'));
  iconGrid(pop, 5, LAYOUTS.map(l => ({ id: l.id, icon: `vc-mm-l-${l.id}`, label: t(l.label) })), d.layout, (id) => {
    ctl.apply(m => {
      m.layout = id as MMLayout;
      // Sides start over: all right, or balanced again.
      for (const c of m.root.children) delete c.side;
    });
  });
  const check = pop.createEl('label', { cls: 'vc-mm-check' });
  const box = check.createEl('input', { type: 'checkbox' });
  box.checked = d.align;
  check.createSpan({ text: t('Align topics of the same level') });
  box.addEventListener('change', () => ctl.apply(m => { m.align = box.checked; }));

  section(pop, t('Topic style'));
  const seg = pop.createDiv('vc-mm-seg');
  for (const s of SIZES) chip(seg, t(s.label), d.size === s.id, () => ctl.apply(m => { m.size = s.id; }));
  const grid = pop.createDiv('vc-mm-themes');
  for (const th of MM_THEMES) {
    const cell = grid.createDiv({ cls: 'vc-mm-theme-cell', attr: { role: 'button', 'aria-label': t(th.name) } });
    themePreview(cell, th.id);
    setTooltip(cell, t(th.name), { placement: 'top' });
    cell.toggleClass('is-active', d.theme === th.id);
    cell.addEventListener('click', () => ctl.apply(m => {
      m.theme = th.id;
      delete m.line; delete m.branchColor;
      eachTopic(m.root, (tp: MMTopic) => { delete tp.style; delete tp.line; delete tp.branchColor; });
    }));
  }
}

function fillPanel(pop: HTMLElement, ctl: MindMapControl): void {
  pop.addClass('vc-mm-pop');
  const raw = rawStyle(ctl);
  const res = resolved(ctl);
  slider(pop, t('Opacity'), raw.fillOpacity ?? 1, v => styleSelected(ctl, s => { s.fillOpacity = v >= 1 ? undefined : v; }));
  section(pop, t('Fill colour'));
  palette(pop, raw.fill, c => styleSelected(ctl, s => { s.fill = c; }));
  const row = pop.createDiv('vc-mm-row');
  chip(row, t('No fill'), raw.fill === 'none' || (!raw.fill && res.fill === 'none'), () => styleSelected(ctl, s => { s.fill = 'none'; }));
  chip(row, t('Theme default'), !raw.fill, () => styleSelected(ctl, s => { s.fill = undefined; s.fillOpacity = undefined; }));
  customColor(pop, row, 'fill', raw.fill, (c, pv) => styleSelected(ctl, s => { s.fill = c; }, pv));
}

function borderPanel(pop: HTMLElement, ctl: MindMapControl): void {
  pop.addClass('vc-mm-pop');
  const raw = rawStyle(ctl);
  const res = resolved(ctl);
  const toggle = pop.createEl('label', { cls: 'vc-mm-toggle-row' });
  toggle.createSpan({ text: t('Show border') });
  const sw = toggle.createDiv({ cls: `checkbox-container${res.border ? ' is-enabled' : ''}` });
  sw.createEl('input', { type: 'checkbox', attr: { tabindex: '0' } });
  sw.addEventListener('click', (e) => { e.preventDefault(); styleSelected(ctl, s => { s.border = !res.border; }); });
  if (!res.border) return;

  section(pop, t('Thickness'));
  const near = BORDER_WIDTHS.reduce((a, b) => (Math.abs(b - res.borderWidth) < Math.abs(a - res.borderWidth) ? b : a));
  iconGrid(pop, BORDER_WIDTHS.length, BORDER_WIDTHS.map(w => ({ id: String(w), icon: `vc-mm-w-${w}`, label: t('Thickness {n}', { n: w }) })), String(near), (id) => styleSelected(ctl, s => { s.borderWidth = Number(id); }));
  section(pop, t('Line style'));
  iconGrid(pop, 5, DASHES.map(x => ({ id: x.id, icon: `vc-mm-d-${x.id}`, label: t(x.label) })), res.borderDash, (id) => styleSelected(ctl, s => { s.borderDash = id === 'solid' ? undefined : id as MMDash; }));
  slider(pop, t('Opacity'), raw.borderOpacity ?? 1, v => styleSelected(ctl, s => { s.borderOpacity = v >= 1 ? undefined : v; }));
  section(pop, t('Border colour'));
  palette(pop, raw.borderColor, c => styleSelected(ctl, s => { s.borderColor = c; }));
  const row = pop.createDiv('vc-mm-row');
  chip(row, t('Theme default'), !raw.borderColor, () => styleSelected(ctl, s => { s.borderColor = undefined; s.borderOpacity = undefined; }));
  customColor(pop, row, 'border', raw.borderColor, (c, pv) => styleSelected(ctl, s => { s.borderColor = c; }, pv));
}

function shapePanel(pop: HTMLElement, ctl: MindMapControl): void {
  pop.addClass('vc-mm-pop');
  const res = resolved(ctl);
  iconGrid(pop, 5, SHAPES.map(x => ({ id: x.id, icon: `vc-mm-s-${x.id}`, label: t(x.label) })), res.shape, (id) => styleSelected(ctl, s => { s.shape = id as MMShape; }));
}

function linePanel(pop: HTMLElement, ctl: MindMapControl): void {
  pop.addClass('vc-mm-pop');
  const res = resolved(ctl);
  section(pop, t('Branch lines'), ctl.rootSelected() ? t('Whole map') : t('This branch and below'));
  iconGrid(pop, 3, LINES.map(x => ({ id: x.id, icon: `vc-mm-ln-${x.id}`, label: t(x.label) })), res.line, (id) => branchSelected(ctl, 'line', id));
}

function branchColorPanel(pop: HTMLElement, ctl: MindMapControl): void {
  pop.addClass('vc-mm-pop');
  const d = ctl.mapData();
  const f = findIn(d, primaryOf(ctl));
  const own = ctl.rootSelected() ? d.branchColor : f?.topic.branchColor;
  section(pop, t('Branch colour'), ctl.rootSelected() ? t('Whole map') : t('This branch and below'));
  palette(pop, own, c => branchSelected(ctl, 'branchColor', c));
  const row = pop.createDiv('vc-mm-row');
  chip(row, t('Theme default'), !own, () => branchSelected(ctl, 'branchColor', undefined));
  customColor(pop, row, 'branch', own, (c, pv) => branchSelected(ctl, 'branchColor', c, pv));
}

// ── Bar items ─────────────────────────────────────────────────────────

export function themeItem(ctl: MindMapControl): BarItem {
  return { id: 'mm-theme', icon: 'vc-mm-theme', label: t('Map style'), dropdown: (pop) => themePanel(pop, ctl) };
}

const FONT_SIZES = [10, 12, 13, 14, 15, 16, 18, 20, 24, 28, 32, 36, 48, 64];

function fontSizePanel(pop: HTMLElement, ctl: MindMapControl, close: () => void): void {
  pop.addClass('vc-mm-pop', 'is-font-size');
  const raw = rawStyle(ctl);
  const res = resolved(ctl);
  // Any size typed in (Enter to apply), then the common sizes in a column, like Boardmix.
  const input = pop.createEl('input', { cls: 'vc-mm-size-input', type: 'number', attr: { min: '6', max: '200', step: '1' } });
  input.value = String(raw.fontSize ?? Math.round(res.fontSize));
  const apply = () => {
    const n = Math.round(Number(input.value));
    if (Number.isFinite(n) && n >= 6 && n <= 200) styleSelected(ctl, s => { s.fontSize = n; });
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); apply(); close(); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  input.addEventListener('change', apply);
  window.setTimeout(() => { input.focus(); input.select(); }, 0);
  const list = pop.createDiv('vc-mm-size-list');
  for (const n of FONT_SIZES) {
    const it = list.createDiv({ cls: 'vc-mm-size-item', text: `${n}` });
    it.toggleClass('is-active', raw.fontSize === n);
    it.addEventListener('click', () => { styleSelected(ctl, s => { s.fontSize = n; }); close(); });
  }
  const reset = list.createDiv({ cls: 'vc-mm-size-item is-reset', text: t('Theme default') });
  reset.toggleClass('is-active', !raw.fontSize);
  reset.addEventListener('click', () => { styleSelected(ctl, s => { s.fontSize = undefined; }); close(); });
}

function textColorPanel(pop: HTMLElement, ctl: MindMapControl): void {
  pop.addClass('vc-mm-pop');
  const raw = rawStyle(ctl);
  section(pop, t('Text colour'));
  palette(pop, raw.textColor, c => styleSelected(ctl, s => { s.textColor = c; }));
  const row = pop.createDiv('vc-mm-row');
  chip(row, t('Theme default'), !raw.textColor, () => styleSelected(ctl, s => { s.textColor = undefined; }));
  customColor(pop, row, 'text', raw.textColor, (c, pv) => styleSelected(ctl, s => { s.textColor = c; }, pv));
}

/** Bold, italic, underline and strikethrough as toggles, then the text colour. */
function textPanel(pop: HTMLElement, ctl: MindMapControl): void {
  pop.addClass('vc-mm-pop');
  const res = resolved(ctl);
  const grid = pop.createDiv('vc-mm-icon-grid is-toggles');
  const toggles: [key: 'bold' | 'italic' | 'underline' | 'strike', icon: string, label: string, on: boolean][] = [
    ['bold', 'bold', t('Bold'), res.bold], ['italic', 'italic', t('Italic'), !!res.italic],
    ['underline', 'underline', t('Underline'), !!res.underline], ['strike', 'strikethrough', t('Strikethrough'), !!res.strike],
  ];
  for (const [key, icon, label, on] of toggles) {
    const cell = grid.createDiv({ cls: 'vc-mm-icon-cell is-small', attr: { role: 'button', 'aria-label': label } });
    setIcon(cell, icon);
    setTooltip(cell, label, { placement: 'top' });
    cell.toggleClass('is-active', on);
    cell.addEventListener('click', () => styleSelected(ctl, s => { s[key] = on ? (key === 'bold' ? false : undefined) : true; }));
  }
  textColorPanel(pop, ctl);
}

/**
 * The bar while topics are selected, grouped by what they change: map style | the topic's
 * shape, fill and border | its branch (lines and colour) | text size, then text style and colour
 * | summary and boundary for a run of siblings.
 */
export function mindMapBarItems(ctl: MindMapControl): BarItem[] {
  const res = resolved(ctl);
  const sep: BarItem = { id: '@sep', icon: '', label: '' };
  const styled = res.bold || !!res.italic || !!res.underline || !!res.strike;
  return [
    themeItem(ctl),
    sep,
    { id: 'mm-shape', icon: `vc-mm-s-${res.shape}`, label: t('Topic shape'), dropdown: (pop) => shapePanel(pop, ctl) },
    { id: 'mm-fill', icon: 'paint-bucket', label: t('Fill colour'), swatch: res.fill, dropdown: (pop) => fillPanel(pop, ctl) },
    { id: 'mm-border', icon: 'vc-mm-border', label: t('Border'), swatch: res.border ? res.borderColor : 'none', dropdown: (pop) => borderPanel(pop, ctl) },
    sep,
    { id: 'mm-branch', icon: `vc-mm-ln-${res.line}`, label: t('Branch lines'), swatch: res.branchColor, dropdown: (pop) => { linePanel(pop, ctl); branchColorPanel(pop, ctl); } },
    sep,
    { id: 'mm-size', icon: 'type', label: t('Font size'), text: `${Math.round(res.fontSize)}`, dropdown: (pop, close) => fontSizePanel(pop, ctl, close) },
    { id: 'mm-text', icon: 'case-sensitive', label: t('Text'), swatch: res.text, active: styled, dropdown: (pop) => textPanel(pop, ctl) },
    // Only when the selection is a run of siblings (as in the right-click menu).
    ...(ctl.canWrap() ? [
      sep,
      { id: 'mm-summary', icon: 'vc-mm-summary', label: t('Add summary'), run: () => ctl.addSummary() },
      { id: 'mm-boundary', icon: 'vc-mm-boundary', label: t('Add boundary'), run: () => ctl.addBoundary() },
    ] : []),
  ];
}

// ── Boundary bar ──────────────────────────────────────────────────────

function boundarySet(ctl: MindMapControl, id: string, fn: (b: MMBoundary) => void, preview = false): void {
  const change = (d: MMData) => { const b = d.boundaries?.find(x => x.id === id); if (b) fn(b); };
  if (preview) ctl.preview(change); else ctl.apply(change);
}

function boundaryOf(ctl: MindMapControl, id: string): MMBoundary | undefined {
  return ctl.mapData().boundaries?.find(x => x.id === id);
}

/** The bar while a boundary is selected: its line, frame colour and fill, then delete. */
export function boundaryBarItems(ctl: MindMapControl, id: string, color: string, remove: () => void): BarItem[] {
  const b = boundaryOf(ctl, id);
  const sep: BarItem = { id: '@sep', icon: '', label: '' };
  return [
    {
      id: 'mm-bnd-line', icon: `vc-mm-d-${b?.dash ?? 'dashed'}`, label: t('Line style'),
      dropdown: (pop) => {
        pop.addClass('vc-mm-pop');
        const cur = boundaryOf(ctl, id);
        const w = cur?.width ?? 1.5;
        section(pop, t('Thickness'));
        const near = BORDER_WIDTHS.reduce((a, x) => (Math.abs(x - w) < Math.abs(a - w) ? x : a));
        iconGrid(pop, BORDER_WIDTHS.length, BORDER_WIDTHS.map(x => ({ id: String(x), icon: `vc-mm-w-${x}`, label: t('Thickness {n}', { n: x }) })), String(near), (v) => boundarySet(ctl, id, x => { x.width = Number(v); }));
        section(pop, t('Line style'));
        iconGrid(pop, 5, DASHES.map(x => ({ id: x.id, icon: `vc-mm-d-${x.id}`, label: t(x.label) })), cur?.dash ?? 'dashed', (v) => boundarySet(ctl, id, x => { if (v === 'dashed') delete x.dash; else x.dash = v as MMDash; }));
      },
    },
    {
      id: 'mm-bnd-color', icon: 'vc-mm-border', label: t('Border colour'), swatch: color,
      dropdown: (pop) => {
        pop.addClass('vc-mm-pop');
        const cur = boundaryOf(ctl, id)?.color;
        section(pop, t('Border colour'));
        palette(pop, cur, c => boundarySet(ctl, id, x => { x.color = c; }));
        const row = pop.createDiv('vc-mm-row');
        chip(row, t('Theme default'), !cur, () => boundarySet(ctl, id, x => { delete x.color; }));
        customColor(pop, row, 'bnd-color', cur, (c, pv) => boundarySet(ctl, id, x => { x.color = c; }, pv));
      },
    },
    {
      id: 'mm-bnd-fill', icon: 'paint-bucket', label: t('Fill colour'), swatch: b?.fill ?? 'none',
      dropdown: (pop) => {
        pop.addClass('vc-mm-pop');
        const cur = boundaryOf(ctl, id)?.fill;
        section(pop, t('Fill colour'));
        palette(pop, cur, c => boundarySet(ctl, id, x => { x.fill = c; }));
        const row = pop.createDiv('vc-mm-row');
        chip(row, t('No fill'), cur === 'none', () => boundarySet(ctl, id, x => { x.fill = 'none'; }));
        chip(row, t('Theme default'), !cur, () => boundarySet(ctl, id, x => { delete x.fill; }));
        customColor(pop, row, 'bnd-fill', cur, (c, pv) => boundarySet(ctl, id, x => { x.fill = c; }, pv));
      },
    },
    sep,
    { id: 'mm-bnd-del', icon: 'trash-2', label: t('Remove boundary'), run: remove },
  ];
}

export type { MMData };
