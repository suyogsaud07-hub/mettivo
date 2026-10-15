/**
 * M21 — the moderation worker: AI scan + email outbox batches.
 *
 * SERVER ONLY. This module never runs in the browser: it holds the shared
 * worker secret and calls the database's secret-gated RPCs over PostgREST with
 * the public anon key. The project has no application server and the
 * `service_role` key must never reach source control, so the SECRET is the
 * authorisation boundary for these functions.
 *
 * IDENTITY
 *   The worker never names a member to punish. It claims a scan the database
 *   already attributed to the content's author, asks the classifier for a
 *   verdict, and hands the verdict back. `record_ai_scan()` — running as the
 *   definer — is the only thing that can restrict anyone, and only the author of
 *   the scanned row.
 *
 * Everything is injectable (`env`, `fetchImpl`, `aiEnv`, `emailEnv`) so the
 * whole loop is unit-testable offline, with no network and no real secret.
 */

import {
  classifyContent,
  readAiEnv,
  type AiEnv,
  type ModerationContentType,
  type SuggestedAction,
} from '@/lib/moderation/ai';
import { readEmailEnv, sendModerationEmail, type EmailEnv } from '@/lib/moderation/email';

export interface WorkerEnv {
  supabaseUrl: string;
  anonKey: string;
  workerSecret: string | null;
}

export function readWorkerEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  const workerSecret = (source['MODERATION_WORKER_SECRET'] ?? '').trim();
  return {
    supabaseUrl: (source['NEXT_PUBLIC_SUPABASE_URL'] ?? '').trim().replace(/\/+$/, ''),
    anonKey: (source['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '').trim(),
    workerSecret: workerSecret || null,
  };
}

export interface ScanRow {
  scan_id: string;
  user_id: string;
  content_type: ModerationContentType;
  content_id: string | null;
  content_text: string | null;
  content_url: string | null;
  report_id: string | null;
}

export interface EmailRow {
  email_id: string;
  recipient: string | null;
  subject: string;
  body: string;
}

export interface ModerationPolicy {
  ai_text_threshold: number;
  ai_media_threshold: number;
}

type RpcBody = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Calls a PostgREST RPC and returns the parsed JSON. Throws when the endpoint is
 * unreachable or refuses the call — the caller reports the batch as failed
 * rather than swallowing it.
 */
async function callRpc(
  env: WorkerEnv,
  fetchImpl: typeof fetch,
  fn: string,
  body: RpcBody
): Promise<unknown> {
  const response = await fetchImpl(`${env.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.anonKey,
      Authorization: `Bearer ${env.anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`rpc_${fn}_http_${response.status}`);
  }

  const text = await response.text();
  if (text.trim() === '') return null;
  return JSON.parse(text) as unknown;
}

function toScanRows(value: unknown): ScanRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((row) => ({
    scan_id: String(row.scan_id),
    user_id: String(row.user_id),
    content_type: row.content_type as ModerationContentType,
    content_id: row.content_id == null ? null : String(row.content_id),
    content_text: row.content_text == null ? null : String(row.content_text),
    content_url: row.content_url == null ? null : String(row.content_url),
    report_id: row.report_id == null ? null : String(row.report_id),
  }));
}

function toEmailRows(value: unknown): EmailRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((row) => ({
    email_id: String(row.email_id),
    recipient: row.recipient == null ? null : String(row.recipient),
    subject: String(row.subject),
    body: String(row.body),
  }));
}

function toPolicy(value: unknown): ModerationPolicy {
  const text = isRecord(value) ? Number(value.ai_text_threshold) : NaN;
  const media = isRecord(value) ? Number(value.ai_media_threshold) : NaN;
  return {
    ai_text_threshold: Number.isFinite(text) ? text : 0.75,
    ai_media_threshold: Number.isFinite(media) ? media : 0.6,
  };
}

/** The threshold a content type is judged against. Media uses the media cut-off. */
function thresholdFor(policy: ModerationPolicy, contentType: ModerationContentType): number {
  return contentType === 'profile_photo' || contentType === 'live_snapshot'
    ? policy.ai_media_threshold
    : policy.ai_text_threshold;
}

export interface ScanBatchResult {
  claimed: number;
  flagged: number;
  scanned: number;
  failed: number;
  skipped: boolean;
  reason?: 'worker_secret_missing' | 'ai_not_configured' | 'database_unconfigured';
}

export interface ScanBatchDeps {
  env?: WorkerEnv;
  fetchImpl?: typeof fetch;
  aiEnv?: AiEnv;
  aiFetchImpl?: typeof fetch;
  limit?: number;
}

/**
 * Claims a batch of queued scans, classifies each, and records the verdict.
 *
 * A classifier failure calls `fail_moderation_scan()` so the item returns to the
 * queue; it is never recorded as clean. Content is only ever enforced when a
 * real verdict comes back.
 */
