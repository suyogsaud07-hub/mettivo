import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslationError } from '@/lib/translation';
import {
  MAX_TRANSLATE_LENGTH,
  MYMEMORY_MAX_QUERY_BYTES,
  deeplErrorCodeForStatus,
  translateText,
} from '@/lib/translation-service';

/**
 * CONTRACT B — the translation service, offline.
 *
 * Every branch of `translateText` is driven by an injected `fetchImpl`, so the
 * suite proves the provider order, the fallback rules and the request shapes
 * without a network and without a key.
 */

const DEEPL_URL = 'https://api-free.deepl.com/v2/translate';
const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';

interface CapturedCall {
  url: string;
  init: RequestInit | undefined;
}

interface FetchStub {
  fetchImpl: typeof fetch;
  calls: CapturedCall[];
}

type StubHandler = (url: string, init: RequestInit | undefined, callIndex: number) => Response;

/** A real function with a captured call log. */
function stubFetch(handler: StubHandler): FetchStub {
  const calls: CapturedCall[] = [];

  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init, calls.length - 1);
  };

  // A stub is not a real `fetch` (no static `preconnect`), so this one cast is
  // the type-level equivalent of "this is a test double".
  return { fetchImpl: impl as unknown as typeof fetch, calls };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** DeepL on one side, MyMemory on the other. */
function providers(deepl: () => Response, mymemory: () => Response): FetchStub {
  return stubFetch((url) => (url.startsWith(DEEPL_URL) ? deepl() : mymemory()));
}

function deeplBody(stub: FetchStub, index = 0): URLSearchParams {
  return new URLSearchParams(String(stub.calls[index].init?.body));
}

function myMemoryQuery(stub: FetchStub, index: number): URLSearchParams {
  return new URL(stub.calls[index].url).searchParams;
}

function deepLErrorMessage(error: unknown): string {
  if (error instanceof Error && error.cause instanceof Error) return error.cause.message;
  return '';
}

/**
 * Environment handling.
 *
 * `vi.stubEnv(name, undefined)` *deletes* the variable and `vi.unstubAllEnvs()`
 * puts the real environment back, so a developer who happens to have a real
 * `DEEPL_API_KEY` exported still gets the "unset" branch. The stub API is also
 * what keeps this file out of the repo-wide scan in
 * `tests/security/security.test.ts`, which flags any `process.env.<NAME>` read
 * under `src/` as a possible browser leak — direct mutation here would be
 * reported even though no test file is ever bundled.
 */
