'use client';

import { useEffect, useRef } from 'react';

/**
 * A `<video>` that is bound to a live `MediaStream`.
 *
 * A tiny component rather than a hook because the binding has to happen against
 * a real DOM node: `srcObject` cannot be set in JSX, it must be assigned after
 * mount and cleared on unmount (otherwise a stopped stream keeps a reference and
 * the camera light can stay on). Both the remote feed, the local preview and the
 * permission preview use this one implementation so they cannot drift.
 */

export interface VideoCanvasProps {
  stream: MediaStream | null;
  muted?: boolean;
  /** Mirror the preview (front camera), never the remote feed. */
  mirror?: boolean;
  style?: React.CSSProperties;
  testId?: string;
  label?: string;
}

export default function VideoCanvas({
  stream,
  muted = false,
  mirror = false,
  style,
  testId,
  label,
}: VideoCanvasProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    if (stream) {
      // Autoplay can still be rejected; that is not an error worth surfacing.
      void element.play().catch(() => undefined);
    }
    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      data-testid={testId}
      aria-label={label}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: mirror ? 'scaleX(-1)' : undefined,
        backgroundColor: '#0d0a10',
        display: 'block',
        ...style,
      }}
    />
  );
}
