import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule, ellipsis } from 'prosemirror-inputrules';
import { findWrapping } from 'prosemirror-transform';
import type { MarkType } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';
import { schema } from './schema';

/** `**x**` → bold etc.: wrap the matched text in a mark and drop the markers. */
function markRule(re: RegExp, type: MarkType): InputRule {
  return new InputRule(re, (state, match, start, end) => {
    const inner = match[2];
    const textStart = start + match[0].indexOf(match[1]);
    const tr = state.tr;
    tr.replaceWith(textStart, end, schema.text(inner, [type.create()]));
    if (textStart > start) tr.delete(start, textStart);
    tr.removeStoredMark(type);
    return tr;
  });
}

/** Markdown typed at the start of a line becomes the block it describes. */
export function markdownInputRules(): Plugin {
  const n = schema.nodes;
  return inputRules({
    rules: [
      ellipsis,
      textblockTypeInputRule(/^(#{1,6})\s$/, n.heading, m => ({ level: m[1].length })),
      wrappingInputRule(/^\s*>\s$/, n.blockquote),
      // "[] " / "[ ] " / "[x] " → task list
      new InputRule(/^\s*\[([ xX]?)\]\s$/, (state, m, start, end) => {
        const tr = state.tr.delete(start, end);
        const range = tr.doc.resolve(start).blockRange();
        const wrapping = range && findWrapping(range, n.bullet_list);
        if (!range || !wrapping) return null;
        tr.wrap(range, wrapping);
        const $p = tr.doc.resolve(tr.mapping.map(start));
        for (let d = $p.depth; d > 0; d--) {
          if ($p.node(d).type === n.list_item) { tr.setNodeMarkup($p.before(d), undefined, { checked: m[1].toLowerCase() === 'x' ? 'x' : ' ' }); break; }
        }
        return tr;
      }),
      wrappingInputRule(/^\s*([-+*])\s$/, n.bullet_list),
      wrappingInputRule(/^(\d+)\.\s$/, n.ordered_list, m => ({ order: Number(m[1]) }), (m, node) => node.childCount + node.attrs.order === Number(m[1])),
      textblockTypeInputRule(/^```([\w-]*)\s$/, n.code_block, m => ({ language: m[1] })),
      new InputRule(/^(?:---|\*\*\*|___)$/, (state, _m, start, end) => {
        const $start = state.doc.resolve(start);
        if ($start.parent.type !== n.paragraph || $start.parent.textContent.length > 3) return null;
        return state.tr.replaceRangeWith($start.before(), $start.after(), n.horizontal_rule.create()).scrollIntoView();
      }),
      markRule(/(?:^|[^*])(\*\*([^*\s][^*]*[^*\s]|[^*\s])\*\*)$/, schema.marks.strong),
      markRule(/(?:^|[^*])(\*([^*\s][^*]*[^*\s]|[^*\s])\*)$/, schema.marks.em),
      markRule(/(?:^|[^~])(~~([^~\s][^~]*[^~\s]|[^~\s])~~)$/, schema.marks.strike),
      markRule(/(?:^|[^=])(==([^=\s][^=]*[^=\s]|[^=\s])==)$/, schema.marks.highlight),
      markRule(/(?:^|[^`])(`([^`]+)`)$/, schema.marks.code),
      // [[note]] typed out → a link chip
      new InputRule(/(!?)\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]$/, (state, m, start, end) => {
        return state.tr.replaceWith(start, end, n.wikilink.create({ target: m[2], alias: m[3] ?? null, embed: m[1] === '!' }));
      }),
    ],
  });
}
