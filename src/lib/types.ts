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

/** A row from the `reports` table. */
export interface ReportRow {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  reason: string;
  details: string | null;
  status: 'pending' | 'reviewed' | 'dismissed' | 'actioned';
  created_at: string;
  updated_at: string;
}

/** A row from the `blocked_users` table. */
export interface BlockedUserRow {
  id: string;
  blocker_id: string;
  blocked_user_id: string;
  created_at: string;
}

/** Shape returned when joining blocked_users with profiles. */
export interface BlockedUserWithProfile extends BlockedUserRow {
  blocked_profile: ProfileSummary | null;
}

/** A row from the `likes` table. `is_like: false` records a pass. */
export interface LikeRow {
  id: string;
  liker_id: string;
  liked_id: string;
  is_like: boolean;
  created_at: string;
  updated_at: string;
}

/** A row from the `matches` table (canonically ordered unordered pair). */
export interface MatchRow {
  id: string;
  user_a: string;
  user_b: string;
  created_at: string;
}

/** A row from the `user_roles` table. */
export interface UserRoleRow {
  user_id: string;
  role: 'user' | 'moderator' | 'admin';
  granted_at: string;
  granted_by: string | null;
}

/** A row from the `admin_audit_log` table (append-only moderation trail). */
export interface AuditLogRow {
  id: string;
  actor_id: string | null;
  action: string;
  target_user_id: string | null;
  target_report_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export type ReportStatus = 'pending' | 'reviewed' | 'dismissed' | 'actioned';

/** The kinds of notification the backend generates. */
export type NotificationType =
  | 'follow'
  | 'like'
  | 'match'
  | 'message'
  | 'visitor'
  | 'report';

/** A row from the `notifications` table. */
export interface NotificationRow {
  id: string;
  /** Recipient — always the signed-in member for rows they can read. */
  user_id: string;
  /** The member whose action caused this notification. */
  actor_id: string | null;
  type: NotificationType;
  /** Match id, message id or report id, depending on `type`. */
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

/** Public profile fields shown alongside a notification. */
export interface NotificationActor {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  gender: string;
}

/** The kinds of media a Moment can carry. `null` means a legacy inline image. */
export type MomentMediaType = 'image' | 'video';

/** A row from the `moments` table. */
export interface MomentRow {
  id: string;
  author_id: string;
  caption: string | null;
  media: string[];
  /** `image` | `video`; null on rows stored before media_type existed. */
  media_type: MomentMediaType | null;
  tags: string[];
  shares: number;
  /** Total views, maintained server-side by `record_moment_view()`. */
  views_count: number;
  created_at: string;
  updated_at: string;
}

/** A row from the `moment_feed` view — a moment plus aggregated engagement. */
export interface MomentFeedRow extends MomentRow {
  /** Distinct members who have viewed the post. */
  unique_views: number;
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
}

/** A row from the `moment_comments` table. */
export interface MomentCommentRow {
  id: string;
  moment_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

/** Public profile fields shown on a moment card. */
export interface MomentAuthor {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  gender: string;
  country: string;
}

export type GameOutcome = 'win' | 'loss' | 'draw';

/** A row from the `game_results` ledger. */
export interface GameResultRow {
  id: string;
  user_id: string;
  game_id: string;
  outcome: GameOutcome;
  score: number;
  duration_seconds: number | null;
  created_at: string;
}

/** A row from the `game_catalog` table. */
export interface GameCatalogRow {
  game_id: string;
  title: string;
  is_playable: boolean;
  max_score: number | null;
  sort_order: number;
}

/** Aggregated game record for the signed-in member. */
export interface GameStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  /** Percentage 0-100, or null when no games have been played. */
  winRate: number | null;
}





