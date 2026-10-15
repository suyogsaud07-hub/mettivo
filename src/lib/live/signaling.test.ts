import { describe, expect, it } from 'vitest';
import {
  LIVE_CHANNEL_NAME,
  LIVE_ICE_SERVERS,
  countryFlagEmoji,
  isAddressedTo,
  isLiveEvent,
  makePeerId,
  readAnswer,
  readAvailable,
  readBye,
  readChat,
  readIce,
  readOffer,
  readSeek,
  shouldAnswerSeek,
} from '@/lib/live/signaling';

/**
 * The signaling rules are the part of Mettivo Live that decides whether two
 * strangers connect or glare at each other forever. They are pure on purpose so
 * these cases can be pinned without a camera, a peer connection or a browser.
 */

describe('live channel constants', () => {
  it('names one channel and offers at least one STUN server', () => {
    expect(LIVE_CHANNEL_NAME).toBe('mettivo-live');
    expect(LIVE_ICE_SERVERS.length).toBeGreaterThan(0);
    expect(LIVE_ICE_SERVERS.every((server) => server.urls)).toBe(true);
  });
});

describe('isLiveEvent', () => {
  it('accepts exactly the protocol events', () => {
    for (const event of ['seek', 'available', 'offer', 'answer', 'ice', 'bye', 'chat']) {
      expect(isLiveEvent(event)).toBe(true);
    }
  });

  it('rejects anything else, including non-strings', () => {
    expect(isLiveEvent('presence')).toBe(false);
    expect(isLiveEvent('')).toBe(false);
    expect(isLiveEvent(undefined)).toBe(false);
    expect(isLiveEvent(7)).toBe(false);
  });
});

describe('shouldAnswerSeek', () => {
  it('lets only the peer with the lower id answer', () => {
    // "abc" < "xyz", so the peer holding "xyz" answers and "abc" calls.
    expect(shouldAnswerSeek('xyz', 'abc')).toBe(true);
    expect(shouldAnswerSeek('abc', 'xyz')).toBe(false);
  });

  it('never lets a peer answer its own seek or an empty one', () => {
    expect(shouldAnswerSeek('abc', 'abc')).toBe(false);
    expect(shouldAnswerSeek('', 'abc')).toBe(false);
    expect(shouldAnswerSeek('abc', '')).toBe(false);
  });

  it('picks exactly one answerer for any pair', () => {
    const peers = ['peer-a', 'peer-b', 'peer-c', 'peer-d'];
    for (const me of peers) {
      for (const seeker of peers) {
        if (me === seeker) continue;
        const mineAnswers = shouldAnswerSeek(me, seeker);
        const theirsAnswers = shouldAnswerSeek(seeker, me);
        expect(mineAnswers).toBe(!theirsAnswers);
      }
    }
  });
});

describe('isAddressedTo', () => {
  it('matches only the exact recipient', () => {
    expect(isAddressedTo({ to: 'me' }, 'me')).toBe(true);
    expect(isAddressedTo({ to: 'you' }, 'me')).toBe(false);
    expect(isAddressedTo({}, 'me')).toBe(false);
  });
});

describe('makePeerId', () => {
  it('produces a non-empty id that is very unlikely to repeat', () => {
    const ids = new Set(Array.from({ length: 200 }, () => makePeerId()));
    expect(ids.size).toBe(200);
    expect([...ids].every((id) => id.length > 0)).toBe(true);
  });
});

describe('countryFlagEmoji', () => {
  it('renders a flag from a two-letter code, case-insensitively', () => {
    expect(countryFlagEmoji('NP')).toBe('🇳🇵');
    expect(countryFlagEmoji('np')).toBe('🇳🇵');
    expect(countryFlagEmoji('US')).toBe('🇺🇸');
  });

  it('maps common country names to flags', () => {
    expect(countryFlagEmoji('Nepal')).toBe('🇳🇵');
    expect(countryFlagEmoji('  united kingdom ')).toBe('🇬🇧');
  });

  it('falls back to a neutral globe rather than a wrong flag', () => {
    expect(countryFlagEmoji('')).toBe('🌐');
    expect(countryFlagEmoji('   ')).toBe('🌐');
    expect(countryFlagEmoji('Atlantis')).toBe('🌐');
    expect(countryFlagEmoji(undefined)).toBe('🌐');
    expect(countryFlagEmoji(null)).toBe('🌐');
  });
});

