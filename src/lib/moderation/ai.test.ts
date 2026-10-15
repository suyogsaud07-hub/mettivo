import { describe, expect, it } from 'vitest';
import {
  AI_CATEGORIES,
  classifyContent,
  readAiEnv,
  suggestedActionFor,
  type AiEnv,
} from './ai';

const ENV: AiEnv = {
  apiKey: 'test-key',
  baseUrl: 'https://ai.example/v1',
  textModel: 'text-model',
  visionModel: 'vision-model',
  provider: 'openai-compatible',
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

const modelReply = (verdict: Record<string, unknown>): unknown => ({
  choices: [{ message: { content: JSON.stringify(verdict) } }],
});

describe('readAiEnv', () => {
  it('reports no key when unconfigured, and applies defaults', () => {
    const env = readAiEnv({});
    expect(env.apiKey).toBeNull();
    expect(env.baseUrl).toBe('https://api.openai.com/v1');
    expect(env.textModel).toBe('gpt-4o-mini');
    expect(env.visionModel).toBe('gpt-4o-mini');
  });

  it('trims a configured key and a trailing slash on the base URL', () => {
    const env = readAiEnv({
      AI_MODERATION_API_KEY: '  secret  ',
      AI_MODERATION_BASE_URL: 'https://gw.example/v1///',
      AI_MODERATION_VISION_MODEL: 'vision-x',
    });
    expect(env.apiKey).toBe('secret');
    expect(env.baseUrl).toBe('https://gw.example/v1');
    expect(env.visionModel).toBe('vision-x');
  });
});

describe('suggestedActionFor', () => {
  it('maps categories onto the least intrusive sufficient scope', () => {
    expect(suggestedActionFor(['underage'])).toBe('account');
    expect(suggestedActionFor(['nudity'])).toBe('video');
    expect(suggestedActionFor(['harassment'])).toBe('chat');
    expect(suggestedActionFor([])).toBeNull();
  });
});

describe('classifyContent', () => {
  it('returns null without an API key (AI is optional)', async () => {
    const verdict = await classifyContent(
      { contentType: 'message', contentText: 'hi', contentUrl: null },
      { env: { ...ENV, apiKey: null }, fetchImpl: fetchReturning({}) }
    );
    expect(verdict).toBeNull();
  });

  it('classifies text and normalises the verdict', async () => {
    const recorder: { url?: string; init?: RequestInit } = {};
    const verdict = await classifyContent(
      { contentType: 'message', contentText: 'buy now cheap', contentUrl: null },
      {
        env: ENV,
        fetchImpl: fetchReturning(
          modelReply({ flagged: true, score: '0.9', categories: ['spam', 'bogus'] }),
          recorder
        ),
      }
    );

    expect(recorder.url).toBe('https://ai.example/v1/chat/completions');
    expect(JSON.parse(String(recorder.init?.body))).toMatchObject({ model: 'text-model' });
    expect(verdict).toMatchObject({
      flagged: true,
      score: 0.9,
      categories: ['spam'],
      suggestedAction: 'chat',
      model: 'text-model',
    });
  });

  it('sends an image to the vision model as an image_url part', async () => {
    const recorder: { url?: string; init?: RequestInit } = {};
    const verdict = await classifyContent(
      { contentType: 'live_snapshot', contentText: null, contentUrl: 'data:image/jpeg;base64,AAAA' },
      {
        env: ENV,
        fetchImpl: fetchReturning(
          modelReply({ flagged: true, score: 0.8, categories: ['nudity'], suggested_action: 'video' }),
          recorder
        ),
      }
    );

    const body = JSON.parse(String(recorder.init?.body)) as { model: string; messages: unknown[] };
    expect(body.model).toBe('vision-model');
    expect(JSON.stringify(body.messages)).toContain('image_url');
    expect(verdict?.suggestedAction).toBe('video');
  });

  it('treats a malformed model reply as no verdict, not a clean one', async () => {
    const verdict = await classifyContent(
      { contentType: 'message', contentText: 'x', contentUrl: null },
      { env: ENV, fetchImpl: fetchReturning({ choices: [{ message: { content: 'not json' } }] }) }
    );
    expect(verdict).toBeNull();
  });

  it('returns null on a provider error status', async () => {
    const verdict = await classifyContent(
      { contentType: 'message', contentText: 'x', contentUrl: null },
      { env: ENV, fetchImpl: (async () => new Response('nope', { status: 500 })) as typeof fetch }
    );
    expect(verdict).toBeNull();
  });

  it('ignores unknown categories from the model', () => {
    expect(AI_CATEGORIES).toEqual(['nudity', 'harassment', 'underage', 'spam']);
  });
});
