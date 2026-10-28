import type { App, Component } from 'obsidian';
import type { RawNode } from '../model/canvas-file';
import type { Board } from '../board/board';

/** What a card implementation gets to work with. */
export interface CardContext {
  app: App;
  board: Board;
  /** Path of the .canvas file, used to resolve links and attachments. */
  sourcePath: string;
  /** Lives as long as the card; register Markdown renders and events on it. */
  component: Component;
}

/** A mounted card. */
export interface CardHandle {
  /** The node's data changed (not its position or size). */
  update(node: RawNode): void;
  /** The card was resized; re-layout if needed. */
  resized?(node: RawNode): void;
  destroy(): void;
  /** Enter editing (double-click, Enter). Return false if the card has nothing to edit. */
  edit?(at?: { clientX: number; clientY: number }): boolean;
  isEditing?(): boolean;
  /** Leave editing, keeping changes. */
  stopEditing?(): void;
  /** Plain text for search. */
  searchText?(): string;
  /**
   * A key pressed while this card is the only selection and not editing.
   * Return true when handled (the board then ignores it).
   */
  onKey?(e: KeyboardEvent): boolean;
  /** Card-specific buttons for the floating context bar (only when it is the sole selection). */
  barItems?(): BarItem[];
  /** Changes when the card's bar should be rebuilt (e.g. a different part of it is selected). */
  barKey?(): string;
  /** Show only the card's own bar items (e.g. a mind map topic is selected). */
  barExclusive?(): boolean;
  /** Board rectangles the bar should not cover (e.g. other mind map topics). */
  barAvoid?(): { x: number; y: number; width: number; height: number }[];
  /** Board rectangle the bar sits above, instead of the whole card. */
  barAnchor?(): { x: number; y: number; width: number; height: number } | null;
  /** The content's own size right now (text cards: the box hugs the text). */
  measure?(): { width: number; height: number } | undefined;
  /** Card-specific entries for its right-click menu (only when it is the sole selection). */
  menu?(menu: import('obsidian').Menu): void;
}

export interface CardType {
  /** Stored as node.vc.kind for Visual Canvas cards. */
  id: string;
  /** English label, translated with t(). */
  label: string;
  icon: string;
  /** Size of a newly placed card, in board units. */
  defaultSize: { width: number; height: number };
  /** Size of a new card chosen in the settings (overrides defaultSize). */
  sizeFor?(settings: import('../settings').VisualCanvasSettings): { width: number; height: number };
  /** The card sizes itself: no resize handles. */
  fixedSize?: boolean;
  /** The card colours itself (no card colour in the bar). */
  noColor?: boolean;
  /** Data for a new card of this kind, before id and position. */
  create?(ctx: { settings: import('../settings').VisualCanvasSettings }): Partial<RawNode>;
  mount(node: RawNode, el: HTMLElement, ctx: CardContext): CardHandle;
}

/** A button on the floating context bar. */
export interface BarItem {
  id: string;
  icon: string;
  label: string;
  /** Shown next to the icon (a size, a short word). */
  text?: string;
  /** A colour dot on the button (a css colour, or 'none'). */
  swatch?: string;
  active?: boolean;
  run?: () => void;
  /** Opens a small panel under the button; build its content into `pop`. */
  dropdown?: (pop: HTMLElement, close: () => void) => void;
}
