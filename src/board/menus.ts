import { Menu, type MenuItem } from 'obsidian';
import type { Board } from './board';
import { duplicateSelection, editEdgeLabel } from './interactions';
import { reverseEdge } from './connect-ui';
import { routeOf, type Route } from './connections';
import { pasteInto } from './clipboard';
import { addArrangeMenu } from './arrange-commands';
import { allCardTypes } from '../cards/registry';
import { presetColor } from '../cards/util';
import type { Point } from './viewport';
import { t } from '../i18n';

/** Extra entries other modules (arrange, export, cards) add to the menus. */
export interface MenuContribution {
  /** Which menu: the board's empty area, cards, or several cards. */
  where: 'board' | 'card' | 'multi';
  section: string;
  add(menu: Menu, board: Board, at: Point): void;
}

const contributions: MenuContribution[] = [];
export function contributeMenu(c: MenuContribution): void { contributions.push(c); }

/** Card kinds offered in "New card" and on the toolbar, in this order. */
export const CREATABLE = ['text', 'note', 'sticky', 'callout', 'kanban', 'column', 'group', 'mindmap', 'swatch', 'calendar', 'bookmark'];

type SubmenuItem = MenuItem & { setSubmenu?: () => Menu };

/** A submenu when Obsidian offers one; otherwise the items inline. */
function submenu(menu: Menu, title: string, icon: string, section: string, build: (m: Menu) => void): void {
  let sub: Menu | null = null;
  menu.addItem(item => {
    item.setTitle(title).setIcon(icon).setSection(section);
    const s = (item as SubmenuItem).setSubmenu?.();
    if (s) sub = s;
  });
  if (sub) build(sub); else build(menu);
}

const COLORS: { id: string | undefined; label: string }[] = [
  { id: undefined, label: 'No colour' },
  { id: '1', label: 'Red' }, { id: '2', label: 'Orange' }, { id: '3', label: 'Yellow' },
  { id: '4', label: 'Green' }, { id: '5', label: 'Cyan' }, { id: '6', label: 'Purple' },
];

function colorItems(m: Menu, board: Board): void {
  for (const c of COLORS) {
    m.addItem(i => {
      i.setTitle(t(c.label)).onClick(() => board.setColor(c.id));
      const dom = (i as unknown as { dom?: HTMLElement }).dom;
      const icon = dom?.querySelector('.menu-item-icon');
      if (icon) {
        const sw = (icon as HTMLElement).createSpan('vc-menu-swatch');
        if (c.id) sw.style.background = presetColor(c.id); else sw.addClass('is-none');
      }
    });
  }
}

export function attachContextMenu(board: Board): void {
  board.root.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented) return;
    if (board.uiEl.contains(e.target as Node)) return;
    const target = e.target as HTMLElement;
    if (board.editingId && board.cards.get(board.editingId)?.el.contains(target)) return;
    e.preventDefault();
    const at = board.clientToWorld(e.clientX, e.clientY);
    const menu = new Menu();

    const edgeEl = target.closest('[data-edge-id]');
    const nodeEl = target.closest<HTMLElement>('.vc-node');
    if (edgeEl) {
      const id = edgeEl.getAttribute('data-edge-id')!;
      if (!board.edgeSelection.has(id)) board.selectEdges([id]);
      edgeMenu(menu, board, id);
    } else if (nodeEl) {
      const id = nodeEl.dataset.id!;
      if (!board.selection.has(id)) board.select([id]);
      cardMenu(menu, board, at);
    } else {
      board.clearSelection();
      boardMenu(menu, board, at);
    }
    menu.showAtMouseEvent(e);
  });
}

/** The selection's right-click menu, opened from elsewhere (the context bar's "…"). */
export function showSelectionMenu(board: Board, clientX: number, clientY: number): void {
  const menu = new Menu();
  cardMenu(menu, board, board.clientToWorld(clientX, clientY));
  menu.showAtPosition({ x: clientX, y: clientY });
}

function boardMenu(menu: Menu, board: Board, at: Point): void {
  menu.addItem(i => i.setTitle(t('Paste')).setIcon('clipboard-paste').setSection('edit').onClick(() => { void pasteFromSystem(board, at); }));
  menu.addItem(i => i.setTitle(t('Select all')).setIcon('box-select').setSection('edit').onClick(() => board.select(board.model.nodes.map(n => n.id))));
  submenu(menu, t('New card'), 'plus-square', 'create', (m) => {
    const types = allCardTypes();
    for (const id of CREATABLE) {
      const type = types.find(x => x.id === id);
      if (!type) continue;
      m.addItem(i => i.setTitle(t(type.label)).setIcon(type.icon).onClick(() => {
        board.createCard(id, at, { edit: ['text', 'note', 'sticky', 'callout'].includes(id) });
      }));
    }
  });
  addArrangeMenu(menu, board, (title, icon, section, build) => submenu(menu, title, icon, section, build), false);
  for (const c of contributions) if (c.where === 'board') c.add(menu, board, at);
  menu.addItem(i => i.setTitle(t('Zoom to fit')).setIcon('maximize').setSection('view').onClick(() => board.zoomToFit(undefined, true)));
  menu.addItem(i => i.setTitle(t('Zoom to 100%')).setIcon('scan').setSection('view').onClick(() => board.setZoom(1, true)));
}

