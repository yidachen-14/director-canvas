import { describe, it, expect } from 'vitest';
import { movedPath, relinkText, relinkCanvas } from '../src/model/relink';

describe('rename sync', () => {
  it('moves files and folders', () => {
    expect(movedPath('a/b.png', [{ from: 'a/b.png', to: 'c/b.png', folder: false }])).toBe('c/b.png');
    expect(movedPath('a/b/c.png', [{ from: 'a/b', to: 'x', folder: true }])).toBe('x/c.png');
    expect(movedPath('a/bb/c.png', [{ from: 'a/b', to: 'x', folder: true }])).toBeNull();
  });
  it('rewrites links by path and by name', () => {
    const m = [{ from: 'Notes/Old.md', to: 'Notes/New.md', folder: false }];
    expect(relinkText('see [[Old]] and [[Notes/Old|alias]] and ![[Notes/Old.md#h]]', m))
      .toBe('see [[New]] and [[Notes/New|alias]] and ![[Notes/New.md#h]]');
    expect(relinkText('[[Other]]', m)).toBe('[[Other]]');
  });
  it('keeps a bare name when only the folder changed', () => {
    const m = [{ from: 'A/Note.md', to: 'B/Note.md', folder: false }];
    expect(relinkText('[[Note]]', m)).toBe('[[Note]]');
  });
  it('updates file nodes', () => {
    const data = { nodes: [{ id: '1', type: 'file', x: 0, y: 0, width: 1, height: 1, file: 'img/a.png' }], edges: [] };
    expect(relinkCanvas(data, [{ from: 'img', to: 'pics', folder: true }])).toBe(true);
    expect(data.nodes[0].file).toBe('pics/a.png');
  });
});
