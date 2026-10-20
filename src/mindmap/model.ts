// Mind map logic without the DOM: data, themes, style resolution, layout,
// branch geometry and Markdown. The card (card.ts) measures the topics and
// hands their sizes to layoutMindMap().

export type MMLayout = 'right' | 'both' | 'down' | 'timeline' | 'list';
export type MMSize = 'compact' | 'normal' | 'large';
export type MMLine = 'curve' | 'straight' | 'arc' | 'elbow' | 'rounded' | 'brace';
export type MMShape = 'rect' | 'rounded-sm' | 'rounded' | 'pill' | 'underline';
export type MMDash = 'solid' | 'dashed' | 'dotted' | 'long' | 'dashdot';

/** Per-topic overrides of the theme. */
export interface MMStyle {
  fill?: string;          // 'none' | css colour
  fillOpacity?: number;   // 0..1
  border?: boolean;
  borderColor?: string;
  borderWidth?: number;
  borderOpacity?: number;
  borderDash?: MMDash;
  shape?: MMShape;
}

export interface MMTopic {
  id: string;
  text: string;
  children: MMTopic[];
  collapsed?: boolean;
  /** First-level topics only: which side of the root (two-sided layouts). */
  side?: 'left' | 'right';
  style?: MMStyle;
  /** Colour of the branch into this topic and everything under it. */
  branchColor?: string;
  /** Style of the lines leaving this topic and everything under it. */
  line?: MMLine;
}

export interface MMData {
  root: MMTopic;
  layout: MMLayout;
  theme: string;
  size: MMSize;
  align: boolean;
  /** Whole-map overrides (set with the central topic selected). */
  line?: MMLine;
  branchColor?: string;
}

// ── Themes ────────────────────────────────────────────────────────────

export interface MMLevel {
  fill: string;
  text?: string;
  border: boolean;
  borderColor: string; // css colour, or 'branch'
  borderWidth: number;
  shape: MMShape;
  fontSize: number;
  bold: boolean;
  /** The fill is the topic's branch colour (colourful first level). */
  fillFromBranch?: boolean;
}

export interface MMTheme {
  id: string;
  name: string;
  root: MMLevel;
  l1: MMLevel;
  l2: MMLevel;
  line: MMLine;
  /** Colours for first-level branches in turn; null = one colour. */
  palette: string[] | null;
  branchColor: string;
  rootLineWidth: number;
  lineWidth: number;
}

const RAINBOW = ['#8B5CF6', '#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6', '#6366F1'];
const PASTEL = ['#C4B5FD', '#93C5FD', '#86EFAC', '#FCD34D', '#FCA5A5', '#F9A8D4', '#5EEAD4', '#A5B4FC'];
const BG = 'var(--background-primary)';
const SOFT = 'var(--background-modifier-hover)';

const lv = (o: Partial<MMLevel> & Pick<MMLevel, 'shape' | 'fontSize'>): MMLevel => ({
  fill: 'none', border: false, borderColor: 'branch', borderWidth: 2, bold: false, ...o,
});

