/**
 * Shared database row types.
 *
 * These mirror the Supabase tables the app reads. They live in one module so
 * pages do not each re-declare (or loosely `any`-type) the same shapes.
 */

/** A row from the `messages` table. */
export interface MessageRow {
  id: string;
  match_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

/** Minimal profile fields used by list views. */
export interface ProfileSummary {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}
