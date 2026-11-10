'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import {
  fetchFlatmatePhotos,
  upsertFlatmatePhoto,
  deleteFlatmatePhotoRecord,
  reorderFlatmatePhotos,
  type FlatmatePhoto,
} from '@/lib/flatmate';
import {
  prepareFlatmatePhoto,
  uploadFlatmatePhoto,
  releaseFlatmatePhoto,
  FlatmateMediaError,
  type PreparedFlatmatePhoto,
} from '@/lib/flatmate-media';

/** Gallery categories offered to members offering a room (Have a Flat). */
const HAVE_A_FLAT_CATEGORIES: { id: string; label: string }[] = [
  { id: 'bedroom', label: 'Bedroom' },
  { id: 'bathroom', label: 'Bathroom' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'living_room', label: 'Living room' },
  { id: 'balcony', label: 'Balcony' },
  { id: 'exterior', label: 'Property exterior' },
  { id: 'pets', label: 'Pets' },
  { id: 'facilities', label: 'Other facilities' },
  { id: 'personal_intro', label: 'Personal introduction' },
];

/** Gallery categories offered to members looking for a room (Need a Flat). */
const NEED_A_FLAT_CATEGORIES: { id: string; label: string }[] = [
  { id: 'personal', label: 'New personal photo' },
  { id: 'lifestyle', label: 'Lifestyle photo' },
  { id: 'additional', label: 'Additional photo' },
];

interface FlatmatePhotoGalleryProps {
  userId: string;
  offeringRoom: boolean;
  lookingForRoom: boolean;
  onChange?: () => void;
}

const MAX_PHOTOS_PER_CATEGORY = 6;