export const MM_THEMES: MMTheme[] = [
  {
    id: 'classic', name: 'Classic',
    root: lv({ fill: BG, border: true, borderColor: '#8B5CF6', borderWidth: 3, shape: 'pill', fontSize: 18, bold: true }),
    l1: lv({ shape: 'underline', fontSize: 15 }),
    l2: lv({ shape: 'underline', fontSize: 13 }),
    line: 'curve', palette: RAINBOW, branchColor: '#8B5CF6', rootLineWidth: 3, lineWidth: 2,
  },
  {
    id: 'blue', name: 'Blue',
    root: lv({ fill: '#1F6FEB', text: '#ffffff', shape: 'pill', fontSize: 18, bold: true }),
    l1: lv({ fill: SOFT, shape: 'rounded', fontSize: 15 }),
    l2: lv({ shape: 'underline', fontSize: 13 }),
    line: 'curve', palette: null, branchColor: '#9DA9C9', rootLineWidth: 2.5, lineWidth: 2,
  },
  {
    id: 'vivid', name: 'Colourful',
    root: lv({ fill: '#6D5DF6', text: '#ffffff', shape: 'rounded', fontSize: 18, bold: true }),
    l1: lv({ fillFromBranch: true, text: '#ffffff', shape: 'rounded', fontSize: 15, bold: true }),
    l2: lv({ shape: 'underline', fontSize: 13 }),
    line: 'curve', palette: ['#A855F7', '#3B82F6', '#14B8A6', '#F59E0B', '#F43F5E', '#22C55E'], branchColor: '#6D5DF6', rootLineWidth: 3, lineWidth: 2,
  },
  {
    id: 'business', name: 'Business',
    root: lv({ fill: '#1D4ED8', text: '#ffffff', shape: 'rect', fontSize: 18, bold: true }),
    l1: lv({ fill: BG, border: true, borderColor: '#64748B', borderWidth: 1.5, shape: 'rounded-sm', fontSize: 15 }),
    l2: lv({ fill: BG, border: true, borderColor: '#94A3B8', borderWidth: 1, shape: 'rounded-sm', fontSize: 13 }),
    line: 'elbow', palette: null, branchColor: '#64748B', rootLineWidth: 2, lineWidth: 1.5,
  },
  {
    id: 'soft', name: 'Soft',
    root: lv({ fill: BG, border: true, borderColor: '#D4D4D8', borderWidth: 1.5, shape: 'rounded', fontSize: 18, bold: true }),
    l1: lv({ shape: 'underline', fontSize: 15 }),
    l2: lv({ shape: 'underline', fontSize: 13 }),
    line: 'curve', palette: PASTEL, branchColor: '#C4B5FD', rootLineWidth: 3, lineWidth: 2,
  },
  {
    id: 'indigo', name: 'Indigo',
    root: lv({ fill: '#4F46E5', text: '#ffffff', shape: 'pill', fontSize: 18, bold: true }),
    l1: lv({ fill: 'color-mix(in srgb, #6366F1 14%, var(--background-primary))', border: true, borderColor: '#A5B4FC', borderWidth: 1.5, shape: 'pill', fontSize: 15 }),
    l2: lv({ shape: 'underline', fontSize: 13 }),
    line: 'curve', palette: null, branchColor: '#A5B4FC', rootLineWidth: 2.5, lineWidth: 2,
  },
  {
    id: 'outline', name: 'Outlined',
    root: lv({ fill: BG, border: true, borderColor: '#7C3AED', borderWidth: 2.5, shape: 'pill', fontSize: 18, bold: true }),
    l1: lv({ fill: BG, border: true, borderColor: 'branch', borderWidth: 2, shape: 'pill', fontSize: 15 }),
    l2: lv({ shape: 'underline', fontSize: 13 }),
    line: 'curve', palette: RAINBOW, branchColor: '#7C3AED', rootLineWidth: 2.5, lineWidth: 2,
  },
  {
    id: 'sky', name: 'Sky',
    root: lv({ fill: 'color-mix(in srgb, #38BDF8 14%, var(--background-primary))', border: true, borderColor: '#38BDF8', borderWidth: 2, shape: 'rect', fontSize: 18, bold: true }),
    l1: lv({ shape: 'underline', fontSize: 15 }),
    l2: lv({ shape: 'underline', fontSize: 13 }),
    line: 'straight', palette: null, branchColor: '#7DD3FC', rootLineWidth: 2, lineWidth: 1.5,
  },
  {
    id: 'minimal', name: 'Minimal',
    root: lv({ shape: 'underline', fontSize: 18, bold: true, borderWidth: 3 }),
    l1: lv({ shape: 'underline', fontSize: 15 }),
    l2: lv({ shape: 'underline', fontSize: 13 }),
    line: 'arc', palette: ['#6366F1', '#A855F7', '#EC4899', '#22C55E'], branchColor: '#6366F1', rootLineWidth: 2.5, lineWidth: 1.5,
  },
  {
    id: 'mono', name: 'Mono',
    root: lv({ fill: BG, border: true, borderColor: 'var(--text-normal)', borderWidth: 2, shape: 'rounded-sm', fontSize: 18, bold: true }),
    l1: lv({ shape: 'underline', fontSize: 15 }),
    l2: lv({ shape: 'underline', fontSize: 13 }),
    line: 'rounded', palette: null, branchColor: 'var(--text-muted)', rootLineWidth: 2, lineWidth: 1.5,
  },
  {
    id: 'navy', name: 'Navy',
    root: lv({ fill: '#1E3A8A', text: '#ffffff', shape: 'rounded', fontSize: 18, bold: true }),
    l1: lv({ fill: '#3B82F6', text: '#ffffff', shape: 'rounded', fontSize: 15 }),
    l2: lv({ fill: 'color-mix(in srgb, #3B82F6 15%, var(--background-primary))', shape: 'rounded-sm', fontSize: 13 }),
    line: 'elbow', palette: null, branchColor: '#1E3A8A', rootLineWidth: 2, lineWidth: 1.5,
  },
  {
    id: 'brace', name: 'Bracket',
    root: lv({ fill: BG, border: true, borderColor: 'var(--text-normal)', borderWidth: 1.5, shape: 'rect', fontSize: 18, bold: true }),
    l1: lv({ shape: 'rect', fontSize: 15 }),
    l2: lv({ shape: 'rect', fontSize: 13 }),
    line: 'brace', palette: null, branchColor: 'var(--text-muted)', rootLineWidth: 1.5, lineWidth: 1.5,
  },
];

