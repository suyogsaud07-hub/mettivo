import { fetchUnreadNotificationCount } from '@/lib/notifications';

/**
 * Shared unread-notification counter.
 *
 * The badge is rendered by `MobileNav`, which is mounted on nearly every page,
 * while the Notifications page is the surface that marks rows read. A React
 * context would force both surfaces under one provider; an external store keeps
 * the value in one place and lets both subscribe with `useSyncExternalStore`,
 * the pattern this codebase already uses for language state.
 *
 * Every read still goes through `fetchUnreadNotificationCount()`, which is
 * scoped by RLS to the signed-in member. This module never accepts a user id.
 */

type Listener = () => void;

let unreadCount = 0;
let revision = 0;
const listeners = new Set<Listener>();

function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function getNotificationUnreadSnapshot(): number {
  return unreadCount;
}

/** SSR/hydration snapshot. The badge appears only after a client read. */
export function getNotificationUnreadServerSnapshot(): number {
  return 0;
}

export function subscribeToNotificationUnread(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Sets the count after a mutation that already changed the database, such as
 * the Notifications page marking every unread row read. Bumping `revision`
 * invalidates any unread count request that was already in flight, so a stale
 * response cannot resurrect the badge.
 */
export function setNotificationUnreadCount(value: number): void {
  revision += 1;
  const next = clampCount(value);
  if (next === unreadCount) {
    emit();
    return;
  }
  unreadCount = next;
  emit();
}

/**
 * Re-reads the caller's unread count. Only the most recently started request is
 * applied, which prevents an older response racing a newer one.
 */
export async function refreshNotificationUnreadCount(): Promise<void> {
  const ticket = ++revision;
  const count = await fetchUnreadNotificationCount();
  if (ticket !== revision) return;

  const next = clampCount(count);
  if (next === unreadCount) return;
  unreadCount = next;
  emit();
}
