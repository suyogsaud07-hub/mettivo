'use client';

import { useRef, useState } from 'react';

/**
 * A profile's avatar plus gallery photos, with tap zones and independent
 * horizontal gestures.
 *
 * The People card delegates all pointer handling over the photo area to this
 * component (`data-photo-nav`). A horizontal gesture here changes the photo; it
 * never reaches the card's Like/Pass drag handler. A tap on the left/right half
 * performs the same change for keyboard and assistive-technology users.
 */
export interface ProfilePhotoCarouselProps {
  name: string;
  avatarUrl: string | null;
  photos: readonly string[];
  online: boolean;
}

/** The avatar is the primary image; up to four gallery photos follow it. */
export function profilePhotos(avatarUrl: string | null, photos: readonly string[]): string[] {
  const unique: string[] = [];
  for (const url of [avatarUrl, ...photos]) {
    if (typeof url === 'string' && url.length > 0 && !unique.includes(url)) unique.push(url);
  }
  return unique.slice(0, 5);
}

export default function ProfilePhotoCarousel({
  name,
  avatarUrl,
  photos,
  online,
}: ProfilePhotoCarouselProps) {
  const urls = profilePhotos(avatarUrl, photos);
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const pointerStart = useRef<number | null>(null);
  const suppressClick = useRef(false);

  const current = urls[active];
  const showFallback = !current || failed.has(current);

  const go = (delta: number) => {
    setActive((index) => Math.max(0, Math.min(urls.length - 1, index + delta)));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerStart.current = event.clientX;
    suppressClick.current = false;
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerStart.current === null) return;
    const delta = event.clientX - pointerStart.current;
    pointerStart.current = null;

    if (Math.abs(delta) < 36) return;
    suppressClick.current = true;
    go(delta < 0 ? 1 : -1);
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  };

  return (
    <div
      data-photo-nav
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown(event);
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        onPointerUp(event);
      }}
      onPointerCancel={() => {
        pointerStart.current = null;
      }}
      style={{ ...styles.frame, touchAction: 'pan-y' }}
    >
      {showFallback ? (
        <div style={styles.fallback} aria-label={`${name} has no photo`}>
          <span style={styles.initial}>{name.trim().charAt(0).toUpperCase() || 'M'}</span>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={current}
          alt={`${name}, photo ${active + 1} of ${urls.length}`}
          draggable={false}
          loading={active === 0 ? 'eager' : 'lazy'}
          onError={() => {
            setFailed((currentFailed) => new Set(currentFailed).add(current));
          }}
          style={styles.image}
        />
      )}

      {urls.length > 1 && (
        <>
          <div style={styles.progress} aria-hidden="true">
            {urls.map((url, index) => (
              <span
                key={`${url}-${index}`}
                style={{
                  ...styles.progressTrack,
                  backgroundColor:
                    index === active ? '#F2E9E4' : 'rgba(242, 233, 228, 0.34)',
                }}
              />
            ))}
          </div>

          <button
            type="button"
            data-photo-nav
            aria-label="Previous photo"
            disabled={active === 0}
            onClick={(event) => {
              event.stopPropagation();
              if (!suppressClick.current) go(-1);
            }}
            style={{ ...styles.zone, left: 0, cursor: active === 0 ? 'default' : 'pointer' }}
          />
          <button
            type="button"
            data-photo-nav
            aria-label="Next photo"
            disabled={active === urls.length - 1}
            onClick={(event) => {
              event.stopPropagation();
              if (!suppressClick.current) go(1);
            }}
            style={{
              ...styles.zone,
              right: 0,
              cursor: active === urls.length - 1 ? 'default' : 'pointer',
            }}
          />
        </>
      )}

      <div style={styles.scrim} aria-hidden="true" />
      {online && (
        <div style={styles.presence}>
          <span style={styles.onlineDot} aria-hidden="true" />
          <span>Online now</span>
        </div>
      )}
    </div>
  );
}

const styles = {
  frame: {
    position: 'relative' as const,
    width: '100%',
    aspectRatio: '4 / 5',
    maxHeight: '58vh',
    overflow: 'hidden',
    backgroundColor: '#211A27',
  },
  image: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    display: 'block',
    userSelect: 'none' as const,
  },
  fallback: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(145deg, #3A2530 0%, #17121C 70%)',
  },
  initial: {
    fontSize: '72px',
    fontWeight: 800,
    color: '#D8B38A',
    opacity: 0.9,
  },
  progress: {
    position: 'absolute' as const,
    top: '12px',
    left: '12px',
    right: '12px',
    display: 'flex',
    gap: '5px',
    zIndex: 3,
  },
  progressTrack: {
    flex: 1,
    height: '3px',
    borderRadius: '999px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
  },
  zone: {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    width: '45%',
    zIndex: 2,
    background: 'transparent',
    border: 0,
    padding: 0,
  },
  scrim: {
    position: 'absolute' as const,
    inset: 0,
    zIndex: 1,
    background:
      'linear-gradient(180deg, rgba(13,10,16,0.08) 0%, rgba(13,10,16,0) 48%, rgba(13,10,16,0.72) 100%)',
    pointerEvents: 'none' as const,
  },
  presence: {
    position: 'absolute' as const,
    left: '16px',
    bottom: '14px',
    zIndex: 4,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 10px',
    borderRadius: '999px',
    backgroundColor: 'rgba(19, 16, 23, 0.72)',
    color: '#F2E9E4',
    fontSize: '11px',
    fontWeight: 700,
    backdropFilter: 'blur(8px)',
  },
  onlineDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: '#34D399',
    boxShadow: '0 0 0 3px rgba(52, 211, 153, 0.16)',
  },
};