export function themeById(id: string | undefined): MMTheme {
  return MM_THEMES.find(x => x.id === id) ?? MM_THEMES[0];
}

export const SIZE_SCALE: Record<MMSize, number> = { compact: 0.88, normal: 1, large: 1.25 };
const GAPS: Record<MMSize, { h: number; v: number; level: number; indent: number }> = {
  compact: { h: 30, v: 8, level: 30, indent: 22 },
  normal: { h: 46, v: 14, level: 44, indent: 28 },
  large: { h: 66, v: 22, level: 60, indent: 36 },
};
export const gapsFor = (size: MMSize | undefined) => GAPS[size ?? 'normal'];

// ── Data ──────────────────────────────────────────────────────────────

const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function newTopic(text: string): MMTopic {
  return { id: rid(), text, children: [] };
}

export function newMindMap(rootText: string): MMData {
  return { root: newTopic(rootText), layout: 'right', theme: 'classic', size: 'normal', align: false };
}

/** A clean copy with fresh ids everywhere (pasting a subtree). */
export function cloneTopic(t: MMTopic, freshIds = false): MMTopic {
  return { ...t, id: freshIds ? rid() : t.id, style: t.style ? { ...t.style } : undefined, children: t.children.map(c => cloneTopic(c, freshIds)) };
}

export function cloneData(d: MMData): MMData {
  return { ...d, root: cloneTopic(d.root) };
}

/** Read a node's mind map, filling in anything missing. */
export function normalizeData(raw: unknown, fallbackText: string): MMData {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<MMData>;
  const fix = (t: Partial<MMTopic> | undefined, text: string): MMTopic => ({
    ...(t ?? {}),
    id: typeof t?.id === 'string' && t.id ? t.id : rid(),
    text: typeof t?.text === 'string' ? t.text : text,
    children: Array.isArray(t?.children) ? t!.children.map(c => fix(c, '')) : [],
  });
  const root = d.root ? fix(d.root, fallbackText) : (fromMarkdown(fallbackText) ?? newTopic(fallbackText || 'Central topic'));
  const layouts: MMLayout[] = ['right', 'both', 'down', 'timeline', 'list'];
  const sizes: MMSize[] = ['compact', 'normal', 'large'];
  return {
    root,
    layout: layouts.includes(d.layout as MMLayout) ? d.layout as MMLayout : 'right',
    theme: typeof d.theme === 'string' ? d.theme : 'classic',
    size: sizes.includes(d.size as MMSize) ? d.size as MMSize : 'normal',
    align: !!d.align,
    line: d.line,
    branchColor: d.branchColor,
  };
}

export interface Found { topic: MMTopic; parent: MMTopic | null; index: number; depth: number }

export function findTopic(root: MMTopic, id: string): Found | null {
  const walk = (t: MMTopic, parent: MMTopic | null, index: number, depth: number): Found | null => {
    if (t.id === id) return { topic: t, parent, index, depth };
    for (let i = 0; i < t.children.length; i++) {
      const r = walk(t.children[i], t, i, depth + 1);
      if (r) return r;
    }
    return null;
  };
  return walk(root, null, 0, 0);
}

