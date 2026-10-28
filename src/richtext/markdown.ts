import markdownit, { type MarkdownIt, type Token, type StateInline, type StateBlock } from 'markdown-it';
import { DOMParser as PMDOMParser, DOMSerializer, Fragment, type Mark, type Node as PMNode } from 'prosemirror-model';
import { MarkdownSerializer, MarkdownSerializerState } from 'prosemirror-markdown';
import { schema, type Align } from './schema';

// ── Markdown → document ────────────────────────────────────────

/** markdown-it set up like Obsidian: single newlines are line breaks, HTML allowed. */
function makeParser(): MarkdownIt {
  const md = markdownit('commonmark', { html: true, breaks: true, linkify: false });
  md.enable(['strikethrough', 'table']);

  // ![[embed]] and [[link|alias]]
  md.inline.ruler.before('link', 'wikilink', (state: StateInline, silent: boolean) => {
    const src = state.src, pos = state.pos;
    const embed = src.charCodeAt(pos) === 0x21 /* ! */;
    const start = embed ? pos + 1 : pos;
    if (src.charCodeAt(start) !== 0x5b || src.charCodeAt(start + 1) !== 0x5b) return false;
    const end = src.indexOf(']]', start + 2);
    if (end < 0) return false;
    const inner = src.slice(start + 2, end);
    if (!inner || inner.includes('\n') || inner.includes('[[')) return false;
    if (!silent) {
      const bar = inner.indexOf('|');
      const tok = state.push('wikilink', '', 0);
      tok.meta = { target: bar >= 0 ? inner.slice(0, bar) : inner, alias: bar >= 0 ? inner.slice(bar + 1) : null, embed };
    }
    state.pos = end + 2;
    return true;
  });

  // Inline things kept verbatim: $math$, %%comments%%, [^footnotes]
  md.inline.ruler.before('emphasis', 'vc_raw_inline', (state: StateInline, silent: boolean) => {
    const src = state.src, pos = state.pos;
    let end = -1;
    if (src.startsWith('%%', pos)) {
      const close = src.indexOf('%%', pos + 2);
      if (close > 0) end = close + 2;
    } else if (src.charCodeAt(pos) === 0x24 /* $ */ && src.charCodeAt(pos + 1) !== 0x24) {
      const next = src.charAt(pos + 1);
      if (next && !/\s/.test(next)) {
        let i = pos + 1;
        while ((i = src.indexOf('$', i)) > 0 && (/\s/.test(src.charAt(i - 1)) || src.charAt(i - 1) === '\\')) i++;
        if (i > pos + 1 && !src.slice(pos, i).includes('\n')) end = i + 1;
      }
    } else if (src.startsWith('[^', pos)) {
      const close = src.indexOf(']', pos + 2);
      if (close > pos + 2 && !src.slice(pos, close).includes(' ')) end = close + 1;
    }
    if (end < 0) return false;
    if (!silent) state.push('vc_raw_inline', '', 0).content = src.slice(pos, end);
    state.pos = end;
    return true;
  });

  // ==highlight==, the same delimiter dance as ~~strikethrough~~.
  md.inline.ruler.before('emphasis', 'vc_mark', (state: StateInline, silent: boolean) => {
    if (silent || state.src.charCodeAt(state.pos) !== 0x3d) return false;
    const scanned = state.scanDelims(state.pos, true);
    let len = scanned.length;
    if (len < 2) return false;
    if (len % 2) { state.push('text', '', 0).content = '='; len--; }
    for (let i = 0; i < len; i += 2) {
      state.push('text', '', 0).content = '==';
      state.delimiters.push({ marker: 0x3d, length: 0, token: state.tokens.length - 1, end: -1, open: scanned.can_open, close: scanned.can_close });
    }
    state.pos += scanned.length;
    return true;
  });
  md.inline.ruler2.before('emphasis', 'vc_mark', (state: StateInline) => {
    const lists = [state.delimiters, ...(state.tokens_meta ?? []).map(m => m?.delimiters).filter(Boolean)] as StateInline['delimiters'][];
    for (const delimiters of lists) {
      for (const d of delimiters) {
        if (d.marker !== 0x3d || d.end === -1) continue;
        const e = delimiters[d.end];
        Object.assign(state.tokens[d.token], { type: 'mark_open', tag: 'mark', nesting: 1, markup: '==', content: '' });
        Object.assign(state.tokens[e.token], { type: 'mark_close', tag: 'mark', nesting: -1, markup: '==', content: '' });
      }
    }
    return false;
  });

  // $$ math blocks $$ and %% comment blocks %%: kept verbatim.
  md.block.ruler.before('fence', 'vc_raw_fence', (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
    const first = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]);
    const fence = first.startsWith('$$') ? '$$' : first.startsWith('%%') ? '%%' : null;
    if (!fence) return false;
    let line = startLine;
    const closesOnFirst = first.length > 2 && first.trimEnd().endsWith(fence);
    if (!closesOnFirst) {
      for (line = startLine + 1; line < endLine; line++) {
        const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
        if (text.trimEnd().endsWith(fence)) break;
      }
      if (line >= endLine) return false;
    }
    if (silent) return true;
    const tok = state.push('vc_raw_block', '', 0);
    tok.map = [startLine, line + 1];
    tok.content = state.getLines(startLine, line + 1, state.tShift[startLine], false).replace(/\n$/, '');
    state.line = line + 1;
    return true;
  }, { alt: ['paragraph'] });

  return md;
}

