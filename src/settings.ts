import type { Language } from './i18n';

export type ToolbarSize = 'L' | 'M' | 'S';
export type ToolbarPosition = 'bottom' | 'top' | 'left' | 'right';
export type TextCardKind = 'text' | 'note' | 'sticky' | 'callout';

export interface VisualCanvasSettings {
  language: Language;
  openCanvasByDefault: boolean;
  /** Only boards inside these folders open with Visual Canvas; empty = every board. */
  takeoverFolders: string[];

  toolbarPosition: ToolbarPosition;
  toolbarSize: ToolbarSize;
  /** Tool ids shown on the toolbar, in order; the rest live under "…". */
  toolbarTools: string[];

  doubleClickKind: TextCardKind;
  pasteTextKind: TextCardKind;
  dragOutKind: TextCardKind;
  defaultTextSize: number;
  defaultStickyColor: string;

  /** Corner radius of pictures (0 = square corners). */
  imageRadius: number;
  /** Soft shadow under pictures. */
  imageShadow: boolean;

  /** perfect-freehand shape of pen ink. */
  penShape: { thinning: number; streamline: number; smoothing: number; taperStart: number; taperEnd: number };

  /** Line shape of new connections. */
  defaultRoute: 'straight' | 'curve' | 'elbow';

  /** Pan with: the space bar + drag always works; this adds a mouse button. */
  panButton: 'middle' | 'right' | 'none';
  dotColor: string;
  dotSize: number;
  backgroundColor: string;
  snapToGrid: boolean;
  gridSize: number;

  arrangeGap: number;
  normalizeBase: 'first' | 'average';

  exportFolder: string;
  pngScale: 1 | 2 | 3;
  htmlMode: 'folder' | 'single';

  autoRelink: boolean;
}

export const DEFAULT_SETTINGS: VisualCanvasSettings = {
  language: 'zh-TW',
  openCanvasByDefault: true,
  takeoverFolders: [],

  toolbarPosition: 'bottom',
  toolbarSize: 'M',
  toolbarTools: ['select', 'hand', 'text', 'note', 'sticky', 'group', 'connect'],

  doubleClickKind: 'text',
  pasteTextKind: 'note',
  dragOutKind: 'text',
  defaultTextSize: 16,
  defaultStickyColor: '#D2BA23',

  imageRadius: 4,
  imageShadow: true,

  penShape: { thinning: 0.5, streamline: 0.5, smoothing: 0.5, taperStart: 0, taperEnd: 0 },

  defaultRoute: 'straight',

  panButton: 'middle',
  dotColor: '',
  dotSize: 1.5,
  backgroundColor: '',
  snapToGrid: false,
  gridSize: 20,

  arrangeGap: 16,
  normalizeBase: 'first',

  exportFolder: '',
  pngScale: 2,
  htmlMode: 'folder',

  autoRelink: true,
};

export function normalizeSettings(raw: unknown): VisualCanvasSettings {
  const s: VisualCanvasSettings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof VisualCanvasSettings)[]) {
    const def = DEFAULT_SETTINGS[key];
    const val = r[key];
    if (val === undefined) continue;
    if (Array.isArray(def)) { if (Array.isArray(val) && val.every(v => typeof v === 'string')) (s as unknown as Record<string, unknown>)[key] = [...val]; }
    else if (typeof val === typeof def) (s as unknown as Record<string, unknown>)[key] = val;
  }
  if (!['zh-TW', 'en'].includes(s.language)) s.language = 'zh-TW';
  if (!['L', 'M', 'S'].includes(s.toolbarSize)) s.toolbarSize = 'M';
  if (![1, 2, 3].includes(s.pngScale)) s.pngScale = 2;
  if (!['straight', 'curve', 'elbow'].includes(s.defaultRoute)) s.defaultRoute = 'straight';
  s.defaultTextSize = Math.min(96, Math.max(8, s.defaultTextSize));
  s.gridSize = Math.min(200, Math.max(4, s.gridSize));
  s.imageRadius = Math.min(40, Math.max(0, s.imageRadius));
  const ps = s.penShape as unknown as Record<string, unknown>;
  const dp = DEFAULT_SETTINGS.penShape as unknown as Record<string, number>;
  s.penShape = Object.fromEntries(Object.keys(dp).map(k => [k, typeof ps?.[k] === 'number' ? ps[k] : dp[k]])) as VisualCanvasSettings['penShape'];
  return s;
}