export function isInside(ancestor: MMTopic, id: string): boolean {
  for (const c of ancestor.children) if (c.id === id || isInside(c, id)) return true;
  return false;
}

export function countTopics(t: MMTopic): number {
  return t.children.reduce((s, c) => s + 1 + countTopics(c), 0);
}

export function eachTopic(t: MMTopic, fn: (t: MMTopic, depth: number) => void, depth = 0): void {
  fn(t, depth);
  for (const c of t.children) eachTopic(c, fn, depth + 1);
}

/** Add a child at the end (or at `index`). In two-sided maps a new first-level topic goes to the emptier side. */
export function addChild(d: MMData, parentId: string, text: string, side?: 'left' | 'right', index?: number): MMTopic | null {
  const f = findTopic(d.root, parentId);
  if (!f) return null;
  const t = newTopic(text);
  if (f.depth === 0 && side) t.side = side;
  f.topic.collapsed = false;
  if (index === undefined) f.topic.children.push(t); else f.topic.children.splice(index, 0, t);
  return t;
}

/** A sibling right after the topic (for the central topic: a child). */
export function addSibling(d: MMData, id: string, text: string): MMTopic | null {
  const f = findTopic(d.root, id);
  if (!f) return null;
  if (!f.parent) return addChild(d, id, text);
  const t = newTopic(text);
  if (f.depth === 1 && f.topic.side) t.side = f.topic.side;
  f.parent.children.splice(f.index + 1, 0, t);
  return t;
}

/** Remove topics (never the central one). Returns the topic to select afterwards. */
export function removeTopics(d: MMData, ids: string[]): string | null {
  let next: string | null = null;
  for (const id of ids) {
    const f = findTopic(d.root, id);
    if (!f || !f.parent) continue;
    f.parent.children.splice(f.index, 1);
    const sib = f.parent.children[f.index] ?? f.parent.children[f.index - 1];
    next = sib?.id ?? f.parent.id;
  }
  return next && findTopic(d.root, next) ? next : d.root.id;
}

export type DropMode = 'child' | 'before' | 'after';

/** Move a topic under another one or next to it. False when not allowed. */
export function moveTopic(d: MMData, id: string, targetId: string, mode: DropMode, side?: 'left' | 'right'): boolean {
  if (id === targetId) return false;
  const src = findTopic(d.root, id);
  const dst = findTopic(d.root, targetId);
  if (!src || !dst || !src.parent) return false;
  if (isInside(src.topic, targetId)) return false;
  if (mode !== 'child' && !dst.parent) mode = 'child';
  src.parent.children.splice(src.index, 1);
  const t = src.topic;
  if (mode === 'child') {
    dst.topic.collapsed = false;
    dst.topic.children.push(t);
    if (!dst.parent) { if (side) t.side = side; } else delete t.side;
  } else {
    const parent = dst.parent!;
    const at = parent.children.indexOf(dst.topic);
    parent.children.splice(mode === 'before' ? at : at + 1, 0, t);
    if (parent === d.root) t.side = dst.topic.side ?? side; else delete t.side;
  }
  return true;
}

// ── Style resolution ──────────────────────────────────────────────────

export interface Resolved {
  fill: string;
  text: string;
  border: boolean;
  borderColor: string;
  borderWidth: number;
  borderDash: MMDash;
  shape: MMShape;
  fontSize: number;
  bold: boolean;
  /** Colour of the branch into this topic. */
  branchColor: string;
  /** Style of the lines leaving this topic. */
  line: MMLine;
  /** Width of the branch into this topic. */
  inWidth: number;
  depth: number;
  /** Index of the first-level branch this topic belongs to. */
  branch: number;
}

export function withAlpha(color: string, alpha: number | undefined): string {
  if (alpha === undefined || alpha >= 1 || color === 'none') return color;
  return `color-mix(in srgb, ${color} ${Math.round(Math.max(0, alpha) * 100)}%, transparent)`;
}

function hexRgb(hex: string): [number, number, number] | null {
  let m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m) { const v = parseInt(m[1], 16); return [v >> 16, (v >> 8) & 255, v & 255]; }
  m = /^#([0-9a-f]{3})$/i.exec(hex);
  if (m) { const [r, g, b] = m[1].split('').map(c => parseInt(c + c, 16)); return [r, g, b]; }
  return null;
}

