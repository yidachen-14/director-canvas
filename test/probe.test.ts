import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { aspectLabel, formatBitrate, formatBytes, probeVideo, snapFrameRate } from '../src/cards/media-probe';

describe('video probe', () => {
  it('reads codec, size, frame rate and audio from an MP4', () => {
    const buf = readFileSync(new URL('./fixtures/sample.mp4', import.meta.url));
    const p = probeVideo((o, l) => new Uint8Array(buf.buffer, buf.byteOffset + o, Math.max(0, Math.min(l, buf.length - o))), buf.length)!;
    expect(p.brand).toBe('isom');
    const v = p.tracks.find(x => x.kind === 'video')!;
    expect(v).toMatchObject({ codec: 'H.264 (AVC)', width: 640, height: 360, frames: 72, frameRate: 23.976 });
    const a = p.tracks.find(x => x.kind === 'audio')!;
    expect(a).toMatchObject({ codec: 'AAC', channels: 2, sampleRate: 48000 });
  });
  it('formats', () => {
    expect(aspectLabel(1920, 1080)).toBe('16:9');
    expect(aspectLabel(1080, 1080)).toBe('1:1');
    expect(snapFrameRate(29.9701)).toBe(29.97);
    expect(formatBytes(1536)).toBe('1.50 KB');
    expect(formatBitrate(2_500_000)).toBe('2.50 Mbps');
  });
});
