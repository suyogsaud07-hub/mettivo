import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    getAll: vi.fn(() => []),
    setAll: vi.fn(),
  })),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } } })),
    },
  })),
}));

const DEEPL_SUCCESS_BODY = { translations: [{ text: 'Hola', detected_source_language: 'EN' }] };

function mockRequest(body: unknown): Request {
  return new Request('http://localhost/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function callRoute(body: unknown) {
  const { POST } = await import('@/app/api/translate/route');
  return POST(mockRequest(body));
}

describe('translation API', () => {
  const fetchMock = vi.fn() as ReturnType<typeof vi.fn> & { mock: ReturnType<typeof vi.fn>['mock'] };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    vi.stubEnv('DEEPL_API_KEY', 'test-deepl-key');
    // Route fetches DeepL directly; intercept it so no real network I/O occurs.
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('rejects missing text', async () => {
    const res = await callRoute({});
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('empty_text');
  });

  it('rejects empty text', async () => {
    const res = await callRoute({ text: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects unsupported language', async () => {
    const res = await callRoute({ text: 'Hello', targetLanguage: 'xx' });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('unsupported_language');
  });

  it('rejects oversized text without fetching', async () => {
    const res = await callRoute({ text: 'a'.repeat(50001), targetLanguage: 'en' });
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('translates short text directly', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(DEEPL_SUCCESS_BODY), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await callRoute({ text: 'Hello', targetLanguage: 'es' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.translatedText).toBe('Hola');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(json.provider).toBe('deepl');
  });

  it('returns service unavailable when DEEPL_API_KEY is missing', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    // DEEPL_API_KEY intentionally left unset.

    const res = await callRoute({ text: 'Hello', targetLanguage: 'es' });
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toBe('service_unavailable');
    expect(json.message).toBe('Translation service unavailable');
  });

  it('returns service unavailable when DeepL errors', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network boom'));

    const res = await callRoute({ text: 'Hello', targetLanguage: 'es' });
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toBe('service_unavailable');
    expect(json.message).toBe('Translation service unavailable');
  });

  it('returns service unavailable when DeepL returns non-ok', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), {
        status: 456,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await callRoute({ text: 'Hello', targetLanguage: 'es' });
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toBe('service_unavailable');
  });
});