export function isDark(hex: string): boolean {
  const rgb = hexRgb(hex);
  if (!rgb) return false;
  const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]) < 0.4;
}

export function resolveStyles(d: MMData): Map<string, Resolved> {
  const theme = themeById(d.theme);
  const scale = SIZE_SCALE[d.size] ?? 1;
  const out = new Map<string, Resolved>();
  const walk = (t: MMTopic, parent: Resolved | null, depth: number, branch: number) => {
    const level = depth === 0 ? theme.root : depth === 1 ? theme.l1 : theme.l2;
    let branchColor: string;
    if (depth === 0) branchColor = d.branchColor ?? theme.branchColor;
    else if (depth === 1) branchColor = t.branchColor ?? d.branchColor ?? (theme.palette ? theme.palette[branch % theme.palette.length] : theme.branchColor);
    else branchColor = t.branchColor ?? parent!.branchColor;
    const st = t.style ?? {};
    const shape = st.shape ?? level.shape;
    const baseFill = st.fill ?? (level.fillFromBranch ? branchColor : level.fill);
    const fill = withAlpha(baseFill, st.fillOpacity);
    const border = st.border ?? (shape === 'underline' ? true : level.border);
    const rawBorder = st.borderColor ?? (level.borderColor === 'branch' ? branchColor : level.borderColor);
    const text = st.fill && st.fill !== 'none' && hexRgb(st.fill) && (st.fillOpacity ?? 1) > 0.5
      ? (isDark(st.fill) ? '#ffffff' : '#1f1f1f')
      : st.fill === 'none' ? 'var(--text-normal)'
        : level.text ?? (hexRgb(baseFill) ? (isDark(baseFill) ? '#ffffff' : '#1f1f1f') : 'var(--text-normal)');
    const line = depth === 0 ? (d.line ?? theme.line) : (t.line ?? parent!.line);
    const res: Resolved = {
      fill,
      text,
      border,
      borderColor: withAlpha(rawBorder, st.borderOpacity),
      borderWidth: st.borderWidth ?? (shape === 'underline' ? (depth <= 1 ? theme.rootLineWidth : theme.lineWidth) : level.borderWidth),
      borderDash: st.borderDash ?? 'solid',
      shape,
      fontSize: Math.round(level.fontSize * scale * 10) / 10,
      bold: level.bold,
      branchColor,
      line: depth === 0 ? line : (t.line ?? parent!.line),
      inWidth: depth <= 1 ? theme.rootLineWidth : theme.lineWidth,
      depth,
      branch,
    };
    out.set(t.id, res);
    t.children.forEach((c, i) => walk(c, res, depth + 1, depth === 0 ? i : branch));
  };
  walk(d.root, null, 0, 0);
  return out;
}

// ── Layout ────────────────────────────────────────────────────────────

export interface Size { w: number; h: number }
export interface Placed { x: number; y: number; w: number; h: number; depth: number; side: 'left' | 'right' }

/** Which side each first-level topic sits on. */
export function sidesOf(d: MMData): Map<string, 'left' | 'right'> {
  const m = new Map<string, 'left' | 'right'>();
  const kids = d.root.children;
  if (d.layout === 'right') { for (const k of kids) m.set(k.id, k.side ?? 'right'); return m; }
  if (d.layout !== 'both') { for (const k of kids) m.set(k.id, 'right'); return m; }
  const half = Math.ceil(kids.length / 2);
  kids.forEach((k, i) => m.set(k.id, k.side ?? (i < half ? 'right' : 'left')));
  return m;
}

/** Whether the flow from parent to children goes downwards (org chart). */
export const flowsDown = (layout: MMLayout) => layout === 'down';

/**
 * Position every visible topic, the central topic's top-left at 0,0.
 * Collapsed subtrees are left out.
 */
