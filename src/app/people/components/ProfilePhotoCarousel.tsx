/* eslint-disable @next/next/no-img-element */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';

interface ProfilePhotoCarouselProps {
  photos: string[];
  avatarUrl: string | null;
  alt: string;
  fullScreen?: boolean;
}

export default function ProfilePhotoCarousel({
  photos,
  avatarUrl,
  alt,
  fullScreen = false,
}: ProfilePhotoCarouselProps) {
  const allPhotos = useMemo(
    () => (photos && photos.length > 0 ? photos : avatarUrl ? [avatarUrl] : []),
    [photos, avatarUrl]
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const touchStartTimeRef = useRef<number>(0);

  const hasMultiple = allPhotos.length > 1;

  useEffect(() => {
    if (!hasMultiple) return;
    const neighbors = [currentIndex - 1, currentIndex, currentIndex + 1].filter(
      (i) => i >= 0 && i < allPhotos.length
    );
    neighbors.forEach((i) => {
      const img = new Image();
      img.src = allPhotos[i];
    });
  }, [currentIndex, allPhotos, hasMultiple]);

  const goToPrevious = useCallback(() => {
    if (!hasMultiple) return;
    setCurrentIndex((prev) => (prev === 0 ? allPhotos.length - 1 : prev - 1));
  }, [allPhotos.length, hasMultiple]);

  const goToNext = useCallback(() => {
    if (!hasMultiple) return;
    setCurrentIndex((prev) => (prev === allPhotos.length - 1 ? 0 : prev + 1));
  }, [allPhotos.length, hasMultiple]);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
    setIsDragging(true);
    touchStartTimeRef.current = Date.now();
  };

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartX === null) {
        setIsDragging(false);
        return;
      }
      const diff = e.changedTouches[0].clientX - touchStartX;
      const threshold = 50;

      if (diff > threshold) {
        goToPrevious();
      } else if (diff < -threshold) {
        goToNext();
      }

      setTouchStartX(null);
      setIsDragging(false);
    },
    [touchStartX, goToPrevious, goToNext]
  );

  const handleClick = (e: React.MouseEvent, side: 'left' | 'right') => {
    if (e.target instanceof HTMLElement && e.target.closest('button, a')) return;
    e.stopPropagation();
    if (side === 'left') goToPrevious();
    else goToNext();
  };

  if (allPhotos.length === 0) {
    return (
      <div
        className={`w-full ${
          fullScreen ? 'h-[70vh] max-h-[75vh]' : 'aspect-video'
        } bg-[#1C1822] border border-[#34283F]/40 rounded-3xl overflow-hidden flex items-center justify-center relative`}
      >
        <div className="text-6xl">👤</div>
      </div>
    );
  }

  return (
    <div
      className={`w-full ${
        fullScreen ? 'h-[70vh] max-h-[75vh]' : 'aspect-video'
      } relative overflow-hidden rounded-3xl bg-[#1C1822] border border-[#34283F]/40`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <motion.div
        className="absolute inset-0"
        initial={{ x: 0 }}
        animate={{ x: -currentIndex * 100 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        {allPhotos.map((photo, i) => (
          <img
            key={i}
            src={photo}
            alt={`${alt}, photo ${i + 1} of ${allPhotos.length}`}
            className="w-full h-full object-cover"
            loading={i === 0 ? 'eager' : 'lazy'}
            decoding="async"
            onError={(e) => {
              const el = e.target as HTMLImageElement;
              el.style.display = 'none';
            }}
            style={{ flex: '0 0 100%', minWidth: '100%', height: '100%', display: 'block' }}
          />
        ))}
      </motion.div>

      {hasMultiple && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/10">
          <span className="text-xs font-medium text-[#F2E9E4]">{currentIndex + 1}</span>
          <span className="text-xs text-[#B58A83]">of</span>
          <span className="text-xs font-medium text-[#F2E9E4]">{allPhotos.length}</span>
        </div>
      )}

      <button
        type="button"
        aria-label="Previous photo"
        className="absolute left-0 top-0 bottom-0 w-[30%] z-20 bg-transparent hover:bg-white/5 active:bg-white/10"
        onClick={(e) => handleClick(e, 'left')}
      />
      <button
        type="button"
        aria-label="Next photo"
        className="absolute right-0 top-0 bottom-0 w-[70%] z-20 bg-transparent hover:bg-white/5 active:bg-white/10"
        onClick={(e) => handleClick(e, 'right')}
      />

      {hasMultiple && !isDragging && currentIndex === 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1 text-[#B58A83]/70 text-xs animate-pulse">
          <span className="text-[#F2E9E4]/60">Swipe to browse photos</span>
        </div>
      )}
    </div>
  );
}
