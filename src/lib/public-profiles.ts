import { supabase } from '@/lib/supabase';

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
 * Public columns, written as a single literal so supabase-js can infer the row
 * type. Nothing private is named here.
 */
const PUBLIC_PROFILE_COLUMNS =
  'id, display_name, age, gender, city, country, avatar_url, bio, intention, looking_for, hobbies, pets, personality, religion, politics, drinking, smoking, is_online, is_verified, followers_count, following_count, matches_count, profile_likes_count' as const;

/** Loads one member's public profile, or `null` when the id does not exist. */
export async function fetchPublicProfile(userId: string): Promise<PublicProfile | null> {
  const { data, error } = await supabase
    .from('public_profiles')
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('[public-profiles] load failed:', error.message);
    throw new PublicProfileError(error.message, error.code);
  }

  return (data as PublicProfile | null) ?? null;
}
