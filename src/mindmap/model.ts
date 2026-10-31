// Mind map logic without the DOM: data, themes, style resolution, layout,
// branch geometry and Markdown. The card (card.ts) measures the topics and
// hands their sizes to layoutMindMap().

export type MMLayout = 'right' | 'both' | 'down' | 'timeline' | 'list';
export type MMSize = 'compact' | 'normal' | 'large';
export type MMLine = 'curve' | 'straight' | 'arc' | 'elbow' | 'rounded' | 'brace';
export type MMShape = 'rect' | 'rounded-sm' | 'rounded' | 'pill' | 'underline';
export type MMDash = 'solid' | 'dotted' | 'short' | 'dashed' | 'long' | 'dashdot';

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
  /** Text: size in px (before the map's size scale), weight, slant, lines and colour. */
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  textColor?: string;
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

/**
 * A summary (Boardmix 概要): a brace beside a run of sibling topics, pointing to a topic of
 * its own that sums them up. `from` and `to` are the first and last sibling of the run.
 */
export interface MMSummary { id: string; parent: string; from: string; to: string; topic: MMTopic }
/** A boundary (Boardmix 外框): a frame drawn around a run of sibling topics and their subtrees. */
export interface MMBoundary {
  id: string; parent: string; from: string; to: string;
  /** A title shown on a tab above the frame (XMind). */
  label?: string;
  /** The frame's own look; unset follows the run's branch colour, dashed, 1.5px. */
  color?: string;
  width?: number;
  dash?: MMDash;
  /** A fill colour, or 'none'; unset is a faint tint of the frame's colour. */
  fill?: string;
}

export interface MMData {
  summaries?: MMSummary[];
  boundaries?: MMBoundary[];
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
  return {
    ...d,
    root: cloneTopic(d.root),
    summaries: d.summaries?.map(x => ({ ...x, topic: cloneTopic(x.topic) })),
    boundaries: d.boundaries?.map(x => ({ ...x })),
  };
}

// ── Summaries and boundaries ──────────────────────────────────────────

/** The run of siblings covering `ids`: they must all share one parent (not the central topic). */
export function siblingRange(d: MMData, ids: string[]): { parent: MMTopic; from: number; to: number } | null {
  let parent: MMTopic | null = null;
  let lo = Infinity, hi = -Infinity;
  for (const id of ids) {
    const f = findTopic(d.root, id);
    if (!f || !f.parent) return null;
    if (parent && parent !== f.parent) return null;
    parent = f.parent;
    lo = Math.min(lo, f.index); hi = Math.max(hi, f.index);
  }
  if (!parent || !Number.isFinite(lo)) return null;
  // Two-sided maps: a run must stay on one side of the central topic.
  if (parent === d.root && d.layout === 'both') {
    const sides = sidesOf(d);
    const s0 = sides.get(parent.children[lo].id);
    for (let i = lo; i <= hi; i++) if (sides.get(parent.children[i].id) !== s0) return null;
  }
  return { parent, from: lo, to: hi };
}

export function addSummary(d: MMData, ids: string[], text: string): MMTopic | null {
  const r = siblingRange(d, ids);
  if (!r) return null;
  const topic = newTopic(text);
  const s: MMSummary = { id: rid(), parent: r.parent.id, from: r.parent.children[r.from].id, to: r.parent.children[r.to].id, topic };
  d.summaries = [...(d.summaries ?? []), s];
  return topic;
}

export function addBoundary(d: MMData, ids: string[]): MMBoundary | null {
  const r = siblingRange(d, ids);
  if (!r) return null;
  const b: MMBoundary = { id: rid(), parent: r.parent.id, from: r.parent.children[r.from].id, to: r.parent.children[r.to].id };
  d.boundaries = [...(d.boundaries ?? []), b];
  return b;
}

/** The summary whose own topic has this id. */
export function summaryOfTopic(d: MMData, topicId: string): MMSummary | undefined {
  return d.summaries?.find(s => s.topic.id === topicId);
}

/** A topic anywhere: in the tree or a summary's. */
export function anyTopic(d: MMData, id: string): MMTopic | null {
  return findIn(d, id)?.topic ?? null;
}

