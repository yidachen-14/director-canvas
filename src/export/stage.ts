import type { Board } from '../board/board';
import type { RawNode } from '../model/canvas-file';
import { nodeRect } from '../model/board-model';

/** What to export. */
export type Scope = { kind: 'board' } | { kind: 'selection' } | { kind: 'object'; id: string };

export interface Bounds { x: number; y: number; width: number; height: number }

/** The cards a scope covers; a selected group brings the cards inside it. */
export function scopeNodes(board: Board, scope: Scope): RawNode[] {
  const all = board.model.nodes;
  if (scope.kind === 'board') return [...all];
  const ids = new Set(scope.kind === 'object' ? [scope.id] : [...board.selection]);
  for (const n of all) {
    if (!ids.has(n.id) || n.type !== 'group') continue;
    for (const m of all) {
      if (m.x >= n.x && m.y >= n.y && m.x + m.width <= n.x + n.width && m.y + m.height <= n.y + n.height) ids.add(m.id);
    }
  }
  return all.filter(n => ids.has(n.id));
}

export function boundsOf(nodes: RawNode[], padding: number): Bounds {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    const r = nodeRect(n);
    // A group's name sits above its frame.
    const top = n.type === 'group' && n.label ? r.y - 28 : r.y;
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, top);
    x1 = Math.max(x1, r.x + r.width); y1 = Math.max(y1, r.y + r.height);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: Math.floor(x0 - padding), y: Math.floor(y0 - padding), width: Math.ceil(x1 - x0 + padding * 2), height: Math.ceil(y1 - y0 + padding * 2) };
}

/** Things that belong to editing, not to the picture. */
const UI_ONLY = [
  '.vc-mm-btn', '.vc-mm-ghost', '.vc-mm-drop', '.vc-resize-handle', '.vc-block-handle', '.vc-drop-line',
  '.vc-swatch-pipette', '.vc-cal-add', '.vc-kb-del', '.vc-kb-add', '.vc-format-bar',
];
const STATE_CLASSES = ['is-selected', 'has-topic-sel', 'is-editing', 'is-dragging', 'is-drop-target', 'is-hover', 'is-armed'];

export interface Stage {
  /** A `.vc-board` element holding a copy of the world, sized to the bounds. */
  el: HTMLElement;
  world: HTMLElement;
  bounds: Bounds;
  nodes: RawNode[];
  remove(): void;
}

/**
 * A still copy of part of the board, laid out at 100% with the bounds' top-left at 0,0,
 * attached under `host` (it must be in the document for styles and images).
 */
export function buildStage(board: Board, nodes: RawNode[], opts: { padding: number; background: boolean; host: HTMLElement }): Stage {
  const bounds = boundsOf(nodes, opts.padding);
  const ids = new Set(nodes.map(n => n.id));
  const root = board.root;
  const el = opts.host.createDiv();
  el.className = [...root.classList].filter(c => !c.startsWith('is-') && !c.startsWith('has-')).join(' ') + ' vc-export-stage';
  for (const a of [...root.attributes]) if (a.name.startsWith('data-')) el.setAttribute(a.name, a.value);
  // The theme's colours as they are on screen (printing switches Obsidian to its print colours).
  const live = getComputedStyle(document.body);
  for (let i = 0; i < live.length; i++) {
    const prop = live[i];
    if (prop.startsWith('--')) el.style.setProperty(prop, live.getPropertyValue(prop));
  }
  const own = root.style;
  for (let i = 0; i < own.length; i++) el.style.setProperty(own[i], own.getPropertyValue(own[i]));
  el.setCssProps({ '--vc-zoom': '1' });
  Object.assign(el.style, { position: 'relative', left: '0', top: '0', width: `${bounds.width}px`, height: `${bounds.height}px`, overflow: 'hidden' });
  el.style.background = opts.background ? getComputedStyle(root).backgroundColor || 'var(--background-primary)' : 'transparent';

  const world = board.worldEl.cloneNode(true) as HTMLElement;
  world.style.transform = `translate(${-bounds.x}px, ${-bounds.y}px)`;
  el.appendChild(world);

  // Only the scope's cards, and connections between them.
  for (const card of [...world.querySelectorAll<HTMLElement>('.vc-node[data-id]')]) if (!ids.has(card.dataset.id ?? '')) card.remove();
  for (const e of [...world.querySelectorAll<Element>('[data-edge-id]')]) {
    const edge = board.model.edge(e.getAttribute('data-edge-id') ?? '');
    if (!edge || !ids.has(edge.fromNode) || !ids.has(edge.toNode)) e.remove();
  }
  for (const sel of UI_ONLY) for (const x of [...world.querySelectorAll(sel)]) x.remove();
  for (const x of [...world.querySelectorAll('*')]) {
    for (const c of STATE_CLASSES) x.classList.remove(c);
    x.removeAttribute('contenteditable');
    x.removeAttribute('data-vc-armed');
  }
  // The copy's videos have no frame yet: show the live one's current frame where possible.
  const liveVideos = [...board.worldEl.querySelectorAll('video')];
  const copies = [...world.querySelectorAll('video')];
  copies.forEach((v, i) => {
    const live = liveVideos.find(l => l.currentSrc === v.currentSrc || l.src === v.src) ?? liveVideos[i];
    const still = videoStill(live);
    if (still) {
      const img = createEl('img', { attr: { src: still } });
      img.className = v.className;
      img.style.cssText = v.style.cssText + ';object-fit:contain;width:100%;height:100%';
      v.replaceWith(img);
    } else v.setAttribute('preload', 'auto');
  });
  return { el, world, bounds, nodes, remove: () => el.remove() };
}

function videoStill(v: HTMLVideoElement | undefined): string | null {
  if (!v || !v.videoWidth) return null;
  try {
    const c = createEl('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    return c.toDataURL('image/jpeg', 0.9);
  } catch {
    return null; // a cross-origin frame can't be read
  }
}

/** An off-screen place in the document for stages. */
export function offscreenHost(): HTMLElement {
  const host = document.body.createDiv('vc-export-host');
  Object.assign(host.style, { position: 'fixed', left: '-100000px', top: '0', pointerEvents: 'none' });
  return host;
}

/** Wait until the stage's pictures have loaded (or failed). */
export async function imagesReady(el: HTMLElement, timeoutMs = 8000): Promise<void> {
  const imgs = [...el.querySelectorAll('img')].filter(i => !i.complete);
  await Promise.race([
    Promise.all(imgs.map(i => new Promise<void>(r => { i.addEventListener('load', () => r(), { once: true }); i.addEventListener('error', () => r(), { once: true }); }))),
    new Promise<void>(r => window.setTimeout(r, timeoutMs)),
  ]);
}
