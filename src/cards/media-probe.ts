/**
 * Reads the technical details of a video file (MP4 / MOV / M4V) from its "moov" box, without
 * loading the whole file: codec, frame size, frame rate, bit rates, audio format.
 */

export interface TrackInfo {
  kind: 'video' | 'audio' | 'other';
  codec: string;
  /** Seconds. */
  duration: number;
  width?: number;
  height?: number;
  frameRate?: number;
  frames?: number;
  channels?: number;
  sampleRate?: number;
  /** Bits per second, from the sizes of its samples. */
  bitrate?: number;
}

export interface VideoProbe {
  /** Container brand, e.g. "isom", "qt  ". */
  brand?: string;
  duration: number;
  tracks: TrackInfo[];
}

/** A random-access reader: `read(offset, length)` returns those bytes (fewer at the end). */
export type ReadAt = (offset: number, length: number) => Uint8Array;

const CODECS: Record<string, string> = {
  avc1: 'H.264 (AVC)', avc3: 'H.264 (AVC)', hvc1: 'H.265 (HEVC)', hev1: 'H.265 (HEVC)', av01: 'AV1', vp09: 'VP9', vp08: 'VP8',
  mp4v: 'MPEG-4 Visual', apcn: 'Apple ProRes 422', apch: 'Apple ProRes 422 HQ', apcs: 'Apple ProRes 422 LT', apco: 'Apple ProRes 422 Proxy',
  ap4h: 'Apple ProRes 4444', ap4x: 'Apple ProRes 4444 XQ', jpeg: 'Motion JPEG', mjpa: 'Motion JPEG', dvh1: 'Dolby Vision (HEVC)',
  mp4a: 'AAC', 'ac-3': 'Dolby Digital (AC-3)', 'ec-3': 'Dolby Digital Plus', Opus: 'Opus', alac: 'Apple Lossless', lpcm: 'PCM',
  sowt: 'PCM', twos: 'PCM', in24: 'PCM 24-bit', in32: 'PCM 32-bit', fl32: 'PCM float', '.mp3': 'MP3', fLaC: 'FLAC',
};

export function codecName(fourcc: string): string {
  return CODECS[fourcc] ?? fourcc.trim();
}

const STANDARD_RATES = [23.976, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60, 100, 119.88, 120];

/** A measured frame rate, snapped to the broadcast rate it almost certainly is. */
export function snapFrameRate(fps: number): number {
  const hit = STANDARD_RATES.find(r => Math.abs(r - fps) < 0.02);
  return hit ?? Math.round(fps * 1000) / 1000;
}

