import { supabase } from '@/lib/supabase';
import type { MomentMediaType } from '@/lib/types';

/**
 * Client-side media pipeline for Moments.
 *
 * WHY THIS EXISTS
 *   The browser talks straight to Supabase (there is no application server), so
 *   the heavy lifting — resizing a photo before it leaves the device, refusing a
 *   video longer than ten seconds, and writing the object to Storage — all has
 *   to happen here. Doing it client-side keeps Storage small and the feed fast,
 *   and means a member on a slow connection uploads kilobytes, not megabytes.
 *
 * The only server-side rule is in SQL: `record_moment_view()` owns the view
 * counter and the bucket policies scope writes to `<user-id>/…`. Nothing in
 * this module is trusted for authorisation.
 */

/** Raised for expected media failures (unsupported type, too large, upload failed). */
export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaError';
  }
}

/** Videos longer than this are rejected before upload. */
export const MAX_VIDEO_SECONDS = 10;

/** Hard ceiling for a video file, so a huge file fails fast and locally. */
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB

/** The longest edge an uploaded image is resized down to. */
const MAX_IMAGE_DIMENSION = 1920;

/** Encoder quality for the resized image. */
const IMAGE_QUALITY = 0.9;

/** The Storage bucket the migration creates. */
export const MOMENT_MEDIA_BUCKET = 'moment-media';

/** A file that has been validated, preprocessed and is ready to upload. */
export interface PreparedMedia {
  mediaType: MomentMediaType;
  /** The bytes that actually get uploaded (optimized for images). */
  blob: Blob;
  /** A local object URL for an instant preview; revoke with `releaseMedia`. */
  previewUrl: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.m4v', '.ogv'];

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/');
}

/**
 * Whether a URL points at a video.
 *
 * Used both for freshly uploaded media and for rows created before `media_type`
 * existed, where the only signal is the file extension or a `data:` prefix.
 */
export function resolveMediaType(
  mediaType: MomentMediaType | null | undefined,
  url: string | undefined
): MomentMediaType {
  if (mediaType === 'video' || mediaType === 'image') return mediaType;
  if (url) {
    if (url.startsWith('data:video/')) return 'video';
    const clean = url.split('?')[0].toLowerCase();
    if (VIDEO_EXTENSIONS.some((extension) => clean.endsWith(extension))) return 'video';
  }
  return 'image';
}

/** Validates and (for images) optimizes a file the member picked. */
export async function prepareMedia(file: File): Promise<PreparedMedia> {
  if (isImageFile(file)) return prepareImage(file);
  if (isVideoFile(file)) return prepareVideo(file);
  throw new MediaError('That file type is not supported. Choose an image or a short video.');
}

/** Releases the object URL backing a preview, so the blob can be collected. */
export function releaseMedia(media: PreparedMedia | null): void {
  if (media) URL.revokeObjectURL(media.previewUrl);
}

async function prepareImage(file: File): Promise<PreparedMedia> {
  const bitmap = await loadBitmap(file);

  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new MediaError('Your browser could not process this image.');
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await encodeCanvas(canvas);
  return { mediaType: 'image', blob, previewUrl: URL.createObjectURL(blob), width, height };
}

async function prepareVideo(file: File): Promise<PreparedMedia> {
  if (file.size > MAX_VIDEO_BYTES) {
    throw new MediaError('That video is too large. Please choose one under 50 MB.');
  }

  const durationSeconds = await probeVideoDuration(file);
  // A tolerance of a quarter second absorbs container rounding; anything longer
  // is a genuine over-length clip and is refused.
  if (durationSeconds > MAX_VIDEO_SECONDS + 0.25) {
    throw new MediaError(`Videos must be ${MAX_VIDEO_SECONDS} seconds or shorter.`);
  }

  return { mediaType: 'video', blob: file, previewUrl: URL.createObjectURL(file), durationSeconds };
}

/**
 * Uploads prepared media under the member's own folder and returns its public URL.
 *
 * The path is `<userId>/<uuid>.<ext>`; the bucket policy requires the first
 * folder segment to equal `auth.uid()`, so a forged `userId` is rejected by the
 * database, not by this function.
 */
export async function uploadMedia(media: PreparedMedia, userId: string): Promise<string> {
  const extension = extensionFor(media);
  const path = `${userId}/${crypto.randomUUID()}.${extension}`;
  const contentType = media.blob.type || (media.mediaType === 'video' ? 'video/mp4' : 'image/jpeg');

  const { error } = await supabase.storage
    .from(MOMENT_MEDIA_BUCKET)
    .upload(path, media.blob, { contentType, upsert: false, cacheControl: '31536000' });

  if (error) {
    console.error('[media] upload failed:', error.message);
    throw new MediaError(error.message);
  }

  const { data } = supabase.storage.from(MOMENT_MEDIA_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    throw new MediaError('The upload finished but no URL was returned.');
  }
  return data.publicUrl;
}

/** Compact engagement counts: 942, 1.2K, 3.4M. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) {
    const thousands = value / 1000;
    return `${thousands >= 10 ? Math.round(thousands) : Number(thousands.toFixed(1))}K`;
  }
  const millions = value / 1_000_000;
  return `${millions >= 10 ? Math.round(millions) : Number(millions.toFixed(1))}M`;
}

/** `mm:ss` for a video duration badge. */
export function formatDuration(seconds: number | undefined): string {
  if (!Number.isFinite(seconds) || (seconds ?? 0) <= 0) return '0:00';
  const total = Math.round(seconds as number);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new MediaError('That image could not be read.');
  }
}

async function encodeCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  // WebP first (smaller, universally supported in current browsers), JPEG as the
  // fallback for the rare engine that cannot encode WebP.
  const webp = await toBlobOrNull(canvas, 'image/webp');
  if (webp) return webp;

  const jpeg = await toBlobOrNull(canvas, 'image/jpeg');
  if (jpeg) return jpeg;

  throw new MediaError('Could not encode this image.');
}

function toBlobOrNull(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, IMAGE_QUALITY);
  });
}

function probeVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    };

    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      resolve(duration);
    };
    video.onerror = () => {
      cleanup();
      reject(new MediaError('That video could not be read. Try an MP4.'));
    };

    video.src = url;
  });
}

function extensionFor(media: PreparedMedia): string {
  if (media.mediaType === 'video') {
    if (media.blob.type === 'video/webm') return 'webm';
    if (media.blob.type === 'video/quicktime') return 'mov';
    return 'mp4';
  }

  if (media.blob.type === 'image/webp') return 'webp';
  if (media.blob.type === 'image/png') return 'png';
  return 'jpg';
}
