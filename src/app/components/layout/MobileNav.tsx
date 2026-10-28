'use client';

import Link from 'next/link';
import { useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { supabase } from '@/lib/supabase';
import {
  getNotificationUnreadServerSnapshot,
  getNotificationUnreadSnapshot,
  refreshNotificationUnreadCount,
  subscribeToNotificationUnread,
} from '@/lib/notification-badge';
import { subscribeToNotificationChanges } from '@/lib/notifications';

interface NavItem {
  name: string;
  path: string;
  icon: string;
  /** Owner-added entries that carry a pulsing live dot. */
  live?: boolean;
  /** The unread-notification badge attaches to this destination. */
  badge?: 'notifications';
}

export default function MobileNav() {
  const pathname = usePathname();
  const { t } = useLanguage();
  // The value lives in a shared store so the Notifications page can clear it
  // the moment its bulk read succeeds, without a prop or provider chain.
  const unread = useSyncExternalStore(
    subscribeToNotificationUnread,
    getNotificationUnreadSnapshot,
    getNotificationUnreadServerSnapshot
  );

  // Keep the notifications badge live. The count is derived from `auth.uid()`
  // under RLS, so it only ever reflects the signed-in member's own rows.
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const attach = async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (cancelled || !user) return;

      await refreshNotificationUnreadCount();
      unsubscribe = subscribeToNotificationChanges(user.id, () => {
        void refreshNotificationUnreadCount();
      });
    };

    void attach();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  // Owner-specified order, left to right: Discover, People, Moments, Mettivo
  // Live (the highlighted centre slot), Games, Notifications, Messages, Profile.
  // Every destination — including the protected notifications/moments/games
  // entries — is retained; only the sequence changed.
  const navItems: NavItem[] = [
    { name: t('discover'), path: '/discover', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
    { name: t('people'), path: '/people', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
    { name: t('moments'), path: '/moments', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
    // Mettivo Live (random 1-on-1 video) sits in the prominent centre slot. The
    // brand label is shown as-is; the camera icon carries the pulsing "on air" dot.
    { name: 'Mettivo Live', path: '/live', live: true, icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' },
    { name: t('games'), path: '/game-zone', icon: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    { name: t('notifications'), path: '/notifications', badge: 'notifications', icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z' },
    { name: t('messages'), path: '/chat', icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z' },
    { name: t('profile'), path: '/profile/dashboard', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
  ];

  return (
    <nav className="pf-nav" aria-label="Primary">
      <div className="pf-nav-inner">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.path);
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`pf-nav-link${isActive ? ' is-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              aria-label={item.name}
            >
              <span className="pf-nav-icon">
                <svg
                  width="21"
                  height="21"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={isActive ? '2.4' : '1.9'}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={item.icon} />
                </svg>
                {item.live && <span className="pf-nav-live-dot" aria-hidden="true" />}
                {item.badge === 'notifications' && unread > 0 && (
                  <span
                    className="pf-nav-badge"
                    aria-label={`${unread} unread notifications`}
                  >
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </span>
              <span className="pf-nav-label">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
