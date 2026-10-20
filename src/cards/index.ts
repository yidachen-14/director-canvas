import { registerCard } from './registry';
import { BASIC_CARDS } from './basic';
import { TEXT_CARDS } from './text-cards';
import { MEDIA_CARDS } from './media';
import { WIDGET_CARDS } from './widgets';
import { drawingCard } from './drawing';

let done = false;

/** Register every card type once. Later phases add their cards here. */
export function registerAllCards(): void {
  if (done) return;
  done = true;
  for (const c of [...TEXT_CARDS, ...BASIC_CARDS, ...MEDIA_CARDS, ...WIDGET_CARDS, drawingCard]) registerCard(c);
}