function cardMenu(menu: Menu, board: Board, at: Point): void {
  const multi = board.selection.size > 1;
  const nodes = board.selectedNodes();
  // A part of the card is selected (a mind map topic): only its own menu.
  if (!multi && nodes[0]) {
    const handle = board.cards.get(nodes[0].id)?.handle;
    if (handle?.barExclusive?.() && handle.menu) { handle.menu(menu); return; }
  }
  if (!multi && nodes[0]) {
    const card = board.cards.get(nodes[0].id);
    if (card?.handle.edit && nodes[0].type !== 'file') {
      menu.addItem(i => i.setTitle(t('Edit')).setIcon('pencil').setSection('edit').onClick(() => board.startEditing(nodes[0].id)));
    }
  }
  if (!multi && nodes[0]) board.cards.get(nodes[0].id)?.handle.menu?.(menu);
  menu.addItem(i => i.setTitle(t('Copy')).setIcon('copy').setSection('edit').onClick(() => { board.root.focus(); document.execCommand('copy'); }));
  menu.addItem(i => i.setTitle(t('Cut')).setIcon('scissors').setSection('edit').onClick(() => { board.root.focus(); document.execCommand('cut'); }));
  menu.addItem(i => i.setTitle(t('Duplicate')).setIcon('copy-plus').setSection('edit').onClick(() => duplicateSelection(board)));
  submenu(menu, t('Colour'), 'palette', 'style', m => colorItems(m, board));
  menu.addItem(i => i.setTitle(t('Bring to front')).setIcon('bring-to-front').setSection('order').onClick(() => board.reorderSelection('front')));
  menu.addItem(i => i.setTitle(t('Send to back')).setIcon('send-to-back').setSection('order').onClick(() => board.reorderSelection('back')));
  menu.addItem(i => i.setTitle(t('Create group from selection')).setIcon('box-select').setSection('order').onClick(() => board.groupSelection()));
  if (multi) addArrangeMenu(menu, board, (title, icon, section, build) => submenu(menu, title, icon, section, build), true);
  for (const c of contributions) if (c.where === 'card' || (multi && c.where === 'multi')) c.add(menu, board, at);
  menu.addItem(i => i.setTitle(t('Zoom to selection')).setIcon('scan-search').setSection('view').onClick(() => board.zoomToFit([...board.selection], true)));
  menu.addItem(i => i.setTitle(t('Delete')).setIcon('trash-2').setSection('danger').setWarning(true).onClick(() => board.deleteSelection()));
}

function edgeMenu(menu: Menu, board: Board, id: string): void {
  const edge = board.model.edge(id);
  if (!edge) return;
  menu.addItem(i => i.setTitle(t(edge.label ? 'Edit label' : 'Add label')).setIcon('text-cursor-input').setSection('edit').onClick(() => editEdgeLabel(board, id)));
  submenu(menu, t('Colour'), 'palette', 'style', m => colorItems(m, board));
  submenu(menu, t('Arrows'), 'move-right', 'style', (m) => {
    const set = (fromEnd: 'none' | 'arrow', toEnd: 'none' | 'arrow') => board.model.transact(() => { edge.fromEnd = fromEnd; edge.toEnd = toEnd; board.model.touchEdges(); });
    const cur = `${edge.fromEnd ?? 'none'}-${edge.toEnd ?? 'arrow'}`;
    m.addItem(i => i.setTitle(t('Arrow at end')).setChecked(cur === 'none-arrow').onClick(() => set('none', 'arrow')));
    m.addItem(i => i.setTitle(t('Arrows at both ends')).setChecked(cur === 'arrow-arrow').onClick(() => set('arrow', 'arrow')));
    m.addItem(i => i.setTitle(t('No arrows')).setChecked(cur === 'none-none').onClick(() => set('none', 'none')));
    m.addItem(i => i.setTitle(t('Reverse direction')).onClick(() => board.model.transact(() => { reverseEdge(edge); board.model.touchEdges(); })));
  });
  submenu(menu, t('Line shape'), 'spline', 'style', (m) => {
    const cur = routeOf(edge);
    for (const [r, label] of [['straight', 'Straight'], ['curve', 'Curved'], ['elbow', 'Elbow']] as [Route, string][]) {
      m.addItem(i => i.setTitle(t(label)).setChecked(cur === r).onClick(() => board.model.transact(() => {
        const vc = { ...(edge.vc ?? {}) } as Record<string, unknown>;
        vc.route = r; delete vc.bend; edge.vc = vc; board.model.touchEdges();
      })));
    }
  });
  menu.addItem(i => i.setTitle(t('Delete')).setIcon('trash-2').setSection('danger').setWarning(true).onClick(() => board.deleteSelection()));
}

/** Paste from the system clipboard through the menu (no paste event there). */
export async function pasteFromSystem(board: Board, at: Point): Promise<void> {
  const dt = new DataTransfer();
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        const blob = await item.getType(type);
        if (type === 'text/plain' || type === 'text/html') dt.setData(type, await blob.text());
        else if (type.startsWith('image/')) dt.items.add(new File([blob], `pasted.${type.split('/')[1] || 'png'}`, { type }));
      }
    }
  } catch {
    try { dt.setData('text/plain', await navigator.clipboard.readText()); } catch { /* nothing to paste */ }
  }
  await pasteInto(board, dt, at);
}
