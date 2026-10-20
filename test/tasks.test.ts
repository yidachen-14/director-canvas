// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, AllSelection, type Command } from 'prosemirror-state';
import { parseMarkdown, serializeMarkdown } from '../src/richtext/markdown';
import { allFromTasks, allToTasks, toggleTaskLines } from '../src/richtext/commands';

function run(md: string, cmd: Command, sel?: (s: EditorState) => EditorState): string {
  let state = EditorState.create({ doc: parseMarkdown(md) });
  state = sel ? sel(state) : state.apply(state.tr.setSelection(new AllSelection(state.doc)));
  cmd(state, tr => { state = state.apply(tr); });
  return serializeMarkdown(state.doc);
}

describe('to-do lines', () => {
  it('turns every line of a card into its own to-do', () => {
    expect(run('Shoot prep\nCheck location\nCall actors', allToTasks)).toBe('- [ ] Shoot prep\n- [ ] Check location\n- [ ] Call actors');
  });
  it('keeps existing ticks and converts other lists', () => {
    const out = run('- [x] done\n\nplain\n\n1. one', allToTasks);
    expect(out).toContain('- [x] done');
    expect(out).toContain('- [ ] plain');
    expect(out).toContain('- [ ] one');
  });
  it('removes the checkboxes again', () => {
    expect(run('- [ ] a\n- [x] b', allFromTasks)).toBe('a\n\nb');
  });
  it('adds a checkbox only to the line with the cursor', () => {
    const out = run('one\ntwo\nthree', toggleTaskLines, (s) => {
      // Cursor inside "two".
      let pos = 0;
      s.doc.descendants((n, p) => { if (n.isText && n.text === 'two') pos = p + 1; });
      return s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos)));
    });
    expect(out).toBe('one\n\n- [ ] two\n\nthree');
    const first = run('one\ntwo\nthree', toggleTaskLines, (s) => {
      let pos = 0;
      s.doc.descendants((n, p) => { if (n.isText && n.text === 'three') pos = p + 1; });
      return s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos)));
    });
    expect(first).toBe('one\ntwo\n\n- [ ] three');
  });
});
