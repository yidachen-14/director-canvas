import { addIcon } from 'obsidian';

/** A 24-unit, Lucide-style drawing on Obsidian's 100-unit icon grid, so it matches the toolbar's other icons. */
const lucideLike = (body: string) =>
  `<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;

/** Connect: two boxes joined by an elbow line with an arrow. */
addIcon('vc-connect', lucideLike('<rect x="2.5" y="14" width="7" height="7" rx="1.5"/><rect x="14.5" y="3" width="7" height="7" rx="1.5"/><path d="M6 14V6.5h7"/><path d="M11 4.5l2 2-2 2"/>'));

/** Mind map: a central box branching to two. */
addIcon('vc-mm-icon', lucideLike('<rect x="2.5" y="9.5" width="6" height="5" rx="1.2"/><rect x="15.5" y="3" width="6" height="5" rx="1.2"/><rect x="15.5" y="16" width="6" height="5" rx="1.2"/><path d="M8.5 12h3.5V5.5h3.5M12 12v6.5h3.5"/>'));
