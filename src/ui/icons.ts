import { addIcon } from 'obsidian';

/** A 24-unit, Lucide-style drawing on Obsidian's 100-unit icon grid, so it matches the toolbar's other icons. */
const lucideLike = (body: string) =>
  `<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;

/** Connect: two nodes joined by a line. */
addIcon('vc-connect', lucideLike('<circle cx="5.5" cy="18.5" r="3"/><circle cx="18.5" cy="5.5" r="3"/><path d="M7.7 16.3 16.3 7.7"/>'));

/** Mind map: a central box branching to two. */
addIcon('vc-mm-icon', lucideLike('<rect x="2.5" y="9.5" width="6" height="5" rx="1.2"/><rect x="15.5" y="3" width="6" height="5" rx="1.2"/><rect x="15.5" y="16" width="6" height="5" rx="1.2"/><path d="M8.5 12h3.5V5.5h3.5M12 12v6.5h3.5"/>'));

/** Director Canvas itself (the ribbon button, board tabs, "new board" menus): a clapperboard, traced from the user's drawing. */
addIcon('vc-director', '<g transform="translate(-32.031 -32.031) scale(0.32812)" fill="currentColor" stroke="currentColor" stroke-width="5" stroke-linejoin="round"><path fill-rule="evenodd" d="M146 139H354A24 24 0 0 1 378 163V337A24 24 0 0 1 354 361H146A24 24 0 0 1 122 337V163A24 24 0 0 1 146 139ZM146 156H354A7 7 0 0 1 361 163V337A7 7 0 0 1 354 344H146A7 7 0 0 1 139 337V163A7 7 0 0 1 146 156Z"/><path d="M139 199H361V216H139ZM143 199H168L211 156H186ZM211 199H236L279 156H254ZM280 199H305L348 156H323Z"/></g>');
export const BOARD_ICON = 'vc-director';
