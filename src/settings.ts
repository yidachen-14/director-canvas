import { isLanguageSetting, type LanguageSetting } from './i18n';

export type ToolbarSize = 'S' | 'M' | 'L';
export type ToolbarPosition = 'top' | 'bottom' | 'left' | 'right';
export type TextCardKind = 'text' | 'note' | 'sticky' | 'callout';

export interface VisualCanvasSettings {
  language: LanguageSetting;
  openCanvasByDefault: boolean;
  /** Only boards inside these folders open with Director Canvas; empty = every board. */
  takeoverFolders: string[];
  /** The "Create new Director Canvas" ribbon button (hideable only while boards open here). */
  showRibbon: boolean;

  toolbarPosition: ToolbarPosition;
  toolbarSize: ToolbarSize;
  /** Tool ids shown on the toolbar, in order; the rest live under "…". Select and Hand are always first. */
  toolbarTools: string[];
  /** The order of every tool (on the toolbar or not), as arranged in the settings. */
  toolbarOrder: string[];
  /** Custom shortcuts: command id → "Mod+Shift+K" style key; missing = the default. */
  hotkeys: Record<string, string>;
  /** Bumped when defaults change in a way that should reach saved settings once. */
  settingsVersion: number;

  doubleClickKind: TextCardKind;
  pasteTextKind: TextCardKind;
  dragOutKind: TextCardKind;
  defaultTextSize: number;
  defaultStickyColor: string;
  /** Size of new Note, Sticky note and Callout cards. */
  noteSize: { width: number; height: number };
  stickySize: { width: number; height: number };
  calloutSize: { width: number; height: number };

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
  /** Background grid: an even square lattice of dots (Boardmix) or of lines. */
  gridStyle: 'lines' | 'dots';
  dotSize: number;
  /** The board's ground: the theme's own background, or plain white (light mode) / black (dark mode). */
  background: 'theme' | 'pure';
  /** How strongly the dots or lines stand out from the background, in percent. */
  gridContrast: number;
  snapToGrid: boolean;
  gridSize: number;

  /** Spacing of arranged cards: the grid size (so they line up with it), or a number of its own. */
  arrangeGapMode: 'grid' | 'custom';
  arrangeGap: number;
  normalizeBase: 'first' | 'average';

  exportFolder: string;
  pngScale: number;
  htmlMode: 'folder' | 'single';

  autoRelink: boolean;
}

export const SETTINGS_VERSION = 4;

export const DEFAULT_SETTINGS: VisualCanvasSettings = {
  language: 'auto',
  openCanvasByDefault: true,
  takeoverFolders: [],
  showRibbon: true,

  toolbarPosition: 'top',
  toolbarSize: 'S',
  toolbarTools: ['text', 'note', 'sticky', 'group', 'connect'],
  toolbarOrder: [],
  hotkeys: {},
  settingsVersion: SETTINGS_VERSION,

  doubleClickKind: 'text',
  pasteTextKind: 'note',
  dragOutKind: 'text',
  defaultTextSize: 16,
  defaultStickyColor: '#F4D81E',
  noteSize: { width: 320, height: 200 },
  stickySize: { width: 220, height: 220 },
  calloutSize: { width: 340, height: 140 },

  imageRadius: 4,
  imageShadow: true,

  penShape: { thinning: 0.5, streamline: 0.5, smoothing: 0.5, taperStart: 0, taperEnd: 0 },

  defaultRoute: 'elbow',

  panButton: 'middle',
  gridStyle: 'dots',
  dotSize: 1.5,
  background: 'theme',
  gridContrast: 25,
  snapToGrid: false,
  gridSize: 20,

  arrangeGapMode: 'grid',
  arrangeGap: 20,
  normalizeBase: 'first',

  exportFolder: '',
  pngScale: 2,
  htmlMode: 'folder',

  autoRelink: true,
};

