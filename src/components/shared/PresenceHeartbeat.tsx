'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';

/** How often an open tab refreshes its presence. */
const HEARTBEAT_MS = 60_000;

/**
 * Keeps `profiles.last_seen_at` warm while the member is using the app.
 *
 * The database derives online state from a two-minute window, so a closed or
 * crashed tab expires on its own. This component never writes an "offline"
 * flag on unmount: that would mark the member offline while another tab is
 * still open.
 */
export default function PresenceHeartbeat() {
  useEffect(() => {
    let cancelled = false;

    const beat = async () => {
      if (cancelled) return;

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled || !session) return;

      const { error } = await supabase.rpc('touch_presence');
      if (error && error.code !== 'PGRST202') {
        console.warn('[presence] heartbeat failed:', error.message);
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void beat();
    };

    void beat();
    const timer = window.setInterval(() => void beat(), HEARTBEAT_MS);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return null;
}