let parser: MarkdownIt | null = null;
const md = () => (parser ??= makeParser());

/** Source lines of a block token. */
function sourceOf(lines: string[], map: [number, number] | null | undefined): string {
  return map ? lines.slice(map[0], map[1]).join('\n').replace(/\s+$/, '') : '';
}

interface Frame { type: string; attrs: Record<string, unknown>; content: PMNode[]; }

const INLINE_HTML_MARK = /^<(\/?)(u|ins|mark|span|font|s|del|strike|b|strong|i|em|sub|sup)\b([^>]*)>$/i;

/** Turn Markdown into a document. Never throws: unknown syntax stays as raw text. */
export function parseMarkdown(text: string): PMNode {
  const src = text.replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const tokens = md().parse(src, {});
  const stack: Frame[] = [{ type: 'doc', attrs: {}, content: [] }];
  const top = () => stack[stack.length - 1];
  const push = (n: PMNode | null) => { if (n) top().content.push(n); };
  const open = (type: string, attrs: Record<string, unknown> = {}) => stack.push({ type, attrs, content: [] });
  const close = () => {
    const f = stack.pop()!;
    const type = schema.nodes[f.type];
    let content = f.content;
    if (f.type === 'list_item' && (!content.length || content[0].type.name !== 'paragraph')) content = [schema.nodes.paragraph.create(), ...content];
    if ((f.type === 'blockquote' || f.type === 'doc') && !content.length) content = [schema.nodes.paragraph.create()];
    push(type.createChecked(f.attrs, content));
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    switch (tok.type) {
      case 'paragraph_open': {
        const inline = tokens[i + 1];
        const nodes = inline?.type === 'inline' ? inlineNodes(inline.children ?? []) : [];
        i += 2;
        // A task list item: "[ ] " / "[x] " at the start of its first paragraph.
        const frame = top();
        if (frame.type === 'list_item' && !frame.content.length && nodes[0]?.isText) {
          const m = /^\[(.)\][ \t]/.exec(nodes[0].text!);
          if (m) {
            frame.attrs.checked = m[1];
            const rest = nodes[0].text!.slice(m[0].length);
            nodes[0] = rest ? schema.text(rest, nodes[0].marks) : (null as unknown as PMNode);
          } else if (/^\[(.)\]$/.test(nodes[0].text!) && nodes.length === 1) {
            frame.attrs.checked = nodes[0].text!.charAt(1);
            nodes.length = 0;
          }
        }
        push(schema.nodes.paragraph.create(null, nodes.filter(Boolean)));
        break;
      }
      case 'heading_open': {
        const level = Number(tok.tag.slice(1));
        const inline = tokens[i + 1];
        push(schema.nodes.heading.create({ level }, inlineNodes(inline?.children ?? [])));
        i += 2;
        break;
      }
      case 'blockquote_open': open('blockquote'); break;
      case 'bullet_list_open': open('bullet_list', { tight: true }); break;
      case 'ordered_list_open': open('ordered_list', { order: Number(tok.attrGet('start') ?? 1), tight: true }); break;
      case 'list_item_open': {
        // A list is loose when any of its paragraphs are visible.
        open('list_item', { checked: null });
        break;
      }
      case 'blockquote_close':
      case 'list_item_close':
        close();
        break;
      case 'bullet_list_close':
      case 'ordered_list_close': {
        const f = top();
        f.attrs.tight = !looseList(tokens, i);
        close();
        break;
      }
      case 'fence':
      case 'code_block': {
        const code = tok.content.replace(/\n$/, '');
        push(schema.nodes.code_block.create({ language: tok.info.trim() }, code ? schema.text(code) : null));
        break;
      }
      case 'hr': push(schema.nodes.horizontal_rule.create()); break;
      case 'html_block': {
        const blocks = alignedHtmlBlock(tok.content);
        if (blocks) blocks.forEach(push);
        else push(schema.nodes.raw_block.create({ source: tok.content.replace(/\s+$/, '') }));
        break;
      }
      case 'table_open': {
        let depth = 0, j = i;
        for (; j < tokens.length; j++) {
          if (tokens[j].type === 'table_open') depth++;
          if (tokens[j].type === 'table_close' && --depth === 0) break;
        }
        push(schema.nodes.raw_block.create({ source: sourceOf(lines, tok.map) }));
        i = j;
        break;
      }
      case 'vc_raw_block':
        push(schema.nodes.raw_block.create({ source: tok.content }));
        break;
      default:
        // Anything else at block level: keep its source.
        if (tok.map && tok.nesting === 0 && tok.type !== 'inline') push(schema.nodes.raw_block.create({ source: sourceOf(lines, tok.map) }));
    }
  }
  while (stack.length > 1) close();
  const content = stack[0].content.length ? stack[0].content : [schema.nodes.paragraph.create()];
  return schema.nodes.doc.create(null, content);
}

