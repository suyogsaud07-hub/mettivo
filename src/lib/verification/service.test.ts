import { describe, expect, it } from 'vitest';
import { verifyFace, type ServiceDeps } from './service';
import type { VerificationEnv } from './ai';

/**
 * M24 — the face route must tell a misconfigured deployment apart from a
 * provider outage. Both used to answer `503 ai_unavailable`, which hid the one
 * thing an operator needs to know: is the API key set at all?
 */

const ENV: VerificationEnv = {
  apiKey: 'test-key',
  baseUrl: 'https://ai.example/v1',
  textModel: 'text-model',
  visionModel: 'vision-model',
  provider: 'openai-compatible',
  transcribeModel: 'whisper-large-v3-turbo',
};

function faceRequest(): Request {
  return new Request('https://mettivo.test/api/verification/face', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    },
    body: JSON.stringify({ selfieUrl: 'data:image/png;base64,aGk=', gender: 'Woman' }),
  });
}

/** The Auth server accepts the bearer token and names a caller. */
const authFetch: typeof fetch = (async () =>
  new Response(JSON.stringify({ id: 'user-1' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch;

function deps(overrides: Partial<ServiceDeps> = {}): ServiceDeps {
  return {
    authEnv: { supabaseUrl: 'https://auth.example', anonKey: 'anon' },
    fetchImpl: authFetch,
    ...overrides,
  };
}

describe('verifyFace — AI configuration vs outage', () => {
  it('answers 500 when the provider key is not configured', async () => {
    const result = await verifyFace(
      faceRequest(),
      deps({ verificationEnv: { ...ENV, apiKey: null } })
    );

    expect(result).toEqual({ status: 500, body: { error: 'Missing AI configuration' } });
  });

  it('answers 503 when the provider call fails despite a configured key', async () => {
    const throwing: typeof fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;

    const result = await verifyFace(
      faceRequest(),
      deps({ verificationEnv: ENV, aiFetchImpl: throwing })
    );

    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: 'ai_unavailable' });
  });
});
