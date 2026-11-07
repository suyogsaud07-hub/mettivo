'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * NotificationPrompt — a small, non-intrusive banner that invites an
 * authenticated member to enable push notifications.
 *
 * Behaviour:
 *   - Never appears on mount: waits for the app to be ready (`ready` prop).
 *   - Only shows when `Notification.permission === 'default'`.
 *   - Hidden after dismissal, grant, or deny (persisted in localStorage).
 *   - Clicking "Enable Notifications" requests permission from the click
 *     handler, subscribes via the push service worker, and posts the
 *     subscription to /api/push/subscribe.
 *   - Gracefully degrades when Notifications or service workers are absent.
 */
interface NotificationPromptProps {
  /** Only render once the app shell is ready (e.g. after /discover loads). */
  ready: boolean;
  /** Dismissed state is remembered across reloads. */
  dismissKey?: string;
}

const DISMISSED_KEY = 'mettivo_notifications_dismissed';

function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

/**
 * Convert a base64-encoded VAPID public key to a Uint8Array for
 * pushManager.subscribe. Chunks the input to avoid call-stack limits with
 * String.fromCharCode.apply on long strings.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const result = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    result[i] = raw.charCodeAt(i);
  }
  return result;
}

/**
 * Convert an ArrayBuffer (e.g. a push-subscription key) to a base64
 * string without fighting over Uint8Array<ArrayBufferLike> vs Uint8Array.
 */
function arrayBufferViewToBase64(view: ArrayBuffer | null): string {
  if (!view) return '';
  const bytes = new Uint8Array(view);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default function NotificationPrompt({
  ready,
  dismissKey = DISMISSED_KEY,
}: NotificationPromptProps) {
  const [permission, setPermission] = useState<NotificationPermission>(
    () => (typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'default')
  );
  const [subscribing, setSubscribing] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return typeof window !== 'undefined'
        ? window.localStorage.getItem(dismissKey) === '1'
        : false;
    } catch {
      return false;
    }
  });
  const [error, setError] = useState<string | null>(null);

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  // Re-read permission when it may have changed (e.g. user changed it in
  // browser settings).
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const handler = () => setPermission(Notification.permission);
    window.addEventListener('permissionchange', handler);
    return () => window.removeEventListener('permissionchange', handler);
  }, []);

  const shouldShow =
    ready &&
    !dismissed &&
    isPushSupported() &&
    permission === 'default' &&
    error === null;

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    setError(null);
    try {
      window.localStorage.setItem(dismissKey, '1');
    } catch {
      // Ignore: dismissal is best-effort.
    }
  }, [dismissKey]);

  const saveSubscription = async (
    subscription: PushSubscription
  ): Promise<void> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError('You must be signed in to enable notifications.');
      return;
    }

    const p256dhKey = subscription.getKey('p256dh');
    const authKey = subscription.getKey('auth');
    if (!p256dhKey || !authKey) {
      setError('Invalid subscription keys.');
      return;
    }

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        keys: {
          p256dh: arrayBufferViewToBase64(subscription.getKey('p256dh')),
          auth: arrayBufferViewToBase64(subscription.getKey('auth')),
        },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Could not save subscription.');
    }

    // Subscription saved successfully: hide the prompt.
    setDismissed(true);
    try {
      window.localStorage.setItem(dismissKey, '1');
    } catch {
      // Ignore.
    }
  };

  const handleEnable = useCallback(async () => {
    if (!vapidPublicKey) {
      setError('Push notifications are not configured on this deployment.');
      return;
    }
    setSubscribing(true);
    setError(null);

    try {
      // 1. Request permission directly from this click interaction.
      const result = await Notification.requestPermission();
      setPermission(result);

      if (result !== 'granted') {
        setError('Notification permission was not granted.');
        return;
      }

      // 2. Register/reuse the existing service worker.
      const registration = await navigator.serviceWorker.ready;

      // 3. Reuse an existing subscription if one exists.
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        await saveSubscription(existing);
        return;
      }

      // 4. Otherwise subscribe using the VAPID public key (server-side only
      //    key; the private key never reaches the browser).
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
      });

      await saveSubscription(subscription);
    } catch (err) {
      console.error('[NotificationPrompt] subscription failed:', err);
      setError(err instanceof Error ? err.message : 'Could not enable notifications.');
    } finally {
      setSubscribing(false);
    }
  }, [vapidPublicKey, dismissKey, saveSubscription]);

  if (!shouldShow) return null;

  return (
    <div
      className="fixed bottom-6 left-6 right-6 z-[70] flex items-center gap-3 rounded-2xl bg-[#1C1822] border border-[#34283F]/60 p-4 shadow-2xl backdrop-blur-md text-[#F2E9E4]"
      role="alert"
      aria-live="polite"
    >
      <div className="flex-1">
        <h3 className="text-sm font-semibold leading-none">
          Get notified when someone likes you
        </h3>
        <p className="text-[11px] text-[#B58A83] leading-none mt-0.5">
          We will let you know about new likes, follows and messages — even when
          Mettivo is in the background.
        </p>
      </div>

      {error ? (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] text-[#FCA5B5] leading-none">{error}</span>
          <button
            type="button"
            onClick={handleEnable}
            disabled={subscribing}
            className="w-full py-1.5 px-3 rounded-xl bg-[#D4B18A] text-[#17121C] text-xs font-bold tracking-tight uppercase hover:bg-[#E4C9A0] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {subscribing ? 'Enabling…' : 'Try again'}
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={handleEnable}
            disabled={subscribing}
            className="w-20 py-2 px-3 rounded-xl bg-[#D4B18A] text-[#17121C] text-xs font-bold tracking-tight uppercase hover:bg-[#E4C9A0] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {subscribing ? 'Enabling…' : 'Enable'}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="w-20 py-2 px-3 rounded-xl border border-[#34283F]/60 bg-transparent text-[#B58A83] text-xs font-medium hover:bg-[#29202D] transition-colors"
          >
            Maybe later
          </button>
        </div>
      )}
    </div>
  );
}
