'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/app/components/ui/Modal';
import { Button } from '@/app/components/ui/Button';
import {
  ChatMediaError,
  isGone,
  redeemChatMedia,
  releaseChatMedia,
  viewsRemaining,
} from '@/lib/chatMedia';
import type { ChatMediaRow } from '@/lib/types';
import { ReportButton } from '@/app/components/moderation/ReportButton';

/**
 * One disappearing chat media bubble (M26: strict two views).
 *
 * The bytes are fetched ONLY when the member taps to open, and through
 * `redeemChatMedia()` — which is where a view is counted server-side. Rendering
 * a thumbnail eagerly would defeat the whole idea, so nothing is downloaded
 * until asked, and the ledger row (not this component) decides when the item is
 * used up.
 *
 * ANTI-SAVE (best effort on the open web)
 *   * The image is painted onto a `<canvas>` rather than an `<img src>`, so the
 *     browser offers no "Save image as…" entry.
 *   * The context menu, drag-to-desktop and picture-in-picture are disabled.
 *   * The overlay is covered the moment the tab loses focus or is hidden, so a
 *     background capture grabs a shield, not the media.
 *   * A screencast / OS screenshot cannot be prevented by any web page; the copy
 *     below says so instead of implying a guarantee the platform cannot make.
 */

export interface ChatMediaMessageProps {
  media: ChatMediaRow;
  isOwn: boolean;
}

type OpenState = 'idle' | 'loading' | 'open' | 'error';

function stop(event: React.SyntheticEvent): void {
  event.preventDefault();
}

export default function ChatMediaMessage({ media, isOwn }: ChatMediaMessageProps) {
  const [state, setState] = useState<OpenState>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [urlType, setUrlType] = useState<'image' | 'video'>('image');
  const [remaining, setRemaining] = useState(() => viewsRemaining(media));
  const [shielded, setShielded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Ownership of the object URL is per-render: revoke it whenever it changes or
  // the component unmounts, so a viewed blob does not linger in memory.
  useEffect(() => {
    return () => releaseChatMedia(url);
  }, [url]);

  // Cover the media whenever the tab is hidden or loses focus, and uncover when
  // it returns. This is what stops a screenshot taken from a background tab.
  useEffect(() => {
    const onVisibility = () => setShielded(document.visibilityState === 'hidden');
    const hide = () => setShielded(true);
    const show = () => setShielded(false);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', hide);
    window.addEventListener('focus', show);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', hide);
      window.removeEventListener('focus', show);
    };
  }, []);

  // Paint images to a canvas so no `<img src>` is ever offered for saving.
  useEffect(() => {
    if (state !== 'open' || urlType !== 'image' || !url) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const maxWidth = 720;
      const scale = Math.min(1, maxWidth / image.naturalWidth);
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (context) context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = url;

    return () => {
      cancelled = true;
    };
  }, [state, urlType, url]);

  const gone = isGone(media);
  const usedUp = !isOwn && remaining <= 0;

  const open = async () => {
    if (state === 'loading' || gone || usedUp) return;

    setState('loading');
    setError(null);
    try {
      const result = await redeemChatMedia(media.id);
      if (!result) {
        setError('This media is no longer available.');
        setState('error');
        return;
      }
      releaseChatMedia(url);
      setUrl(result.url);
      setUrlType(result.mediaType);
      setRemaining(result.remaining);
      setState('open');
    } catch (err) {
      setError(err instanceof ChatMediaError ? err.message : 'This media is no longer available.');
      setState('error');
    }
  };

  const close = () => {
    setState('idle');
    releaseChatMedia(url);
    setUrl(null);
  };

  const subtitle = gone
    ? 'Disappeared'
    : state === 'loading'
      ? 'Loading…'
      : isOwn
        ? `Your media · ${remaining} view${remaining === 1 ? '' : 's'} left`
        : usedUp
          ? 'No views left'
          : `Tap to view · ${remaining} view${remaining === 1 ? '' : 's'} left`;

  return (
    <div className="flex flex-col gap-1" onContextMenu={stop} onDragStart={stop}>
      <button
        type="button"
        onClick={open}
        disabled={gone || usedUp || state === 'loading'}
        className="flex items-center gap-2 rounded-2xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-left text-sm text-neutral-200 hover:border-neutral-500 disabled:opacity-60"
      >
        <span aria-hidden className="text-lg">
          {media.media_type === 'video' ? '🎬' : '🖼️'}
        </span>
        <span className="flex flex-col">
          <span className="font-medium">{isOwn ? 'Your media' : 'Photo or video'}</span>
          <span className="text-xs text-neutral-500">{subtitle}</span>
        </span>
      </button>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      <Modal isOpen={state === 'open'} onClose={close} title="Media" width="md">
        <div
          className="relative flex flex-col items-center gap-3 select-none"
          onContextMenu={stop}
          onDragStart={stop}
        >
          {url && urlType === 'video' && (
            <video
              src={url}
              controls
              autoPlay
              playsInline
              disablePictureInPicture
              disableRemotePlayback
              controlsList="nodownload noplaybackrate noremoteplayback"
              onContextMenu={stop}
              onDragStart={stop}
              className="max-h-[70vh] w-full rounded-xl"
            />
          )}
          {url && urlType === 'image' && (
            <canvas
              ref={canvasRef}
              aria-label="Shared media"
              className="max-h-[70vh] w-full rounded-xl object-contain"
            />
          )}

          {shielded && (
            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-neutral-950/95 text-sm text-neutral-400">
              Media hidden while the tab is not focused
            </div>
          )}

          <p className="text-center text-xs text-amber-300">
            Disappears after {media.view_limit} views. Saving is disabled, but a screenshot can
            still be taken on some devices.
          </p>
          <div className="flex w-full justify-end">
            <Button variant="ghost" type="button" onClick={close}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/**
 * A compact report affordance for a media message. Kept here so the bubble and
 * its report control travel together, and the report points at the exact
 * message the media belongs to.
 */
export function ChatMediaReport({ media }: { media: ChatMediaRow }) {
  return (
    <ReportButton
      targetUserId={media.sender_id}
      targetType="message"
      targetId={media.message_id}
      title="Report this media"
      ariaLabel="Report this media"
      className="mb-1"
    />
  );
}
