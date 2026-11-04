'use client';

import { useEffect, useRef, useState } from 'react';
import twemoji from 'twemoji';

/**
 * Parses text and replaces native emoji glyphs with Twemoji images for
 * consistent cross-platform rendering. Non-emoji text is preserved as-is.
 *
 * The twemoji CDN serves the open-source (CC-BY 4.0) Twitter emoji artwork.
 */
interface EmojiTextProps {
  text: string;
  size?: number; // px, defaults to 24
  className?: string;
}

export default function EmojiText({ text, size = 24, className }: EmojiTextProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [parsed, setParsed] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const html = twemoji.parse(text, {
      folder: '.png',
      ext: '.png',
      size: '72x72',
      attributes: () => ({
        width: String(size),
        height: String(size),
        style: 'vertical-align: middle;',
        loading: 'lazy',
      }),
    });
    setParsed(html);
  }, [text, size]);

  if (!parsed) return null;

  return (
    <span
      ref={containerRef}
      className={className}
      dangerouslySetInnerHTML={{ __html: parsed }}
    />
  );
}