beforeEach(() => {
  vi.stubEnv('DEEPL_API_KEY', undefined);
  vi.stubEnv('MYMEMORY_CONTACT_EMAIL', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('DeepL (primary)', () => {
  it('returns the translation, the provider and the detected source language', async () => {
    vi.stubEnv('DEEPL_API_KEY', 'test-deepl-key');
    const stub = stubFetch(() =>
      jsonResponse({ translations: [{ text: 'नमस्ते', detected_source_language: 'EN' }] })
    );

    const result = await translateText({
      text: 'Hello',
      targetLanguage: 'ne',
      sourceLanguage: 'en',
      fetchImpl: stub.fetchImpl,
    });

    expect(result).toEqual({
      translatedText: 'नमस्ते',
      provider: 'deepl',
      detectedSourceLanguage: 'en',
    });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].url).toBe(DEEPL_URL);
    expect(new Headers(stub.calls[0].init?.headers).get('authorization')).toBe(
      'DeepL-Auth-Key test-deepl-key'
    );
  });

  it('sends an UPPERCASE target and omits source_lang when the source is auto', async () => {
    vi.stubEnv('DEEPL_API_KEY', 'test-deepl-key');
    const stub = stubFetch(() => jsonResponse({ translations: [{ text: 'Hola' }] }));

    await translateText({
      text: 'Hello',
      targetLanguage: 'es',
      sourceLanguage: 'auto',
      fetchImpl: stub.fetchImpl,
    });

    const body = deeplBody(stub);
    expect(body.get('target_lang')).toBe('ES');
    expect(body.has('source_lang')).toBe(false);
    expect(body.get('text')).toBe('Hello');
  });

  it('sends an UPPERCASE source_lang when a concrete source is given', async () => {
    vi.stubEnv('DEEPL_API_KEY', 'test-deepl-key');
    const stub = stubFetch(() => jsonResponse({ translations: [{ text: 'Hola' }] }));

    await translateText({
      text: 'नमस्ते',
      targetLanguage: 'es',
      sourceLanguage: 'ne',
      fetchImpl: stub.fetchImpl,
    });

    expect(deeplBody(stub).get('source_lang')).toBe('NE');
  });

  it('classifies 456 and 429 as quota, other failures as upstream errors', () => {
    // Pinned directly because every DeepL failure falls back, so a request-level
    // test can only observe the last error, never DeepL's own classification.
    expect(deeplErrorCodeForStatus(456)).toBe('upstream_quota');
    expect(deeplErrorCodeForStatus(429)).toBe('upstream_quota');
    expect(deeplErrorCodeForStatus(500)).toBe('upstream_error');
    expect(deeplErrorCodeForStatus(400)).toBe('upstream_error');
    expect(deeplErrorCodeForStatus(200)).toBeNull();
  });

  it('never returns the source text as if it were a translation', async () => {
    vi.stubEnv('DEEPL_API_KEY', 'test-deepl-key');
    const stub = providers(
      () => jsonResponse({ translations: [] }),
      () => jsonResponse({ responseData: { translatedText: '' }, responseStatus: 200 })
    );

    await expect(
      translateText({ text: 'Hello', targetLanguage: 'es', fetchImpl: stub.fetchImpl })
    ).rejects.toMatchObject({ code: 'empty_result' });
  });
});

describe('the DeepL → MyMemory fallback', () => {
  it('falls back when DeepL reports quota exhaustion (456)', async () => {
    vi.stubEnv('DEEPL_API_KEY', 'test-deepl-key');
    const stub = providers(
      () => jsonResponse({ message: 'Quota exceeded' }, 456),
      () => jsonResponse({ responseData: { translatedText: 'Hola' }, responseStatus: 200 })
    );

    const result = await translateText({
      text: 'Hello',
      targetLanguage: 'es',
      fetchImpl: stub.fetchImpl,
    });

    expect(result).toEqual({ translatedText: 'Hola', provider: 'mymemory' });
    expect(stub.calls.map((call) => call.url)).toEqual([DEEPL_URL, expect.stringContaining(MYMEMORY_URL)]);
  });

  it('falls back when DeepL fails with a server error', async () => {
    vi.stubEnv('DEEPL_API_KEY', 'test-deepl-key');
    const stub = providers(
      () => new Response('upstream exploded: Hello', { status: 500 }),
      () => jsonResponse({ responseData: { translatedText: 'Hola' }, responseStatus: 200 })
    );

    const result = await translateText({
      text: 'Hello',
      targetLanguage: 'es',
      fetchImpl: stub.fetchImpl,
    });

    expect(result.provider).toBe('mymemory');
    expect(result.translatedText).toBe('Hola');
    // The upstream body is never echoed into the returned text.
    expect(result.translatedText).not.toContain('upstream exploded');
  });

  it('falls back when DeepL returns malformed JSON', async () => {
    vi.stubEnv('DEEPL_API_KEY', 'test-deepl-key');
    const stub = providers(
      () => new Response('<html>not json</html>', { status: 200 }),
      () => jsonResponse({ responseData: { translatedText: 'Hola' }, responseStatus: 200 })
    );

    const result = await translateText({
      text: 'Hello',
      targetLanguage: 'es',
      fetchImpl: stub.fetchImpl,
    });

    expect(result.provider).toBe('mymemory');
  });

  it('goes straight to MyMemory when DEEPL_API_KEY is unset', async () => {
    const stub = providers(
      () => jsonResponse({ translations: [{ text: 'should never be called' }] }),
      () => jsonResponse({ responseData: { translatedText: 'Hola' }, responseStatus: 200 })
    );

    const result = await translateText({
      text: 'Hello',
      targetLanguage: 'es',
      fetchImpl: stub.fetchImpl,
    });

    expect(result.provider).toBe('mymemory');
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].url).toContain(MYMEMORY_URL);
  });

  it('throws the LAST error when both providers fail, keeping the first as cause', async () => {
    vi.stubEnv('DEEPL_API_KEY', 'test-deepl-key');
    const stub = providers(
      () => new Response('', { status: 500 }),
      () => new Response('', { status: 503 })
    );

    const caught = await translateText({
      text: 'Hello',
      targetLanguage: 'es',
      fetchImpl: stub.fetchImpl,
    }).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(TranslationError);
    expect(caught).toMatchObject({ code: 'upstream_error' });
    // The last (MyMemory) error is the one thrown…
    expect((caught as Error).message).toContain('503');
    // …and the first (DeepL) error survives as the cause.
    expect(deepLErrorMessage(caught)).toContain('500');
  });

  it('does not call MyMemory twice for a short message', async () => {
    const stub = providers(
      () => jsonResponse({}),
      () => jsonResponse({ responseData: { translatedText: 'Hola' }, responseStatus: 200 })
    );

    await translateText({ text: 'Hello', targetLanguage: 'es', fetchImpl: stub.fetchImpl });

    expect(stub.calls).toHaveLength(1);
  });
});