function looseList(tokens: Token[], closeIndex: number): boolean {
  // Walk back to the matching open; any non-hidden paragraph directly in an item makes it loose.
  let depth = 0;
  for (let j = closeIndex; j >= 0; j--) {
    const t = tokens[j];
    if (t.type.endsWith('_list_close')) depth++;
    if (t.type.endsWith('_list_open')) { depth--; if (depth === 0) return false; }
    if (depth === 1 && t.type === 'paragraph_open' && !t.hidden) return true;
  }
  return false;
}

/**
 * HTML parsed into a separate, inert document: nothing in it runs or loads (no scripts,
 * no image loads, no event handlers), unlike HTML assigned to an element of this page.
 */
function inertHtml(html: string): HTMLElement {
  return new DOMParser().parseFromString(html, 'text/html').body;
}

/** `<p style="text-align:center">…</p>` (how aligned paragraphs are stored) back into blocks. */
function alignedHtmlBlock(html: string): PMNode[] | null {
  const trimmed = html.trim();
  if (!/^<(p|h[1-6])\b[^>]*(text-align|align=)/i.test(trimmed)) return null;
  const doc = PMDOMParser.fromSchema(schema).parse(inertHtml(trimmed));
  const out: PMNode[] = [];
  doc.forEach(n => out.push(n));
  return out.length ? out : null;
}

/** Inline tokens to inline nodes with marks. */
function inlineNodes(children: Token[]): PMNode[] {
  const out: PMNode[] = [];
  let marks: readonly Mark[] = [];
  const htmlStack: (Mark | null)[] = [];
  const add = (m: Mark) => { marks = m.addToSet(marks); };
  const remove = (type: string) => { marks = marks.filter(m => m.type.name !== type); };
  const removeMark = (m: Mark) => { marks = m.removeFromSet(marks); };
  const text = (s: string) => { if (s) out.push(schema.text(s, marks)); };

  for (const t of children) {
    switch (t.type) {
      case 'text': text(t.content); break;
      case 'softbreak':
      case 'hardbreak': out.push(schema.nodes.hard_break.create(null, null, marks)); break;
      case 'strong_open': add(schema.marks.strong.create()); break;
      case 'strong_close': remove('strong'); break;
      case 'em_open': add(schema.marks.em.create()); break;
      case 'em_close': remove('em'); break;
      case 's_open': add(schema.marks.strike.create()); break;
      case 's_close': remove('strike'); break;
      case 'mark_open': add(schema.marks.highlight.create()); break;
      case 'mark_close': remove('highlight'); break;
      case 'code_inline': out.push(schema.text(t.content || ' ', [...marks, schema.marks.code.create()])); break;
      case 'link_open': add(schema.marks.link.create({ href: t.attrGet('href') ?? '', title: t.attrGet('title') })); break;
      case 'link_close': remove('link'); break;
      case 'image': {
        const src = t.attrGet('src') ?? '';
        const alt = (t.children ?? []).map(c => c.content).join('') || t.content;
        out.push(schema.nodes.raw_inline.create({ source: `![${alt}](${src})` }, null, marks));
        break;
      }
      case 'wikilink':
        out.push(schema.nodes.wikilink.create(t.meta, null, marks));
        break;
      case 'vc_raw_inline':
        out.push(schema.nodes.raw_inline.create({ source: t.content }, null, marks));
        break;
      case 'html_inline': {
        const m = INLINE_HTML_MARK.exec(t.content.trim());
        if (!m) { out.push(schema.nodes.raw_inline.create({ source: t.content }, null, marks)); break; }
        const closing = m[1] === '/';
        if (closing) {
          const mk = htmlStack.pop();
          if (mk) removeMark(mk);
          else if (mk === undefined) out.push(schema.nodes.raw_inline.create({ source: t.content }, null, marks));
          break;
        }
        const mark = htmlTagMark(m[2].toLowerCase(), m[3]);
        htmlStack.push(mark);
        if (mark) add(mark);
        else out.push(schema.nodes.raw_inline.create({ source: t.content }, null, marks));
        break;
      }
      default:
        if (t.content) text(t.content);
    }
  }
  return out;
}