export async function runModerationScanBatch(
  deps: ScanBatchDeps = {}
): Promise<ScanBatchResult> {
  const env = deps.env ?? readWorkerEnv();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const aiEnv = deps.aiEnv ?? readAiEnv();
  // One injected transport can serve every call; a caller may still override the
  // classifier's transport specifically.
  const aiFetchImpl = deps.aiFetchImpl ?? deps.fetchImpl ?? fetch;

  if (!env.supabaseUrl || !env.anonKey) {
    return { claimed: 0, flagged: 0, scanned: 0, failed: 0, skipped: true, reason: 'database_unconfigured' };
  }
  if (!env.workerSecret) {
    return { claimed: 0, flagged: 0, scanned: 0, failed: 0, skipped: true, reason: 'worker_secret_missing' };
  }
  if (!aiEnv.apiKey) {
    return { claimed: 0, flagged: 0, scanned: 0, failed: 0, skipped: true, reason: 'ai_not_configured' };
  }

  const policy = toPolicy(
    await callRpc(env, fetchImpl, 'moderation_policy', { p_secret: env.workerSecret })
  );

  const claimed = toScanRows(
    await callRpc(env, fetchImpl, 'claim_moderation_scans', {
      p_secret: env.workerSecret,
      p_limit: deps.limit ?? 10,
    })
  );

  let flagged = 0;
  let scanned = 0;
  let failed = 0;

  for (const scan of claimed) {
    const verdict = await classifyContent(
      {
        contentType: scan.content_type,
        contentText: scan.content_text,
        contentUrl: scan.content_url,
      },
      { fetchImpl: aiFetchImpl, env: aiEnv }
    );

    if (!verdict) {
      failed += 1;
      await callRpc(env, fetchImpl, 'fail_moderation_scan', {
        p_secret: env.workerSecret,
        p_scan_id: scan.scan_id,
        p_error: 'classifier_unavailable',
      });
      continue;
    }

    const isFlagged = verdict.flagged && verdict.score >= thresholdFor(policy, scan.content_type);
    scanned += 1;
    if (isFlagged) flagged += 1;

    await callRpc(env, fetchImpl, 'record_ai_scan', {
      p_secret: env.workerSecret,
      p_scan_id: scan.scan_id,
      p_flagged: isFlagged,
      p_score: verdict.score,
      p_categories: verdict.categories,
      p_provider: verdict.provider,
      p_model: verdict.model,
      p_suggested_action: verdict.suggestedAction,
    });
  }

  return { claimed: claimed.length, flagged, scanned, failed, skipped: false };
}

export interface EmailBatchResult {
  claimed: number;
  sent: number;
  failed: number;
  skipped: boolean;
  reason?: 'worker_secret_missing' | 'email_not_configured' | 'database_unconfigured';
}

export interface EmailBatchDeps {
  env?: WorkerEnv;
  fetchImpl?: typeof fetch;
  emailEnv?: EmailEnv;
  emailFetchImpl?: typeof fetch;
  limit?: number;
}

/** Claims pending outbox rows, sends each, and marks the result. */
export async function runModerationEmailBatch(
  deps: EmailBatchDeps = {}
): Promise<EmailBatchResult> {
  const env = deps.env ?? readWorkerEnv();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const emailEnv = deps.emailEnv ?? readEmailEnv();
  const emailFetchImpl = deps.emailFetchImpl ?? deps.fetchImpl ?? fetch;

  if (!env.supabaseUrl || !env.anonKey) {
    return { claimed: 0, sent: 0, failed: 0, skipped: true, reason: 'database_unconfigured' };
  }
  if (!env.workerSecret) {
    return { claimed: 0, sent: 0, failed: 0, skipped: true, reason: 'worker_secret_missing' };
  }
  if (!emailEnv.apiKey) {
    return { claimed: 0, sent: 0, failed: 0, skipped: true, reason: 'email_not_configured' };
  }

  const rows = toEmailRows(
    await callRpc(env, fetchImpl, 'claim_moderation_emails', {
      p_secret: env.workerSecret,
      p_limit: deps.limit ?? 20,
    })
  );

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.recipient) {
      await callRpc(env, fetchImpl, 'mark_moderation_email', {
        p_secret: env.workerSecret,
        p_email_id: row.email_id,
        p_sent: false,
        p_error: 'missing_recipient',
      });
      failed += 1;
      continue;
    }

    const result = await sendModerationEmail(
      { to: row.recipient, subject: row.subject, body: row.body },
      { fetchImpl: emailFetchImpl, env: emailEnv }
    );

    if (result.sent) {
      sent += 1;
      await callRpc(env, fetchImpl, 'mark_moderation_email', {
        p_secret: env.workerSecret,
        p_email_id: row.email_id,
        p_sent: true,
        p_provider: result.provider,
        p_provider_id: result.providerId,
      });
    } else {
      failed += 1;
      await callRpc(env, fetchImpl, 'mark_moderation_email', {
        p_secret: env.workerSecret,
        p_email_id: row.email_id,
        p_sent: false,
        p_provider: result.provider,
        p_error: result.skipped ? 'provider_not_configured' : result.error,
      });
    }
  }

  return { claimed: rows.length, sent, failed, skipped: false };
}

export type { SuggestedAction };
