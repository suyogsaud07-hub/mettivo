import { describe, expect, it } from 'vitest';
import { readEmailEnv, sendModerationEmail, type EmailEnv } from './email';

const ENV: EmailEnv = { apiKey: 'resend-key', from: 'Safety <safety@mettivo.app>' };

describe('readEmailEnv', () => {
  it('reports no key when unconfigured and falls back to a default sender', () => {
    const env = readEmailEnv({});
    expect(env.apiKey).toBeNull();
    expect(env.from).toContain('@');
  });
});

describe('sendModerationEmail', () => {
  it('skips without a configured key rather than failing', async () => {
    const result = await sendModerationEmail(
      { to: 'a@example.com', subject: 's', body: 'b' },
      { env: { ...ENV, apiKey: null } }
    );
    expect(result).toEqual({ sent: false, skipped: true, provider: 'resend' });
  });

  it('posts to Resend and returns the provider id', async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    const result = await sendModerationEmail(
      { to: 'a@example.com', subject: 'Subject', body: 'Body' },
      {
        env: ENV,
        fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
          captured = { url: String(input), init };
          return new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 });
        }) as typeof fetch,
      }
    );

    expect(captured.url).toBe('https://api.resend.com/emails');
    expect(JSON.parse(String(captured.init?.body))).toMatchObject({
      to: ['a@example.com'],
      subject: 'Subject',
    });
    expect(result).toEqual({ sent: true, providerId: 'msg_123', provider: 'resend' });
  });

  it('reports a non-2xx response as a failure, not a send', async () => {
    const result = await sendModerationEmail(
      { to: 'a@example.com', subject: 's', body: 'b' },
      { env: ENV, fetchImpl: (async () => new Response('bad', { status: 422 })) as typeof fetch }
    );
    expect(result).toMatchObject({ sent: false, skipped: false, error: 'http_422' });
  });

  it('refuses an email with no recipient', async () => {
    const result = await sendModerationEmail({ to: '', subject: 's', body: 'b' }, { env: ENV });
    expect(result).toMatchObject({ sent: false, skipped: false, error: 'missing_recipient' });
  });
});
