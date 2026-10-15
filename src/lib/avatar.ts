import { supabase } from '@/lib/supabase';
import { MediaError, isImageFile, prepareMedia } from '@/lib/media';

/**
 * Avatar upload.
 *
 * WHY STORAGE RATHER THAN A DATA URL
 *   The previous handler read the picked file into a base64 `data:` URL and wrote
 *   the whole string into `profiles.avatar_url`. That value then travelled inside
 *   every profile row and every discovery payload — megabytes of base64 where a
 *   stored URL belongs. Uploading to the `avatars` bucket instead keeps the row
 *   small, lets the CDN cache the image, and reuses the same resize pipeline the
 *   Moments composer uses (`prepareMedia`), so a 12 MP phone photo becomes a
 *   ~1920px WebP before it leaves the device.
 *
 * Authorisation is not done here: the bucket policy (M20) requires the first
 * path segment to equal `auth.uid()`, so a forged user id is rejected by the
 * database. This module mirrors that with `<userId>/<uuid>.<ext>`.
 */

/** The Storage bucket the M20 migration creates. */
export const AVATAR_BUCKET = 'avatars';

/** A hard ceiling so an enormous file fails fast and locally. */
const MAX_AVATAR_BYTES = 8 * 1024 * 1024; // 8 MB

/** Raised for expected avatar-upload failures. */
export class AvatarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AvatarError';
  }
}

function extensionFor(blob: Blob): string {
  if (blob.type === 'image/webp') return 'webp';
  if (blob.type === 'image/png') return 'png';
  return 'jpg';
}

/**
 * Removes a previous avatar object when it lived in our own bucket.
 *
 * Best-effort: a stale object is untidy, not an error, and a `data:` URL from an
 * older build has nothing to remove.
 */
async function removePreviousAvatar(previousUrl: string | null | undefined): Promise<void> {
  if (!previousUrl || previousUrl.startsWith('data:')) return;

  const marker = `/object/public/${AVATAR_BUCKET}/`;
  const at = previousUrl.indexOf(marker);
  if (at === -1) return;

  const path = previousUrl.slice(at + marker.length).split('?')[0];
  if (!path) return;

  const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([decodeURIComponent(path)]);
  if (error) {
    console.warn('[avatar] could not remove the previous avatar:', error.message);
  }
}

/**
 * Uploads a new profile picture and points `profiles.avatar_url` at it.
 *
 * Returns the public URL so the caller can update its local state without a
 * refetch. `previousUrl` is the currently stored value, removed after the new
 * object is in place.
 */
export async function saveAvatar(
  file: File,
  previousUrl?: string | null
): Promise<string> {
  if (!isImageFile(file)) {
    throw new AvatarError('Please choose an image file for your profile picture.');
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new AvatarError('That image is too large. Please choose one under 8 MB.');
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new AvatarError('You need to be signed in to change your picture.');
  }

  let prepared;
  try {
    prepared = await prepareMedia(file);
  } catch (err) {
    throw new AvatarError(err instanceof MediaError ? err.message : 'That image could not be read.');
  }

  if (prepared.mediaType !== 'image') {
    throw new AvatarError('Please choose an image file for your profile picture.');
  }

  const path = `${user.id}/${crypto.randomUUID()}.${extensionFor(prepared.blob)}`;
  const contentType = prepared.blob.type || 'image/jpeg';

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, prepared.blob, { contentType, upsert: false, cacheControl: '31536000' });

  if (uploadError) {
    console.error('[avatar] upload failed:', uploadError.message);
    throw new AvatarError(uploadError.message);
  }

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const publicUrl = data?.publicUrl;
  if (!publicUrl) {
    throw new AvatarError('The upload finished but no image URL was returned.');
  }

  // Upsert, not a bare update: the row may not exist yet for a brand-new member
  // (AGENTS.md hard constraint 6). Only `avatar_url` is named, so nothing else
  // on the profile is touched.
  const { error: saveError } = await supabase
    .from('profiles')
    .upsert({ id: user.id, avatar_url: publicUrl }, { onConflict: 'id' });

  if (saveError) {
    console.error('[avatar] profile update failed:', saveError.message);
    throw new AvatarError(`Your picture uploaded but we could not save it: ${saveError.message}`);
  }

  await removePreviousAvatar(previousUrl);

  return publicUrl;
}
