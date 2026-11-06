/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import VoiceNoteRecorder from './VoiceNoteRecorder';

// React's act() only opts in when this flag is set in the test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeMediaRecorder {
  state = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    instances.push(this);
  }

  start = vi.fn(function (this: FakeMediaRecorder) {
    this.state = 'recording';
  });
  pause = vi.fn(function (this: FakeMediaRecorder) {
    this.state = 'paused';
  });
  resume = vi.fn(function (this: FakeMediaRecorder) {
    this.state = 'recording';
  });
  stop = vi.fn(function (this: FakeMediaRecorder) {
    this.state = 'inactive';
    this.onstop?.();
  });

  static isTypeSupported = vi.fn(() => true);
}

const instances: FakeMediaRecorder[] = [];

const trackStop = vi.fn();
const fakeStream = {
  getTracks: () => [{ stop: trackStop }],
} as unknown as MediaStream;

const createdUrls: string[] = [];
const revokedUrls: string[] = [];
const createObjectURL = vi.fn(() => {
  const url = `blob:mock-${createdUrls.length}`;
  createdUrls.push(url);
  return url;
});
const revokeObjectURL = vi.fn((url: string) => {
  revokedUrls.push(url);
});

const endedListeners: Array<(() => void) | undefined> = [];
const fakeAudio = {
  src: '',
  currentTime: 0,
  duration: 0,
  paused: true,
  play: vi.fn(() => Promise.resolve()),
  pause: vi.fn(),
  load: vi.fn(),
  addEventListener: vi.fn((type: string, listener: EventListener) => {
    if (type === 'ended') endedListeners.push(listener as () => void);
  }),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(() => true),
};

