import { describe, expect, it } from 'vitest';
import { formatTime, videoData } from '../src/cards/video-data';

describe('video player', () => {
  it('formats times', () => {
    expect(formatTime(0)).toBe('0:00.00');
    expect(formatTime(65.239)).toBe('1:05.24');
    expect(formatTime(3725.5)).toBe('1:02:05.50');
    expect(formatTime(NaN)).toBe('0:00.00');
  });
  it('reads video data safely', () => {
    expect(videoData({ id: 'a', type: 'file', x: 0, y: 0, width: 1, height: 1 } as never)).toEqual({});
    const marks = [{ id: 'm', in: 1, out: 2, note: 'x' }];
    expect(videoData({ id: 'a', type: 'file', x: 0, y: 0, width: 1, height: 1, vc: { video: { marks } } } as never).marks).toEqual(marks);
  });
});