export function layoutMindMap(d: MMData, sizes: Map<string, Size>): Map<string, Placed> {
  const g = gapsFor(d.size);
  const out = new Map<string, Placed>();
  const size = (t: MMTopic): Size => sizes.get(t.id) ?? { w: 80, h: 30 };
  const kids = (t: MMTopic) => (t.collapsed ? [] : t.children);
  const root = d.root;
  const rs = size(root);

  if (d.layout === 'right' || d.layout === 'both') {
    const hOf = new Map<string, number>();
    const subH = (t: MMTopic): number => {
      const k = kids(t);
      const sum = k.reduce((s, c) => s + subH(c), 0) + Math.max(0, k.length - 1) * g.v;
      const v = Math.max(size(t).h, sum);
      hOf.set(t.id, v);
      return v;
    };
    // Column widths per depth and side, for aligned siblings.
    const colW = { left: new Map<number, number>(), right: new Map<number, number>() };
    const measure = (t: MMTopic, depth: number, side: 'left' | 'right') => {
      const m = colW[side];
      m.set(depth, Math.max(m.get(depth) ?? 0, size(t).w));
      for (const c of kids(t)) measure(c, depth + 1, side);
    };
    const sides = sidesOf(d);
    const right = kids(root).filter(c => sides.get(c.id) !== 'left');
    const left = kids(root).filter(c => sides.get(c.id) === 'left');
    for (const c of right) measure(c, 1, 'right');
    for (const c of left) measure(c, 1, 'left');
    const colX = { left: new Map<number, number>(), right: new Map<number, number>() };
    let ax = rs.w + g.h, bx = -g.h;
    for (let dd = 1; colW.right.has(dd); dd++) { colX.right.set(dd, ax); ax += (colW.right.get(dd) ?? 0) + g.h; }
    for (let dd = 1; colW.left.has(dd); dd++) { colX.left.set(dd, bx); bx -= (colW.left.get(dd) ?? 0) + g.h; }

    const place = (t: MMTopic, x: number, top: number, depth: number, side: 'left' | 'right') => {
      const s = size(t);
      const total = hOf.get(t.id) ?? s.h;
      out.set(t.id, { x: side === 'left' ? x - s.w : x, y: top + total / 2 - s.h / 2, w: s.w, h: s.h, depth, side });
      const k = kids(t);
      const sum = k.reduce((acc, c) => acc + (hOf.get(c.id) ?? 0), 0) + Math.max(0, k.length - 1) * g.v;
      let cy = top + (total - sum) / 2;
      for (const c of k) {
        const cx = d.align ? colX[side].get(depth + 1)! : side === 'left' ? x - s.w - g.h : x + s.w + g.h;
        place(c, cx, cy, depth + 1, side);
        cy += (hOf.get(c.id) ?? 0) + g.v;
      }
    };
    out.set(root.id, { x: 0, y: 0, w: rs.w, h: rs.h, depth: 0, side: 'right' });
    const stack = (list: MMTopic[], side: 'left' | 'right') => {
      for (const c of list) subH(c);
      const total = list.reduce((s, c) => s + (hOf.get(c.id) ?? 0), 0) + Math.max(0, list.length - 1) * g.v;
      let top = rs.h / 2 - total / 2;
      for (const c of list) {
        const x = d.align ? colX[side].get(1)! : side === 'left' ? -g.h : rs.w + g.h;
        place(c, x, top, 1, side);
        top += (hOf.get(c.id) ?? 0) + g.v;
      }
    };
    stack(right, 'right');
    stack(left, 'left');
    return out;
  }

  if (d.layout === 'down') {
    const sib = g.h * 0.5;
    const wOf = new Map<string, number>();
    const subW = (t: MMTopic): number => {
      const k = kids(t);
      const sum = k.reduce((s, c) => s + subW(c), 0) + Math.max(0, k.length - 1) * sib;
      const v = Math.max(size(t).w, sum);
      wOf.set(t.id, v);
      return v;
    };
    subW(root);
    const rowH = new Map<number, number>();
    const rows = (t: MMTopic, depth: number) => {
      rowH.set(depth, Math.max(rowH.get(depth) ?? 0, size(t).h));
      for (const c of kids(t)) rows(c, depth + 1);
    };
    rows(root, 0);
    const rowY = new Map<number, number>();
    let y = 0;
    for (let dd = 0; rowH.has(dd); dd++) { rowY.set(dd, y); y += (rowH.get(dd) ?? 0) + g.level; }
    const place = (t: MMTopic, left: number, top: number, depth: number) => {
      const s = size(t);
      const total = wOf.get(t.id) ?? s.w;
      const ty = d.align ? (rowY.get(depth) ?? 0) : top;
      out.set(t.id, { x: left + total / 2 - s.w / 2, y: ty, w: s.w, h: s.h, depth, side: 'right' });
      const k = kids(t);
      const sum = k.reduce((acc, c) => acc + (wOf.get(c.id) ?? 0), 0) + Math.max(0, k.length - 1) * sib;
      let cx = left + (total - sum) / 2;
      for (const c of k) { place(c, cx, ty + s.h + g.level, depth + 1); cx += (wOf.get(c.id) ?? 0) + sib; }
    };
    place(root, 0, 0, 0);
    const r = out.get(root.id)!;
    const dx = r.x;
    for (const p of out.values()) p.x -= dx;
    return out;
  }

  // An indented outline growing downwards; the timeline uses it under each step.
  const listFrom = (t: MMTopic, x: number, y: number, depth: number): number => {
    const s = size(t);
    out.set(t.id, { x, y, w: s.w, h: s.h, depth, side: 'right' });
    let cy = y + s.h + g.v;
    for (const c of kids(t)) cy = listFrom(c, x + g.indent, cy, depth + 1);
    return cy - (kids(t).length ? 0 : 0);
  };

  if (d.layout === 'list') {
    out.set(root.id, { x: 0, y: 0, w: rs.w, h: rs.h, depth: 0, side: 'right' });
    let cy = rs.h + g.level * 0.6;
    const x = Math.min(rs.w / 2, g.indent * 1.5);
    for (const c of kids(root)) cy = listFrom(c, x, cy, 1);
    return out;
  }

  // timeline: first level along a horizontal spine, each step's topics listed under it.
  out.set(root.id, { x: 0, y: 0, w: rs.w, h: rs.h, depth: 0, side: 'right' });
  let x = rs.w + g.h;
  const spine = rs.h / 2;
  for (const c of kids(root)) {
    const cs = size(c);
    out.set(c.id, { x, y: spine - cs.h / 2, w: cs.w, h: cs.h, depth: 1, side: 'right' });
    let cy = spine + cs.h / 2 + g.level * 0.6;
    let right = x + cs.w;
    for (const gc of kids(c)) {
      const before = new Set(out.keys());
      cy = listFrom(gc, x + g.indent * 0.8, cy, 2);
      for (const [id, p] of out) if (!before.has(id)) right = Math.max(right, p.x + p.w);
    }
    x = right + g.h;
  }
  return out;
}