/** Summaries and boundaries touching any of these topics (as one of the run). */
export function extrasCovering(d: MMData, ids: string[]): { summaries: MMSummary[]; boundaries: MMBoundary[] } {
  const want = new Set(ids);
  const covers = (x: { parent: string; from: string; to: string }) => {
    const p = findIn(d, x.parent)?.topic;
    if (!p) return false;
    const a = p.children.findIndex(c => c.id === x.from), b = p.children.findIndex(c => c.id === x.to);
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (p.children[i] && want.has(p.children[i].id)) return true;
    return false;
  };
  return { summaries: (d.summaries ?? []).filter(covers), boundaries: (d.boundaries ?? []).filter(covers) };
}

/**
 * Re-span a boundary over the siblings whose middles lie between two heights (sideways maps) or
 * widths (org chart), as found in `placed`. False when that would leave it empty.
 */
export function respanBoundary(d: MMData, id: string, placed: Map<string, Placed>, lo: number, hi: number, axis: 'y' | 'x'): boolean {
  const b = d.boundaries?.find(x => x.id === id);
  const p = b && findIn(d, b.parent)?.topic;
  if (!b || !p) return false;
  const side = placed.get(b.from)?.side;
  const inside = p.children.filter((c) => {
    const q = placed.get(c.id);
    if (!q || (axis === 'y' && q.side !== side)) return false;
    const m = axis === 'y' ? q.y + q.h / 2 : q.x + q.w / 2;
    return m >= lo && m <= hi;
  });
  if (!inside.length) return false;
  b.from = inside[0].id;
  b.to = inside[inside.length - 1].id;
  return true;
}

/** Drop summaries and boundaries whose topics are gone or no longer siblings; keep runs in order. */
export function pruneExtras(d: MMData): void {
  const fix = <T extends { parent: string; from: string; to: string }>(x: T): T | null => {
    const p = findIn(d, x.parent)?.topic;
    if (!p) return null;
    const a = p.children.findIndex(c => c.id === x.from), b = p.children.findIndex(c => c.id === x.to);
    if (a < 0 && b < 0) return null;
    const lo = a < 0 ? b : b < 0 ? a : Math.min(a, b), hi = a < 0 ? b : b < 0 ? a : Math.max(a, b);
    return { ...x, from: p.children[lo].id, to: p.children[hi].id };
  };
  if (d.summaries) { d.summaries = d.summaries.map(fix).filter((x): x is MMSummary => !!x); if (!d.summaries.length) delete d.summaries; }
  if (d.boundaries) { d.boundaries = d.boundaries.map(fix).filter((x): x is MMBoundary => !!x); if (!d.boundaries.length) delete d.boundaries; }
}

