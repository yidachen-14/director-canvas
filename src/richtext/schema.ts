import { Schema, type DOMOutputSpec, type Node as PMNode } from 'prosemirror-model';

/**
 * The document model of every text card. It maps one-to-one onto Markdown
 * (plus a few HTML tags for what Markdown can't say: alignment, colour,
 * size, underline), so a card's text stays readable in the core Canvas.
 * Anything this editor does not edit itself (tables, math blocks, HTML,
 * embeds…) is kept verbatim in raw nodes.
 */

export type Align = 'left' | 'center' | 'right' | null;

const alignAttr = { align: { default: null as Align } };

function getAlign(dom: HTMLElement): Align {
  const a = (dom.style.textAlign || dom.getAttribute('align') || '').toLowerCase();
  return a === 'center' || a === 'right' || a === 'left' ? (a) : null;
}

function alignStyle(node: PMNode): Record<string, string> {
  return node.attrs.align ? { style: `text-align: ${node.attrs.align}` } : {};
}

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },

    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: alignAttr,
      parseDOM: [{ tag: 'p', getAttrs: (d) => ({ align: getAlign(d) }) }],
      toDOM: (node): DOMOutputSpec => ['p', alignStyle(node), 0],
    },

    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 }, ...alignAttr },
      defining: true,
      parseDOM: [1, 2, 3, 4, 5, 6].map(level => ({
        tag: `h${level}`,
        getAttrs: (d: HTMLElement | string) => ({ level, align: getAlign(d as HTMLElement) }),
      })),
      toDOM: (node): DOMOutputSpec => [`h${node.attrs.level}`, alignStyle(node), 0],
    },

    blockquote: {
      group: 'block',
      content: 'block+',
      defining: true,
      parseDOM: [{ tag: 'blockquote' }],
      toDOM: (): DOMOutputSpec => ['blockquote', 0],
    },

    code_block: {
      group: 'block',
      content: 'text*',
      marks: '',
      code: true,
      defining: true,
      attrs: { language: { default: '' } },
      parseDOM: [{
        tag: 'pre',
        preserveWhitespace: 'full',
        getAttrs: (d) => {
          const code = (d).querySelector('code');
          const m = /language-(\S+)/.exec(code?.className ?? '');
          return { language: m ? m[1] : '' };
        },
      }],
      toDOM: (node): DOMOutputSpec => ['pre', ['code', node.attrs.language ? { class: `language-${node.attrs.language}` } : {}, 0]],
    },

    horizontal_rule: {
      group: 'block',
      parseDOM: [{ tag: 'hr' }],
      toDOM: (): DOMOutputSpec => ['hr'],
    },

    bullet_list: {
      group: 'block',
      content: 'list_item+',
      attrs: { tight: { default: true } },
      parseDOM: [{ tag: 'ul', getAttrs: (d) => ({ tight: !(d).querySelector('li > p + p') }) }],
      toDOM: (): DOMOutputSpec => ['ul', 0],
    },

    ordered_list: {
      group: 'block',
      content: 'list_item+',
      attrs: { order: { default: 1 }, tight: { default: true } },
      parseDOM: [{
        tag: 'ol',
        getAttrs: (d) => ({ order: (d).hasAttribute('start') ? Number((d).getAttribute('start')) : 1 }),
      }],
      toDOM: (node): DOMOutputSpec => ['ol', node.attrs.order === 1 ? {} : { start: node.attrs.order as number }, 0],
    },

    list_item: {
      content: 'paragraph block*',
      defining: true,
      // null: an ordinary item; a character: a task item ("- [ ]" is ' ', "- [x]" is 'x').
      attrs: { checked: { default: null as string | null } },
      parseDOM: [{
        tag: 'li',
        getAttrs: (d) => {
          const el = d;
          if (el.dataset.task !== undefined) return { checked: el.dataset.task || ' ' };
          const box = el.querySelector<HTMLInputElement>(':scope > input[type=checkbox], :scope > p > input[type=checkbox]');
          return { checked: box ? (box.checked ? 'x' : ' ') : null };
        },
      }],
      toDOM: (node): DOMOutputSpec => {
        const checked = node.attrs.checked as string | null;
        return checked === null ? ['li', 0] : ['li', { class: `vc-task${isDone(checked) ? ' is-checked' : ''}`, 'data-task': checked }, 0];
      },
    },

    /** Markdown this editor keeps but does not edit (tables, math, HTML…). */
    raw_block: {
      group: 'block',
      atom: true,
      selectable: true,
      attrs: { source: { default: '' } },
      parseDOM: [{ tag: 'div[data-raw-block]', getAttrs: (d) => ({ source: (d).dataset.rawBlock ?? '' }) }],
      toDOM: (node): DOMOutputSpec => ['div', { 'data-raw-block': node.attrs.source as string, class: 'vc-raw-block' }],
    },

    text: { group: 'inline' },

    hard_break: {
      inline: true,
      group: 'inline',
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM: (): DOMOutputSpec => ['br'],
    },

    /** [[target|alias]] or ![[target]]. */
    wikilink: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: { target: { default: '' }, alias: { default: null as string | null }, embed: { default: false } },
      parseDOM: [{
        tag: 'span[data-wikilink]',
        getAttrs: (d) => {
          const el = d;
          return { target: el.dataset.wikilink ?? '', alias: el.dataset.alias ?? null, embed: el.dataset.embed === '1' };
        },
      }],
      toDOM: (node): DOMOutputSpec => {
        const a = node.attrs as { target: string; alias?: string | null; embed?: boolean };
        return ['span', {
          'data-wikilink': a.target,
          ...(a.alias ? { 'data-alias': a.alias } : {}),
          ...(a.embed ? { 'data-embed': '1' } : {}),
          class: 'vc-wikilink internal-link',
        }, a.alias || a.target];
      },
    },

    /** Inline Markdown kept verbatim ($math$, %%comments%%, unknown HTML). */
    raw_inline: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: { source: { default: '' } },
      parseDOM: [{ tag: 'span[data-raw-inline]', getAttrs: (d) => ({ source: (d).dataset.rawInline ?? '' }) }],
      toDOM: (node): DOMOutputSpec => ['span', { 'data-raw-inline': node.attrs.source as string, class: 'vc-raw-inline' }, node.attrs.source as string],
    },
  },

  marks: {
    link: {
      attrs: { href: {}, title: { default: null } },
      inclusive: false,
      parseDOM: [{ tag: 'a[href]', getAttrs: (d) => ({ href: (d).getAttribute('href'), title: (d).getAttribute('title') }) }],
      toDOM: (mark): DOMOutputSpec => ['a', { href: mark.attrs.href as string, title: mark.attrs.title as string | null, class: 'external-link' }, 0],
    },
    strong: {
      parseDOM: [
        { tag: 'strong' },
        { tag: 'b', getAttrs: (d) => (d).style.fontWeight !== 'normal' && null },
        { style: 'font-weight', getAttrs: (v) => /^(bold(er)?|[6-9]\d{2,})$/.test(v) && null },
      ],
      toDOM: (): DOMOutputSpec => ['strong', 0],
    },
    em: {
      parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
      toDOM: (): DOMOutputSpec => ['em', 0],
    },
    underline: {
      parseDOM: [{ tag: 'u' }, { tag: 'ins' }, { style: 'text-decoration', getAttrs: (v) => /underline/.test(v) && null }],
      toDOM: (): DOMOutputSpec => ['u', 0],
    },
    strike: {
      parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }, { style: 'text-decoration', getAttrs: (v) => /line-through/.test(v) && null }],
      toDOM: (): DOMOutputSpec => ['del', 0],
    },
    highlight: {
      attrs: { color: { default: null as string | null } },
      parseDOM: [{
        tag: 'mark',
        getAttrs: (d) => ({ color: (d).style.backgroundColor || null }),
      }],
      toDOM: (mark): DOMOutputSpec => ['mark', mark.attrs.color ? { style: `background-color: ${mark.attrs.color}` } : {}, 0],
    },
    color: {
      attrs: { color: {} },
      parseDOM: [
        // Greys and black/white are page text colours, not a choice: drop them.
        { style: 'color', getAttrs: (v) => (isMeaningfulColor(v) ? { color: v } : false) },
        { tag: 'font[color]', getAttrs: (d) => (isMeaningfulColor((d).getAttribute('color') ?? '') ? { color: (d).getAttribute('color') } : false) },
      ],
      toDOM: (mark): DOMOutputSpec => ['span', { style: `color: ${mark.attrs.color}` }, 0],
    },
    size: {
      attrs: { size: {} },
      // Only sizes this editor set (data-size); pasted pages bring their own sizes.
      parseDOM: [{ tag: 'span[data-size]', getAttrs: (d) => ({ size: Number((d).dataset.size) || 16 }) }],
      toDOM: (mark): DOMOutputSpec => ['span', { 'data-size': String(mark.attrs.size), style: `font-size: ${mark.attrs.size}px` }, 0],
    },
    code: {
      code: true,
      parseDOM: [{ tag: 'code' }],
      toDOM: (): DOMOutputSpec => ['code', 0],
    },
  },
});

export type RichDoc = PMNode;

/** Whether a task character means done. */
export function isDone(c: string | null): boolean {
  return !!c && c !== ' ';
}

/** A colour worth keeping from pasted content: not black, white or grey. */
export function isMeaningfulColor(v: string): boolean {
  if (!v) return false;
  const probe = createSpan();
  probe.style.color = v;
  if (!probe.style.color) return false;
  if (/^(black|white|gr[ae]y|silver|dimgr[ae]y|darkgr[ae]y|lightgr[ae]y|gainsboro|whitesmoke|inherit|currentcolor|initial)$/i.test(probe.style.color)) return false;
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(probe.style.color);
  if (!m) return true; // named colours other than the greys below
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max - min > 24; // has some saturation
}
