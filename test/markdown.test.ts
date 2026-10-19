// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseMarkdown, serializeMarkdown } from '../src/richtext/markdown';

const rt = (s: string) => serializeMarkdown(parseMarkdown(s));

describe('markdown round trip', () => {
  const same = [
    'plain text',
    '# Title\n\nbody',
    '**bold** and *italic* and ~~strike~~ and ==mark==',
    'line one\nline two',
    '- a\n- b\n  - c',
    '1. one\n2. two',
    '- [ ] todo\n- [x] done',
    '> quote\n> more',
    '```js\nconst a = 1;\n```',
    'see [[Some Note|alias]] and ![[pic.png]]',
    'math $x^2$ inline',
    '%%comment%% visible',
    '<u>under</u> <span style="color: #ff0000">red</span>',
    '[link](https://example.com)',
    '| a | b |\n| --- | --- |\n| 1 | 2 |',
    '$$\nE=mc^2\n$$',
    'footnote[^1]',
    '---',
    'C# 是語言 #tag',
  ];
  for (const s of same) it(JSON.stringify(s), () => expect(rt(s)).toBe(s));

  it('keeps aligned paragraphs as HTML that parses back', () => {
    const doc = parseMarkdown('<p style="text-align: center">置中 <strong>粗</strong></p>');
    expect(doc.firstChild!.attrs.align).toBe('center');
    const out = serializeMarkdown(doc);
    expect(out).toContain('text-align: center');
    expect(parseMarkdown(out).firstChild!.attrs.align).toBe('center');
  });

  it('keeps other task characters', () => {
    expect(rt('- [/] half')).toBe('- [/] half');
  });

  it('does not escape ordinary brackets', () => {
    expect(rt('a [draft] note')).toBe('a [draft] note');
  });
});
