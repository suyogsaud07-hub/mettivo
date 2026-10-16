'use client';

import { useEffect, useRef, useState } from 'react';
import PhotoCropperModal from '@/app/components/verification/PhotoCropperModal';
import {
  submitPhoto,
  VerificationError,
  type VerificationGender,
} from '@/lib/verification/client';

/**
 * The final onboarding step: strict photo verification.
 *
 * One distinct profile picture (adjusted with the cropper) and exactly four
 * distinct gallery photos. Every image is sent to the server, which classifies
 * it against the member's verified live selfie and rejects anything that is not
 * a human, is not the same person, or does not match the verified gender — so
 * pets, objects, landscapes and stock images never reach the profile.
 *
 * Only verified images are ever reported upward, which means the payload the
 * wizard saves contains exactly the photos the database has a passing check for.
 */

interface PhotoVerificationStepProps {
  gender: VerificationGender;
  selfieUrl: string;
  initialAvatarUrl: string;
  initialPhotos: string[];
  onProgress: (next: { avatarUrl: string; photos: string[]; ready: boolean }) => void;
}

const GALLERY_TARGET = 4;

export default function PhotoVerificationStep({
  gender,
  selfieUrl,
  initialAvatarUrl,
  initialPhotos,
  onProgress,
}: PhotoVerificationStepProps) {
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const [avatar, setAvatar] = useState<string>(initialAvatarUrl);
  const [gallery, setGallery] = useState<string[]>(initialPhotos.slice(0, GALLERY_TARGET));
  const [cropperSrc, setCropperSrc] = useState<string | null>(null);
  const [busyAvatar, setBusyAvatar] = useState(false);
  const [busyGallery, setBusyGallery] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = avatar.length > 0 && gallery.length === GALLERY_TARGET;

  // Report verified state up. The callback is kept in a ref so that a parent
  // re-render (which happens on every `onProgress`) never re-fires this effect
  // and loops. The report itself only fires when the verified set changes.
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    onProgressRef.current({ avatarUrl: avatar, photos: gallery, ready });
  }, [avatar, gallery, ready]);

  const verifyImage = async (
    url: string,
    role: 'gallery' | 'avatar'
  ): Promise<{ passed: boolean; reasons: string[] }> => {
    try {
      const result = await submitPhoto(url, selfieUrl, role, gender);
      return { passed: result.passed, reasons: result.reasons };
    } catch (err) {
      throw err instanceof VerificationError ? err : new VerificationError('Verification failed.');
    }
  };

  const handleAvatarFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    fileToDataUrl(file)
      .then((dataUrl) => setCropperSrc(dataUrl))
      .catch(() => setError('That image could not be read.'));
  };

  const handleCroppedAvatar = async (cropped: string) => {
    setCropperSrc(null);
    if (gallery.includes(cropped)) {
      setError('Your profile picture must be different from your gallery photos.');
      return;
    }
    setBusyAvatar(true);
    setError(null);
    try {
      const { passed, reasons } = await verifyImage(cropped, 'avatar');
      if (!passed) {
        setError(photoMessage(reasons, 'profile picture'));
        return;
      }
      setAvatar(cropped);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify your profile picture.');
    } finally {
      setBusyAvatar(false);
    }
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
        const { passed, reasons } = await verifyImage(dataUrl, 'gallery');
        if (!passed) {
          setError(photoMessage(reasons, 'gallery photo'));
          continue;
        }
        next.push(dataUrl);
      }
      setGallery(next.slice(0, GALLERY_TARGET));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify those photos.');
    } finally {
      setBusyGallery(false);
    }
  };

  const busy = busyAvatar || busyGallery;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ fontSize: '22px', fontWeight: 800, color: '#F2E9E4' }}>
        Verify your photos
      </div>
      <div style={{ fontSize: '14px', color: '#B58A83', lineHeight: 1.4 }}>
        Upload one profile picture and exactly four gallery photos. Every photo is checked by AI
        against your verified face — pets, objects, landscapes and stock images are rejected.
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => avatarInputRef.current?.click()}
              style={secondaryButton}
            >
              {busyAvatar ? 'Verifying…' : avatar ? 'Replace & adjust' : 'Upload & adjust'}
            </button>
            {avatar && <span style={{ fontSize: '12px', color: '#34D399' }}>Verified ✓</span>}
          </div>
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
            : 'All four verified ✓'}
        </p>
      </div>

      {error && (
        <div role="alert" style={{ color: '#FCA5B5', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {ready && (
        <div style={{ color: '#34D399', fontSize: '13px', fontWeight: 700 }}>
          All photos verified. You can finish now.
        </div>
      )}

      {cropperSrc && (
        <PhotoCropperModal
          src={cropperSrc}
          shape="circle"
          onCancel={() => setCropperSrc(null)}
          onSave={(dataUrl) => void handleCroppedAvatar(dataUrl)}
        />
      )}
    </div>
  );
}

function photoMessage(reasons: string[], what: string): string {
  if (reasons.includes('not_human')) {
    return 'That image does not show a real person. Please choose a photo of yourself.';
  }
  if (reasons.includes('different_person')) {
    return 'That photo does not match your verified face. Please use a photo of yourself.';
  }
  if (reasons.includes('gender_mismatch')) {
    return 'That photo did not match your verified gender.';
  }
  return `We could not verify that ${what}. Please try a different photo.`;
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
