/**
 * Reading and writing the JSON Canvas files Obsidian uses (.canvas).
 *
 * Every key this plugin does not understand is kept as-is, on the file, on
 * each node and on each edge, so a board round-trips through Visual Canvas
 * without losing what the core Canvas or other plugins stored there.
 * Data only Visual Canvas understands lives under one extra key per node
 * (`vc`) and one at the top level (`vc`).
 */

export type NodeKind = 'text' | 'file' | 'link' | 'group';

export interface RawNode {
  id: string;
  type: NodeKind | string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  subpath?: string;
  url?: string;
  label?: string;
  background?: string;
  backgroundStyle?: string;
  /** Visual Canvas data: card kind, formatting, mind map tree, etc. */
  vc?: Record<string, unknown>;
  [key: string]: unknown;
}

export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface RawEdge {
  id: string;
  fromNode: string;
  fromSide?: Side;
  fromEnd?: 'none' | 'arrow';
  toNode: string;
  toSide?: Side;
  toEnd?: 'none' | 'arrow';
  color?: string;
  label?: string;
  vc?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CanvasFile {
  nodes: RawNode[];
  edges: RawEdge[];
  vc?: Record<string, unknown>;
  [key: string]: unknown;
}

export function emptyCanvas(): CanvasFile {
  return { nodes: [], edges: [] };
}

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Parse file text. Malformed entries are dropped, never thrown on. */
export function parseCanvas(text: string): CanvasFile {
  if (!text || !text.trim()) return emptyCanvas();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This .canvas file is not valid JSON.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyCanvas();
  const obj = raw as Record<string, unknown>;
  const nodes: RawNode[] = [];
  const seen = new Set<string>();
  for (const n of Array.isArray(obj.nodes) ? obj.nodes : []) {
    if (!n || typeof n !== 'object') continue;
    const r = n as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id || seen.has(r.id)) continue;
    seen.add(r.id);
    nodes.push({
      ...r,
      id: r.id,
      type: typeof r.type === 'string' ? r.type : 'text',
      x: num(r.x, 0),
      y: num(r.y, 0),
      width: Math.max(1, num(r.width, 250)),
      height: Math.max(1, num(r.height, 60)),
    } as RawNode);
  }
  const edges: RawEdge[] = [];
  for (const e of Array.isArray(obj.edges) ? obj.edges : []) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.fromNode !== 'string' || typeof r.toNode !== 'string') continue;
    if (!seen.has(r.fromNode) || !seen.has(r.toNode)) continue;
    edges.push({ ...r } as RawEdge);
  }
  // Connections with a free end live in vc.lines (JSON Canvas cannot hold them).
  let vc = obj.vc && typeof obj.vc === 'object' && !Array.isArray(obj.vc) ? { ...(obj.vc as Record<string, unknown>) } : undefined;
  if (vc && Array.isArray(vc.lines)) {
    for (const l of vc.lines as unknown[]) {
      if (!l || typeof l !== 'object') continue;
      const r = l as Record<string, unknown>;
      if (typeof r.id !== 'string') continue;
      const from = typeof r.fromNode === 'string' ? r.fromNode : '';
      const to = typeof r.toNode === 'string' ? r.toNode : '';
      if ((from && !seen.has(from)) || (to && !seen.has(to))) continue;
      edges.push({ ...r, fromNode: from, toNode: to } as RawEdge);
    }
    delete vc.lines;
    if (Object.keys(vc).length === 0) vc = undefined;
  }
  const out: CanvasFile = { ...obj, nodes, edges };
  if (vc) out.vc = vc; else delete out.vc;
  return out;
}

/**
 * Serialize in the same layout Obsidian writes (tab indent, one node or edge
 * per line) so files stay diff-friendly and look untouched to the core view.
 */
export function serializeCanvas(data: CanvasFile, prepareEdges?: (edges: RawEdge[], nodes: RawNode[]) => RawEdge[]): string {
  const { nodes, edges: allEdges, ...rest } = data;
  const prepared = prepareEdges ? prepareEdges(allEdges, nodes) : allEdges;
  const edges = prepared.filter(e => e.fromNode && e.toNode);
  const freeLines = prepared.filter(e => !e.fromNode || !e.toNode);
  const vc = { ...((rest.vc as Record<string, unknown> | undefined) ?? {}) };
  if (freeLines.length) vc.lines = freeLines.map(cleanEdge); else delete vc.lines;
  if (Object.keys(vc).length) rest.vc = vc; else delete rest.vc;
  const lines: string[] = ['{'];
  const parts: string[] = [];
  parts.push('\t"nodes":[\n' + nodes.map(n => '\t\t' + JSON.stringify(cleanNode(n))).join(',\n') + (nodes.length ? '\n' : '') + '\t]');
  parts.push('\t"edges":[\n' + edges.map(e => '\t\t' + JSON.stringify(cleanEdge(e))).join(',\n') + (edges.length ? '\n' : '') + '\t]');
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    parts.push('\t' + JSON.stringify(k) + ':' + JSON.stringify(v));
  }
  lines.push(parts.join(',\n'));
  lines.push('}');
  return lines.join('\n');
}

const NODE_ORDER = ['id', 'type', 'text', 'file', 'subpath', 'url', 'label', 'background', 'backgroundStyle', 'x', 'y', 'width', 'height', 'color'];
const EDGE_ORDER = ['id', 'fromNode', 'fromSide', 'fromEnd', 'toNode', 'toSide', 'toEnd', 'color', 'label'];

function ordered<T extends Record<string, unknown>>(obj: T, order: string[]): T {
  const out: Record<string, unknown> = {};
  for (const k of order) if (obj[k] !== undefined) out[k] = obj[k];
  for (const [k, v] of Object.entries(obj)) if (!(k in out) && v !== undefined) out[k] = v;
  return out as T;
}

function cleanNode(n: RawNode): RawNode {
  const copy: RawNode = { ...n, x: Math.round(n.x), y: Math.round(n.y), width: Math.round(n.width), height: Math.round(n.height) };
  if (copy.vc && Object.keys(copy.vc).length === 0) delete copy.vc;
  return ordered(copy, NODE_ORDER);
}

function cleanEdge(e: RawEdge): RawEdge {
  const copy: RawEdge = { ...e };
  if (copy.vc && Object.keys(copy.vc).length === 0) delete copy.vc;
  return ordered(copy, EDGE_ORDER);
}

/** 16 hex characters, the id shape Obsidian itself uses. */
export function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
