import type { MomentMediaType } from '@/lib/types';

/**
 * Media type detection by magic bytes.
 *
 * A `File.type` string is supplied by the browser and is trivially forged (it is
 * only a filename hint), so a `.jpg` that is really a script, or a video
 * mislabelled as an image, must be caught before it reaches Storage. This module
 * reads the leading bytes and reports what the file actually is.
 *
 * It is intentionally dependency-free and free of browser globals so it can be
 * unit tested against byte arrays.
 */

/** The number of leading bytes any signature below needs. */
export const SIGNATURE_BYTES = 16;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const byte = bytes[offset + i];
    if (byte === undefined) return out;
    out += String.fromCharCode(byte);
  }
  return out;
}

/**
 * The real media type of a file, or `null` when the signature is unknown.
 *
 * `MomentMediaType` is only `image | video`, so an unknown signature returns
 * `null` and the caller refuses the upload rather than guessing.
 */
export function sniffMediaType(bytes: Uint8Array): MomentMediaType | null {
  // Images
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image'; // JPEG
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image'; // PNG
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image'; // GIF87a/GIF89a
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image';
  if (startsWith(bytes, [0x42, 0x4d])) return 'image'; // BMP

  // Video containers
  if (ascii(bytes, 4, 4) === 'ftyp') return 'video'; // MP4 / MOV / M4V (ISO-BMFF)
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video'; // Matroska / WebM
  if (ascii(bytes, 0, 4) === 'OggS') return 'video'; // Ogg (Theora)
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'AVI ') return 'video';

  return null;
}

/**
 * Reads the leading bytes of a file and reports its real media type.
 *
 * `File` and friends live in the DOM; tests pass a byte array straight to
 * `sniffMediaType`, so this thin reader only exists in the browser path.
 */
export async function detectFileMediaType(file: Blob): Promise<MomentMediaType | null> {
  const head = await file.slice(0, SIGNATURE_BYTES).arrayBuffer();
  return sniffMediaType(new Uint8Array(head));
}
