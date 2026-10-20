import { supabase } from '@/lib/supabase';
import { rankCandidates, type MatchProfile, type RankedCandidate, type RankOptions } from '@/lib/matching';

/**
 * M9 + M12 — the discovery surface, client side.
 *
 * TWO RESPONSIBILITIES, DELIBERATELY SEPARATED
 *   1. `fetchDiscoveryCandidates` — asks PostgreSQL for who is *eligible*.
 *      Eligibility (blocked, suspended, already decided, non-onboarded) is
 *      decided by `discover_profiles()` and cannot be influenced by the browser.
 *   2. `rankDiscovery` — orders the eligible set. Pure, deterministic, testable.
 *
 * The old implementation read `profiles` with `select('*')` and filtered in the
 * browser, which meant a blocked member was only hidden by the client's good
 * behaviour -- and that every candidate's `birth_date` crossed the wire.
 */

/** Raised for an expected failure while loading the discovery feed. */
export class DiscoveryError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'DiscoveryError';
    this.code = code;
  }
}

/** A candidate as returned by `discover_profiles()`, in camelCase. */
export interface DiscoveryCandidate extends MatchProfile {
  id: string;
  firstName: string | null;
  lastName: string | null;
  hasLastName: boolean;
  username: string | null;
  displayName: string;
  age: number | null;
  gender: string | null;
  city: string | null;
  country: string | null;
  avatarUrl: string | null;
  photos: string[];
  bio: string | null;
  intention: string | null;
  lookingFor: string[];
  hobbies: string[];
  pets: string[];
  mbti: string | null;
  interests: string[];
  promptAnswers: Record<string, string>;
  online: boolean;
}

export interface DiscoveryFilters {
  minAge?: number;
  maxAge?: number;
  genders?: string[] | null;
  limit?: number;
  onlineOnly?: boolean;
}

/** Safety rails mirrored in SQL: `discover_profiles` clamps to the same range. */
export const DISCOVERY_DEFAULT_LIMIT = 50;
export const DISCOVERY_MAX_LIMIT = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

/** `text[]` arrives as an array; anything else is treated as empty. */
function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/** `jsonb` arrives as an object; anything else is treated as empty. */
function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') result[key] = item;
  }
  return result;
}

/**
 * Narrows one RPC row. Returns `null` rather than casting, so a schema change
 * drops the row instead of putting `undefined` in front of a member.
 */
function parseCandidate(row: unknown): DiscoveryCandidate | null {
  if (!isRecord(row)) return null;
  const id = str(row.id);
  if (!id) return null;

  return {
    id,
    firstName: str(row.first_name),
    lastName: str(row.last_name),
    hasLastName: row.has_last_name === true,
    username: str(row.username),
    displayName: str(row.display_name) ?? 'Member',
    age: num(row.age),
    gender: str(row.gender),
    city: str(row.city),
    country: str(row.country),
    avatarUrl: str(row.avatar_url),
    photos: strArray(row.photos),
    bio: str(row.bio),
    intention: str(row.intention),
    lookingFor: strArray(row.looking_for),
    hobbies: strArray(row.hobbies),
    pets: strArray(row.pets),
    mbti: str(row.mbti),
    interests: strArray(row.interests),
    promptAnswers: stringRecord(row.prompts),
    online: bool(row.is_online),
  };
}

/** Clamps a requested page size into the range the database will honour. */
export function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DISCOVERY_DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.trunc(limit), DISCOVERY_MAX_LIMIT));
}

/**
 * Fetches the eligible candidate set for the signed-in member.
 *
 * Throws `DiscoveryError` with a member-safe message on failure. Returning an
 * empty array on error would look like "nobody is online", which is a lie and
 * hides an outage (`CONSTITUTION.md` Article 2.7).
 */
export async function fetchDiscoveryCandidates(
  filters: DiscoveryFilters = {}
): Promise<DiscoveryCandidate[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new DiscoveryError('You must be signed in to browse members.', '28000');
  }

  const { data, error } = await supabase.rpc('discover_profiles', {
    p_min_age: filters.minAge ?? 18,
    p_max_age: filters.maxAge ?? 99,
    p_genders: filters.genders && filters.genders.length > 0 ? filters.genders : null,
    p_limit: clampLimit(filters.limit),
    p_online_only: filters.onlineOnly ?? false,
  });

  if (error) {
    console.error('[discovery] discover_profiles failed:', error.message);
    throw new DiscoveryError(
      'We could not load members right now. Please try again.',
      error.code
    );
  }

  const rows = Array.isArray(data) ? data : [];
  return rows.map(parseCandidate).filter((row): row is DiscoveryCandidate => row !== null);
}

/**
 * Orders the eligible set. `excludeIds` is defence in depth: the database
 * already removes blocked members, and passing the locally known block list
 * means a stale response can never surface someone the member just blocked.
 */
export function rankDiscovery(
  me: MatchProfile,
  candidates: readonly DiscoveryCandidate[],
  options: RankOptions = {}
): RankedCandidate<DiscoveryCandidate>[] {
  return rankCandidates(me, candidates, {
    requireIntentionalFit: true,
    ...options,
  });
}
