'use client';

import { useEffect, useRef, useState } from 'react';
import PhotoCropperModal from '@/app/components/profile/PhotoCropperModal';

/**
 * The final onboarding step: profile picture and gallery upload.
 *
 * One distinct profile picture (adjusted with the cropper) and exactly four
 * distinct gallery photos. Images are stored as data URLs by the profile
 * payload; no verification service is involved.
 */

interface PhotoUploadStepProps {
  initialAvatarUrl: string;
  initialPhotos: string[];
  onProgress: (next: { avatarUrl: string; photos: string[]; ready: boolean }) => void;
}

const GALLERY_TARGET = 4;

export default function PhotoUploadStep({
  initialAvatarUrl,
  initialPhotos,
  onProgress,
}: PhotoUploadStepProps) {
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const [avatar, setAvatar] = useState<string>(initialAvatarUrl);
  const [gallery, setGallery] = useState<string[]>(initialPhotos.slice(0, GALLERY_TARGET));
  const [cropperSrc, setCropperSrc] = useState<string | null>(null);
  const [busyAvatar, setBusyAvatar] = useState(false);
  const [busyGallery, setBusyGallery] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = avatar.length > 0 && gallery.length === GALLERY_TARGET;

  // Keep the callback in a ref so a parent re-render (which happens on every
  // `onProgress`) never re-fires this effect and loops. The report only fires
  // when the selected set changes.
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    onProgressRef.current({ avatarUrl: avatar, photos: gallery, ready });
  }, [avatar, gallery, ready]);

  const handleAvatarFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setBusyAvatar(true);
    fileToDataUrl(file)
      .then((dataUrl) => setCropperSrc(dataUrl))
      .catch(() => setError('That image could not be read.'))
      .finally(() => setBusyAvatar(false));
  };

  const handleCroppedAvatar = (cropped: string) => {
    setCropperSrc(null);
    if (gallery.includes(cropped)) {
      setError('Your profile picture must be different from your gallery photos.');
      return;
    }
    setError(null);
    setAvatar(cropped);
  };

  const handleGalleryFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    // Snapshot the files BEFORE clearing the input: `input.value = ''` empties
    // the live `FileList`, so reading it afterwards would yield nothing.
    const selected = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (selected.length === 0) return;

    setBusyGallery(true);
    setError(null);
    try {
      const next = [...gallery];
      for (const file of selected) {
        if (next.length >= GALLERY_TARGET) break;
        let dataUrl: string;
        try {
          dataUrl = await fileToDataUrl(file);
        } catch {
          setError('One of those images could not be read.');
          continue;
        }
        if (dataUrl === avatar || next.includes(dataUrl)) {
          setError('Each photo must be different. One was skipped.');
          continue;
        }
        next.push(dataUrl);
      }
      setGallery(next.slice(0, GALLERY_TARGET));
    } finally {
      setBusyGallery(false);
    }
  };

  const busy = busyAvatar || busyGallery;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ fontSize: '22px', fontWeight: 800, color: '#F2E9E4' }}>
        Add your photos
      </div>
      <div style={{ fontSize: '14px', color: '#B58A83', lineHeight: 1.4 }}>
        Upload one profile picture and exactly four gallery photos. You can adjust your profile
        picture before saving.
      </div>

      {/* Profile picture */}
      <div>
        <label style={labelStyle}>Profile picture *</label>
        <input
          type="file"
          accept="image/*"
          ref={avatarInputRef}
          style={{ display: 'none' }}
          onChange={handleAvatarFile}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {avatar ? (
            <img src={avatar} alt="Profile picture" style={avatarStyle} />
          ) : (
            <div
              style={{
                ...avatarStyle,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '26px',
              }}
            >
              👤
            </div>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => avatarInputRef.current?.click()}
            style={secondaryButton}
          >
            {busyAvatar ? 'Opening…' : avatar ? 'Replace & adjust' : 'Upload & adjust'}
          </button>
        </div>
      </div>

      {/* Gallery */}
      <div>
        <label style={labelStyle}>
          Gallery ({gallery.length}/{GALLERY_TARGET}) *
        </label>
        <input
          type="file"
          accept="image/*"
          multiple
          ref={galleryInputRef}
          style={{ display: 'none' }}
          onChange={handleGalleryFiles}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
          {gallery.map((photo, index) => (
            <div key={index} style={{ position: 'relative' }}>
              <img src={photo} alt={`Gallery photo ${index + 1}`} style={thumbStyle} />
              <button
                type="button"
                aria-label={`Remove gallery photo ${index + 1}`}
                onClick={() => setGallery((prev) => prev.filter((_, position) => position !== index))}
                style={removeButton}
              >
                ×
              </button>
            </div>
          ))}

          {gallery.length < GALLERY_TARGET && (
            <button
              type="button"
              aria-label="Add gallery photos"
              disabled={busy}
              onClick={() => galleryInputRef.current?.click()}
              style={addButton}
            >
              {busyGallery ? '…' : '+'}
            </button>
          )}
        </div>
        <p style={{ fontSize: '12px', color: '#B58A83', marginTop: '8px' }}>
          Exactly four distinct photos.{' '}
          {gallery.length < GALLERY_TARGET
            ? `${GALLERY_TARGET - gallery.length} to go.`
            : 'All four photos added.'}
        </p>
      </div>

      {error && (
        <div role="alert" style={{ color: '#FCA5B5', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {ready && (
        <div
          data-testid="photos-ready"
          style={{ color: '#34D399', fontSize: '13px', fontWeight: 700 }}
        >
          Photos ready. You can finish now.
        </div>
      )}

      {cropperSrc && (
        <PhotoCropperModal
          src={cropperSrc}
          shape="circle"
          onCancel={() => setCropperSrc(null)}
          onSave={handleCroppedAvatar}
        />
      )}
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith('data:image/')) {
        resolve(reader.result);
      } else {
        reject(new Error('Unsupported image.'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read the image.'));
    reader.readAsDataURL(file);
  });
}

const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 700,
  color: '#D4B18A',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  display: 'block',
  marginBottom: '6px',
};

const avatarStyle: React.CSSProperties = {
  width: '70px',
  height: '70px',
  borderRadius: '50%',
  objectFit: 'cover',
  backgroundColor: '#0D0A10',
  border: '1px solid #4A1828',
};

const thumbStyle: React.CSSProperties = {
  width: '64px',
  height: '64px',
  borderRadius: '12px',
  objectFit: 'cover',
};

const secondaryButton: React.CSSProperties = {
  backgroundColor: '#29202D',
  color: '#D4B18A',
  border: '1px solid #4A1828',
  padding: '10px 16px',
  borderRadius: '20px',
  cursor: 'pointer',
  fontSize: '13px',
};

const addButton: React.CSSProperties = {
  width: '64px',
  height: '64px',
  borderRadius: '12px',
  border: '1px dashed #4A1828',
  backgroundColor: 'transparent',
  color: '#D4B18A',
  cursor: 'pointer',
  fontSize: '22px',
  lineHeight: 1,
};

const removeButton: React.CSSProperties = {
  position: 'absolute',
  top: '-6px',
  right: '-6px',
  width: '22px',
  height: '22px',
  borderRadius: '50%',
  backgroundColor: '#7F1D2E',
  color: '#F2E9E4',
  border: 'none',
  cursor: 'pointer',
  fontSize: '13px',
  lineHeight: 1,
  padding: 0,
};