export function normalizeSettings(raw: unknown): VisualCanvasSettings {
  const s: VisualCanvasSettings = { ...DEFAULT_SETTINGS, hotkeys: {}, toolbarTools: [...DEFAULT_SETTINGS.toolbarTools], toolbarOrder: [] };
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof VisualCanvasSettings)[]) {
    const def = DEFAULT_SETTINGS[key];
    const val = r[key];
    if (val === undefined) continue;
    if (key === 'hotkeys') {
      if (val && typeof val === 'object' && !Array.isArray(val)) s.hotkeys = Object.fromEntries(Object.entries(val as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
      continue;
    }
    if (Array.isArray(def)) { if (Array.isArray(val) && val.every(v => typeof v === 'string')) (s as unknown as Record<string, unknown>)[key] = [...val]; }
    else if (typeof val === typeof def) (s as unknown as Record<string, unknown>)[key] = val;
  }
  if (!isLanguageSetting(s.language)) s.language = 'auto';
  if (!['L', 'M', 'S'].includes(s.toolbarSize)) s.toolbarSize = 'S';
  if (!['top', 'bottom', 'left', 'right'].includes(s.toolbarPosition)) s.toolbarPosition = 'top';
  // Version 2: the toolbar moved to the top at size S; Select and Hand are fixed, not listed.
  if (r.settingsVersion === undefined || (typeof r.settingsVersion === 'number' && r.settingsVersion < 2)) {
    s.toolbarPosition = 'top';
    s.toolbarSize = 'S';
  }
  // Version 3: new default sticky yellow (R244 G216 B30), if the old default was never changed.
  if (typeof r.settingsVersion !== 'number' || r.settingsVersion < 3) {
    if (s.defaultStickyColor.toUpperCase() === '#D2BA23') s.defaultStickyColor = '#F4D81E';
  }
  // Version 4: elbow connections by default; the arranging gap follows the grid.
  if (typeof r.settingsVersion !== 'number' || r.settingsVersion < 4) {
    if (r.defaultRoute === undefined || r.defaultRoute === 'straight') s.defaultRoute = 'elbow';
    s.arrangeGapMode = 'grid';
    s.arrangeGap = s.gridSize;
  }
  s.toolbarTools = s.toolbarTools.filter(id => id !== 'select' && id !== 'hand');
  s.toolbarOrder = s.toolbarOrder.filter(id => id !== 'select' && id !== 'hand');
  s.settingsVersion = SETTINGS_VERSION;
  if (![1, 2, 3, 4, 5].includes(s.pngScale)) s.pngScale = 2;
  if (!['lines', 'dots'].includes(s.gridStyle)) s.gridStyle = 'dots';
  if (!['straight', 'curve', 'elbow'].includes(s.defaultRoute)) s.defaultRoute = 'elbow';
  if (!['theme', 'pure'].includes(s.background)) s.background = 'theme';
  if (!['grid', 'custom'].includes(s.arrangeGapMode)) s.arrangeGapMode = 'grid';
  s.gridContrast = Math.min(100, Math.max(0, Math.round(s.gridContrast)));
  s.arrangeGap = Math.min(400, Math.max(0, Math.round(s.arrangeGap)));
  s.defaultTextSize = Math.min(96, Math.max(8, s.defaultTextSize));
  s.gridSize = Math.min(200, Math.max(4, Math.round(s.gridSize)));
  s.imageRadius = Math.min(40, Math.max(0, s.imageRadius));
  for (const k of ['noteSize', 'stickySize', 'calloutSize'] as const) {
    const v = r[k] as { width?: unknown; height?: unknown } | undefined;
    const d = DEFAULT_SETTINGS[k];
    const num = (x: unknown, def: number, min: number) => (typeof x === 'number' && isFinite(x) ? Math.min(2000, Math.max(min, Math.round(x))) : def);
    s[k] = { width: num(v?.width, d.width, 60), height: num(v?.height, d.height, 40) };
  }
  const ps = s.penShape as unknown as Record<string, unknown>;
  const dp = DEFAULT_SETTINGS.penShape as unknown as Record<string, number>;
  s.penShape = Object.fromEntries(Object.keys(dp).map(k => [k, typeof ps?.[k] === 'number' ? ps[k] : dp[k]])) as VisualCanvasSettings['penShape'];
  return s;
}

/** The spacing arrangements use: the grid size when they follow the grid. */
export function arrangeGapOf(s: VisualCanvasSettings): number {
  return s.arrangeGapMode === 'grid' ? s.gridSize : s.arrangeGap;
}
