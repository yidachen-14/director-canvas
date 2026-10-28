import type { RawNode } from '../model/canvas-file';

/** A mark: a point when `out` equals `in`. */
export interface VideoMark { id: string; in: number; out: number; note: string }
export interface VideoData {
  /** The frame shown while the video is not playing; `image` is a still in the plugin cache. */
  cover?: { t: number; image?: string };
  marks?: VideoMark[];
}

export function videoData(n: RawNode): VideoData {
  const v = n.vc?.video;
  return v && typeof v === 'object' ? (v) : {};
}

/** 1:05.24 (or 1:02:05.24) */
export function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(2).padStart(5, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

