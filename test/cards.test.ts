import { describe, it, expect, vi } from 'vitest';

vi.mock('obsidian', () => ({ moment: () => ({}), Menu: class {}, Notice: class {}, TFile: class {}, FuzzySuggestModal: class {}, Modal: class {}, Setting: class {}, addIcon: () => {}, normalizePath: (p: string) => p, setIcon: () => {}, setTooltip: () => {}, getIcon: () => null, requestUrl: async () => ({}) }));

import { parseKanban, serializeKanban } from '../src/cards/widgets';
import { nearestColorName, inkOn } from '../src/cards/named-colors';
import { datedTasks, moveTaskDate, toggleTaskDone, addDays, weekStart } from '../src/cards/calendar';
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
  it('names the nearest colour', () => {
    expect(nearestColorName('#9D2933', 'zh-TW')).toBe('胭脂');
    expect(nearestColorName('#FE0101', 'en')).toBe('Red');
  });
  it('picks readable ink', () => {
    expect(inkOn('#ffffff')).toContain('0,0,0');
    expect(inkOn('#000000')).toContain('255');
  });
});

describe('calendar', () => {
  it('finds dated to-dos and moves them', () => {
    const n = { id: 'a', type: 'text', x: 0, y: 0, width: 1, height: 1, text: 'x\n- [ ] 交分鏡 📅 2026-10-21\n- [x] done 📅 2026-10-22' };
    const items = datedTasks(n);
    expect(items.map(i => [i.date, i.label, i.done])).toEqual([['2026-10-21', '交分鏡', false], ['2026-10-22', 'done', true]]);
    expect(moveTaskDate(n.text, 1, '2026-11-01')).toContain('📅 2026-11-01');
    expect(toggleTaskDone(n.text, 1)).toContain('- [x] 交分鏡');
  });
  it('date maths', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(weekStart('2026-10-25')).toBe('2026-10-19');
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
