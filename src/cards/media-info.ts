import { FileSystemAdapter, Modal, type App, type TFile } from 'obsidian';
import { t } from '../i18n';
import { aspectLabel, formatBitrate, formatBytes, probeVideo, type VideoProbe } from './media-probe';
import { formatTime } from './video-data';

type NodeFs = typeof import('fs');

function nodeFs(): NodeFs | null {
  const req = (window as unknown as { require?: (id: string) => unknown }).require;
  try { return req ? (req('fs') as NodeFs) : null; } catch { return null; }
}

/** Read a video's container details straight from disk (desktop), a few kilobytes at a time. */
function probeFile(app: App, file: TFile): VideoProbe | null {
  const fs = nodeFs();
  const adapter = app.vault.adapter;
  if (!fs || typeof FileSystemAdapter === 'undefined' || !(adapter instanceof FileSystemAdapter)) return null;
  let fd = -1;
  try {
    fd = fs.openSync(adapter.getFullPath(file.path), 'r');
    const read = (offset: number, length: number): Uint8Array => {
      const buf = new Uint8Array(Math.max(0, length));
      const n = fs.readSync(fd, buf, 0, buf.length, offset);
      return buf.subarray(0, n);
    };
    return probeVideo(read, file.stat.size);
  } catch {
    return null;
  } finally {
    if (fd >= 0) fs.closeSync(fd);
  }
}

/** Without direct disk access (phones and tablets): read the whole file, when it isn't too big. */
async function probeWhole(app: App, file: TFile): Promise<VideoProbe | null> {
  if (file.stat.size > 512 * 1024 * 1024) return null;
  try {
    const bytes = new Uint8Array(await app.vault.readBinary(file));
    return probeVideo((offset, length) => bytes.subarray(offset, Math.min(bytes.length, offset + Math.max(0, length))), bytes.length);
  } catch {
    return null;
  }
}

/** What the picture or video itself reports (works for any format the board can show). */
export interface Shown { width: number; height: number; duration?: number }

/** The details of a picture or video: size, proportions, frame rate, bit rate, codecs. */
export class MediaInfoModal extends Modal {
  constructor(app: App, private file: TFile, private kind: 'image' | 'video', private shown: Shown | null) { super(app); }

  onOpen(): void { void this.render(); }

  private async render(): Promise<void> {
    this.titleEl.setText(t('Information'));
    this.modalEl.addClass('vc-info-modal');
    const table = this.contentEl.createDiv('vc-info');
    const section = (title: string) => table.createDiv({ cls: 'vc-info-section', text: title });
    const row = (label: string, value: string | undefined) => {
      if (!value) return;
      table.createDiv({ cls: 'vc-info-label', text: label });
      table.createDiv({ cls: 'vc-info-value', text: value });
    };
    const f = this.file;
    section(t('File'));
    row(t('Name'), f.name);
    row(t('Location'), f.parent?.path && f.parent.path !== '/' ? f.parent.path : t('Vault root'));
    row(t('Format'), f.extension.toUpperCase());
    row(t('File size'), formatBytes(f.stat.size));
    row(t('Modified'), new Date(f.stat.mtime).toLocaleString());

    const w = this.shown?.width ?? 0, h = this.shown?.height ?? 0;
    if (this.kind === 'image') {
      section(t('Picture'));
      if (w && h) {
        row(t('Original size'), `${w} × ${h} px`);
        row(t('Aspect ratio'), aspectLabel(w, h));
        row(t('Megapixels'), `${((w * h) / 1e6).toFixed(2)} MP`);
      }
      return;
    }

    const probe = nodeFs() ? probeFile(this.app, f) : await probeWhole(this.app, f);
    if (!this.contentEl.isConnected) return;
    const video = probe?.tracks.find(x => x.kind === 'video');
    const audio = probe?.tracks.find(x => x.kind === 'audio');
    const vw = video?.width || w, vh = video?.height || h;
    const duration = probe?.duration || video?.duration || this.shown?.duration || 0;
    section(t('Video'));
    if (vw && vh) {
      row(t('Original size'), `${vw} × ${vh} px`);
      row(t('Aspect ratio'), aspectLabel(vw, vh));
    }
    if (duration) row(t('Duration'), formatTime(duration));
    if (video?.frameRate) row(t('Frame rate'), `${video.frameRate} fps`);
    if (video?.frames) row(t('Frames'), String(video.frames));
    row(t('Video codec'), video?.codec);
    if (video?.bitrate) row(t('Video bit rate'), formatBitrate(video.bitrate));
    if (duration) row(t('Overall bit rate'), formatBitrate((f.stat.size * 8) / duration));
    if (probe?.brand) row(t('Container'), probe.brand.trim());
    if (audio) {
      section(t('Audio'));
      row(t('Audio codec'), audio.codec);
      if (audio.sampleRate) row(t('Sample rate'), `${(audio.sampleRate / 1000).toFixed(1)} kHz`);
      if (audio.channels) row(t('Channels'), audio.channels === 1 ? t('Mono sound') : audio.channels === 2 ? t('Stereo') : String(audio.channels));
      if (audio.bitrate) row(t('Audio bit rate'), formatBitrate(audio.bitrate));
    }
    if (!probe) this.contentEl.createDiv({ cls: 'vc-info-note', text: t('Frame rate and codecs are read from MP4 and MOV files.') });
  }

  onClose(): void { this.contentEl.empty(); }
}
