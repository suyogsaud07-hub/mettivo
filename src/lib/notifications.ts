import { isMissingColumnError } from '@/lib/postgrest-errors';
import { supabase } from '@/lib/supabase';
import type { NotificationActor, NotificationRow, NotificationType } from '@/lib/types';

/**
 * Notifications data access.
 *
 * Rows are generated server-side by the triggers in
 * `supabase/migrations/20261015160000_notifications_realtime.sql`. The
 * `notifications_select_own` RLS policy means a member can only ever read,
 * update or delete their own rows — this module cannot widen that.
 */

/** Raised for expected notification failures. */
export class NotificationError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'NotificationError';
    this.code = code;
  }
}

/** UI tabs, mapped to the notification types each one shows. */
export const NOTIFICATION_TABS = ['All', 'Follows', 'Likes', 'Activity', 'Safety', 'Visitors'] as const;
export type NotificationTab = (typeof NOTIFICATION_TABS)[number];

const TAB_TYPES: Record<NotificationTab, NotificationType[] | null> = {
  All: null,
  Follows: ['follow'],
  Likes: ['like'],
  Activity: ['match', 'message'],
  // Safety carries the M21 warnings and the outcome of a report you filed.
  Safety: ['warning', 'report'],
  Visitors: ['visitor'],
};

/** Types included in a tab, or null for "everything". */
export function typesForTab(tab: NotificationTab): NotificationType[] | null {
  return TAB_TYPES[tab] ?? null;
}

/** Human-readable sentence for a notification, matching the existing card copy. */
export function describeNotification(type: NotificationType): string {
  switch (type) {
    case 'follow':
      return 'started following you.';
    case 'like':
      return 'liked your profile.';
    case 'match':
      return "it's a match! You liked each other.";
    case 'message':
      return 'sent you a message.';
    case 'visitor':
      return 'visited your profile.';
    case 'report':
      return 'your report was reviewed and actioned.';
    case 'warning':
      return 'the safety team sent you a notice.';
    default:
      return 'sent you an update.';
  }
}

/**
 * Label for the card's action button, and where it should go.
 * Returns null when no action makes sense for that kind of notification.
 */
export function actionForNotification(
  notification: NotificationRow
): { label: string; href: string } | null {
  switch (notification.type) {
    case 'match':
      return notification.entity_id
        ? { label: 'Message', href: `/chat/${notification.entity_id}` }
        : null;
    case 'message':
      return notification.entity_id
        ? { label: 'Reply', href: `/chat/${notification.entity_id}` }
        : null;
    case 'like':
      return { label: 'View', href: '/discover' };
    case 'follow':
      return { label: 'View', href: '/people' };
    case 'visitor':
      return notification.actor_id
        ? { label: 'View', href: `/profile/${notification.actor_id}` }
        : null;
    default:
      return null;
  }
}

/** "3 minutes ago" style label. Rendered client-side only, after data loads. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

/** Newest first. RLS restricts the result to the caller's own rows. */
export async function fetchNotifications(limit = 100): Promise<NotificationRow[]> {
  // `body` arrived in a later migration (M21). A deployment that is behind would
  // otherwise fail the whole read with 42703, so degrade to the columns that
  // exist rather than blanking the page.
  const withBody = await supabase
    .from('notifications')
    .select('id, user_id, actor_id, type, entity_id, body, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!withBody.error) return (withBody.data ?? []) as NotificationRow[];

  if (!isMissingColumnError(withBody.error)) {
    console.error('[notifications] load failed:', withBody.error.message);
    throw new NotificationError(withBody.error.message, withBody.error.code);
  }

  const withoutBody = await supabase
    .from('notifications')
    .select('id, user_id, actor_id, type, entity_id, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (withoutBody.error) {
    console.error('[notifications] load failed:', withoutBody.error.message);
    throw new NotificationError(withoutBody.error.message, withoutBody.error.code);
  }

  return ((withoutBody.data ?? []) as Omit<NotificationRow, 'body'>[]).map((row) => ({
    ...row,
    body: null,
  }));
}

/**
 * Unread count for the signed-in member, used by the navigation badge.
 *
 * There is no INSERT policy on `notifications`, so this only ever counts the
 * caller's own rows; a failure degrades to 0 rather than breaking the nav.
 */
export async function fetchUnreadNotificationCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);

  if (error) {
    console.error('[notifications] unread count failed:', error.message);
    return 0;
  }

  return count ?? 0;
}

/**
 * Streams INSERT and UPDATE notifications for the signed-in member.
 *
 * The badge uses this so a new notification appears — and a read one is
 * cleared — without a refresh. Returns an unsubscribe function.
 */
export function subscribeToNotificationChanges(
  userId: string,
  onChange: () => void
): () => void {
  const channel = supabase
    .channel(`notifications-count:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      () => onChange()
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/** Display data for the members referenced by a notification list. */
export async function fetchNotificationActors(
  actorIds: string[]
): Promise<Record<string, NotificationActor>> {
  const ids = Array.from(new Set(actorIds.filter(Boolean)));
  if (ids.length === 0) return {};

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url, gender')
    .in('id', ids);

  if (error) {
    console.error('[notifications] load actors failed:', error.message);
    throw new NotificationError(error.message, error.code);
  }

  const actors: Record<string, NotificationActor> = {};
  for (const row of (data ?? []) as {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    gender: string | null;
  }[]) {
    actors[row.id] = {
      id: row.id,
      displayName: row.display_name ?? 'Someone',
      avatarUrl: row.avatar_url,
      gender: row.gender ?? '',
    };
  }
  return actors;
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .is('read_at', null);

  if (error) {
    console.error('[notifications] mark read failed:', error.message);
    throw new NotificationError(error.message, error.code);
  }
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);

  if (error) {
    console.error('[notifications] mark all read failed:', error.message);
    throw new NotificationError(error.message, error.code);
  }
}

/**
 * Streams newly inserted notifications for the signed-in member.
 *
 * Returns an unsubscribe function. Realtime row filtering requires the
 * `notifications` table to be in the `supabase_realtime` publication, which the
 * migration adds.
 */
export function subscribeToNotifications(
  userId: string,
  onInsert: (row: NotificationRow) => void
): () => void {
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = payload.new as Partial<NotificationRow>;
        // Narrow rather than trust: a partial row would break rendering.
        if (
          typeof row.id === 'string' &&
          typeof row.user_id === 'string' &&
          typeof row.type === 'string' &&
          typeof row.created_at === 'string'
        ) {
          onInsert({
            id: row.id,
            user_id: row.user_id,
            actor_id: typeof row.actor_id === 'string' ? row.actor_id : null,
            type: row.type as NotificationType,
            entity_id: typeof row.entity_id === 'string' ? row.entity_id : null,
            body: typeof row.body === 'string' ? row.body : null,
            read_at: typeof row.read_at === 'string' ? row.read_at : null,
            created_at: row.created_at,
          });
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
