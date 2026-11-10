import { supabase } from '@/lib/supabase';

/**
 * Client-side media pipeline for Flatmate Find photo galleries.
 *
 * Flatmate photos are entirely independent of the dating profile gallery and of
 * Moments media. They live in the private `flatmate-media` Storage bucket under
 * `{userId}/{category}/{uuid}.jpg`. Bucket policy requires the first path
 * segment to equal `auth.uid()`, so a member can never write into or overwrite
 * another member's gallery. Nothing here is trusted for authorisation.
 */

/** Raised for expected flatmate media failures (bad type, too large, upload failed). */
export class FlatmateMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlatmateMediaError';
  }
}

/** The Storage bucket the M54 migration creates. */
export const FLATMATE_MEDIA_BUCKET = 'flatmate-media';

/** Maximum photos per flatmate gallery. */
export const MAX_FLATMATE_PHOTOS = 12;

/** Hard ceiling for an uploaded photo. */
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB

/** The longest edge an uploaded photo is resized down to. */
const MAX_IMAGE_DIMENSION = 1600;

/** Encoder quality for the resized image. */
const IMAGE_QUALITY = 0.9;

/** A file that has been validated and is ready to upload. */
export interface PreparedFlatmatePhoto {
  blob: Blob;
  /** A local object URL for an instant preview; revoke with `releaseFlatmatePhoto`. */
  previewUrl: string;
  width?: number;
  height?: number;
  size: number;
}

/** Whether a file is an image. */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/** Allowed image MIME types. */
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Validate and (for images) optimize a photo the member picked. */
export async function prepareFlatmatePhoto(file: File): Promise<PreparedFlatmatePhoto> {
  if (!isImageFile(file)) {
    throw new FlatmateMediaError('Only images are supported. Choose a JPEG, PNG or WEBP.');
  }
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new FlatmateMediaError('That image type is not supported. Choose a JPEG, PNG or WEBP.');
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new FlatmateMediaError('That photo is too large. Please choose one under 8 MB.');
  }

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
    throw new FlatmateMediaError('Your browser could not process this image.');
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await encodeCanvas(canvas);
  return { blob, previewUrl: URL.createObjectURL(blob), width, height, size: blob.size };
}

/** Releases the object URL backing a preview. */
export function releaseFlatmatePhoto(photo: PreparedFlatmatePhoto | null): void {
  if (photo) URL.revokeObjectURL(photo.previewUrl);
}

/**
 * Uploads a prepared photo under the member's own category folder and returns
 * its public URL. The path is `{userId}/{category}/{uuid}.jpg`; the bucket
 * policy requires the first segment to equal `auth.uid()`.
 */
export async function uploadFlatmatePhoto(
  photo: PreparedFlatmatePhoto,
  userId: string,
  category: string
): Promise<string> {
  const path = `${userId}/${category}/${crypto.randomUUID()}.jpg`;
  const contentType = photo.blob.type || 'image/jpeg';

  const { error } = await supabase.storage
    .from(FLATMATE_MEDIA_BUCKET)
    .upload(path, photo.blob, { contentType, upsert: false, cacheControl: '31536000' });

  if (error) {
    console.error('[flatmate-media] upload failed:', error.message);
    throw new FlatmateMediaError(error.message);
  }

  const { data } = supabase.storage.from(FLATMATE_MEDIA_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    throw new FlatmateMediaError('The upload finished but no URL was returned.');
  }
  return data.publicUrl;
}

/** Delete a photo object from Storage. */
export async function deleteFlatmatePhoto(storagePath: string): Promise<void> {
  const { error } = await supabase.storage.from(FLATMATE_MEDIA_BUCKET).remove([storagePath]);
  if (error) {
    console.error('[flatmate-media] delete failed:', error.message);
    throw new FlatmateMediaError(error.message);
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new FlatmateMediaError('That image could not be read.');
  }
}

async function encodeCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp = await toBlobOrNull(canvas, 'image/webp');
  if (webp) return webp;
  const jpeg = await toBlobOrNull(canvas, 'image/jpeg');
  if (jpeg) return jpeg;
  throw new FlatmateMediaError('Could not encode this image.');
}

function toBlobOrNull(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, IMAGE_QUALITY);
  });
}