export interface Bounds { x: number; y: number; w: number; h: number }

export function boundsOf(placed: Map<string, Placed>): Bounds {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of placed.values()) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ── Branch geometry ───────────────────────────────────────────────────

export interface Pt { x: number; y: number }

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A branch between two anchors in a sideways flow. `trunk` is where elbows turn. */
export function branchSideways(a: Pt, b: Pt, style: MMLine, trunk?: number): string {
  const dx = b.x - a.x;
  const mx = trunk ?? a.x + dx / 2;
  const dirX = Math.sign(dx) || 1;
  const dirY = Math.sign(b.y - a.y);
  const r = Math.min(10, Math.abs(b.y - a.y) / 2, Math.abs(b.x - mx));
  switch (style) {
    case 'curve': return `M${r1(a.x)},${r1(a.y)} C${r1(a.x + dx / 2)},${r1(a.y)} ${r1(a.x + dx / 2)},${r1(b.y)} ${r1(b.x)},${r1(b.y)}`;
    case 'straight': return `M${r1(a.x)},${r1(a.y)} L${r1(b.x)},${r1(b.y)}`;
    case 'arc': {
      const kx = a.x + dx * 0.4;
      return `M${r1(a.x)},${r1(a.y)} Q${r1(a.x + dx * 0.04)},${r1(b.y)} ${r1(kx)},${r1(b.y)} H${r1(b.x)}`;
    }
    case 'rounded':
      if (dirY === 0 || r < 1) return `M${r1(a.x)},${r1(a.y)} H${r1(b.x)}`;
      return `M${r1(a.x)},${r1(a.y)} H${r1(mx)} V${r1(b.y - dirY * r)} Q${r1(mx)},${r1(b.y)} ${r1(mx + dirX * r)},${r1(b.y)} H${r1(b.x)}`;
    case 'brace':
      return `M${r1(mx + dirX * 6)},${r1(b.y)} H${r1(b.x)}`;
    case 'elbow':
    default:
      return `M${r1(a.x)},${r1(a.y)} H${r1(mx)} V${r1(b.y)} H${r1(b.x)}`;
  }
}

