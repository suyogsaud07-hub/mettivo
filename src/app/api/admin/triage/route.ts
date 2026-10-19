import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { errorContext, logger } from '@/lib/logger';
import { adviseOnReport } from '@/lib/moderation/report-ai';
import { assessReport, type ReportRecord } from '@/lib/moderation/triage';

/**
 * M30 — AI-assisted report triage.
 *
 * AUTHORISATION IS SERVER-SIDE AND DATABASE-BACKED
 *   The caller must be signed in AND `is_moderator()` must return true, checked
 *   here on the server. The dashboard hiding a button is never the boundary.
 *
 * WHAT IT DOES NOT DO
 *   It returns an assessment. It does not enforce anything: no report is
 *   resolved, no account is suspended. Enforcement stays in the existing,
 *   moderator-gated RPCs. A model response can never bypass that.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BODY_BYTES = 1_200_000;
const MAX_DETAILS_CHARS = 2_000;
const MAX_RELATED = 50;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

interface RateWindow {
  startedAt: number;
  count: number;
}
const windows = new Map<string, RateWindow>();

function isRateLimited(userId: string, now: number): boolean {
  const existing = windows.get(userId);
  if (!existing || now - existing.startedAt > RATE_LIMIT_WINDOW_MS) {
    windows.set(userId, { startedAt: now, count: 1 });
    for (const [key, window] of windows) {
      if (now - window.startedAt > RATE_LIMIT_WINDOW_MS) windows.delete(key);
    }
    return false;
  }
  existing.count += 1;
  return existing.count > RATE_LIMIT_MAX;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

function optionalStr(value: unknown, max: number): string | null {
  return str(value, max);
}

function parseReport(value: unknown): ReportRecord | null {
  if (!isRecord(value)) return null;
  const reportId = str(value.reportId, 128);
  const category = str(value.category, 64);
  const reporterId = str(value.reporterId, 128);
  const reportedId = str(value.reportedId, 128);
  if (!reportId || !category || !reporterId || !reportedId) return null;

  return {
    reportId,
    category,
    targetType: optionalStr(value.targetType, 32),
    targetId: optionalStr(value.targetId, 128),
    details: optionalStr(value.details, MAX_DETAILS_CHARS),
    hasEvidenceImage: value.hasEvidenceImage === true,
    reporterId,
    reportedId,
    status: optionalStr(value.status, 32) ?? 'pending',
    createdAt: optionalStr(value.createdAt, 64),
  };
}

async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {}
        },
      },
    }
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const now = Date.now();
  const declaredLength = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (!isRecord(raw)) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const report = parseReport(raw.report);
  if (!report) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const relatedReports = (Array.isArray(raw.relatedReports) ? raw.relatedReports : [])
    .slice(0, MAX_RELATED)
    .map(parseReport)
    .filter((entry): entry is ReportRecord => entry !== null);

  const evidenceImage = optionalStr(raw.evidenceImage, 700_000);
  const useAi = raw.useAi !== false;

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

    const { data: moderator, error: roleError } = await supabase.rpc('is_moderator');
    if (roleError) {
      logger.error('admin.triage_role_check_failed', 'is_moderator() failed.', {
        message: roleError.message,
      });
      return NextResponse.json({ error: 'role_check_failed' }, { status: 500 });
    }
    if (moderator !== true) {
      logger.warn('admin.triage_forbidden', 'A non-moderator requested triage.', { userId: user.id });
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    if (isRateLimited(user.id, now)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    // The AI advisory is best-effort and never blocks the assessment: an outage
    // degrades to a deterministic, evidence-only result.
    const signal = useAi
      ? await adviseOnReport({
          category: report.category,
          targetType: report.targetType,
          details: report.details,
          hasEvidenceImage: report.hasEvidenceImage,
          evidenceImage,
        })
      : null;

    const assessment = assessReport({ report, relatedReports, signal });

    return NextResponse.json(
      { assessment, aiAvailable: signal !== null, requestedAi: useAi },
      { status: 200 }
    );
  } catch (error) {
    console.error('ADMIN TRIAGE ERROR:', error instanceof Error ? error.message : 'unknown error');
    logger.error('admin.triage_failed', 'Triage failed before an assessment was produced.', {
      ...errorContext(error),
    });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
