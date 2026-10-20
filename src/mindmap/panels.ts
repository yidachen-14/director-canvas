import { addIcon, setIcon, setTooltip } from 'obsidian';
import type { BarItem } from '../cards/types';
import { t } from '../i18n';
import {
  type MMDash, type MMData, type MMLayout, type MMLine, type MMShape, type MMSize, type MMTopic, type MMStyle,
  MM_THEMES, branchSideways, eachTopic, findTopic, resolveStyles, themeById,
} from './model';
import type { MindMapControl } from './card';

// ── Icons (100 × 100) ─────────────────────────────────────────────────

const S = (d: string, w = 7) => `<path d="${d}" fill="none" stroke="currentColor" style="stroke-width:${w}px" stroke-linecap="round" stroke-linejoin="round"/>`;
const R = (x: number, y: number, w: number, h: number, rx: number, sw = 7, fill = 'none') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="currentColor" style="stroke-width:${sw}px"/>`;

const ICONS: Record<string, string> = {
  'vc-mm-icon': R(6, 40, 30, 20, 10) + S('M36 50 C50 50 48 22 62 22 M36 50 H62 M36 50 C50 50 48 78 62 78') + S('M64 22 H92 M64 50 H92 M64 78 H92', 6),
  'vc-mm-theme': R(6, 40, 28, 20, 10) + S('M34 50 C48 50 46 22 60 22 M34 50 H60 M34 50 C48 50 46 78 60 78') + R(62, 14, 30, 16, 6, 6) + R(62, 42, 30, 16, 6, 6) + R(62, 70, 30, 16, 6, 6),
  'vc-mm-border': R(12, 24, 76, 52, 14, 9),
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
  // Border dashes
  'vc-mm-d-solid': S('M8 50 H92', 8),
  'vc-mm-d-dashed': `<path d="M8 50 H92" fill="none" stroke="currentColor" style="stroke-width:8px" stroke-dasharray="14 10"/>`,
  'vc-mm-d-dotted': `<path d="M10 50 H92" fill="none" stroke="currentColor" style="stroke-width:8px" stroke-dasharray="0.1 14" stroke-linecap="round"/>`,
  'vc-mm-d-long': `<path d="M8 50 H92" fill="none" stroke="currentColor" style="stroke-width:8px" stroke-dasharray="28 10"/>`,
  'vc-mm-d-dashdot': `<path d="M8 50 H92" fill="none" stroke="currentColor" style="stroke-width:8px" stroke-dasharray="18 8 0.1 8" stroke-linecap="round"/>`,
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
const DASHES: { id: MMDash; label: string }[] = [
  { id: 'solid', label: 'Solid' }, { id: 'dashed', label: 'Dashed' }, { id: 'dotted', label: 'Dotted' },
  { id: 'long', label: 'Long dashes' }, { id: 'dashdot', label: 'Dash and dot' },
];

// ── Helpers ───────────────────────────────────────────────────────────

const same = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function primaryOf(ctl: MindMapControl): string {
  return ctl.selected()[0] ?? ctl.mapData().root.id;
}

function rawStyle(ctl: MindMapControl): MMStyle {
  return findTopic(ctl.mapData().root, primaryOf(ctl))?.topic.style ?? {};
}

function resolved(ctl: MindMapControl) {
  return resolveStyles(ctl.mapData()).get(primaryOf(ctl))!;
}

/** Change the style of every selected topic. */
function styleSelected(ctl: MindMapControl, fn: (s: MMStyle) => void): void {
  const ids = ctl.selected();
  ctl.apply(d => {
    for (const id of ids) {
      const f = findTopic(d.root, id);
      if (!f) continue;
      const s = { ...(f.topic.style ?? {}) };
      fn(s);
      for (const k of Object.keys(s) as (keyof MMStyle)[]) if (s[k] === undefined) delete s[k];
      f.topic.style = Object.keys(s).length ? s : undefined;
    }
  });
}

/** Branch settings: the whole map from the central topic, otherwise the selected branches and below. */
function branchSelected(ctl: MindMapControl, key: 'line' | 'branchColor', value: string | undefined): void {
  const rootSel = ctl.rootSelected();
  const ids = ctl.selected();
  ctl.apply(d => {
    if (rootSel) {
      if (value === undefined) delete d[key]; else (d as unknown as Record<string, string>)[key] = value;
      eachTopic(d.root, tp => { delete tp[key]; });
      return;
    }
    for (const id of ids) {
      const f = findTopic(d.root, id);
      if (!f) continue;
      eachTopic(f.topic, tp => { delete tp[key]; });
      if (value !== undefined) (f.topic as unknown as Record<string, string>)[key] = value;
    }
  });
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

function customColor(row: HTMLElement, current: string | undefined, pick: (c: string) => void): void {
  const label = row.createEl('label', { cls: 'vc-mm-chip vc-mm-custom' });
  const dot = label.createSpan('vc-mm-custom-dot');
  if (current && /^#/.test(current) && !PALETTE.some(p => same(p, current))) dot.style.background = current;
  label.createSpan({ text: t('Custom') });
  const input = label.createEl('input', { type: 'color' });
  input.value = current && /^#[0-9a-f]{6}$/i.test(current) ? current : '#8b5cf6';
  input.addEventListener('change', () => pick(input.value));
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
  customColor(row, raw.fill, c => styleSelected(ctl, s => { s.fill = c; }));
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
  const widths = pop.createDiv('vc-mm-row');
  for (const w of [1, 2, 3, 4, 6]) chip(widths, `${w}`, Math.abs(res.borderWidth - w) < 0.01, () => styleSelected(ctl, s => { s.borderWidth = w; }));
  section(pop, t('Line style'));
  iconGrid(pop, 5, DASHES.map(x => ({ id: x.id, icon: `vc-mm-d-${x.id}`, label: t(x.label) })), res.borderDash, (id) => styleSelected(ctl, s => { s.borderDash = id === 'solid' ? undefined : id as MMDash; }));
  slider(pop, t('Opacity'), raw.borderOpacity ?? 1, v => styleSelected(ctl, s => { s.borderOpacity = v >= 1 ? undefined : v; }));
  section(pop, t('Border colour'));
  palette(pop, raw.borderColor, c => styleSelected(ctl, s => { s.borderColor = c; }));
  const row = pop.createDiv('vc-mm-row');
  chip(row, t('Theme default'), !raw.borderColor, () => styleSelected(ctl, s => { s.borderColor = undefined; s.borderOpacity = undefined; }));
  customColor(row, raw.borderColor, c => styleSelected(ctl, s => { s.borderColor = c; }));
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
  const f = findTopic(d.root, primaryOf(ctl));
  const own = ctl.rootSelected() ? d.branchColor : f?.topic.branchColor;
  section(pop, t('Branch colour'), ctl.rootSelected() ? t('Whole map') : t('This branch and below'));
  palette(pop, own, c => branchSelected(ctl, 'branchColor', c));
  const row = pop.createDiv('vc-mm-row');
  chip(row, t('Theme default'), !own, () => branchSelected(ctl, 'branchColor', undefined));
  customColor(row, own, c => branchSelected(ctl, 'branchColor', c));
}

// ── Bar items ─────────────────────────────────────────────────────────

export function themeItem(ctl: MindMapControl): BarItem {
  return { id: 'mm-theme', icon: 'vc-mm-theme', label: t('Map style'), dropdown: (pop) => themePanel(pop, ctl) };
}

/** The six controls shown while topics are selected (Boardmix). */
export function mindMapBarItems(ctl: MindMapControl): BarItem[] {
  const res = resolved(ctl);
  return [
    themeItem(ctl),
    { id: 'mm-fill', icon: 'paint-bucket', label: t('Fill colour'), swatch: res.fill, dropdown: (pop) => fillPanel(pop, ctl) },
    { id: 'mm-border', icon: 'vc-mm-border', label: t('Border'), active: res.border && res.shape !== 'underline', dropdown: (pop) => borderPanel(pop, ctl) },
    { id: 'mm-shape', icon: `vc-mm-s-${res.shape}`, label: t('Topic shape'), dropdown: (pop) => shapePanel(pop, ctl) },
    { id: 'mm-line', icon: `vc-mm-ln-${res.line}`, label: t('Branch lines'), dropdown: (pop) => linePanel(pop, ctl) },
    { id: 'mm-branch', icon: 'vc-mm-branch', label: t('Branch colour'), swatch: res.branchColor, dropdown: (pop) => branchColorPanel(pop, ctl) },
  ];
}

export type { MMData };