describe('MyMemory (fallback)', () => {
  it('sends langpair, defaults an auto source to en, and includes de when configured', async () => {
    vi.stubEnv('MYMEMORY_CONTACT_EMAIL', 'translate@mettivo.test');
    const stub = stubFetch(() =>
      jsonResponse({ responseData: { translatedText: 'Hola' }, responseStatus: 200 })
    );

    await translateText({
      text: 'Hello',
      targetLanguage: 'es',
      sourceLanguage: 'auto',
      fetchImpl: stub.fetchImpl,
    });

    const query = myMemoryQuery(stub, 0);
    expect(query.get('q')).toBe('Hello');
    expect(query.get('langpair')).toBe('en|es');
    expect(query.get('de')).toBe('translate@mettivo.test');
    expect(stub.calls[0].init?.method).toBe('GET');
  });

  it('omits de when no contact email is configured', async () => {
    const stub = stubFetch(() =>
      jsonResponse({ responseData: { translatedText: 'Hola' }, responseStatus: 200 })
    );

    await translateText({
      text: 'Hello',
      targetLanguage: 'es',
      sourceLanguage: 'en',
      fetchImpl: stub.fetchImpl,
    });

    expect(myMemoryQuery(stub, 0).has('de')).toBe(false);
    expect(myMemoryQuery(stub, 0).get('langpair')).toBe('en|es');
  });

  it('maps quotaFinished to upstream_quota', async () => {
    const stub = stubFetch(() =>
      jsonResponse({
        responseData: { translatedText: 'Hola' },
        responseStatus: 200,
        quotaFinished: true,
      })
    );

    await expect(
      translateText({ text: 'Hello', targetLanguage: 'es', fetchImpl: stub.fetchImpl })
    ).rejects.toMatchObject({ code: 'upstream_quota' });
  });

  it('maps responseStatus != 200 to upstream_error', async () => {
    const stub = stubFetch(() =>
      jsonResponse({ responseData: { translatedText: 'Hola' }, responseStatus: 403 })
    );

    await expect(
      translateText({ text: 'Hello', targetLanguage: 'es', fetchImpl: stub.fetchImpl })
    ).rejects.toMatchObject({ code: 'upstream_error' });
  });

  it('maps a non-200 HTTP status to upstream_error', async () => {
    const stub = stubFetch(() => new Response('nope', { status: 502 }));

    await expect(
      translateText({ text: 'Hello', targetLanguage: 'es', fetchImpl: stub.fetchImpl })
    ).rejects.toMatchObject({ code: 'upstream_error' });
  });

  it('maps an empty translatedText to empty_result', async () => {
    const stub = stubFetch(() =>
      jsonResponse({ responseData: { translatedText: '   ' }, responseStatus: 200 })
    );

    await expect(
      translateText({ text: 'Hello', targetLanguage: 'es', fetchImpl: stub.fetchImpl })
    ).rejects.toMatchObject({ code: 'empty_result' });
  });

  it('refuses an oversized response before parsing it', async () => {
    const stub = stubFetch(
      () =>
        new Response(JSON.stringify({ responseData: { translatedText: 'Hola' } }), {
          status: 200,
          headers: { 'Content-Length': '999999' },
        })
    );

    await expect(
      translateText({ text: 'Hello', targetLanguage: 'es', fetchImpl: stub.fetchImpl })
    ).rejects.toMatchObject({ code: 'upstream_error' });
  });
});

