import { describe, it, expect, vi } from 'vitest';
vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }));
vi.mock('obsidian', () => ({ FileSystemAdapter: class {}, Notice: class {}, normalizePath: (p: string) => p }));
import { imagePdf } from '../src/export/raster';
import { resourcePath, toBase64 } from '../src/export/files';

describe('export helpers', () => {
  it('writes a one-page PDF with a correct cross-reference table', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const pdf = imagePdf(jpeg, 10, 20, 100, 200);
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/MediaBox [0 0 100.00 200.00]');
    const start = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(start, start + 4)).toBe('xref');
    // Every object offset points at "n 0 obj".
    const offs = [...text.slice(start).matchAll(/(\d{10}) 00000 n/g)].map(m => Number(m[1]));
    offs.forEach((o, i) => expect(text.slice(o, o + 7)).toBe(`${i + 1} 0 obj`));
  });

  it('finds the file behind an Obsidian resource URL', () => {
    expect(resourcePath('app://abc123/Users/me/Vault/a%20b.png?1700000')).toBe('/Users/me/Vault/a b.png');
    expect(resourcePath('app://abc123/C:/Vault/x.png')).toBe('C:/Vault/x.png');
    expect(resourcePath('https://example.com/x.png')).toBeNull();
  });

  it('base64-encodes large buffers', () => {
    const b = new Uint8Array(100000).map((_, i) => i % 256);
    expect(atob(toBase64(b)).length).toBe(100000);
  });
});
