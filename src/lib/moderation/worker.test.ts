import { describe, expect, it } from 'vitest';
import type { AiEnv } from './ai';
import type { EmailEnv } from './email';
import {
  runModerationEmailBatch,
  runModerationScanBatch,
  type WorkerEnv,
} from './worker';

const ENV: WorkerEnv = {
  supabaseUrl: 'https://proj.supabase.co',
  anonKey: 'anon-key',
  workerSecret: 'worker-secret',
};

const AI_ENV: AiEnv = {
  apiKey: 'ai-key',
  baseUrl: 'https://ai.example/v1',
  textModel: 'text-model',
  visionModel: 'vision-model',
  provider: 'openai-compatible',
};

const EMAIL_ENV: EmailEnv = { apiKey: 'resend-key', from: 'Safety <s@mettivo.app>' };

interface Call {
  fn: string;
  body: Record<string, unknown>;
}

/** Routes PostgREST RPC calls and AI/Resend calls by URL, recording each. */
function router(handlers: {
  rpc: Record<string, unknown>;
  ai?: unknown;
  resend?: unknown;
  calls?: Call[];
  rpcStatus?: number;
}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    if (url.includes('/rest/v1/rpc/')) {
      const fn = url.split('/rest/v1/rpc/')[1];
      handlers.calls?.push({ fn, body });
      if (handlers.rpcStatus && handlers.rpcStatus >= 400) {
        return new Response('error', { status: handlers.rpcStatus });
      }
      return new Response(JSON.stringify(handlers.rpc[fn] ?? null), { status: 200 });
    }

    if (url.includes('chat/completions')) {
      return new Response(JSON.stringify(handlers.ai ?? {}), { status: 200 });
    }

    if (url.includes('api.resend.com')) {
      return new Response(JSON.stringify(handlers.resend ?? { id: 'msg_1' }), { status: 200 });
    }

    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

const aiReply = (verdict: Record<string, unknown>): unknown => ({
  choices: [{ message: { content: JSON.stringify(verdict) } }],
});

const scan = {
  scan_id: 'scan-1',
  user_id: 'user-1',
  content_type: 'message',
  content_id: 'content-1',
  content_text: 'abusive text',
  content_url: null,
  report_id: null,
};

describe('runModerationScanBatch', () => {
  it('does nothing without a worker secret', async () => {
    const result = await runModerationScanBatch({
      env: { ...ENV, workerSecret: null },
      aiEnv: AI_ENV,
      fetchImpl: router({ rpc: {} }),
    });
    expect(result).toMatchObject({ skipped: true, reason: 'worker_secret_missing', claimed: 0 });
  });

  it('does nothing without an AI key', async () => {
    const result = await runModerationScanBatch({
      env: ENV,
      aiEnv: { ...AI_ENV, apiKey: null },
      fetchImpl: router({ rpc: {} }),
    });
    expect(result).toMatchObject({ skipped: true, reason: 'ai_not_configured' });
  });

  it('claims, classifies and records a flagged verdict', async () => {
    const calls: Call[] = [];
    const result = await runModerationScanBatch({
      env: ENV,
      aiEnv: AI_ENV,
      fetchImpl: router({
        rpc: {
          moderation_policy: { ai_text_threshold: 0.5, ai_media_threshold: 0.4 },
          claim_moderation_scans: [scan],
          record_ai_scan: { ok: true, flagged: true, action: 'chat' },
        },
        ai: aiReply({ flagged: true, score: 0.92, categories: ['harassment'] }),
        calls,
      }),
    });

    expect(result).toMatchObject({ claimed: 1, flagged: 1, scanned: 1, failed: 0, skipped: false });

    const record = calls.find((call) => call.fn === 'record_ai_scan');
    expect(record?.body).toMatchObject({
      p_secret: 'worker-secret',
      p_scan_id: 'scan-1',
      p_flagged: true,
      p_score: 0.92,
      p_categories: ['harassment'],
      p_suggested_action: 'chat',
    });
  });

  it('does not flag a verdict below the configured threshold', async () => {
    const calls: Call[] = [];
    const result = await runModerationScanBatch({
      env: ENV,
      aiEnv: AI_ENV,
      fetchImpl: router({
        rpc: {
          moderation_policy: { ai_text_threshold: 0.75, ai_media_threshold: 0.6 },
          claim_moderation_scans: [scan],
          record_ai_scan: { ok: true },
        },
        ai: aiReply({ flagged: true, score: 0.6, categories: ['harassment'] }),
        calls,
      }),
    });

    expect(result.flagged).toBe(0);
    expect(calls.find((call) => call.fn === 'record_ai_scan')?.body).toMatchObject({
      p_flagged: false,
    });
  });

  it('requeues a scan when the classifier is unavailable', async () => {
    const calls: Call[] = [];
    const result = await runModerationScanBatch({
      env: ENV,
      aiEnv: AI_ENV,
      fetchImpl: router({
        rpc: {
          moderation_policy: { ai_text_threshold: 0.5, ai_media_threshold: 0.4 },
          claim_moderation_scans: [scan],
        },
        ai: null,
        calls,
      }),
      // The AI call below returns a 200 with no choices, which parses to no
      // verdict — the same outcome as an outage.
    });

    expect(result).toMatchObject({ claimed: 1, flagged: 0, scanned: 0, failed: 1 });
    expect(calls.find((call) => call.fn === 'fail_moderation_scan')?.body).toMatchObject({
      p_scan_id: 'scan-1',
    });
    expect(calls.find((call) => call.fn === 'record_ai_scan')).toBeUndefined();
  });
});

describe('runModerationEmailBatch', () => {
  it('does nothing without an email key', async () => {
    const result = await runModerationEmailBatch({
      env: ENV,
      emailEnv: { ...EMAIL_ENV, apiKey: null },
      fetchImpl: router({ rpc: {} }),
    });
    expect(result).toMatchObject({ skipped: true, reason: 'email_not_configured' });
  });

  it('claims, sends and marks an outbox row sent', async () => {
    const calls: Call[] = [];
    const result = await runModerationEmailBatch({
      env: ENV,
      emailEnv: EMAIL_ENV,
      fetchImpl: router({
        rpc: {
          claim_moderation_emails: [
            { email_id: 'mail-1', recipient: 'bo@example.com', subject: 'Heads up', body: 'Body' },
          ],
        },
        resend: { id: 'msg_42' },
        calls,
      }),
    });

    expect(result).toMatchObject({ claimed: 1, sent: 1, failed: 0, skipped: false });
    expect(calls.find((call) => call.fn === 'mark_moderation_email')?.body).toMatchObject({
      p_email_id: 'mail-1',
      p_sent: true,
      p_provider_id: 'msg_42',
    });
  });

  it('marks a row failed when the recipient is missing', async () => {
    const calls: Call[] = [];
    const result = await runModerationEmailBatch({
      env: ENV,
      emailEnv: EMAIL_ENV,
      fetchImpl: router({
        rpc: {
          claim_moderation_emails: [
            { email_id: 'mail-2', recipient: null, subject: 's', body: 'b' },
          ],
        },
        calls,
      }),
    });

    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(calls.find((call) => call.fn === 'mark_moderation_email')?.body).toMatchObject({
      p_sent: false,
      p_error: 'missing_recipient',
    });
  });
});
