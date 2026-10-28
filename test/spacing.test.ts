import { describe, expect, it } from 'vitest';
import { respace, runOf } from '../src/board/spacing';

const box = (id: string, x: number, y: number, width = 100, height = 50) => ({ id, x, y, width, height });

describe('spacing handles', () => {
  it('finds a row whose tops line up', () => {
    const run = runOf([box('b', 150, 0), box('a', 0, 0), box('c', 400, 0, 80, 90)], 'h')!;
    expect(run.items.map(i => i.id)).toEqual(['a', 'b', 'c']);
    expect(runOf([box('a', 0, 0), box('b', 150, 0)], 'v')).toBeNull();
  });
  it('needs a shared line and no overlap', () => {
    expect(runOf([box('a', 0, 0), box('b', 150, 13)], 'h')).toBeNull();
    expect(runOf([box('a', 0, 0), box('b', 50, 0)], 'h')).toBeNull();
    expect(runOf([box('a', 0, 0, 100, 40), box('b', 150, 10, 100, 20)], 'h')).not.toBeNull(); // centres
  });
  it('sets every gap the same', () => {
    const run = runOf([box('a', 0, 0), box('b', 150, 0), box('c', 400, 0)], 'h')!;
    expect([...respace(run, 20).values()]).toEqual([0, 120, 240]);
  });
});
