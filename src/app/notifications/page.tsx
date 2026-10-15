'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileNav from '../components/layout/MobileNav';
import { supabase } from '@/lib/supabase';
import type { NotificationActor, NotificationRow } from '@/lib/types';
import {
  NOTIFICATION_TABS,
  NotificationError,
  actionForNotification,
  describeNotification,
  fetchNotificationActors,
  fetchNotifications,
  formatRelativeTime,
  markNotificationRead,
  subscribeToNotifications,
  typesForTab,
  type NotificationTab,
} from '@/lib/notifications';

const getGenderIcon = (gender: string) => {
  if (gender === 'Woman') return '♀️';
  if (gender === 'Man') return '♂️';
  return '⚧';
};

export default function NotificationsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('All');
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [actors, setActors] = useState<Record<string, NotificationActor>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tabs: string[] = [...NOTIFICATION_TABS];

  const loadNotifications = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace('/auth');
        return;
      }

      const rows = await fetchNotifications();
      setNotifications(rows);
      setActors(
        await fetchNotificationActors(
          rows.map((row) => row.actor_id).filter((id): id is string => id !== null)
        )
      );
    } catch (err) {
      console.error('Failed to load notifications:', err);
      setError(
        err instanceof NotificationError
          ? err.message
          : 'Could not load your notifications.'
      );
    } finally {
      // Always leaves the loading state, even on failure.
      setLoading(false);
    }
  }, [router]);

  // Initial load + live updates for new notifications.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadNotifications();

    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    const attach = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (cancelled || !user) return;

      unsubscribe = subscribeToNotifications(user.id, (row) => {
        setNotifications((prev) =>
          prev.some((existing) => existing.id === row.id) ? prev : [row, ...prev]
        );

        // Fetch the actor lazily so the new card renders with a name and avatar.
        if (row.actor_id) {
          void fetchNotificationActors([row.actor_id])
            .then((found) => setActors((prev) => ({ ...prev, ...found })))
            .catch((err) => console.error('Failed to load notification actor:', err));
        }
      });
    };

    void attach();

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [loadNotifications]);

  const visible = useMemo(() => {
    const allowed = typesForTab(activeTab as NotificationTab);
    if (!allowed) return notifications;
    return notifications.filter((row) => allowed.includes(row.type));
  }, [notifications, activeTab]);

  const unreadCount = useMemo(
    () => notifications.filter((row) => row.read_at === null).length,
    [notifications]
  );

  const handleOpen = async (notification: NotificationRow) => {
    // Mark read optimistically; the write is owner-scoped by RLS.
    if (notification.read_at === null) {
      setNotifications((prev) =>
        prev.map((row) =>
          row.id === notification.id ? { ...row, read_at: new Date().toISOString() } : row
        )
      );
      try {
        await markNotificationRead(notification.id);
      } catch (err) {
        console.error('Failed to mark notification read:', err);
      }
    }

    const action = actionForNotification(notification);
    if (action) router.push(action.href);
  };

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', fontFamily: 'system-ui', paddingBottom: '100px', display: 'flex', flexDirection: 'column' as const },
    header: { display: 'flex', alignItems: 'center', padding: '20px', borderBottom: '1px solid #29202D' },
    backBtn: { background: 'none', border: 'none', color: '#F2E9E4', cursor: 'pointer', marginRight: '16px' },
    headerTitle: { fontSize: '20px', fontWeight: '700', color: '#F2E9E4' },
    unreadBadge: { marginLeft: 'auto', backgroundColor: '#4A1828', color: '#D4B18A', fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '12px' },
    
    // Tabs
    tabsContainer: { display: 'flex', gap: '20px', padding: '16px 20px', overflowX: 'auto' as const, borderBottom: '1px solid #29202D' },
    tab: { fontSize: '15px', fontWeight: '600', color: '#B58A83', cursor: 'pointer', background: 'none', border: 'none', whiteSpace: 'nowrap' as const, paddingBottom: '8px', position: 'relative' as const },
    tabActive: { color: '#D4B18A' },
    tabUnderline: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: '3px', backgroundColor: '#D4B18A', borderRadius: '3px' },
    
    // Notification List
    listContainer: { padding: '0 20px', display: 'flex', flexDirection: 'column' as const, gap: '16px', marginTop: '16px' },
    notificationCard: { display: 'flex', alignItems: 'center', gap: '16px', padding: '16px', backgroundColor: '#1C1822', borderRadius: '16px', border: '1px solid #29202D' },
    notificationCardUnread: { borderColor: '#4A1828' },
    avatar: { width: '50px', height: '50px', borderRadius: '50%', objectFit: 'cover' as const, backgroundColor: '#29202D' },
    avatarFallback: { width: '50px', height: '50px', borderRadius: '50%', backgroundColor: '#29202D', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' },
    content: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: '4px' },
    nameRow: { display: 'flex', alignItems: 'center', gap: '6px' },
    name: { fontSize: '15px', fontWeight: '700', color: '#F2E9E4' },
    genderIcon: { fontSize: '12px', color: '#D4B18A' },
    message: { fontSize: '13px', color: '#B58A83', lineHeight: '1.4' },
    timestamp: { fontSize: '11px', color: '#666666' },
    
    // Action Button
    actionBtn: { padding: '8px 16px', borderRadius: '20px', backgroundColor: '#D4B18A', color: '#17121C', fontSize: '12px', fontWeight: '700', border: 'none', cursor: 'pointer' },
    empty: { padding: '48px 24px', textAlign: 'center' as const, color: '#B58A83', fontSize: '14px' },
    error: { margin: '16px 20px', backgroundColor: '#3B1220', border: '1px solid #7F1D2E', color: '#FCA5B5', borderRadius: '14px', padding: '12px 16px', fontSize: '13px', lineHeight: 1.5 }
  };

  return (
    <div style={styles.container}>
      
      {/* Header */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => router.back()}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <div style={styles.headerTitle}>Notifications</div>
        {unreadCount > 0 && <span style={styles.unreadBadge}>{unreadCount} new</span>}
      </div>

      {/* Tabs */}
      <div style={styles.tabsContainer}>
        {tabs.map(tab => (
          <button 
            key={tab} 
            style={{ ...styles.tab, ...(activeTab === tab ? styles.tabActive : {}) }}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
            {activeTab === tab && <div style={styles.tabUnderline} />}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" style={styles.error}>
          {error}
        </div>
      )}

      {/* Notification List */}
      <div style={styles.listContainer}>
        {loading ? (
          <div style={styles.empty}>Loading notifications...</div>
        ) : visible.length === 0 ? (
          <div style={styles.empty}>
            {notifications.length === 0
              ? 'No notifications yet. Likes, matches and messages will show up here.'
              : `Nothing in ${activeTab} yet.`}
          </div>
        ) : (
          visible.map((notif) => {
            const actor = notif.actor_id ? actors[notif.actor_id] : undefined;
            const action = actionForNotification(notif);
            const name = actor?.displayName ?? 'Mettivo';
            const isUnread = notif.read_at === null;

            return (
              <div
                key={notif.id}
                style={{ ...styles.notificationCard, ...(isUnread ? styles.notificationCardUnread : {}) }}
                onClick={() => void handleOpen(notif)}
              >
                {actor?.avatarUrl ? (
                  <img src={actor.avatarUrl} alt={name} style={styles.avatar} />
                ) : (
                  <div style={styles.avatarFallback}>{actor ? getGenderIcon(actor.gender) : '🔔'}</div>
                )}
                <div style={styles.content}>
                  <div style={styles.nameRow}>
                    <span style={styles.name}>{name}</span>
                    {actor && <span style={styles.genderIcon}>{getGenderIcon(actor.gender)}</span>}
                  </div>
                  <div style={styles.message}>
                    {notif.type === 'warning' && notif.body
                      ? notif.body
                      : describeNotification(notif.type)}
                  </div>
                  <div style={styles.timestamp}>{formatRelativeTime(notif.created_at)}</div>
                </div>
                {action && (
                  <button
                    style={styles.actionBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleOpen(notif);
                    }}
                  >
                    {action.label}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Navigation */}
      <MobileNav />

    </div>
  );
}
