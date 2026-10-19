import { describe, expect, it } from 'vitest';
import {
  analyzeFace,
  analyzePhoto,
  classifyUpstreamStatus,
  dataUrlToBlob,
  matchesSelectedGender,
  phraseMatches,
  readVerificationEnv,
  transcribeVoice,
  VERIFICATION_THRESHOLD,
  type VerificationEnv,
} from './ai';

const ENV: VerificationEnv = {
  apiKey: 'test-key',
  baseUrl: 'https://ai.example/v1',
  textModel: 'text-model',
  visionModel: 'vision-model',
  provider: 'openai-compatible',
  transcribeModel: 'whisper-1',
};

/** A fetch stand-in that records the request and returns a canned response. */
function fetchReturning(
  body: unknown,
  recorder: { url?: string; init?: RequestInit } = {}
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    recorder.url = String(input);
    recorder.init = init;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

/** A fetch stand-in that always fails at the transport layer. */
function fetchThrowing(): typeof fetch {
  return (async () => {
    throw new Error('network down');
  }) as typeof fetch;
}

const modelReply = (verdict: Record<string, unknown>): unknown => ({
  choices: [{ message: { content: JSON.stringify(verdict) } }],
});

const okHuman = { human: true, face_present: true, apparent_gender: 'woman', score: 0.92 };

describe('readVerificationEnv', () => {
  it('defaults the transcription model', () => {
    const env = readVerificationEnv({});
    expect(env.apiKey).toBeNull();
    expect(env.transcribeModel).toBe('whisper-large-v3-turbo');
  });

  it('honours a configured transcription model, trimmed', () => {
    const env = readVerificationEnv({ AI_VERIFICATION_TRANSCRIBE_MODEL: '  gpt-4o-transcribe  ' });
    expect(env.transcribeModel).toBe('gpt-4o-transcribe');
  });
});

describe('classifyUpstreamStatus', () => {
  it('separates a rejected credential from a transient outage', () => {
    expect(classifyUpstreamStatus(401)).toBe('auth');
    expect(classifyUpstreamStatus(403)).toBe('auth');
    expect(classifyUpstreamStatus(429)).toBe('rate_limit');
    expect(classifyUpstreamStatus(503)).toBe('provider');
    expect(classifyUpstreamStatus(400)).toBe('request');
    expect(classifyUpstreamStatus(null)).toBe('transport');
  });
});

describe('matchesSelectedGender', () => {
  it('requires an exact match for Woman and Man', () => {
    expect(matchesSelectedGender('Woman', 'woman')).toBe(true);
    expect(matchesSelectedGender('Woman', 'man')).toBe(false);
    expect(matchesSelectedGender('Man', 'man')).toBe(true);
    expect(matchesSelectedGender('Man', 'woman')).toBe(false);
  });

  it('only requires a known presentation for Nonbinary', () => {
    expect(matchesSelectedGender('Nonbinary', 'woman')).toBe(true);
    expect(matchesSelectedGender('Nonbinary', 'man')).toBe(true);
    expect(matchesSelectedGender('Nonbinary', 'unknown')).toBe(false);
  });
});

describe('phraseMatches', () => {
  it('requires every content word, in any order, ignoring case and punctuation', () => {
    expect(phraseMatches('amber orchid 42', 'Amber, orchid — 42!')).toBe(true);
    expect(phraseMatches('amber orchid 42', 'orchid 42 amber')).toBe(true);
    expect(phraseMatches('amber orchid 42', 'amber orchid')).toBe(false);
    expect(phraseMatches('', 'anything')).toBe(false);
  });

  it('ignores hyphens, so "non-binary" matches "nonbinary"', () => {
    expect(phraseMatches('hello my name is nonbinary', 'hello my name is non-binary')).toBe(
      true
    );
  });
});

describe('dataUrlToBlob', () => {
  it('decodes a base64 data URL', () => {
    const blob = dataUrlToBlob('data:image/png;base64,aGk=');
    expect(blob?.type).toBe('image/png');
    expect(blob?.size).toBe(2);
  });

  it('returns null for a non-data URL', () => {
    expect(dataUrlToBlob('https://example.com/a.png')).toBeNull();
  });
});

describe('analyzeFace', () => {
  it('returns null without an API key (fail closed, never a pass)', async () => {
    const verdict = await analyzeFace(
      { selfieUrl: 'data:image/png;base64,aGk=', gender: 'Woman' },
      { env: { ...ENV, apiKey: null }, fetchImpl: fetchReturning({}) }
    );
    expect(verdict).toBeNull();
  });

  it('returns null when the transport fails', async () => {
    const verdict = await analyzeFace(
      { selfieUrl: 'data:image/png;base64,aGk=', gender: 'Woman' },
      { env: ENV, fetchImpl: fetchThrowing() }
    );
    expect(verdict).toBeNull();
  });

  it('throws a typed upstream error when throwOnFailure is set and the transport fails', async () => {
    await expect(
      analyzeFace(
        { selfieUrl: 'data:image/png;base64,aGk=', gender: 'Woman' },
        { env: ENV, fetchImpl: fetchThrowing(), throwOnFailure: true }
      )
    ).rejects.toThrow(/could not be reached/);
  });

  it('throws with the upstream status when throwOnFailure is set and the provider rejects', async () => {
    const unauthorized: typeof fetch = (async () =>
      new Response('invalid api key', { status: 401 })) as typeof fetch;

    await expect(
      analyzeFace(
        { selfieUrl: 'data:image/png;base64,aGk=', gender: 'Woman' },
        { env: ENV, fetchImpl: unauthorized, throwOnFailure: true }
      )
    ).rejects.toThrow(/HTTP 401/);
  });

  it('returns null on an unparseable model reply', async () => {
    const verdict = await analyzeFace(
      { selfieUrl: 'data:image/png;base64,aGk=', gender: 'Woman' },
      { env: ENV, fetchImpl: fetchReturning({ choices: [] }) }
    );
    expect(verdict).toBeNull();
  });

  it('normalises a passing verdict', async () => {
    const recorder: { url?: string; init?: RequestInit } = {};
    const verdict = await analyzeFace(
      { selfieUrl: 'data:image/png;base64,aGk=', gender: 'Woman' },
      { env: ENV, fetchImpl: fetchReturning(modelReply(okHuman), recorder) }
    );

    expect(recorder.url).toBe('https://ai.example/v1/chat/completions');
    expect(verdict).toMatchObject({
      human: true,
      facePresent: true,
      apparentGender: 'woman',
      genderMatch: true,
      score: 0.92,
    });
    expect(verdict!.score).toBeGreaterThanOrEqual(VERIFICATION_THRESHOLD);
  });

  it('parses a reply the model wrapped in a markdown JSON fence', async () => {
    const fenced = {
      choices: [{ message: { content: '```json\n' + JSON.stringify(okHuman) + '\n```' } }],
    };
    const verdict = await analyzeFace(
      { selfieUrl: 'data:image/png;base64,aGk=', gender: 'Woman' },
      { env: ENV, fetchImpl: fetchReturning(fenced) }
    );
    expect(verdict).toMatchObject({
      human: true,
      facePresent: true,
      apparentGender: 'woman',
    });
  });

  it('flags a gender mismatch', async () => {
    const verdict = await analyzeFace(
      { selfieUrl: 'data:image/png;base64,aGk=', gender: 'Woman' },
      { env: ENV, fetchImpl: fetchReturning(modelReply({ ...okHuman, apparent_gender: 'man' })) }
    );
    expect(verdict?.genderMatch).toBe(false);
  });

  it('treats "human" false as not human, regardless of score', async () => {
    const verdict = await analyzeFace(
      { selfieUrl: 'data:image/png;base64,aGk=', gender: 'Woman' },
      { env: ENV, fetchImpl: fetchReturning(modelReply({ ...okHuman, human: false })) }
    );
    expect(verdict?.human).toBe(false);
  });
});

describe('analyzePhoto', () => {
  it('normalises a passing gallery verdict', async () => {
    const verdict = await analyzePhoto(
      {
        photoUrl: 'data:image/png;base64,aGk=',
        selfieUrl: 'data:image/png;base64,aGk=',
        gender: 'Man',
      },
      {
        env: ENV,
        fetchImpl: fetchReturning(
          modelReply({
            human: true,
            same_person: true,
            apparent_gender: 'man',
            reject_reason: null,
            score: 0.8,
          })
        ),
      }
    );

    expect(verdict).toMatchObject({ human: true, samePerson: true, genderMatch: true });
    expect(verdict?.rejectReason).toBeNull();
  });

  it('surfaces a reject reason (e.g. a pet)', async () => {
    const verdict = await analyzePhoto(
      {
        photoUrl: 'data:image/png;base64,aGk=',
        selfieUrl: 'data:image/png;base64,aGk=',
        gender: 'Man',
      },
      {
        env: ENV,
        fetchImpl: fetchReturning(
          modelReply({
            human: false,
            same_person: false,
            apparent_gender: 'unknown',
            reject_reason: 'not_human',
            score: 0.9,
          })
        ),
      }
    );

    expect(verdict?.human).toBe(false);
    expect(verdict?.rejectReason).toBe('not_human');
  });

  it('returns null when either image URL is missing', async () => {
    const verdict = await analyzePhoto(
      { photoUrl: '', selfieUrl: 'data:image/png;base64,aGk=', gender: 'Man' },
      { env: ENV, fetchImpl: fetchReturning(modelReply(okHuman)) }
    );
    expect(verdict).toBeNull();
  });
});

describe('transcribeVoice', () => {
  it('returns null without an API key (fail closed)', async () => {
    const verdict = await transcribeVoice(
      { audioUrl: 'data:audio/webm;base64,aGk=', phrase: 'amber orchid 42' },
      { env: { ...ENV, apiKey: null }, fetchImpl: fetchReturning({ text: 'amber orchid 42' }) }
    );
    expect(verdict).toBeNull();
  });

  it('returns null for an unreadable audio data URL', async () => {
    const verdict = await transcribeVoice(
      { audioUrl: 'https://example.com/a.webm', phrase: 'amber orchid 42' },
      { env: ENV, fetchImpl: fetchReturning({ text: 'amber orchid 42' }) }
    );
    expect(verdict).toBeNull();
  });

  it('transcribes and matches the liveness phrase', async () => {
    const recorder: { url?: string; init?: RequestInit } = {};
    const verdict = await transcribeVoice(
      { audioUrl: 'data:audio/webm;base64,aGk=', phrase: 'amber orchid 42' },
      { env: ENV, fetchImpl: fetchReturning({ text: 'Amber, orchid 42.' }, recorder) }
    );

    expect(recorder.url).toBe('https://ai.example/v1/audio/transcriptions');
    expect(verdict).toMatchObject({ transcript: 'Amber, orchid 42.', phraseMatch: true });
  });

  it('reports a phrase mismatch without failing the call', async () => {
    const verdict = await transcribeVoice(
      { audioUrl: 'data:audio/webm;base64,aGk=', phrase: 'amber orchid 42' },
      { env: ENV, fetchImpl: fetchReturning({ text: 'completely different words' }) }
    );
    expect(verdict?.phraseMatch).toBe(false);
  });
});