function str(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

/** Probe an ISO-BMFF file through `read`. Returns null when it has no readable "moov" box. */
export function probeVideo(read: ReadAt, fileSize: number): VideoProbe | null {
  let offset = 0;
  let brand: string | undefined;
  let moov: Uint8Array | null = null;
  // Walk the top-level boxes until "moov" (it can sit before or after the media data).
  for (let guard = 0; offset + 8 <= fileSize && guard < 1000; guard++) {
    const head = read(offset, 16);
    if (head.length < 8) break;
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let size = dv.getUint32(0);
    const type = str(head, 4);
    let header = 8;
    if (size === 1) {
      if (head.length < 16) break;
      size = Number(dv.getBigUint64(8));
      header = 16;
    } else if (size === 0) size = fileSize - offset;
    if (size < header) break;
    if (type === 'ftyp') brand = str(read(offset + header, 4), 0);
    if (type === 'moov') {
      if (size > 256 * 1024 * 1024) return null;
      moov = read(offset + header, size - header);
      break;
    }
    offset += size;
  }
  if (!moov) return null;
  return parseMoov(moov, brand);
}

interface Box { type: string; start: number; end: number }

function boxes(b: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = [];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = start;
  while (o + 8 <= end) {
    let size = dv.getUint32(o);
    const type = str(b, o + 4);
    let header = 8;
    if (size === 1) { size = Number(dv.getBigUint64(o + 8)); header = 16; } else if (size === 0) size = end - o;
    if (size < header || o + size > end) break;
    out.push({ type, start: o + header, end: o + size });
    o += size;
  }
  return out;
}

const find = (b: Uint8Array, box: Box, type: string): Box | undefined => boxes(b, box.start, box.end).find(x => x.type === type);

function parseMoov(b: Uint8Array, brand?: string): VideoProbe {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const root: Box = { type: 'moov', start: 0, end: b.length };
  let duration = 0;
  const mvhd = find(b, root, 'mvhd');
  if (mvhd) {
    const v = b[mvhd.start];
    const ts = v === 1 ? dv.getUint32(mvhd.start + 20) : dv.getUint32(mvhd.start + 12);
    const du = v === 1 ? Number(dv.getBigUint64(mvhd.start + 24)) : dv.getUint32(mvhd.start + 16);
    if (ts) duration = du / ts;
  }
  const tracks: TrackInfo[] = [];
  for (const trak of boxes(b, 0, b.length).filter(x => x.type === 'trak')) {
    const mdia = find(b, trak, 'mdia');
    if (!mdia) continue;
    const hdlr = find(b, mdia, 'hdlr');
    const handler = hdlr ? str(b, hdlr.start + 8) : '';
    const kind: TrackInfo['kind'] = handler === 'vide' ? 'video' : handler === 'soun' ? 'audio' : 'other';
    const mdhd = find(b, mdia, 'mdhd');
    let tdur = 0;
    if (mdhd) {
      const v = b[mdhd.start];
      const ts = v === 1 ? dv.getUint32(mdhd.start + 20) : dv.getUint32(mdhd.start + 12);
      const du = v === 1 ? Number(dv.getBigUint64(mdhd.start + 24)) : dv.getUint32(mdhd.start + 16);
      if (ts) tdur = du / ts;
    }
    const stbl = (() => { const minf = find(b, mdia, 'minf'); return minf ? find(b, minf, 'stbl') : undefined; })();
    const info: TrackInfo = { kind, codec: '', duration: tdur };
    if (stbl) {
      const stsd = find(b, stbl, 'stsd');
      if (stsd && dv.getUint32(stsd.start + 4) > 0) {
        const e = stsd.start + 8; // first sample entry: size, format
        info.codec = codecName(str(b, e + 4));
        if (kind === 'video') { info.width = dv.getUint16(e + 32); info.height = dv.getUint16(e + 34); }
        if (kind === 'audio') { info.channels = dv.getUint16(e + 24); info.sampleRate = dv.getUint32(e + 32) / 65536; }
      }
      const stts = find(b, stbl, 'stts');
      if (stts) {
        let frames = 0;
        const n = dv.getUint32(stts.start + 4);
        for (let i = 0; i < n; i++) frames += dv.getUint32(stts.start + 8 + i * 8);
        if (kind === 'video') { info.frames = frames; if (tdur) info.frameRate = snapFrameRate(frames / tdur); }
      }
      const stsz = find(b, stbl, 'stsz');
      if (stsz && tdur) {
        const fixed = dv.getUint32(stsz.start + 4);
        const count = dv.getUint32(stsz.start + 8);
        let bytes = fixed * count;
        if (!fixed) for (let i = 0; i < count; i++) bytes += dv.getUint32(stsz.start + 12 + i * 4);
        if (bytes) info.bitrate = (bytes * 8) / tdur;
      }
    }
    tracks.push(info);
  }
  return { brand, duration, tracks };
}

/** "16:9", or the reduced ratio when it isn't a common one. */
export function aspectLabel(w: number, h: number): string {
  if (!w || !h) return '';
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(w, h);
  const rw = w / d, rh = h / d;
  const ratio = w / h;
  const known: [number, string][] = [[16 / 9, '16:9'], [4 / 3, '4:3'], [21 / 9, '21:9'], [2.39, '2.39:1'], [1.85, '1.85:1'], [1, '1:1'], [9 / 16, '9:16'], [3 / 2, '3:2'], [2 / 3, '2:3'], [4 / 5, '4:5'], [3 / 4, '3:4']];
  const hit = known.find(([r]) => Math.abs(r - ratio) < 0.01);
  const exact = rw <= 64 ? `${rw}:${rh}` : '';
  return hit ? (exact && exact !== hit[1] ? `${hit[1]} (${exact})` : hit[1]) : exact || `${ratio.toFixed(3)}:1`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}

export function formatBitrate(bps: number): string {
  return bps >= 1e6 ? `${(bps / 1e6).toFixed(2)} Mbps` : `${Math.round(bps / 1e3)} kbps`;
}
