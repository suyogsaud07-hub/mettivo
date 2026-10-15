import { describe, expect, it } from 'vitest';
import { captureStreamFrame } from '@/lib/live/snapshot';

/**
 * `captureStreamFrame` is DOM-bound (it needs a canvas), so in the node test
 * environment it can only prove the guard that matters: it returns `null`
 * rather than throwing when it cannot capture. That is the contract the report
 * flow relies on — a report must still be filable with no evidence image.
 */
describe('captureStreamFrame', () => {
  it('returns null when there is no document (server / node)', async () => {
    const stream = { getVideoTracks: () => [{ kind: 'video' }] } as unknown as MediaStream;
    await expect(captureStreamFrame(stream)).resolves.toBeNull();
  });

  it('returns null for a stream with no video track', async () => {
    const stream = { getVideoTracks: () => [] } as unknown as MediaStream;
    await expect(captureStreamFrame(stream)).resolves.toBeNull();
  });

  it('never throws for a null-ish stream', async () => {
    await expect(captureStreamFrame(null as unknown as MediaStream)).resolves.toBeNull();
  });
});