function htmlTagMark(tag: string, attrs: string): Mark | null {
  const style = /style\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? /style\s*=\s*'([^']*)'/i.exec(attrs)?.[1] ?? '';
  const prop = (name: string) => new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i').exec(style)?.[1].trim();
  switch (tag) {
    case 'u': case 'ins': return schema.marks.underline.create();
    case 's': case 'del': case 'strike': return schema.marks.strike.create();
    case 'b': case 'strong': return schema.marks.strong.create();
    case 'i': case 'em': return schema.marks.em.create();
    case 'mark': return schema.marks.highlight.create({ color: prop('background-color') ?? prop('background') ?? null });
    case 'font': {
      const c = /color\s*=\s*"?([^"\s>]+)/i.exec(attrs)?.[1];
      return c ? schema.marks.color.create({ color: c }) : null;
    }
    case 'span': {
      const size = /data-size\s*=\s*"?(\d+(?:\.\d+)?)/i.exec(attrs)?.[1] ?? prop('font-size')?.replace(/px$/, '');
      if (size && Number(size)) return schema.marks.size.create({ size: Number(size) });
      const c = prop('color');
      if (c) return schema.marks.color.create({ color: c });
      return null;
    }
  }
  return null;
}

// ── document → Markdown ────────────────────────────────────────

const htmlOf = (node: PMNode): string => {
  const ser = DOMSerializer.fromSchema(schema);
  const host = document.createElement('div');
  host.appendChild(ser.serializeNode(node));
  // Internal links inside HTML: Obsidian follows <a class="internal-link">.
  host.querySelectorAll<HTMLElement>('span[data-wikilink]').forEach(el => {
    if (el.dataset.embed === '1') { el.replaceWith(document.createTextNode(`![[${el.dataset.wikilink}]]`)); return; }
    const a = document.createElement('a');
    a.className = 'internal-link';
    a.setAttribute('data-href', el.dataset.wikilink ?? '');
    a.setAttribute('href', el.dataset.wikilink ?? '');
    a.textContent = el.textContent;
    el.replaceWith(a);
  });
  host.querySelectorAll<HTMLElement>('span[data-raw-inline]').forEach(el => el.replaceWith(document.createTextNode(el.dataset.rawInline ?? '')));
  return host.innerHTML;
};

const alignedBlock = (state: MarkdownSerializerState, node: PMNode) => {
  state.write(htmlOf(node));
  state.closeBlock(node);
};

const taskPrefix = (node: PMNode) => (node.attrs.checked === null || node.attrs.checked === undefined ? '' : `[${node.attrs.checked}] `);

