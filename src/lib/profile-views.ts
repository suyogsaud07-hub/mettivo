import { supabase } from '@/lib/supabase';
import type {
  ProfileViewerRow,
  ProfileViewSummary,
  RecordProfileViewResult,
} from '@/lib/types';

/**
 * Profile-view analytics data access.
 *
 * All reads and writes go through the SECURITY DEFINER functions in
 * `20261015470000_profile_view_analytics.sql`. The underlying
 * `profile_viewers` table is RPC-only: it has RLS enabled, no policies and no
 * client grants, so a member cannot read or forge viewer identities directly.
 *
 * Owner-facing reads are derived server-side from `auth.uid()` and accept no
 * owner id, so no parameter can point them at another member's analytics.
 * `profile_view_count` accepts a profile id only to return a public aggregate.
 */

/** Raised for expected profile-view failures. */
export class ProfileViewError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ProfileViewError';
    this.code = code;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function parseRecordResult(value: unknown): RecordProfileViewResult | null {
  const raw = asRecord(value);
  if (!raw || typeof raw.recorded !== 'boolean') return null;

  return {
    recorded: raw.recorded,
    reason:
      raw.reason === 'self_view' || raw.reason === 'missing_profile' || raw.reason === 'blocked'
        ? raw.reason
        : undefined,
    is_new_viewer: typeof raw.is_new_viewer === 'boolean' ? raw.is_new_viewer : undefined,
    unique_viewers: asNumber(raw.unique_viewers) ?? undefined,
    total_visits: asNumber(raw.total_visits) ?? undefined,
    viewer_visits: asNumber(raw.viewer_visits) ?? undefined,
  };
}

function parseSummary(value: unknown): ProfileViewSummary | null {
  const raw = asRecord(value);
  if (!raw) return null;

  const unique = asNumber(raw.unique_viewers);
  const returning = asNumber(raw.returning_viewers);
  const visits = asNumber(raw.total_visits);
  if (unique === null || returning === null || visits === null) return null;

  return {
    unique_viewers: unique,
    returning_viewers: returning,
    total_visits: visits,
    most_recent_at: asString(raw.most_recent_at),
  };
}

function parseViewer(value: unknown): ProfileViewerRow | null {
  const raw = asRecord(value);
  if (!raw) return null;

  const viewerId = asString(raw.viewer_id);
  const firstViewedAt = asString(raw.first_viewed_at);
  const lastViewedAt = asString(raw.last_viewed_at);
  const viewCount = asNumber(raw.view_count);
  if (!viewerId || !firstViewedAt || !lastViewedAt || viewCount === null) return null;

  return {
    viewer_id: viewerId,
    first_name: asString(raw.first_name),
    last_name: asString(raw.last_name),
    has_last_name: asBoolean(raw.has_last_name),
    username: asString(raw.username),
    display_name: asString(raw.display_name),
    avatar_url: asString(raw.avatar_url),
    is_online: asBoolean(raw.is_online),
    first_viewed_at: firstViewedAt,
    last_viewed_at: lastViewedAt,
    view_count: viewCount,
    is_followed_by_me: asBoolean(raw.is_followed_by_me),
  };
}

/**
 * Records a genuine visit to `viewedId` for the signed-in member.
 *
 * The database ignores self-views, blocked pairs and missing profiles, so a
 * `recorded: false` result is a normal outcome rather than an error. Callers
 * must treat any failure as nonfatal: analytics must never block the profile
 * from rendering.
 */
export async function recordProfileView(viewedId: string): Promise<RecordProfileViewResult> {
  if (!viewedId) {
    throw new ProfileViewError('A profile id is required.');
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new ProfileViewError('You must be signed in to view profiles.', '28000');
  }

  const { data, error } = await supabase.rpc('record_profile_view', {
    p_viewed_id: viewedId,
  });

  if (error) {
    console.error('[profile-views] record_profile_view failed:', error.message);
    throw new ProfileViewError(error.message, error.code);
  }

  const result = parseRecordResult(data);
  if (!result) {
    console.error('[profile-views] unexpected record_profile_view payload:', data);
    throw new ProfileViewError('Unexpected response from the profile view service.');
  }

  return result;
}

/** The public unique-viewer count for one profile (aggregate only). */
export async function fetchProfileViewCount(profileId: string): Promise<number> {
  if (!profileId) return 0;

  const { data, error } = await supabase.rpc('profile_view_count', {
    p_profile_id: profileId,
  });

  if (error) {
    console.error('[profile-views] profile_view_count failed:', error.message);
    throw new ProfileViewError(error.message, error.code);
  }

  const count = asNumber(data);
  if (count === null) {
    console.error('[profile-views] unexpected profile_view_count payload:', data);
    throw new ProfileViewError('Unexpected response from the profile view service.');
  }

  return count;
}

/** Aggregate analytics for the signed-in member's OWN profile. */
export async function fetchProfileViewSummary(): Promise<ProfileViewSummary> {
  const { data, error } = await supabase.rpc('profile_view_summary');

  if (error) {
    console.error('[profile-views] profile_view_summary failed:', error.message);
    throw new ProfileViewError(error.message, error.code);
  }

  const summary = parseSummary(data);
  if (!summary) {
    console.error('[profile-views] unexpected profile_view_summary payload:', data);
    throw new ProfileViewError('Unexpected response from the profile view service.');
  }

  return summary;
}

export interface FetchProfileViewersOptions {
  limit?: number;
  offset?: number;
  search?: string;
}

/**
 * Viewer identities for the signed-in member's OWN profile, most recent first.
 * The owner is derived server-side; there is no owner parameter to tamper with.
 */
export async function fetchProfileViewers(
  options: FetchProfileViewersOptions = {}
): Promise<ProfileViewerRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const search = options.search?.trim() || null;

  const { data, error } = await supabase.rpc('list_profile_viewers', {
    p_limit: limit,
    p_offset: offset,
    p_search: search,
  });

  if (error) {
    console.error('[profile-views] list_profile_viewers failed:', error.message);
    throw new ProfileViewError(error.message, error.code);
  }

  if (!Array.isArray(data)) {
    console.error('[profile-views] unexpected list_profile_viewers payload:', data);
    throw new ProfileViewError('Unexpected response from the profile view service.');
  }

  return data
    .map(parseViewer)
    .filter((row): row is ProfileViewerRow => row !== null);
}
