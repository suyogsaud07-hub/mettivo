import { supabase } from '@/lib/supabase';
import { isMissingColumnError } from '@/lib/postgrest-errors';

/**
 * Public profile reads.
 *
 * Reads go through the `public_profiles` view, never `public.profiles`:
 *   * the view is an explicit allow-list, so private columns (`birth_date`) and
 *     moderation columns can never leak even though the view is not row-filtered
 *     (`AGENTS.md`: never `select *` on profiles for a public surface);
 *   * it carries the denormalised social counters (M18), which a third party
 *     cannot derive directly because `follows` / `likes` are RLS-scoped to the
 *     caller's own edges.
 *
 * Email and phone are NOT here and must not be: they live on the auth user and
 * belong to nobody but their owner.
 */

/** Raised for expected public-profile load failures. */
export class PublicProfileError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'PublicProfileError';
    this.code = code;
  }
}

/** The allow-listed shape of another member's profile. */
export interface PublicProfile {
  id: string;
  display_name: string | null;
  age: number | null;
  gender: string | null;
  city: string | null;
  country: string | null;
  avatar_url: string | null;
  bio: string | null;
  intention: string | null;
  looking_for: string[] | null;
  hobbies: string[] | null;
  pets: string[] | null;
  personality: string[] | null;
  religion: string | null;
  politics: string | null;
  drinking: string | null;
  smoking: string | null;
  is_online: boolean | null;
  is_verified: boolean | null;
  followers_count: number | null;
  following_count: number | null;
  matches_count: number | null;
  profile_likes_count: number | null;
}

/**
 * Public columns, written as single literals so supabase-js can infer the row
 * type. Nothing private is named here.
 *
 * The four social counters are split out because they only exist once M18 has
 * run. On a deployment that is behind, requesting them fails with `42703` and
 * would otherwise make every public profile unreachable; the fallback reads the
 * core projection and reports the counters as zero.
 */
const PUBLIC_PROFILE_CORE_COLUMNS =
  'id, display_name, age, gender, city, country, avatar_url, bio, intention, looking_for, hobbies, pets, personality, religion, politics, drinking, smoking, is_online, is_verified' as const;

const PUBLIC_PROFILE_COUNT_COLUMNS =
  'followers_count, following_count, matches_count, profile_likes_count' as const;

const PUBLIC_PROFILE_COLUMNS = `${PUBLIC_PROFILE_CORE_COLUMNS}, ${PUBLIC_PROFILE_COUNT_COLUMNS}` as const;

/** The view row without the optional counter columns. */
type PublicProfileCore = Omit<
  PublicProfile,
  'followers_count' | 'following_count' | 'matches_count' | 'profile_likes_count'
>;

/** Zeros the counters so a partially migrated view still yields a profile. */
function withDefaultCounts(row: PublicProfileCore): PublicProfile {
  return {
    ...row,
    followers_count: 0,
    following_count: 0,
    matches_count: 0,
    profile_likes_count: 0,
  };
}

/** Loads one member's public profile, or `null` when the id does not exist. */
export async function fetchPublicProfile(userId: string): Promise<PublicProfile | null> {
  const { data, error } = await supabase
    .from('public_profiles')
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    // The M18 counters may not exist yet; re-read the core projection instead of
    // failing the whole profile.
    if (isMissingColumnError(error)) {
      const fallback = await supabase
        .from('public_profiles')
        .select(PUBLIC_PROFILE_CORE_COLUMNS)
        .eq('id', userId)
        .maybeSingle();

      if (fallback.error) {
        console.error('[public-profiles] load failed (core fallback):', fallback.error.message);
        throw new PublicProfileError(fallback.error.message, fallback.error.code);
      }

      return fallback.data ? withDefaultCounts(fallback.data as PublicProfileCore) : null;
    }

    console.error('[public-profiles] load failed:', error.message);
    throw new PublicProfileError(error.message, error.code);
  }

  return (data as PublicProfile | null) ?? null;
}