const serializer = new MarkdownSerializer({
  doc: (state, node) => state.renderContent(node),
  paragraph: (state, node) => {
    if (node.attrs.align) { alignedBlock(state, node); return; }
    state.renderInline(node);
    state.closeBlock(node);
  },
  heading: (state, node) => {
    if (node.attrs.align) { alignedBlock(state, node); return; }
    state.write(state.repeat('#', node.attrs.level) + ' ');
    state.renderInline(node, false);
    state.closeBlock(node);
  },
  blockquote: (state, node) => state.wrapBlock('> ', null, node, () => state.renderContent(node)),
  code_block: (state, node) => {
    const backticks = node.textContent.match(/`{3,}/gm);
    const fence = backticks ? (backticks.sort().slice(-1)[0] + '`') : '```';
    state.write(fence + (node.attrs.language || '') + '\n');
    state.text(node.textContent, false);
    state.write('\n');
    state.write(fence);
    state.closeBlock(node);
  },
  horizontal_rule: (state, node) => { state.write('---'); state.closeBlock(node); },
  bullet_list: (state, node) => state.renderList(node, '  ', () => '- '),
  ordered_list: (state, node) => {
    const start = node.attrs.order || 1;
    const maxW = String(start + node.childCount - 1).length;
    const space = state.repeat(' ', maxW + 2);
    state.renderList(node, space, (i) => {
      const n = String(start + i);
      return state.repeat(' ', maxW - n.length) + n + '. ';
    });
  },
  list_item: (state, node) => {
    const prefix = taskPrefix(node);
    if (prefix) state.write(prefix);
    state.renderContent(node);
  },
  raw_block: (state, node) => { state.text(node.attrs.source, false); state.closeBlock(node); },
  text: (state, node) => state.text(node.text ?? ''),
  hard_break: (state, node, parent, index) => {
    for (let i = index + 1; i < parent.childCount; i++) {
      if (parent.child(i).type !== node.type) { state.write('\n'); return; }
    }
  },
  wikilink: (state, node) => {
    const a = node.attrs;
    state.write(`${a.embed ? '!' : ''}[[${a.target}${a.alias ? '|' + a.alias : ''}]]`);
  },
  raw_inline: (state, node) => state.write(node.attrs.source),
}, {
  em: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
  strong: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
  strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  highlight: {
    open: (_s, mark) => mark.attrs.color ? `<mark style="background-color: ${mark.attrs.color}">` : '==',
    close: (_s, mark) => mark.attrs.color ? '</mark>' : '==',
    mixable: true, expelEnclosingWhitespace: true,
  },
  underline: { open: '<u>', close: '</u>', mixable: true },
  color: { open: (_s, mark) => `<span style="color: ${mark.attrs.color}">`, close: '</span>' },
  size: { open: (_s, mark) => `<span data-size="${mark.attrs.size}" style="font-size: ${mark.attrs.size}px">`, close: '</span>' },
  link: {
    open: '[',
    close: (_s, mark) => `](${String(mark.attrs.href).replace(/[()\s]/g, encodeURIComponent)}${mark.attrs.title ? ` "${String(mark.attrs.title).replace(/"/g, '\\"')}"` : ''})`,
  },
  code: {
    open: (_s, _m, parent, index) => backticksFor(parent.child(index), -1),
    close: (_s, _m, parent, index) => backticksFor(parent.child(index - 1), 1),
    escape: false,
  },
}, { hardBreakNodeName: 'hard_break', strict: false });

function backticksFor(node: PMNode, side: number): string {
  const ticks = /`+/g;
  let m: RegExpExecArray | null, len = 0;
  if (node.isText) while ((m = ticks.exec(node.text!))) len = Math.max(len, m[0].length);
  let result = len > 0 && side > 0 ? ' `' : '`';
  for (let i = 0; i < len; i++) result += '`';
  if (len > 0 && side < 0) result += ' ';
  return result;
}

// Lighter escaping than the default: only what would change meaning in Obsidian.
(MarkdownSerializerState.prototype as unknown as { esc: (s: string, sol?: boolean) => string }).esc = function (str: string, startOfLine = false): string {
  str = str.replace(/\\(?=[\\`*_{}[\]()#+\-.!~=<>|%$])/g, '\\\\');
  str = str.replace(/[`*]/g, '\\$&');
  str = str.replace(/_/g, (m, i: number) => (i > 0 && i + 1 < str.length && /\w/.test(str[i - 1]) && /\w/.test(str[i + 1]) ? m : '\\_'));
  str = str.replace(/~~/g, '\\~~').replace(/==/g, '\\==').replace(/%%/g, '\\%%');
  str = str.replace(/\[(?=[[^])/g, '\\[').replace(/\](?=\()/g, '\\]');
  str = str.replace(/<(?=[A-Za-z/!])/g, '\\<');
  if (startOfLine) {
    str = str.replace(/^(\+[ ]|[-*>])/, '\\$&').replace(/^(\s*)(#{1,6})(\s|$)/, '$1\\$2$3').replace(/^(\s*\d+)\.\s/, '$1\\. ');
  }
  return str;
};

/** Document to Markdown. */
export function serializeMarkdown(doc: PMNode): string {
  return serializer.serialize(doc, { tightLists: true }).replace(/\n+$/, '');
}

/** The Markdown of one block (for dragging a paragraph out of a card). */
export function blockMarkdown(node: PMNode): string {
  return serializeMarkdown(schema.nodes.doc.create(null, Fragment.from(node)));
}

/** Rich clipboard HTML (web pages, Word, Docs) to Markdown. */
export function htmlToMarkdown(html: string): string {
  const doc = PMDOMParser.fromSchema(schema).parse(inertHtml(html.replace(/<meta[^>]*>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')));
  return serializeMarkdown(doc);
}

/** Plain text of a document, for search. */
export function plainText(doc: PMNode): string {
  return doc.textBetween(0, doc.content.size, '\n', (leaf) => leaf.attrs.source ?? leaf.attrs.alias ?? leaf.attrs.target ?? '');
}

export type { Align };
