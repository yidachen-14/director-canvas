import { describe, it, expect, vi } from 'vitest';

vi.mock('obsidian', () => ({ moment: () => ({}), Menu: class {}, Notice: class {}, TFile: class {}, normalizePath: (p: string) => p, setIcon: () => {}, requestUrl: async () => ({}) }));

import { parseKanban, serializeKanban, swatchText, inkFor } from '../src/cards/widgets';
import { layoutColumn, COLUMN_HEADER, COLUMN_PAD } from '../src/board/columns';
import type { RawNode } from '../src/model/canvas-file';

describe('kanban', () => {
  it('round-trips columns, tasks and multi-line cards', () => {
    const md = '## To do\n- [ ] one\n- [x] two\n  second line\n\n## Done\n- plain';
    const cols = parseKanban(md);
    expect(cols.map(c => c.title)).toEqual(['To do', 'Done']);
    expect(cols[0].items[1]).toEqual({ text: 'two\nsecond line', done: true });
    expect(cols[1].items[0].done).toBeNull();
    expect(serializeKanban(cols)).toBe(md);
  });
});

describe('swatch', () => {
  it('lists colours for the core Canvas', () => {
    expect(swatchText([{ hex: '#aabbcc', name: 'Sky' }])).toBe('- `#AABBCC` Sky');
  });
  it('picks readable ink', () => {
    expect(inkFor('#ffffff')).toBe('#1d1d1d');
    expect(inkFor('#000000')).toBe('#ffffff');
  });
});

describe('columns', () => {
  it('stacks cards inside a column and fits its height', () => {
    const col: RawNode = { id: 'c', type: 'group', x: 0, y: 0, width: 300, height: 400, vc: { kind: 'column' } };
    const a: RawNode = { id: 'a', type: 'text', x: 40, y: 200, width: 100, height: 50 };
    const b: RawNode = { id: 'b', type: 'text', x: 10, y: 60, width: 200, height: 80 };
    const out: RawNode = { id: 'o', type: 'text', x: 500, y: 0, width: 100, height: 50 };
    layoutColumn(col, [col, a, b, out]);
    expect(b.y).toBe(COLUMN_HEADER);
    expect(a.y).toBe(COLUMN_HEADER + 80 + 10);
    expect(a.width).toBe(300 - COLUMN_PAD * 2);
    expect(out.x).toBe(500);
    expect(col.height).toBe(COLUMN_HEADER + 80 + 10 + 50 + COLUMN_PAD);
  });
});
