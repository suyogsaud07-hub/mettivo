'use client';

import { useEffect, useState } from 'react';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  SettingsError,
  fetchNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences,
} from '@/lib/settings';
import ToggleRow from './ToggleRow';
import type { ToastMessage } from './Toast';

/**
 * Notification preferences.
 *
 * Each toggle saves on change and reverts if the write fails, so the switch never
 * shows a state the database does not hold. `notify_push` is the master switch:
 * when it is off the four event toggles are disabled rather than silently
 * ignored, which is the difference between a control and a lie.
 */

const EVENT_TOGGLES: readonly { key: keyof NotificationPreferences; label: string; description: string }[] = [
  { key: 'notify_new_matches', label: 'New matches', description: 'When you match with someone new.' },
  { key: 'notify_messages', label: 'Messages', description: 'When a match sends you a message.' },
  { key: 'notify_likes', label: 'Likes', description: 'When someone likes your profile.' },
  { key: 'notify_moments', label: 'Moments updates', description: 'Likes and comments on your posts.' },
];

export interface NotificationsSheetProps {
  onToast: (message: string, tone?: ToastMessage['tone']) => void;
}

export default function NotificationsSheet({ onToast }: NotificationsSheetProps) {
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    void fetchNotificationPreferences()
      .then((stored) => {
        if (isMounted) setPrefs(stored);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const update = async (key: keyof NotificationPreferences, value: boolean) => {
    const previous = prefs;
    setPrefs((current) => ({ ...current, [key]: value }));
    setError(null);
    try {
      await saveNotificationPreferences({ [key]: value });
    } catch (err) {
      setPrefs(previous);
      const message = err instanceof SettingsError ? err.message : 'Could not save that preference.';
      setError(message);
      onToast(message, 'error');
    }
  };

  if (loading) {
    return <p style={{ fontSize: '14px', color: 'var(--mr-placeholder, #9b8ba6)' }}>Loading your preferences…</p>;
  }

  const channelsDisabled = !prefs.notify_push;

  return (
    <div>
      {error && (
        <p role="alert" data-testid="notifications-error" style={{ margin: '0 0 8px', fontSize: '13px', color: '#fca5b5' }}>
          {error}
        </p>
      )}

      <ToggleRow
        testId="notify-toggle-push"
        label="Push notifications"
        description="Master switch for in-app notifications."
        checked={prefs.notify_push}
        onChange={(next) => void update('notify_push', next)}
      />

      <div style={{ opacity: channelsDisabled ? 0.5 : 1 }}>
        {EVENT_TOGGLES.map((toggle) => (
          <ToggleRow
            key={toggle.key}
            testId={`notify-toggle-${toggle.key}`}
            label={toggle.label}
            description={toggle.description}
            checked={prefs[toggle.key]}
            disabled={channelsDisabled}
            onChange={(next) => void update(toggle.key, next)}
          />
        ))}
      </div>

      <ToggleRow
        testId="notify-toggle-email"
        label="Email notifications"
        description="Allow Mettivo to email you about activity."
        checked={prefs.notify_email}
        onChange={(next) => void update('notify_email', next)}
      />
    </div>
  );
}