/** Downward flow (org chart): parent bottom to child top. */
export function branchDown(a: Pt, b: Pt, style: MMLine, trunk?: number): string {
  const dy = b.y - a.y;
  const my = trunk ?? a.y + dy / 2;
  const dirX = Math.sign(b.x - a.x);
  const r = Math.min(10, Math.abs(b.x - a.x) / 2, Math.abs(b.y - my));
  switch (style) {
    case 'curve': return `M${r1(a.x)},${r1(a.y)} C${r1(a.x)},${r1(a.y + dy / 2)} ${r1(b.x)},${r1(a.y + dy / 2)} ${r1(b.x)},${r1(b.y)}`;
    case 'straight': return `M${r1(a.x)},${r1(a.y)} L${r1(b.x)},${r1(b.y)}`;
    case 'arc': return `M${r1(a.x)},${r1(a.y)} Q${r1(b.x)},${r1(a.y + dy * 0.04)} ${r1(b.x)},${r1(a.y + dy * 0.6)} V${r1(b.y)}`;
    case 'rounded':
      if (dirX === 0 || r < 1) return `M${r1(a.x)},${r1(a.y)} V${r1(b.y)}`;
      return `M${r1(a.x)},${r1(a.y)} V${r1(my)} H${r1(b.x - dirX * r)} Q${r1(b.x)},${r1(my)} ${r1(b.x)},${r1(my + r)} V${r1(b.y)}`;
    case 'elbow':
    case 'brace':
    default:
      return `M${r1(a.x)},${r1(a.y)} V${r1(my)} H${r1(b.x)} V${r1(b.y)}`;
  }
}

/** A curly brace from y0 to y1 at x, its tip pointing back towards the parent (dir = -1: tip to the left). */
export function bracePath(x: number, y0: number, y1: number, mid: number, dir: 1 | -1): string {
  const d = 6 * -dir;
  const q = Math.max(2, Math.min(8, (y1 - y0) / 4));
  return `M${r1(x + d)},${r1(y0)} Q${r1(x)},${r1(y0)} ${r1(x)},${r1(y0 + q)} V${r1(mid - q)} Q${r1(x)},${r1(mid)} ${r1(x - d)},${r1(mid)} Q${r1(x)},${r1(mid)} ${r1(x)},${r1(mid + q)} V${r1(y1 - q)} Q${r1(x)},${r1(y1)} ${r1(x + d)},${r1(y1)}`;
}

// ── Markdown (what the core Canvas shows) ──────────────────────────────

export function toMarkdown(root: MMTopic): string {
  const lines: string[] = [];
  const walk = (t: MMTopic, depth: number) => {
    lines.push(`${'  '.repeat(depth)}- ${t.text.replace(/\s*\n\s*/g, ' ').trim() || ' '}`);
    for (const c of t.children) walk(c, depth + 1);
  };
  walk(root, 0);
  return lines.join('\n');
}

/** A nested list as a tree; several top-level items share a new central topic. */
export function fromMarkdown(md: string): MMTopic | null {
  const items: { depth: number; text: string }[] = [];
  for (const raw of md.split('\n')) {
    const m = /^(\s*)[-*+]\s+(?:\[.\]\s+)?(.*)$/.exec(raw.replace(/\t/g, '  '));
    if (!m) continue;
    items.push({ depth: Math.floor(m[1].length / 2), text: m[2].trim() });
  }
  if (!items.length) return null;
  const top = newTopic('');
  const stack: { depth: number; t: MMTopic }[] = [{ depth: -1, t: top }];
  for (const it of items) {
    const t = newTopic(it.text);
    while (stack.length > 1 && stack[stack.length - 1].depth >= it.depth) stack.pop();
    stack[stack.length - 1].t.children.push(t);
    stack.push({ depth: it.depth, t });
  }
  return top.children.length === 1 ? top.children[0] : { ...top, text: 'Central topic' };
}
