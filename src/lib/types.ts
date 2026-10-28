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
  /** M26: when the OTHER participant's device received the message. */
  delivered_at?: string | null;
  /** M26: when the OTHER participant read the message. */
  seen_at?: string | null;
}

/** Minimal profile fields used by list views. */
export interface ProfileSummary {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

/** The categories a report can carry (M25 `reports.category` CHECK). */
export type ReportCategory =
  | 'abuse_text'
  | 'explicit_media'
  | 'indecent_live'
  | 'underage'
  | 'other'
  | 'nudity'
  | 'harassment'
  | 'spam';

/** What a report points at (M25 `reports.target_type`). */
export type ReportTargetType =
  | 'user'
  | 'message'
  | 'moment'
  | 'comment'
  | 'live'
  | 'bio'
  | 'photo'
  | 'chat'
  | 'voice';

/** A disappearing chat media row (M25/M26 `chat_media`). */
export interface ChatMediaRow {
  id: string;
  message_id: string;
  match_id: string;
  sender_id: string;
  storage_path: string;
  media_type: MomentMediaType;
  /** M25 legacy flag; superseded by `view_limit`/`view_count` in M26. */
  view_once: boolean;
  /** M26: how many times the recipient may open the item. */
  view_limit: number;
  /** M26: how many times the recipient has opened it. */
  view_count: number;
  expires_at: string;
  viewed_at: string | null;
  created_at: string;
}

/** A per-conversation retention setting (M26 `chat_settings`). */
export interface ChatSettingsRow {
  match_id: string;
  /** Non-null enables disappearing mode; the window in seconds. */
  disappear_after_seconds: number | null;
  updated_at: string;
}

/** A row from the `reports` table. */
export interface ReportRow {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  reason: string;
  details: string | null;
  /** M21 classification. Null on rows written before M21. */
  category: ReportCategory | null;
  /** M21: what the report is about. */
  target_type: ReportTargetType | null;
  target_id: string | null;
  /** M21: server-captured content snapshot. */
  context: string | null;
  /** M21: whether the AI worker flagged this report's content. */
  ai_flagged: boolean;
  ai_score: number | null;
  /** M21: the action the safety pipeline took, if any. */
  action_taken: string | null;
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
  user_a_id: string;
  user_b_id: string;
  kind: 'match' | 'mutual_follow' | 'request' | 'closed';
  request_status: 'not_applicable' | 'pending' | 'accepted' | 'rejected';
  requested_by: string | null;
  requested_at: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
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
  | 'report'
  /** M21: a safety warning, e.g. an AI-flagged message or a ban. */
  | 'warning';

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
  /** M21: the human-readable body of a system notification (warnings). */
  body: string | null;
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

/**
 * Who may see a Moment (M22 post privacy).
 *
 *   only_me  the author alone
 *   matches  members who follow the author or share a mutual match
 *   public   any signed-in member
 *
 * Enforced in the database by `can_view_moment()` and repeated in the
 * `moment_feed` view predicate; the client only ever reads what RLS returns.
 */
export type MomentVisibility = 'only_me' | 'matches' | 'public';

/**
 * Whether a Moment is an ordinary Post or a vertical Reel.
 *
 * A Reel is exactly one video with a declared duration of at most 120 seconds;
 * a Post is a single image, a multi-image carousel, or an ordinary video.
 */
export type MomentKind = 'post' | 'reel';

/** The moderation lifecycle of a Moment. Only `approved` shows to others. */
export type MomentModerationStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'failed_review';

/** A row from the `moments` table. */
export interface MomentRow {
  id: string;
  author_id: string;
  caption: string | null;
  media: string[];
  /** `image` | `video`; null on rows stored before media_type existed. */
  media_type: MomentMediaType | null;
  /** Post or Reel; absent on a legacy view is treated as `post`. */
  content_kind: MomentKind;
  /** Declared media duration in seconds, or null for images. */
  duration_seconds: number | null;
  /** Creator switch controlling whether viewers may download the media. */
  allow_downloads: boolean;
  /** Moderation lifecycle; only `approved` is public. */
  moderation_status: MomentModerationStatus;
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
  save_count: number;
  liked_by_me: boolean;
  saved_by_me: boolean;
  /** M22 privacy tier; absent on a legacy view is treated as `public`. */
  visibility: MomentVisibility;
}

/** A row from the `moment_archive` view — an archived post (author only). */
export interface MomentArchiveRow extends MomentFeedRow {
  /** Always set: the moment left the profile at this time. */
  archived_at: string;
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

/**
 * One distinct member who viewed the signed-in profile owner.
 *
 * A repeated visit stays the SAME row: `view_count` grows and `last_viewed_at`
 * moves, so a returning viewer is never double-counted as a new one.
 */
export interface ProfileViewerRow {
  viewer_id: string;
  first_name: string | null;
  last_name: string | null;
  has_last_name: boolean;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_online: boolean;
  first_viewed_at: string;
  last_viewed_at: string;
  /** Total recorded visits by this viewer (> 1 means returning). */
  view_count: number;
  is_followed_by_me: boolean;
}

/** Aggregate metrics for the signed-in member's own profile views. */
export interface ProfileViewSummary {
  /** Distinct accounts, the primary public metric. */
  unique_viewers: number;
  /** Distinct accounts with more than one recorded visit. */
  returning_viewers: number;
  /** All recorded visits, including repeats. Never labelled as unique. */
  total_visits: number;
  /** Most recent visit, or null when nobody has viewed the profile. */
  most_recent_at: string | null;
}

/** Result of recording a profile visit through `record_profile_view`. */
export interface RecordProfileViewResult {
  recorded: boolean;
  reason?: 'self_view' | 'missing_profile' | 'blocked';
  is_new_viewer?: boolean;
  unique_viewers?: number;
  total_visits?: number;
  viewer_visits?: number;
}