/** Read a node's mind map, filling in anything missing. */
export function normalizeData(raw: unknown, fallbackText: string): MMData {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<MMData>;
  const fix = (t: Partial<MMTopic> | undefined, text: string): MMTopic => ({
    ...(t ?? {}),
    id: typeof t?.id === 'string' && t.id ? t.id : rid(),
    text: typeof t?.text === 'string' ? t.text : text,
    children: Array.isArray(t?.children) ? t.children.map(c => fix(c, '')) : [],
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
    summaries: Array.isArray(d.summaries)
      ? d.summaries.filter(x => x && typeof x.parent === 'string' && typeof x.from === 'string' && typeof x.to === 'string')
        .map(x => ({ id: typeof x.id === 'string' ? x.id : rid(), parent: x.parent, from: x.from, to: x.to, topic: fix(x.topic, '') }))
      : undefined,
    boundaries: Array.isArray(d.boundaries)
      ? d.boundaries.filter(x => x && typeof x.parent === 'string' && typeof x.from === 'string' && typeof x.to === 'string')
        .map(x => ({ id: typeof x.id === 'string' ? x.id : rid(), parent: x.parent, from: x.from, to: x.to, ...(typeof x.label === 'string' && x.label ? { label: x.label } : {}) }))
      : undefined,
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

/**
 * Find a topic in the map: the tree under the central topic, or under a summary's own topic
 * (a summary topic can have subtopics too; it answers like a central topic: no parent).
 */
export function findIn(d: MMData, id: string): (Found & { summary?: MMSummary }) | null {
  const f = findTopic(d.root, id);
  if (f) return f;
  for (const sm of d.summaries ?? []) {
    const g = findTopic(sm.topic, id);
    if (g) return { ...g, summary: sm };
  }
  return null;
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
  const f = findIn(d, parentId);
  if (!f) return null;
  const t = newTopic(text);
  if (f.depth === 0 && side && !f.summary && f.topic === d.root) t.side = side;
  f.topic.collapsed = false;
  if (index === undefined) f.topic.children.push(t); else f.topic.children.splice(index, 0, t);
  return t;
}

/** A sibling right after the topic (for the central topic: a child). */
export function addSibling(d: MMData, id: string, text: string): MMTopic | null {
  const f = findIn(d, id);
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
  // A summary's topic or a boundary goes on its own.
  const gone = new Set(ids);
  if (d.summaries?.some(s => gone.has(s.topic.id)) || d.boundaries?.some(b => gone.has(b.id))) {
    const s0 = d.summaries?.find(s => gone.has(s.topic.id));
    if (s0) next = s0.from;
    d.summaries = d.summaries?.filter(s => !gone.has(s.topic.id));
    d.boundaries = d.boundaries?.filter(b => !gone.has(b.id));
  }
  for (const id of ids) {
    const f = findIn(d, id);
    if (!f || !f.parent) continue;
    // A run that starts or ends at this topic now starts / ends at its neighbour inside the run.
    const kids = f.parent.children;
    const shrink = <T extends { parent: string; from: string; to: string }>(x: T): T | null => {
      if (x.parent !== f.parent!.id || (x.from !== id && x.to !== id)) return x;
      if (x.from === id && x.to === id) return null;
      if (x.from === id) return { ...x, from: kids[f.index + 1]?.id ?? x.to };
      return { ...x, to: kids[f.index - 1]?.id ?? x.from };
    };
    if (d.summaries) d.summaries = d.summaries.map(shrink).filter((x): x is MMSummary => !!x);
    if (d.boundaries) d.boundaries = d.boundaries.map(shrink).filter((x): x is MMBoundary => !!x);
    f.parent.children.splice(f.index, 1);
    const sib = f.parent.children[f.index] ?? f.parent.children[f.index - 1];
    next = sib?.id ?? f.parent.id;
  }
  pruneExtras(d);
  return next && findIn(d, next) ? next : d.root.id;
}

export type DropMode = 'child' | 'before' | 'after';

/** Move a topic under another one or next to it. False when not allowed. */
export function moveTopic(d: MMData, id: string, targetId: string, mode: DropMode, side?: 'left' | 'right'): boolean {
  if (id === targetId) return false;
  const src = findIn(d, id);
  const dst = findIn(d, targetId);
  if (!src || !dst || !src.parent) return false;
  if (isInside(src.topic, targetId)) return false;
  if (mode !== 'child' && !dst.parent) mode = 'child';
  src.parent.children.splice(src.index, 1);
  const t = src.topic;
  if (mode === 'child') {
    dst.topic.collapsed = false;
    dst.topic.children.push(t);
    if (!dst.parent && dst.topic === d.root) { if (side) t.side = side; } else delete t.side;
  } else {
    const parent = dst.parent!;
    const at = parent.children.indexOf(dst.topic);
    parent.children.splice(mode === 'before' ? at : at + 1, 0, t);
    if (parent === d.root) t.side = dst.topic.side ?? side; else delete t.side;
  }
  return true;
}

/**
 * The topics that actually move when `ids` are dragged together, in the order they have in the
 * map: a topic under another one of them travels with it, and the central topic and summary
 * topics never move.
 */
export function movedTopics(d: MMData, ids: string[]): MMTopic[] {
  const want = new Set(ids);
  const order: MMTopic[] = [];
  const visit = (t: MMTopic, carried: boolean) => {
    for (const c of t.children) {
      const take = !carried && want.has(c.id);
      if (take) order.push(c);
      visit(c, carried || take);
    }
  };
  visit(d.root, false);
  return order;
}

/**
 * Move several topics together, in the order they have in the map: under `targetId` (after its
 * children) or side by side just before / after it. A topic under another moved topic travels
 * with it; the central topic and summary topics stay where they are.
 */
export function moveTopics(d: MMData, ids: string[], targetId: string, mode: DropMode, side?: 'left' | 'right'): boolean {
  const order = movedTopics(d, ids);
  if (!order.length || order.some(t => t.id === targetId || isInside(t, targetId))) return false;
  if (order.length === 1) return moveTopic(d, order[0].id, targetId, mode, side);
  const dst = findIn(d, targetId);
  if (!dst || dst.summary) return false;
  if (mode !== 'child' && !dst.parent) mode = 'child';
  for (const t of order) {
    const f = findIn(d, t.id)!;
    f.parent!.children.splice(f.index, 1);
  }
  if (mode === 'child') {
    dst.topic.collapsed = false;
    dst.topic.children.push(...order);
    for (const t of order) { if (dst.topic === d.root) { if (side) t.side = side; } else delete t.side; }
  } else {
    const parent = dst.parent!;
    const at = parent.children.indexOf(dst.topic) + (mode === 'after' ? 1 : 0);
    parent.children.splice(at, 0, ...order);
    for (const t of order) { if (parent === d.root) t.side = dst.topic.side ?? side; else delete t.side; }
  }
  return true;
}

/**
 * A dash pattern stretched a little so it repeats a whole number of times round a closed outline
 * `length` long: where the line meets itself the gap is the same as everywhere else.
 */
export function dashesAround(pattern: number[], length: number): string {
  if (!pattern.length) return '';
  const unit = pattern.reduce((a, b) => a + b, 0);
  const n = Math.max(1, Math.round(length / unit));
  const k = length / (n * unit);
  return pattern.map(v => +(v * k).toFixed(3)).join(' ');
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
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
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
    out.set(t.id, withText(res, st, scale));
    t.children.forEach((c, i) => walk(c, res, depth + 1, depth === 0 ? i : branch));
  };
  walk(d.root, null, 0, 0);
  for (const sm of d.summaries ?? []) {
    const base = out.get(sm.from);
    if (!base) continue;
    const res: Resolved = withText({ ...base, ...summaryLook(theme, base, sm.topic, scale) }, sm.topic.style ?? {}, scale);
    out.set(sm.topic.id, res);
    // Its own subtopics look like the topics one level below the run.
    sm.topic.children.forEach(c => walk(c, { ...res, line: sm.topic.line ?? base.line }, Math.max(2, base.depth + 1), base.branch));
  }
  return out;
}

/** A topic's own text settings on top of its resolved look. */
function withText(r: Resolved, st: MMStyle, scale: number): Resolved {
  if (st.fontSize) r.fontSize = Math.round(st.fontSize * scale * 10) / 10;
  if (st.bold !== undefined) r.bold = st.bold;
  if (st.italic) r.italic = true;
  if (st.underline) r.underline = true;
  if (st.strike) r.strike = true;
  if (st.textColor) r.text = st.textColor;
  return r;
}

/** A summary topic: the look of a first-level topic, in its run's branch colour, own overrides on top. */
function summaryLook(theme: MMTheme, base: Resolved, t: MMTopic, scale: number): Partial<Resolved> {
  const level = theme.l1;
  const st = t.style ?? {};
  const shape = st.shape ?? (level.shape === 'underline' ? 'rounded' : level.shape);
  const fill = withAlpha(st.fill ?? (level.fillFromBranch ? base.branchColor : level.fill === 'none' ? 'var(--background-primary)' : level.fill), st.fillOpacity);
  return {
    fill,
    text: st.fill && hexRgb(st.fill) ? (isDark(st.fill) ? '#ffffff' : '#1f1f1f') : level.fillFromBranch ? '#ffffff' : 'var(--text-normal)',
    border: st.border ?? true,
    borderColor: withAlpha(st.borderColor ?? base.branchColor, st.borderOpacity),
    borderWidth: st.borderWidth ?? 1.5,
    borderDash: st.borderDash ?? 'solid',
    shape,
    fontSize: Math.round(level.fontSize * scale * 10) / 10,
    // Its own text settings only, not those of the topic it starts at.
    bold: level.bold,
    italic: undefined,
    underline: undefined,
    strike: undefined,
  };
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
  // Room around boundaries: their padding, plus a title tab above.
  const before = new Map<string, number>(), after = new Map<string, number>();
  for (const b of d.boundaries ?? []) {
    before.set(b.from, (before.get(b.from) ?? 0) + 10 + (b.label && d.layout !== 'down' ? 24 : 0));
    after.set(b.to, (after.get(b.to) ?? 0) + 10);
  }

  /**
   * Stack subtrees along one axis without overlap and centre the parent between the first and the
   * last child itself (not the whole block of their descendants), like XMind and Boardmix. Works
   * on the axis the siblings line up on: y for the sideways layouts, x for the org chart.
   * `ext` is how far a subtree reaches before and after its topic's centre on that axis.
   */
  const stacker = (len: (t: MMTopic) => number, gap: number) => {
    const ext = new Map<string, { a: number; b: number }>();
    const rel = new Map<string, number[]>();
    const spread = (k: MMTopic[]): { centers: number[]; a: number; b: number } => {
      const centers: number[] = [];
      let pos = 0, prevB = 0;
      k.forEach((c, i) => {
        const e = measure(c);
        if (i > 0) pos += prevB + (after.get(k[i - 1].id) ?? 0) + gap + (before.get(c.id) ?? 0) + e.a;
        centers.push(pos);
        prevB = e.b;
      });
      const mid = (centers[0] + centers[centers.length - 1]) / 2;
      const r = centers.map(c => c - mid);
      const first = k[0], last = k[k.length - 1];
      return { centers: r, a: -r[0] + measure(first).a + (before.get(first.id) ?? 0), b: r[r.length - 1] + measure(last).b + (after.get(last.id) ?? 0) };
    };
    const measure = (t: MMTopic): { a: number; b: number } => {
      const known = ext.get(t.id);
      if (known) return known;
      const half = len(t) / 2;
      const k = kids(t);
      let e = { a: half, b: half };
      if (k.length) {
        const sp = spread(k);
        rel.set(t.id, sp.centers);
        e = { a: Math.max(half, sp.a), b: Math.max(half, sp.b) };
      }
      ext.set(t.id, e);
      return e;
    };
    return { measure, spread, rel };
  };

  if (d.layout === 'right' || d.layout === 'both') {
    // Column widths per depth and side, for aligned siblings.
    const colW = { left: new Map<number, number>(), right: new Map<number, number>() };
    const measureW = (t: MMTopic, depth: number, side: 'left' | 'right') => {
      const m = colW[side];
      m.set(depth, Math.max(m.get(depth) ?? 0, size(t).w));
      for (const c of kids(t)) measureW(c, depth + 1, side);
    };
    const sides = sidesOf(d);
    const right = kids(root).filter(c => sides.get(c.id) !== 'left');
    const left = kids(root).filter(c => sides.get(c.id) === 'left');
    for (const c of right) measureW(c, 1, 'right');
    for (const c of left) measureW(c, 1, 'left');
    const colX = { left: new Map<number, number>(), right: new Map<number, number>() };
    let ax = rs.w + g.h, bx = -g.h;
    for (let dd = 1; colW.right.has(dd); dd++) { colX.right.set(dd, ax); ax += (colW.right.get(dd) ?? 0) + g.h; }
    for (let dd = 1; colW.left.has(dd); dd++) { colX.left.set(dd, bx); bx -= (colW.left.get(dd) ?? 0) + g.h; }

    const st = stacker(t => size(t).h, g.v);
    // `cy` is the topic's vertical centre.
    const place = (t: MMTopic, x: number, cy: number, depth: number, side: 'left' | 'right') => {
      const s = size(t);
      out.set(t.id, { x: side === 'left' ? x - s.w : x, y: cy - s.h / 2, w: s.w, h: s.h, depth, side });
      const r = st.rel.get(t.id) ?? [];
      kids(t).forEach((c, i) => {
        const cx = d.align ? colX[side].get(depth + 1)! : side === 'left' ? x - s.w - g.h : x + s.w + g.h;
        place(c, cx, cy + r[i], depth + 1, side);
      });
    };
    out.set(root.id, { x: 0, y: 0, w: rs.w, h: rs.h, depth: 0, side: 'right' });
    const stack = (list: MMTopic[], side: 'left' | 'right') => {
      if (!list.length) return;
      const sp = st.spread(list);
      const x = d.align ? colX[side].get(1)! : side === 'left' ? -g.h : rs.w + g.h;
      list.forEach((c, i) => place(c, x, rs.h / 2 + sp.centers[i], 1, side));
    };
    stack(right, 'right');
    stack(left, 'left');
    return out;
  }

  if (d.layout === 'down') {
    const sib = g.h * 0.5;
    const rowH = new Map<number, number>();
    const rows = (t: MMTopic, depth: number) => {
      rowH.set(depth, Math.max(rowH.get(depth) ?? 0, size(t).h));
      for (const c of kids(t)) rows(c, depth + 1);
    };
    rows(root, 0);
    const rowY = new Map<number, number>();
    let y = 0;
    for (let dd = 0; rowH.has(dd); dd++) { rowY.set(dd, y); y += (rowH.get(dd) ?? 0) + g.level; }
    const st = stacker(t => size(t).w, sib);
    st.measure(root);
    // `cx` is the topic's horizontal centre.
    const place = (t: MMTopic, cx: number, top: number, depth: number) => {
      const s = size(t);
      const ty = d.align ? (rowY.get(depth) ?? 0) : top;
      out.set(t.id, { x: cx - s.w / 2, y: ty, w: s.w, h: s.h, depth, side: 'right' });
      const r = st.rel.get(t.id) ?? [];
      kids(t).forEach((c, i) => place(c, cx + r[i], ty + s.h + g.level, depth + 1));
    };
    place(root, rs.w / 2, 0, 0);
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

/** Where a boundary frame and a summary brace go (the summary's topic is added to `placed`). */
export interface ExtrasLayout {
  boundaries: { id: string; from: string; label?: string; x: number; y: number; w: number; h: number }[];
  /** `vertical`: a brace standing beside the run (sideways maps); else lying under it (org chart). */
  braces: { id: string; from: string; vertical: boolean; dir: 1 | -1; at: number; a: number; b: number; mid: number }[];
}

/** Layouts with room beside or under a run of siblings for summaries and boundaries. */
export const extrasSupported = (layout: MMLayout) => layout === 'right' || layout === 'both' || layout === 'down';

/**
 * Place boundaries around runs of siblings and summaries beside them, after the topics are
 * laid out. Summary topics go into `placed`; nested extras grow outwards in order.
 */
export function layoutExtras(d: MMData, sizes: Map<string, Size>, placed: Map<string, Placed>): ExtrasLayout {
  const out: ExtrasLayout = { boundaries: [], braces: [] };
  if (!extrasSupported(d.layout)) return out;
  const down = d.layout === 'down';
  const g = gapsFor(d.size);
  // BRACE_GAP: room between the run and its brace, so the summary does not crowd the topics.
  const PADB = 8, BRACE = 14, GAPT = 12, BRACE_GAP = 18;
  // Extras already placed, by the topic whose children they wrap (and which of them).
  const done: { parent: string; lo: number; hi: number; box: Bounds }[] = [];
  const indexIn = (parent: MMTopic, id: string) => parent.children.findIndex(c => c.id === id);
  // Box of a topic and everything shown under it, with the extras around its children.
  const subtreeBox = (t: MMTopic): Bounds | null => {
    const parts: Bounds[] = [];
    const walk = (x: MMTopic) => {
      const p = placed.get(x.id);
      if (!p) return;
      parts.push(p);
      if (!x.collapsed) {
        for (const e of done) if (e.parent === x.id) parts.push(e.box);
        x.children.forEach(walk);
      }
    };
    walk(t);
    if (!parts.length) return null;
    const x0 = Math.min(...parts.map(q => q.x)), y0 = Math.min(...parts.map(q => q.y));
    const x1 = Math.max(...parts.map(q => q.x + q.w)), y1 = Math.max(...parts.map(q => q.y + q.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const runOf = (x: { parent: string; from: string; to: string }) => {
    const f = findIn(d, x.parent);
    if (!f || f.topic.collapsed) return null;
    const kids = f.topic.children;
    const a = kids.findIndex(c => c.id === x.from), b = kids.findIndex(c => c.id === x.to);
    if (a < 0 || b < 0) return null;
    return { parent: f.topic, depth: f.depth, run: kids.slice(Math.min(a, b), Math.max(a, b) + 1) };
  };
  // A run's box: its topics' subtrees, and extras around runs that lie within it.
  const unionOf = (parent: MMTopic, list: MMTopic[]): Bounds | null => {
    const boxes = list.map(subtreeBox).filter((q): q is Bounds => !!q);
    const lo = indexIn(parent, list[0].id), hi = indexIn(parent, list[list.length - 1].id);
    for (const e of done) if (e.parent === parent.id && e.lo >= lo && e.hi <= hi) boxes.push(e.box);
    if (!boxes.length) return null;
    const x0 = Math.min(...boxes.map(q => q.x)), y0 = Math.min(...boxes.map(q => q.y));
    const x1 = Math.max(...boxes.map(q => q.x + q.w)), y1 = Math.max(...boxes.map(q => q.y + q.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  // Deepest runs first, so outer ones wrap what is inside them.
  type Item = { kind: 'b'; x: MMBoundary } | { kind: 's'; x: MMSummary };
  const items: (Item & { depth: number })[] = [];
  for (const x of d.boundaries ?? []) { const r = runOf(x); if (r) items.push({ kind: 'b', x, depth: r.depth }); }
  for (const x of d.summaries ?? []) { const r = runOf(x); if (r) items.push({ kind: 's', x, depth: r.depth }); }
  items.sort((p, q) => q.depth - p.depth || (p.kind === 'b' ? -1 : 1) - (q.kind === 'b' ? -1 : 1));
  for (const it of items) {
    const r = runOf(it.x)!;
    const box = unionOf(r.parent, r.run);
    if (!box) continue;
    const first = r.run[0];
    const side = placed.get(first.id)?.side ?? 'right';
    const keep = (b: Bounds) => done.push({ parent: r.parent.id, lo: indexIn(r.parent, first.id), hi: indexIn(r.parent, r.run[r.run.length - 1].id), box: b });
    if (it.kind === 'b') {
      const b = { x: box.x - PADB, y: box.y - PADB, w: box.w + PADB * 2, h: box.h + PADB * 2 };
      const label = (it.x).label;
      out.boundaries.push({ id: it.x.id, from: first.id, label, ...b });
      // A label tab sits above the frame.
      keep(label ? { x: b.x, y: b.y - 24, w: b.w, h: b.h + 24 } : b);
      continue;
    }
    const sm = it.x;
    const depth = r.depth + 1;
    // A frame that only partly overlaps the run still pushes the brace out past it.
    {
      const lo = indexIn(r.parent, first.id), hi = indexIn(r.parent, r.run[r.run.length - 1].id);
      for (const e of done) {
        if (e.parent !== r.parent.id || e.hi < lo || e.lo > hi) continue;
        if (down) { const y1 = Math.max(box.y + box.h, e.box.y + e.box.h); box.h = y1 - box.y; }
        else if (side === 'left') { const x0 = Math.min(box.x, e.box.x); box.w += box.x - x0; box.x = x0; }
        else { const x1 = Math.max(box.x + box.w, e.box.x + e.box.w); box.w = x1 - box.x; }
      }
    }
    let ext: Bounds;
    if (down) {
      const at = box.y + box.h + BRACE_GAP, mid = box.x + box.w / 2;
      ext = placeSubtreeDown(sm.topic, mid, at + BRACE + GAPT, depth);
      out.braces.push({ id: sm.id, from: first.id, vertical: false, dir: 1, at, a: box.x, b: box.x + box.w, mid });
    } else {
      const dir: 1 | -1 = side === 'left' ? -1 : 1;
      const at = dir === 1 ? box.x + box.w + BRACE_GAP : box.x - BRACE_GAP;
      const mid = box.y + box.h / 2;
      ext = placeSubtreeSideways(sm.topic, dir === 1 ? at + BRACE + GAPT : at - BRACE - GAPT, mid, depth, side);
      out.braces.push({ id: sm.id, from: first.id, vertical: true, dir, at, a: box.y, b: box.y + box.h, mid });
    }
    const x0 = Math.min(box.x, ext.x), y0 = Math.min(box.y, ext.y);
    keep({ x: x0, y: y0, w: Math.max(box.x + box.w, ext.x + ext.w) - x0, h: Math.max(box.y + box.h, ext.y + ext.h) - y0 });
  }
  return out;

  /** A summary topic and its subtopics flowing away from the run (sideways maps); returns their box. */
  function placeSubtreeSideways(t: MMTopic, edge: number, mid: number, depth: number, side: 'left' | 'right'): Bounds {
    const hOf = new Map<string, number>();
    const kids = (x: MMTopic) => (x.collapsed ? [] : x.children);
    const sz = (x: MMTopic) => sizes.get(x.id) ?? { w: 80, h: 30 };
    const subH = (x: MMTopic): number => {
      const k = kids(x);
      const sum = k.reduce((acc, c) => acc + subH(c), 0) + Math.max(0, k.length - 1) * g.v;
      const v = Math.max(sz(x).h, sum);
      hOf.set(x.id, v);
      return v;
    };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const place = (x: MMTopic, at: number, top: number, dd: number) => {
      const s = sz(x);
      const total = hOf.get(x.id) ?? s.h;
      const px = side === 'left' ? at - s.w : at;
      const py = top + total / 2 - s.h / 2;
      placed.set(x.id, { x: px, y: py, w: s.w, h: s.h, depth: dd, side });
      x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px + s.w); y1 = Math.max(y1, py + s.h);
      const k = kids(x);
      const sum = k.reduce((acc, c) => acc + (hOf.get(c.id) ?? 0), 0) + Math.max(0, k.length - 1) * g.v;
      let cy = top + (total - sum) / 2;
      for (const c of k) {
        place(c, side === 'left' ? px - g.h : px + s.w + g.h, cy, dd + 1);
        cy += (hOf.get(c.id) ?? 0) + g.v;
      }
    };
    const total = subH(t);
    place(t, edge, mid - total / 2, depth);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** The same for org charts: under the run, children spreading in a row. */
  function placeSubtreeDown(t: MMTopic, mid: number, top: number, depth: number): Bounds {
    const sib = g.h * 0.5;
    const wOf = new Map<string, number>();
    const kids = (x: MMTopic) => (x.collapsed ? [] : x.children);
    const sz = (x: MMTopic) => sizes.get(x.id) ?? { w: 80, h: 30 };
    const subW = (x: MMTopic): number => {
      const k = kids(x);
      const sum = k.reduce((acc, c) => acc + subW(c), 0) + Math.max(0, k.length - 1) * sib;
      const v = Math.max(sz(x).w, sum);
      wOf.set(x.id, v);
      return v;
    };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const place = (x: MMTopic, left: number, ty: number, dd: number) => {
      const s = sz(x);
      const total = wOf.get(x.id) ?? s.w;
      const px = left + total / 2 - s.w / 2;
      placed.set(x.id, { x: px, y: ty, w: s.w, h: s.h, depth: dd, side: 'right' });
      x0 = Math.min(x0, px); y0 = Math.min(y0, ty); x1 = Math.max(x1, px + s.w); y1 = Math.max(y1, ty + s.h);
      const k = kids(x);
      const sum = k.reduce((acc, c) => acc + (wOf.get(c.id) ?? 0), 0) + Math.max(0, k.length - 1) * sib;
      let cx = left + (total - sum) / 2;
      for (const c of k) { place(c, cx, ty + s.h + g.level, dd + 1); cx += (wOf.get(c.id) ?? 0) + sib; }
    };
    const total = subW(t);
    place(t, mid - total / 2, top, depth);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
}

/** A curly brace lying under a run (org chart), from x0 to x1 at y, its tip pointing down at mid. */
export function braceDownPath(y: number, x0: number, x1: number, mid: number): string {
  const d = 6;
  const q = Math.max(2, Math.min(8, (x1 - x0) / 4));
  return `M${r1(x0)},${r1(y - d)} Q${r1(x0)},${r1(y)} ${r1(x0 + q)},${r1(y)} H${r1(mid - q)} Q${r1(mid)},${r1(y)} ${r1(mid)},${r1(y + d)} Q${r1(mid)},${r1(y)} ${r1(mid + q)},${r1(y)} H${r1(x1 - q)} Q${r1(x1)},${r1(y)} ${r1(x1)},${r1(y - d)}`;
}

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