export default function FlatmatePhotoGallery({
  userId,
  offeringRoom,
  lookingForRoom,
  onChange,
}: FlatmatePhotoGalleryProps) {
  const [photos, setPhotos] = useState<FlatmatePhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<Set<string>>(new Set());
  const cancelledRef = useRef(false);

  const allCategories = [...HAVE_A_FLAT_CATEGORIES, ...NEED_A_FLAT_CATEGORIES].reduce(
    (acc, c) => ({ ...acc, [c.id]: c }),
    {} as Record<string, { id: string; label: string }>
  );

  const categories = (() => {
    const ids = new Set<string>();
    if (offeringRoom) HAVE_A_FLAT_CATEGORIES.forEach((c) => ids.add(c.id));
    if (lookingForRoom) NEED_A_FLAT_CATEGORIES.forEach((c) => ids.add(c.id));
    if (!offeringRoom && !lookingForRoom) {
      NEED_A_FLAT_CATEGORIES.forEach((c) => ids.add(c.id));
    }
    return [...ids].map((id) => allCategories[id]).filter(Boolean);
  })();

  const photosByCategory = useCallback(
    (category: string) =>
      [...photos]
        .filter((p) => p.category === category)
        .sort((a, b) => a.sort_order - b.sort_order),
    [photos]
  );

  useEffect(() => {
    cancelledRef.current = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const fetched = await fetchFlatmatePhotos(userId);
        if (!cancelledRef.current) setPhotos(fetched);
      } catch (err) {
        if (!cancelledRef.current) {
          setError(err instanceof Error ? err.message : 'Could not load gallery photos.');
        }
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    })();
    return () => { cancelledRef.current = true; };
  }, [userId]);

  const handleUpload = useCallback(
    async (categoryId: string, file: File) => {
      setError(null);
      let prepared: PreparedFlatmatePhoto;
      try {
        prepared = await prepareFlatmatePhoto(file);
      } catch (err) {
        setError(err instanceof FlatmateMediaError ? err.message : 'That photo could not be prepared.');
        return;
      }

      const existing = photosByCategory(categoryId);
      if (existing.length >= MAX_PHOTOS_PER_CATEGORY) {
        releaseFlatmatePhoto(prepared);
        setError(`You can add at most ${MAX_PHOTOS_PER_CATEGORY} photos per category.`);
        return;
      }

      setUploading((prev) => new Set([...prev, categoryId]));
      try {
        const publicUrl = await uploadFlatmatePhoto(prepared, userId, categoryId);
        const saved = await upsertFlatmatePhoto({
          category: categoryId,
          storagePath: publicUrl,
          caption: null,
          sortOrder: existing.length,
        });
        if (!cancelledRef.current) {
          setPhotos((prev) => [
            ...prev,
            {
              id: saved.id,
              user_id: userId,
              category: categoryId,
              storage_path: publicUrl,
              caption: null,
              sort_order: existing.length,
              is_visible: true,
              media_type: 'image',
              file_size: prepared.size,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ]);
          onChange?.();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      } finally {
        setUploading((prev) => {
          const next = new Set(prev);
          next.delete(categoryId);
          return next;
        });
        releaseFlatmatePhoto(prepared);
      }
    },
    [userId, onChange, photosByCategory]
  );

  const handleDelete = useCallback(
    async (photo: FlatmatePhoto) => {
      setSaving((prev) => new Set([...prev, photo.id]));
      setError(null);
      try {
        await deleteFlatmatePhotoRecord(photo.id, photo.storage_path);
        setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
        const updated = photosByCategory(photo.category).map((p, idx) => ({ id: p.id, sortOrder: idx }));
        if (updated.length > 0) await reorderFlatmatePhotos(updated);
        onChange?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not delete the photo.');
      } finally {
        setSaving((prev) => {
          const next = new Set(prev);
          next.delete(photo.id);
          return next;
        });
      }
    },
    [onChange, photosByCategory]
  );

  const handleUpdate = useCallback(
    async (photo: FlatmatePhoto, field: 'caption' | 'is_visible' | 'sort_order', value: string | boolean | number) => {
      setSaving((prev) => new Set([...prev, photo.id]));
      setError(null);
      try {
        await upsertFlatmatePhoto({
          photoId: photo.id,
          category: photo.category,
          storagePath: photo.storage_path,
          caption: field === 'caption' ? (value as string) : photo.caption,
          sortOrder: field === 'sort_order' ? (value as number) : photo.sort_order,
          isVisible: field === 'is_visible' ? (value as boolean) : photo.is_visible,
          fileSize: photo.file_size,
        });
        setPhotos((prev) =>
          prev.map((p) => (p.id === photo.id ? { ...p, [field]: value } : p))
        );
        onChange?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update the photo.');
      } finally {
        setSaving((prev) => {
          const next = new Set(prev);
          next.delete(photo.id);
          return next;
        });
      }
    },
    []
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-xs font-bold text-[#B58A83] uppercase tracking-wider">Photos</h2>
        <div className="flex items-center gap-2 text-[#B58A83] text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading gallery…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xs font-bold text-[#B58A83] uppercase tracking-wider">Photos</h2>
      <p className="text-xs text-[#B58A83]">
        Add photos of your home or yourself. Each category can hold up to {MAX_PHOTOS_PER_CATEGORY} photos.
      </p>

      {error && (
        <div className="rounded-xl bg-[#17121A] border border-[#F3A7AD]/30 p-3 text-[#F3A7AD] text-sm">
          {error}
          <button
            type="button"
            onClick={() => {
              setError(null);
              void (async () => {
                const fetched = await fetchFlatmatePhotos(userId);
                if (!cancelledRef.current) setPhotos(fetched);
              })();
            }}
            className="mt-2 underline underline-offset-4 text-xs text-[#D9B38C] hover:text-[#F2E9E4]"
          >
            Try again
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {categories.map((category) => {
          const catPhotos = photosByCategory(category.id);
          return (
            <section
              key={category.id}
              className="rounded-xl bg-[#211A28] border border-[#34283F]/40 p-3 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#B58A83]">{category.label}</span>
                <span className="text-[10px] text-[#6B5B79]">
                  {catPhotos.length}/{MAX_PHOTOS_PER_CATEGORY}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {catPhotos.map((photo) => {
                  const deleting = saving.has(photo.id);
                  return (
                    <div
                      key={photo.id}
                      className="relative group rounded-md overflow-hidden border border-[#34283F]/40 bg-[#17121A]"
                    >
                      <img
                        src={photo.storage_path}
                        alt={photo.caption || category.label}
                        className="w-full h-20 object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                      <button
                        type="button"
                        onClick={() => handleDelete(photo)}
                        disabled={deleting}
                        aria-label={`Delete ${category.label} photo`}
                        className="absolute top-1 right-1 z-10 w-6 h-6 rounded-md bg-[#17121A]/90 flex items-center justify-center text-[#F2E9E4] hover:bg-[#F3A7AD]/20 transition-colors disabled:opacity-50"
                      >
                        <Trash2 size={14} strokeWidth={2} />
                      </button>
                    </div>
                  );
                })}
              </div>

              {catPhotos.length > 0 && (
                <div className="space-y-2 pt-1">
                  {catPhotos.map((photo) => {
                    const updating = saving.has(photo.id);
                    return (
                      <div key={photo.id} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={photo.caption ?? ''}
                          placeholder="Caption"
                          disabled={updating}
                          onChange={(e) => handleUpdate(photo, 'caption', e.target.value)}
                          className="flex-1 px-2 py-1 rounded-md bg-[#17121A] border border-[#34283F]/40 text-[#F2E9E4] text-xs focus:border-[#D9B38C] focus:outline-none disabled:opacity-50"
                        />
                        <label className="flex items-center gap-1 text-[10px] text-[#B58A83]">
                          <input
                            type="checkbox"
                            checked={photo.is_visible}
                            onChange={(e) => handleUpdate(photo, 'is_visible', e.target.checked)}
                            disabled={updating}
                            className="rounded bg-[#211A28] border-[#34283F]/40 text-[#D9B38C] focus:ring-0 disabled:opacity-50"
                          />
                          {photo.is_visible ? 'Visible' : 'Hidden'}
                        </label>
                        <input
                          type="number"
                          value={photo.sort_order}
                          disabled={updating}
                          onChange={(e) =>
                            handleUpdate(photo, 'sort_order', Math.max(0, Number(e.target.value) || 0))
                          }
                          className="w-10 px-2 py-1 rounded-md bg-[#17121A] border border-[#34283F]/40 text-[#F2E9E4] text-xs focus:border-[#D9B38C] focus:outline-none disabled:opacity-50"
                          title="Sort order"
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                disabled={catPhotos.length >= MAX_PHOTOS_PER_CATEGORY || uploading.has(category.id)}
                onClick={() => {
                  const input = document.getElementById(`flatmate-upload-${category.id}`);
                  input?.click();
                }}
                className={`w-full px-3 py-2 rounded-md text-xs border transition-colors ${
                  catPhotos.length >= MAX_PHOTOS_PER_CATEGORY
                    ? 'border-[#34283F]/40 text-[#6B5B79] opacity-50 cursor-not-allowed'
                    : 'border-[#D9B38C]/60 bg-[#D9B38C]/10 text-[#D9B38C] hover:bg-[#D9B38C]/20'
                }`}
              >
                {catPhotos.length >= MAX_PHOTOS_PER_CATEGORY
                  ? 'Category full'
                  : uploading.has(category.id)
                    ? 'Uploading…'
                    : 'Add photo'}
                <input
                  id={`flatmate-upload-${category.id}`}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleUpload(category.id, file);
                    e.target.value = '';
                  }}
                />
              </button>
            </section>
          );
        })}
      </div>
    </div>
  );
}
