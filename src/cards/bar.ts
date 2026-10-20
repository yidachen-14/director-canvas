import { getIcon, setIcon } from 'obsidian';

/** One row in a context-bar dropdown: icon, label, a tick when current. */
export function barRow(pop: HTMLElement, icon: string | null, label: string, active: boolean, run: () => void): HTMLElement {
  const row = pop.createDiv({ cls: 'vc-ctx-row', attr: { role: 'button' } });
  const ic = row.createDiv('vc-ctx-row-icon');
  if (icon && getIcon(icon)) setIcon(ic, icon);
  row.createDiv({ cls: 'vc-ctx-row-label', text: label });
  if (active) { row.addClass('is-active'); setIcon(row.createDiv('vc-ctx-row-check'), 'check'); }
  row.addEventListener('click', run);
  return row;
}
