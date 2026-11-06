import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('google-translate-api-x', () => ({
  default: vi.fn(),
}));

import { POST } from '@/app/api/translate/route';
import type { googleTranslateApi } from 'google-translate-api-x';
import translate from 'google-translate-api-x';

type TranslationResponse = googleTranslateApi.TranslationResponse;

const mockTranslate = vi.mocked(translate);

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

function mockRequest(body: unknown): Request {
  return new Request('http://localhost/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function callRoute(body: unknown) {
  return POST(mockRequest(body));
}

function mockTranslation(text: string): TranslationResponse {
  return {
    text,
    from: {
      language: { iso: 'en', didYouMean: false },
      text: { autoCorrected: false, value: '', didYouMean: false },
    },
    raw: '',
    pronunciation: undefined,
  };
}

describe('translation API', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
    expect(mockTranslate).not.toHaveBeenCalled();
  });

  it('translates short text directly without chunking', async () => {
    mockTranslate.mockResolvedValue(mockTranslation('Hola'));

    const res = await callRoute({ text: 'Hello', targetLanguage: 'es' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.translatedText).toBe('Hola');
    expect(mockTranslate).toHaveBeenCalledTimes(1);
    expect(mockTranslate).toHaveBeenCalledWith('Hello', { to: 'es' });
    expect(json.chunked).toBeUndefined();
  });

  it('chunks long text by paragraph boundaries', async () => {
    const para = 'This is a test paragraph with some content to make it long enough. ';
    const longText = Array(200).fill(para).join('\n\n');
    mockTranslate.mockResolvedValue(mockTranslation('Hola.'));

    const res = await callRoute({ text: longText, targetLanguage: 'es' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(mockTranslate).toHaveBeenCalledTimes(4);
    expect(mockTranslate).toHaveBeenCalledWith(expect.any(String), { to: 'es' });
    expect(json.translatedText).toContain('Hola.');
  });

  it('reassembles chunks in original order', async () => {
    const paraA = 'START-MARKER-A ' + 'x '.repeat(500);
    const paraB = 'START-MARKER-B ' + 'y '.repeat(500);
    const longText = `${paraA}\n\n${paraB}\n\n${paraA}\n\n${paraB}`;
    mockTranslate.mockImplementation(async (input: unknown) =>
      Promise.resolve(mockTranslation(`translated:${String(input)}`))
    );

    const res = await callRoute({ text: longText, targetLanguage: 'es' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(mockTranslate).toHaveBeenCalledTimes(2);
    const aIndex = json.translatedText.indexOf('START-MARKER-A');
    const bIndex = json.translatedText.indexOf('START-MARKER-B');
    expect(aIndex).toBeGreaterThanOrEqual(0);
    expect(bIndex).toBeGreaterThanOrEqual(0);
    expect(aIndex).toBeLessThan(bIndex);
  });

  it('preserves emoji and unicode text', async () => {
    const emojiText = 'Hello 🙂 你好 🎉';
    mockTranslate.mockResolvedValue(mockTranslation('Hola 🙂 你好 🎉'));

    const res = await callRoute({ text: emojiText, targetLanguage: 'es' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.translatedText).toBe('Hola 🙂 你好 🎉');
  });

  it('preserves multiline formatting', async () => {
    const multiline = 'Line one\nLine two\nLine three';
    mockTranslate.mockResolvedValue(mockTranslation('Línea uno\nLínea dos\nLínea tres'));

    const res = await callRoute({ text: multiline, targetLanguage: 'es' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.translatedText).toContain('\n');
  });

  it('returns error when a chunk fails', async () => {
    const para = 'x '.repeat(500);
    const longText = `${para}\n\n${para}`;
    mockTranslate.mockImplementation(() => {
      throw new Error('provider boom');
    });

    const res = await callRoute({ text: longText, targetLanguage: 'es' });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe('upstream_error');
  });

  it('returns error when provider returns empty result', async () => {
    mockTranslate.mockResolvedValue(mockTranslation(''));

    const res = await callRoute({ text: 'Hello', targetLanguage: 'es' });
    expect(res.status).toBe(502);
  });
});
