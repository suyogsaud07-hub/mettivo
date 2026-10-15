import { NextResponse } from 'next/server';
import { buildLogRecord, redact } from '@/lib/logger';

/**
 * R-08 — the client error sink.
 *
 * Accepts a small, redacted report from `reportClientError()` and writes it as
 * one structured JSON line. It deliberately does not persist anything itself:
 * the destination is whatever the platform already collects stdout into, so
 * there is no second copy of personal data to secure, expire or delete.
 *
 * PROTECTIONS
 *   * the body is size-capped before it is parsed
 *   * the payload is re-redacted here, because the sender is the browser and
 *     the browser is not trusted to have redacted anything
 *   * a fixed-window counter bounds the rate, so a render loop cannot flood the
 *     log pipeline (and cannot be used to inflate its cost)
 */

const MAX_BODY_BYTES = 4_096;
const MAX_EVENT_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 300;

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

// Per-process counters. On a serverless platform each instance counts
// independently, which is an acceptable bound: the goal is flood protection,
// not an exact quota.
let windowStartedAt = 0;
let windowCount = 0;

function isRateLimited(now: number): boolean {
  if (now - windowStartedAt > WINDOW_MS) {
    windowStartedAt = now;
    windowCount = 0;
  }
  windowCount += 1;
  return windowCount > MAX_PER_WINDOW;
}

function readString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined;
}

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const now = Date.now();

  if (isRateLimited(now)) {
    return NextResponse.json({ ok: false, error: 'rate limited' }, { status: 429 });
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: 'payload too large' }, { status: 413 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return NextResponse.json({ ok: false, error: 'expected an object' }, { status: 400 });
  }

  const body = raw as Record<string, unknown>;

  // Re-redacted here on purpose: the browser is not trusted to have done it.
  const context = redact(body.context ?? {}) as Record<string, unknown>;

  const record = buildLogRecord(
    'error',
    readString(body.event, MAX_EVENT_LENGTH) ?? 'client.unknown',
    readString(body.message, MAX_MESSAGE_LENGTH),
    {
      ...context,
      route: readString(body.route, 200),
      source: 'client',
    },
    new Date(now)
  );

  console.error(JSON.stringify(record));

  // 204: the client has nothing useful to do with a body, and this keeps the
  // reporter as cheap as possible on a failing page.
  return new NextResponse(null, { status: 204 });
}
