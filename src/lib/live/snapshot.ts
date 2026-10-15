/**
 * Capturing one frame of a live stream as report evidence.
 *
 * WHY A STILL FRAME
 *   A report about a live call needs something a moderator — or the vision
 *   worker — can actually look at after the call is over. The peer's stream is
 *   gone the moment either side hangs up, so the only honest evidence is a frame
 *   grabbed at the instant the member taps Report. This module takes the stream
 *   the caller already holds (never the camera, never the peer connection) and
 *   returns a bounded JPEG data URL.
 *
 * The output is deliberately small: the M21 `reports.evidence_image` guard
 * rejects anything over 600 000 characters, and a 720px-wide JPEG at quality 0.7
 * stays well under that while remaining legible.
 */

export interface CaptureFrameOptions {
  /** Downscale so the long edge is at most this many pixels. Default 720. */
  maxWidth?: number;
  /** JPEG quality, 0–1. Default 0.7. */
  quality?: number;
  /** How long to wait for a first frame before giving up. Default 1500 ms. */
  timeoutMs?: number;
}

/**
 * Draws the current frame of `stream` onto a canvas and returns a JPEG data URL,
 * or `null` when there is no video track or no frame could be read. It never
 * throws for a normal failure — a member must be able to file a report even when
 * the capture comes back empty.
 */
export async function captureStreamFrame(
  stream: MediaStream,
  options: CaptureFrameOptions = {}
): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  if (!stream || stream.getVideoTracks().length === 0) return null;

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;

  try {
    await video.play().catch(() => undefined);

    if (!video.videoWidth) {
      await waitForFirstFrame(video, options.timeoutMs ?? 1500);
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;

    const maxWidth = options.maxWidth ?? 720;
    const scale = width > maxWidth ? maxWidth / width : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const context = canvas.getContext('2d');
    if (!context) return null;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', options.quality ?? 0.7);
  } catch (err) {
    console.warn('[live] snapshot capture failed:', err);
    return null;
  } finally {
    video.pause();
    video.srcObject = null;
  }
}

/** Resolves when the element reports a frame, or after `timeoutMs`. */
function waitForFirstFrame(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('loadeddata', finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    video.addEventListener('loadeddata', finish);
  });
}
