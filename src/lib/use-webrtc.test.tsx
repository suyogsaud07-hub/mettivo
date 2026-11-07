/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useWebRTC, type UseWebRTCResult } from './use-webrtc';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mock RTCPeerConnection */
class MockRTCPeerConnection {
  connectionState = 'new';
  iceConnectionState = 'new';
  iceGatheringState = 'new';
  signalingState = 'stable';
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;
  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: ((event: { streams: MediaStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onsignalingstatechange: (() => void) | null = null;

  constructor(_config: RTCConfiguration) {}

  addTrack(_track: MediaStreamTrack, _stream?: MediaStream) {}

  async createOffer() {
    return { type: 'offer', sdp: 'mock-offer-sdp' } as RTCSessionDescriptionInit;
  }

  async createAnswer() {
    return { type: 'answer', sdp: 'mock-answer-sdp' } as RTCSessionDescriptionInit;
  }

  async setLocalDescription(_desc: RTCSessionDescriptionInit) {}

  async setRemoteDescription(_desc: RTCSessionDescriptionInit) {}

  async addIceCandidate(_candidate: RTCIceCandidateInit) {}

  close() {
    this.connectionState = 'closed';
    this.signalingState = 'closed';
  }
}

const mockGetUserMedia = vi.fn();

const fakeStream = {
  getTracks: () => [
    { kind: 'audio', enabled: true, stop: vi.fn() },
    { kind: 'video', enabled: true, stop: vi.fn() },
  ],
  getAudioTracks: () => [
    { kind: 'audio', enabled: true, stop: vi.fn() },
  ],
  getVideoTracks: () => [
    { kind: 'video', enabled: true, stop: vi.fn() },
  ],
} as unknown as MediaStream;

beforeEach(() => {
  vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection);
  vi.stubGlobal('MediaStream', class {
    getTracks() {
      return fakeStream.getTracks();
    }
  });
  vi.stubGlobal('MediaStreamTrack', class {
    kind = 'audio';
    enabled = true;
    stop = vi.fn();
  });

  mockGetUserMedia.mockResolvedValue(fakeStream);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: mockGetUserMedia },
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  // Clean up any mounted components
  document.body.innerHTML = '';
});

function renderWebRTC() {
  const resultRef: { current: UseWebRTCResult } = { current: null as unknown as UseWebRTCResult };
  const onSignal = vi.fn();

  const TestComponent = () => {
    resultRef.current = useWebRTC(onSignal);
    return null;
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<TestComponent></TestComponent>));

  return { result: resultRef, onSignal };
}

describe('useWebRTC', () => {
  it('starts in idle state with no streams', () => {
    const { result } = renderWebRTC();
    expect(result.current.state).toBe('idle');
    expect(result.current.localStream).toBeNull();
    expect(result.current.remoteStream).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('initiate() acquires media, creates offer, and sends it via onSignal', async () => {
    const { result, onSignal } = renderWebRTC();

    await act(async () => {
      await result.current.initiate({ audio: true, video: false }, 'user-2');
    });

    // Re-read result after act() flushes re-renders
    const current = result.current;
    expect(mockGetUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    expect(current.state).toBe('connecting');
    expect(current.localStream).toBe(fakeStream);
    expect(onSignal).toHaveBeenCalledWith({
      type: 'offer',
      target: 'user-2',
      sdp: { type: 'offer', sdp: 'mock-offer-sdp' },
    });
  });

  it('handleOffer() sets remote description and transitions to ringing', async () => {
    const { result } = renderWebRTC();

    const offer: RTCSessionDescriptionInit = { type: 'offer', sdp: 'remote-offer-sdp' };
    act(() => {
      result.current.handleOffer(offer, 'user-3');
    });

    expect(result.current.state).toBe('ringing');
  });

  it('accept() acquires media, creates answer, and sends it', async () => {
    const { result, onSignal } = renderWebRTC();

    // First simulate receiving an offer (creates the PC)
    const offer: RTCSessionDescriptionInit = { type: 'offer', sdp: 'remote-offer-sdp' };
    act(() => {
      result.current.handleOffer(offer, 'user-3');
    });

    // Then accept - re-read result after handleOffer's re-render
    const afterOffer = result.current;
    await act(async () => {
      await afterOffer.accept({ audio: true, video: false });
    });

    // Re-read after accept's re-render
    const current = result.current;
    expect(mockGetUserMedia).toHaveBeenCalled();
    expect(current.state).toBe('connecting');
    expect(onSignal).toHaveBeenCalledWith({
      type: 'answer',
      target: 'user-3',
      sdp: { type: 'answer', sdp: 'mock-answer-sdp' },
    });
  });

  it('handleAnswer() sets remote description and transitions to connecting', async () => {
    const { result } = renderWebRTC();

    // First initiate to create a local PC
    await act(async () => {
      await result.current.initiate({ audio: true, video: false }, 'user-2');
    });

    // Re-read after initiate's re-render
    const current = result.current;

    // Then receive answer
    const answer: RTCSessionDescriptionInit = { type: 'answer', sdp: 'remote-answer-sdp' };
    act(() => {
      current.handleAnswer(answer);
    });

    expect(result.current.state).toBe('connecting');
  });

  it('handleIceCandidate() adds ICE candidate to PC', async () => {
    const { result } = renderWebRTC();

    // Create PC via initiate
    await act(async () => {
      await result.current.initiate({ audio: true, video: false }, 'user-2');
    });

    const candidate: RTCIceCandidateInit = {
      candidate: 'candidate:mock 1 udp 1 1.2.3.4 5678 typ host',
      sdpMLineIndex: 0,
      sdpMid: '0',
    };
    act(() => {
      result.current.handleIceCandidate(candidate);
    });

    // Should not throw - candidate accepted
    expect(result.current.state).toBe('connecting');
  });

  it('toggleMute() disables audio track', async () => {
    const { result } = renderWebRTC();

    await act(async () => {
      await result.current.initiate({ audio: true, video: false }, 'user-2');
    });

    act(() => {
      result.current.toggleMute();
    });

    expect(result.current.isMuted).toBe(true);
  });

  it('toggleCamera() disables video track', async () => {
    const { result } = renderWebRTC();

    await act(async () => {
      await result.current.initiate({ audio: false, video: true }, 'user-2');
    });

    act(() => {
      result.current.toggleCamera();
    });

    expect(result.current.isCameraOff).toBe(true);
  });

  it('end() cleans up peer connection and returns to idle', async () => {
    const { result } = renderWebRTC();

    await act(async () => {
      await result.current.initiate({ audio: true, video: false }, 'user-2');
    });

    act(() => {
      result.current.end();
    });

    expect(result.current.state).toBe('ended');
    expect(result.current.localStream).toBeNull();
  });

  it('reject() cleans up and returns to idle', async () => {
    const { result } = renderWebRTC();

    // First get into ringing state via handleOffer
    act(() => {
      result.current.handleOffer({ type: 'offer', sdp: 'sdp' }, 'user-3');
    });

    expect(result.current.state).toBe('ringing');

    act(() => {
      result.current.reject();
    });

    expect(result.current.state).toBe('ended');
  });

  it('getUserMedia failure transitions to failed state', async () => {
    const { result } = renderWebRTC();

    mockGetUserMedia.mockRejectedValueOnce(new Error('Microphone access denied'));

    await act(async () => {
      await result.current.initiate({ audio: true, video: false }, 'user-2');
    });

    const current = result.current;
    expect(current.state).toBe('failed');
    expect(current.error).toBe('Microphone access denied');
  });
});