describe('readSeek', () => {
  it('reads a well-formed seek and defaults a missing country', () => {
    expect(readSeek({ from: 'a', country: 'Nepal' })).toEqual({
      from: 'a',
      country: 'Nepal',
      userId: null,
    });
    expect(readSeek({ from: 'a' })).toEqual({ from: 'a', country: '', userId: null });
  });

  it("carries the sender's real account id when present", () => {
    expect(readSeek({ from: 'a', country: 'Nepal', userId: 'user-1' })?.userId).toBe('user-1');
    expect(readSeek({ from: 'a', userId: '   ' })?.userId).toBeNull();
    expect(readSeek({ from: 'a', userId: 42 })?.userId).toBeNull();
  });

  it('drops a seek with no sender', () => {
    expect(readSeek({ country: 'Nepal' })).toBeNull();
    expect(readSeek({ from: '' })).toBeNull();
    expect(readSeek(null)).toBeNull();
    expect(readSeek('not-an-object')).toBeNull();
  });
});

describe('readAvailable', () => {
  it('requires a recipient', () => {
    expect(readAvailable({ from: 'a', to: 'b', country: 'India', userId: 'user-2' })).toEqual({
      from: 'a',
      to: 'b',
      country: 'India',
      userId: 'user-2',
    });
    expect(readAvailable({ from: 'a', country: 'India' })).toBeNull();
  });
});

describe('readOffer / readAnswer', () => {
  it('keeps only the description fields we send', () => {
    expect(
      readOffer({
        from: 'a',
        to: 'b',
        country: 'Nepal',
        sdp: { type: 'offer', sdp: 'v=0', ignored: 'x' },
      })
    ).toEqual({
      from: 'a',
      to: 'b',
      country: 'Nepal',
      sdp: { type: 'offer', sdp: 'v=0' },
    });
  });

  it('refuses an offer/answer whose SDP type is wrong or missing', () => {
    expect(readOffer({ from: 'a', to: 'b', sdp: { type: 'answer', sdp: 'x' } })).toBeNull();
    expect(readAnswer({ from: 'a', to: 'b', sdp: { type: 'offer', sdp: 'x' } })).toBeNull();
    expect(readOffer({ from: 'a', to: 'b' })).toBeNull();
    expect(readAnswer({ from: 'a', to: 'b', sdp: 'nope' })).toBeNull();
  });

  it('accepts an answer and drops the country (it is not part of an answer)', () => {
    expect(readAnswer({ from: 'a', to: 'b', sdp: { type: 'answer', sdp: 'v=0' } })).toEqual({
      from: 'a',
      to: 'b',
      sdp: { type: 'answer', sdp: 'v=0' },
    });
  });
});

describe('readIce', () => {
  it('requires a recipient and a candidate string', () => {
    expect(
      readIce({
        from: 'a',
        to: 'b',
        candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 },
      })
    ).toEqual({
      from: 'a',
      to: 'b',
      candidate: {
        candidate: 'candidate:1',
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: null,
      },
    });
    expect(readIce({ from: 'a', to: 'b', candidate: {} })).toBeNull();
    expect(readIce({ from: 'a', candidate: { candidate: 'c' } })).toBeNull();
  });
});

describe('readBye', () => {
  it('needs both ends of the farewell', () => {
    expect(readBye({ from: 'a', to: 'b' })).toEqual({ from: 'a', to: 'b' });
    expect(readBye({ from: 'a' })).toBeNull();
  });
});

describe('readChat', () => {
  it('keeps non-empty text and falls back to the current time', () => {
    const now = Date.now();
    const message = readChat({ from: 'a', to: 'b', text: 'hi' });
    expect(message?.from).toBe('a');
    expect(message?.to).toBe('b');
    expect(message?.text).toBe('hi');
    expect(typeof message?.at).toBe('number');
    expect(message!.at).toBeGreaterThanOrEqual(now - 1000);
  });

  it('preserves a sensible sender timestamp', () => {
    expect(readChat({ from: 'a', to: 'b', text: 'hi', at: 1234 })?.at).toBe(1234);
  });

  it('drops an empty line or one with no recipient', () => {
    expect(readChat({ from: 'a', to: 'b', text: '   ' })).toBeNull();
    expect(readChat({ from: 'a', text: 'hi' })).toBeNull();
  });
});
