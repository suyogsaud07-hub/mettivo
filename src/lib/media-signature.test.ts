import { describe, expect, it } from 'vitest';
import { SIGNATURE_BYTES, sniffMediaType } from '@/lib/media-signature';

/**
 * Signature detection must classify by real bytes, because `File.type` is a
 * browser-supplied filename hint and is trivially forged.
 */

function bytes(...values: number[]): Uint8Array {
  const out = new Uint8Array(16);
  values.forEach((value, index) => {
    out[index] = value;
  });
  return out;
}

function ascii(text: string, offset = 0, length = 16): Uint8Array {
  const out = new Uint8Array(16);
  for (let i = 0; i < text.length && offset + i < length; i += 1) {
    out[offset + i] = text.charCodeAt(i);
  }
  return out;
}

function withFtyp(brand: string): Uint8Array {
  const out = ascii('ftyp', 4);
  for (let i = 0; i < brand.length; i += 1) out[8 + i] = brand.charCodeAt(i);
  return out;
}

describe('sniffMediaType', () => {
  it('recognises common image signatures', () => {
    expect(sniffMediaType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image'); // JPEG
    expect(sniffMediaType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image'); // PNG
    expect(sniffMediaType(ascii('GIF89a'))).toBe('image'); // GIF
    expect(sniffMediaType(ascii('RIFF____WEBP'))).toBe('image'); // WebP
  });

  it('recognises video containers', () => {
    expect(sniffMediaType(withFtyp('isom'))).toBe('video'); // MP4
    expect(sniffMediaType(withFtyp('qt  '))).toBe('video'); // QuickTime
    expect(sniffMediaType(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe('video'); // WebM/Matroska
    expect(sniffMediaType(ascii('OggS'))).toBe('video'); // Ogg
  });

  it('returns null for an unknown signature', () => {
    expect(sniffMediaType(ascii('<?php echo'))).toBeNull();
    expect(sniffMediaType(new Uint8Array(16))).toBeNull();
    expect(sniffMediaType(bytes(0x7b, 0x22, 0x61))).toBeNull(); // JSON
  });

  it('exposes how many leading bytes a caller must read', () => {
    expect(SIGNATURE_BYTES).toBe(16);
  });
});
