'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Facebook-style profile-picture adjuster.
 *
 * Drag to reposition, pinch/slider to zoom, then save. The saved image is a
 * square rendered from the exact region currently inside the frame, so what the
 * member sees is what gets verified and stored — the crop is committed before
 * the AI ever sees the photo.
 *
 * The maths is deliberately explicit: the <img> is drawn centred in a square
 * viewport and translated by `offset` at `scale`, and `toSourceRect` inverts
 * exactly that transform to draw the crop. No libraries, no `any`.
 */

interface PhotoCropperModalProps {
  src: string;
  /** Preview shape only; the saved image is always a square. */
  shape?: 'circle' | 'square';
  onCancel: () => void;
  onSave: (dataUrl: string) => void;
}

/** On-screen crop frame, in CSS pixels. */
const VIEWPORT = 300;
/** Saved edge length, in pixels. */
const OUTPUT = 512;

export default function PhotoCropperModal({
  src,
  shape = 'circle',
  onCancel,
  onSave,
}: PhotoCropperModalProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(
    null
  );

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setNatural({ w: image.naturalWidth, h: image.naturalHeight });
    };
    image.onerror = () => setError('That image could not be loaded.');
    image.src = src;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [src]);

  /** Scale that makes the image exactly cover the viewport at zoom 1. */
  const baseScale = useMemo(
    () => (natural ? Math.max(VIEWPORT / natural.w, VIEWPORT / natural.h) : 1),
    [natural]
  );

  const clampOffset = useCallback(
    (next: { x: number; y: number }, forZoom = zoom) => {
      if (!natural) return next;
      const total = baseScale * forZoom;
      const maxX = Math.max(0, (natural.w * total - VIEWPORT) / 2);
      const maxY = Math.max(0, (natural.h * total - VIEWPORT) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, next.x)),
        y: Math.min(maxY, Math.max(-maxY, next.y)),
      };
    },
    [baseScale, natural, zoom]
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset(
      clampOffset({
        x: drag.originX + (event.clientX - drag.startX),
        y: drag.originY + (event.clientY - drag.startY),
      })
    );
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  /** The crop region, in natural image coordinates. */
  const toSourceRect = useCallback(() => {
    if (!natural) return null;
    const total = baseScale * zoom;
    const displayedW = natural.w * total;
    const sourceSize = VIEWPORT / total;
    let sourceX = (displayedW / 2 - VIEWPORT / 2 - offset.x) / total;
    let sourceY = ((natural.h * total) / 2 - VIEWPORT / 2 - offset.y) / total;
    sourceX = Math.min(Math.max(0, sourceX), Math.max(0, natural.w - sourceSize));
    sourceY = Math.min(Math.max(0, sourceY), Math.max(0, natural.h - sourceSize));
    return { sourceX, sourceY, sourceSize };
  }, [baseScale, natural, offset.x, offset.y, zoom]);

  const handleSave = () => {
    const image = imageRef.current;
    const rect = toSourceRect();
    if (!image || !rect) {
      setError('That image could not be processed.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const context = canvas.getContext('2d');
    if (!context) {
      setError('Your browser could not process this image.');
      return;
    }

    context.drawImage(
      image,
      rect.sourceX,
      rect.sourceY,
      rect.sourceSize,
      rect.sourceSize,
      0,
      0,
      OUTPUT,
      OUTPUT
    );

    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      setError('Your browser could not process this image.');
      return;
    }
    onSave(dataUrl);
  };

  const total = natural ? baseScale * zoom : 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Adjust your photo"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        backgroundColor: 'rgba(13,10,16,0.92)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        padding: '20px',
      }}
    >
      <div style={{ color: '#F2E9E4', fontSize: '18px', fontWeight: 800 }}>Adjust your picture</div>
      <div style={{ color: '#B58A83', fontSize: '13px', textAlign: 'center', maxWidth: '320px' }}>
        Drag to reposition and zoom until your face is centred.
      </div>

      {error && (
        <div role="alert" style={{ color: '#FCA5B5', fontSize: '13px' }}>
          {error}
        </div>
      )}

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          width: VIEWPORT,
          height: VIEWPORT,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: shape === 'circle' ? '50%' : '16px',
          border: '2px solid #D4B18A',
          backgroundColor: '#0D0A10',
          touchAction: 'none',
          cursor: 'grab',
        }}
      >
        {natural ? (
          <img
            src={src}
            alt=""
            draggable={false}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: natural.w * total,
              height: natural.h * total,
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#B58A83',
              fontSize: '13px',
            }}
          >
            Loading…
          </div>
        )}
      </div>

      <input
        type="range"
        min={1}
        max={3}
        step={0.01}
        value={zoom}
        aria-label="Zoom"
        onChange={(event) => {
          const nextZoom = Number(event.target.value);
          setZoom(nextZoom);
          setOffset((prev) => clampOffset(prev, nextZoom));
        }}
        style={{ width: VIEWPORT, accentColor: '#D4B18A' }}
      />

      <div style={{ display: 'flex', gap: '12px', width: VIEWPORT }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            flex: 1,
            padding: '14px',
            borderRadius: '30px',
            backgroundColor: '#29202D',
            color: '#B58A83',
            border: 'none',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!natural}
          style={{
            flex: 2,
            padding: '14px',
            borderRadius: '30px',
            backgroundColor: '#D4B18A',
            color: '#17121C',
            border: 'none',
            fontWeight: 800,
            cursor: natural ? 'pointer' : 'not-allowed',
            opacity: natural ? 1 : 0.6,
          }}
        >
          Save picture
        </button>
      </div>
    </div>
  );
}
