/**
 * M21 — server-side moderation email sender (Resend).
 *
 * SERVER ONLY. Reads `RESEND_API_KEY`, a private value
 * (`CONSTITUTION.md` Article 1.5). Imported by the `/api/moderation/email`
 * route and its unit test only — never from a component.
 *
 * GRACEFUL DEGRADATION
 *   With no key configured the sender reports `{ sent: false, skipped: true }`
 *   and the route leaves the outbox rows untouched, so warning mail starts
 *   flowing the moment an operator adds the key — nothing is lost in the
 *   meantime.
 *
 * The envelope is deliberately tiny: a recipient, a subject and a plain body
 * that the database already composed. The worker never invents copy.
 */

export interface ModerationEmail {
  to: string;
  subject: string;
  body: string;
}

export interface EmailEnv {
  apiKey: string | null;
  from: string;
}

export type EmailResult =
  | { sent: true; providerId: string | null; provider: string }
  | { sent: false; skipped: true; provider: string }
  | { sent: false; skipped: false; provider: string; error: string };

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Mettivo Safety <safety@mettivo.app>';
const UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 16_384;

/**
 * Reads the email configuration through the injected-source pattern, so the
 * secrets scan stays meaningful without weakening the server-only guarantee.
 */
export function readEmailEnv(source: Record<string, string | undefined> = process.env): EmailEnv {
  const apiKey = (source['RESEND_API_KEY'] ?? '').trim();
  const from = (source['MODERATION_EMAIL_FROM'] ?? '').trim() || DEFAULT_FROM;
  return { apiKey: apiKey || null, from };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function sendModerationEmail(
  email: ModerationEmail,
  deps: { fetchImpl?: typeof fetch; env?: EmailEnv } = {}
): Promise<EmailResult> {
  const env = deps.env ?? readEmailEnv();
  const provider = 'resend';

  if (!env.apiKey) {
    return { sent: false, skipped: true, provider };
  }
  if (!email.to || !email.subject) {
    return { sent: false, skipped: false, provider, error: 'missing_recipient' };
  }

  const fetchImpl = deps.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.from,
        to: [email.to],
        subject: email.subject,
        text: email.body,
      }),
    });
  } catch (error) {
    return {
      sent: false,
      skipped: false,
      provider,
      error: error instanceof Error ? error.name : 'network_error',
    };
  }

  if (!response.ok) {
    // The body can echo the recipient address, so it is read only to bound it,
    // never returned or logged.
    return { sent: false, skipped: false, provider, error: `http_${response.status}` };
  }

  let payload: unknown = null;
  try {
    const text = await response.text();
    if (text.length <= MAX_RESPONSE_BYTES) payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  const providerId = isRecord(payload) && typeof payload.id === 'string' ? payload.id : null;
  return { sent: true, providerId, provider };
}