describe('VoiceNoteRecorder', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let onSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['Date', 'setInterval', 'clearInterval'],
    });
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    instances.length = 0;
    trackStop.mockClear();
    createdUrls.length = 0;
    revokedUrls.length = 0;
    endedListeners.length = 0;
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();

    fakeAudio.src = '';
    fakeAudio.currentTime = 0;
    fakeAudio.paused = true;
    fakeAudio.play.mockClear();
    fakeAudio.pause.mockClear();
    fakeAudio.addEventListener.mockClear();

    FakeMediaRecorder.isTypeSupported.mockReturnValue(true);

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
      writable: true,
    });
    const AudioConstructor = vi.fn(function Audio() {
      return fakeAudio;
    });
    vi.stubGlobal('Audio', AudioConstructor);

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: FakeMediaRecorder,
      writable: true,
    });

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => fakeStream) },
      writable: true,
    });

    onSend = vi.fn<(blob: Blob, durationSeconds: number) => void>();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<VoiceNoteRecorder onSend={onSend as unknown as (blob: Blob, durationSeconds: number) => void} />));
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    vi.useRealTimers();
  });

  function has(testid: string): boolean {
    return container.querySelector(`[data-testid="${testid}"]`) !== null;
  }

  function buttonText(testid: string): string | null {
    return container.querySelector(`[data-testid="${testid}"]`)?.textContent ?? null;
  }

  async function click(testid: string) {
    const button = container.querySelector(`[data-testid="${testid}"]`);
    expect(button, `expected button [data-testid="${testid}"] to exist`).not.toBeNull();
    act(() => {
      (button as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      );
    });
    // Flush the async continuation started by the event handler (e.g.
    // getUserMedia) so state updates are applied before assertions run.
    await act(async () => {});
    await act(async () => {});
  }

  function advance(ms: number) {
    act(() => vi.advanceTimersByTime(ms));
  }

  function timerText(): string | null {
    return container.querySelector('[data-testid="timer"]')?.textContent ?? null;
  }

  function currentRecorder(): FakeMediaRecorder {
    return instances[instances.length - 1];
  }

  it('renders only the microphone button when idle', () => {
    expect(has('record-button')).toBe(true);
    expect(has('pause-button')).toBe(false);
    expect(has('resume-button')).toBe(false);
    expect(has('cancel-button')).toBe(false);
    expect(has('send-button')).toBe(false);
    expect(has('delete-button')).toBe(false);
    expect(timerText()).toBeNull();
  });

  it('starts recording and transitions to RECORDING', async () => {
    await click('record-button');

    expect(has('record-button')).toBe(false);
    expect(has('pause-button')).toBe(true);
    expect(has('cancel-button')).toBe(true);
    expect(timerText()).toBe('0:00');
    expect(currentRecorder().start).toHaveBeenCalled();
    expect(trackStop).not.toHaveBeenCalled();
  });

  it('reports microphone permission denied and stays IDLE', async () => {
    // Test-only override of the browser API.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(navigator.mediaDevices as any).getUserMedia = vi.fn().mockRejectedValueOnce(
      new Error('Not allowed')
    );

    await click('record-button');

    expect(has('record-button')).toBe(true);
    expect(container.textContent).toContain('Not allowed');
    expect(trackStop).not.toHaveBeenCalled();
  });

  it('tracks elapsed time with ticks while recording', async () => {
    await click('record-button');
    advance(1000);
    advance(1500);
  });

  it('pauses recording, freezes the timer, and transitions to PAUSED', async () => {
    await click('record-button');
    advance(1250);
    expect(timerText()).toBe('0:02');

    await click('pause-button');
    expect(has('pause-button')).toBe(false);
    expect(has('resume-button')).toBe(true);
    expect(has('stop-preview-button')).toBe(true);
    expect(currentRecorder().pause).toHaveBeenCalled();
    expect(timerText()).toBe('0:02');

    // Time passes while paused: timer must stay frozen.
    advance(5000);
    expect(timerText()).toBe('0:02');
  });

  it('resumes recording without resetting duration', async () => {
    await click('record-button');
    advance(1000);
    await click('pause-button');
    expect(timerText()).toBe('0:01');

    await click('resume-button');
    expect(has('pause-button')).toBe(true);
    expect(has('resume-button')).toBe(false);
    expect(currentRecorder().resume).toHaveBeenCalled();

    advance(1000);
    // 1s before pause + 1s after resume = 2s total.
    expect(timerText()).toBe('0:02');
  });

  it('cancels recording, discards audio, and returns to IDLE', async () => {
    await click('record-button');
    advance(1000);

    await click('cancel-button');
    expect(has('record-button')).toBe(true);
    expect(has('pause-button')).toBe(false);
    expect(currentRecorder().stop).toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('stops and previews, preserving the actual recorded duration', async () => {
    await click('record-button');
    advance(3000);

    currentRecorder().ondataavailable?.({
      data: new Blob(['fake-audio'], { type: 'audio/webm' }),
    });

    await click('pause-button');
    await click('stop-preview-button');
    expect(has('play-button')).toBe(true);
    expect(has('send-button')).toBe(true);
    expect(has('delete-button')).toBe(true);

    // 3 seconds recorded → initial preview shows the total duration, not zero.
    expect(buttonText('playback-total')).toBe('0:03');
    expect(buttonText('playback-current')).toBe('0:00');
    expect(createObjectURL).toHaveBeenCalled();
  });

  it('refuses to preview an empty recording', async () => {
    await click('record-button');
    advance(1000);
    // Produced chunk has zero size, so it is never retained.
    currentRecorder().ondataavailable?.({ data: new Blob([]) });

    await click('pause-button');
    await click('stop-preview-button');

    expect(has('record-button')).toBe(true);
    expect(has('play-button')).toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(container.textContent).toContain('empty');
  });

  it('plays audio and updates playback progress independently of recording duration', async () => {
    await click('record-button');
    advance(3000);
    currentRecorder().ondataavailable?.({
      data: new Blob(['fake-audio'], { type: 'audio/webm' }),
    });
    await click('pause-button');
    await click('stop-preview-button');

    await click('play-button');
    expect(fakeAudio.play).toHaveBeenCalled();

    fakeAudio.currentTime = 5;
    advance(300);
    expect(buttonText('playback-current')).toBe('0:05');

    // Total stays fixed at the recorded duration while progress moves.
    expect(buttonText('playback-total')).toBe('0:03');
  });

  it('resets playback position when playback completes', async () => {
    await click('record-button');
    advance(3000);
    currentRecorder().ondataavailable?.({
      data: new Blob(['fake-audio'], { type: 'audio/webm' }),
    });
    await click('pause-button');
    await click('stop-preview-button');
    await click('play-button');

    fakeAudio.currentTime = 5;
    advance(300);
    expect(buttonText('playback-current')).toBe('0:05');

    act(() => {
      endedListeners[0]?.();
    });
    expect(buttonText('playback-current')).toBe('0:00');
  });

  it('sends the recorded blob and returns to IDLE', async () => {
    await click('record-button');
    advance(3000);
    currentRecorder().ondataavailable?.({
      data: new Blob(['fake-audio'], { type: 'audio/webm' }),
    });
    await click('pause-button');
    await click('stop-preview-button');

    await click('send-button');

    expect(onSend).toHaveBeenCalledTimes(1);
    const [blob, duration] = onSend.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(typeof duration).toBe('number');
    expect(has('record-button')).toBe(true);
    expect(has('send-button')).toBe(false);
  });

  it('deletes the preview, revokes the object URL, and returns to IDLE', async () => {
    await click('record-button');
    advance(3000);
    currentRecorder().ondataavailable?.({
      data: new Blob(['fake-audio'], { type: 'audio/webm' }),
    });
    await click('pause-button');
    await click('stop-preview-button');
    expect(createObjectURL).toHaveBeenCalled();

    await click('delete-button');
    expect(has('record-button')).toBe(true);
    expect(has('play-button')).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it('cleans every resource up on unmount', async () => {
    await click('record-button');
    advance(3000);
    currentRecorder().ondataavailable?.({
      data: new Blob(['fake-audio'], { type: 'audio/webm' }),
    });
    await click('pause-button');
    await click('stop-preview-button');
    await click('play-button');

    act(() => root!.unmount());

    expect(trackStop).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
    expect(fakeAudio.pause).toHaveBeenCalled();
  });
});