describe("MyMemory's 500-byte ceiling", () => {
  it('chunks a multi-byte message into 500-byte requests and joins the translations', async () => {
    // 200 Devanagari code points = 600 UTF-8 bytes: two chunks.
    const text = 'न'.repeat(200);
    expect(new TextEncoder().encode(text).length).toBeGreaterThan(MYMEMORY_MAX_QUERY_BYTES);

    const stub = stubFetch(
      (_url, _init, callIndex) =>
        jsonResponse({
          responseData: { translatedText: callIndex === 0 ? 'A' : 'B' },
          responseStatus: 200,
        })
    );

    const result = await translateText({
      text,
      targetLanguage: 'en',
      sourceLanguage: 'ne',
      fetchImpl: stub.fetchImpl,
    });

    expect(stub.calls.length).toBeGreaterThan(1);

    for (const call of stub.calls) {
      const query = new URL(call.url).searchParams.get('q') ?? '';
      expect(new TextEncoder().encode(query).length).toBeLessThanOrEqual(MYMEMORY_MAX_QUERY_BYTES);
      expect(query.length).toBeGreaterThan(0);
    }

    expect(result).toEqual({ translatedText: 'A B', provider: 'mymemory' });
  });

  it('does not split a surrogate pair across chunks', async () => {
    // 300 emoji = 1200 bytes; a naive split by string index would cut a pair in
    // half and send an unpaired surrogate.
    const text = '🙂'.repeat(300);
    const queries: string[] = [];
    const stub = stubFetch((url) => {
      queries.push(new URL(url).searchParams.get('q') ?? '');
      return jsonResponse({ responseData: { translatedText: 'ok' }, responseStatus: 200 });
    });

    await translateText({
      text,
      targetLanguage: 'en',
      sourceLanguage: 'ne',
      fetchImpl: stub.fetchImpl,
    });

    const reassembled = queries.join('');
    expect(reassembled).toBe(text);
    for (const query of queries) {
      expect(/[\uD800-\uDBFF]$/.test(query)).toBe(false);
    }
  });
});

describe('validation happens before the network', () => {
  it('rejects an unsupported target without fetching', async () => {
    vi.stubEnv('DEEPL_API_KEY', 'test-deepl-key');
    const stub = stubFetch(() => jsonResponse({}));

    await expect(
      translateText({ text: 'Hello', targetLanguage: 'klingon', fetchImpl: stub.fetchImpl })
    ).rejects.toMatchObject({ code: 'unsupported_language' });

    expect(stub.calls).toHaveLength(0);
  });

  it('rejects empty text without fetching', async () => {
    vi.stubEnv('DEEPL_API_KEY', 'test-deepl-key');
    const stub = stubFetch(() => jsonResponse({}));

    await expect(
      translateText({ text: '   ', targetLanguage: 'es', fetchImpl: stub.fetchImpl })
    ).rejects.toMatchObject({ code: 'invalid_request' });

    expect(stub.calls).toHaveLength(0);
  });

  it('rejects text over the length cap without fetching', async () => {
    vi.stubEnv('DEEPL_API_KEY', 'test-deepl-key');
    const stub = stubFetch(() => jsonResponse({}));

    await expect(
      translateText({
        text: 'a'.repeat(MAX_TRANSLATE_LENGTH + 1),
        targetLanguage: 'es',
        fetchImpl: stub.fetchImpl,
      })
    ).rejects.toMatchObject({ code: 'invalid_request' });

    expect(stub.calls).toHaveLength(0);
  });

  it('trims the text it does send', async () => {
    vi.stubEnv('DEEPL_API_KEY', 'test-deepl-key');
    const stub = stubFetch(() => jsonResponse({ translations: [{ text: 'Hola' }] }));

    await translateText({ text: '  Hello  ', targetLanguage: 'es', fetchImpl: stub.fetchImpl });

    expect(deeplBody(stub).get('text')).toBe('Hello');
  });
});
