import { Notice, setIcon, setTooltip } from 'obsidian';
import type { RawNode } from '../model/canvas-file';
import type { BarItem, CardContext, CardHandle, CardType } from './types';
import { commitNode } from './basic';
import { inkOn, nearestColorName, randomNamedColor } from './named-colors';
import { getLanguage, t } from '../i18n';

/** A swatch card shows one colour: the colour itself, its code and its name. */
export function swatchColor(n: RawNode): string {
  const c = n.vc?.color;
  if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) return c.toUpperCase();
  // Swatches from the first version held a list; keep its first colour.
  const list = n.vc?.colors;
  if (Array.isArray(list) && list[0] && typeof list[0].hex === 'string') return String(list[0].hex).toUpperCase();
  return '#888888';
}

/** What the core Canvas shows. */
export function swatchText(hex: string): string {
  return `### 🎨 ${hex.toUpperCase()}\n${nearestColorName(hex, getLanguage())}`;
}

class SwatchCard implements CardHandle {
  private node: RawNode;
  private area: HTMLElement;
  private hexEl: HTMLElement;
  private nameEl: HTMLElement;
  private input: HTMLInputElement;

  constructor(node: RawNode, el: HTMLElement, private ctx: CardContext) {
    this.node = node;
    el.addClass('vc-swatch');
    this.area = el.createDiv('vc-swatch-area');
    this.hexEl = this.area.createDiv({ cls: 'vc-swatch-hex vc-click', attr: { 'aria-label': t('Copy colour code') } });
    this.hexEl.addEventListener('click', (e) => {
      if (!this.live()) return;
      e.stopPropagation();
      this.copy();
    });
    // The system colour picker (wheel, sliders, eyedropper), opened from the pipette.
    this.input = this.area.createEl('input', { type: 'color', cls: 'vc-swatch-input' });
    this.input.addEventListener('pointerdown', e => e.stopPropagation());
    this.input.addEventListener('input', () => this.paint(this.input.value.toUpperCase()));
    this.input.addEventListener('change', () => this.setColor(this.input.value));
    const pipette = this.area.createDiv({ cls: 'vc-swatch-pipette vc-click', attr: { 'aria-label': t('Change colour') } });
    setIcon(pipette, 'pipette');
    setTooltip(pipette, t('Change colour'), { placement: 'top' });
    pipette.addEventListener('click', (e) => { if (!this.live()) return; e.stopPropagation(); this.input.click(); });
    pipette.addEventListener('dblclick', e => e.stopPropagation());

    const bar = el.createDiv('vc-swatch-bar');
    this.nameEl = bar.createDiv('vc-swatch-name');
    const shuffle = bar.createDiv({ cls: 'vc-swatch-shuffle vc-click', attr: { 'aria-label': t('Random colour') } });
    setIcon(shuffle, 'shuffle');
    setTooltip(shuffle, t('Random colour'), { placement: 'top' });
    shuffle.addEventListener('click', (e) => { if (!this.live()) return; e.stopPropagation(); this.shuffle(); });
    shuffle.addEventListener('dblclick', e => e.stopPropagation());
    this.paint(swatchColor(node));
  }

  private live(): boolean {
    const b = this.ctx.board;
    return b.selection.has(this.node.id) && b.selection.size === 1;
  }

  private paint(hex: string): void {
    this.area.style.background = hex;
    this.hexEl.setText(hex);
    this.hexEl.style.color = inkOn(hex);
    this.area.style.setProperty('--vc-swatch-ink', inkOn(hex));
    this.nameEl.setText(nearestColorName(hex, getLanguage()));
    if (this.input.value.toUpperCase() !== hex) this.input.value = hex.toLowerCase();
  }

  private setColor(hex: string): void {
    const h = hex.toUpperCase();
    commitNode(this.ctx, this.node.id, (n) => {
      n.vc = { ...(n.vc ?? {}), kind: 'swatch', color: h };
      delete n.vc.colors;
      n.text = swatchText(h);
    });
  }

  private shuffle(): void { this.setColor(randomNamedColor(getLanguage()).hex); }

  private copy(): void {
    const hex = swatchColor(this.node);
    void navigator.clipboard.writeText(hex);
    new Notice(t('Copied {hex}', { hex }));
  }

  update(n: RawNode): void { this.node = n; this.paint(swatchColor(n)); }
  destroy(): void { /* nothing */ }
  searchText(): string { const hex = swatchColor(this.node); return `${hex} ${nearestColorName(hex, getLanguage())}`; }

  barItems(): BarItem[] {
    return [
      { id: 'pick', icon: 'pipette', label: t('Change colour'), run: () => this.input.click() },
      { id: 'shuffle', icon: 'shuffle', label: t('Random colour'), run: () => this.shuffle() },
      { id: 'copy', icon: 'copy', label: t('Copy colour code'), text: swatchColor(this.node), run: () => this.copy() },
    ];
  }
}

export const swatchCard: CardType = {
  id: 'swatch',
  label: 'Colour swatch',
  icon: 'palette',
  // Square overall: the colour above is a little wider than tall, the name strip below.
  defaultSize: { width: 160, height: 160 },
  create: () => {
    const hex = randomNamedColor(getLanguage()).hex.toUpperCase();
    return { type: 'text', text: swatchText(hex), vc: { kind: 'swatch', color: hex } };
  },
  mount: (node, el, ctx) => new SwatchCard(node, el, ctx),
};
