'use client';

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

/** Heartbeat interval - 25 seconds as per requirements */
const HEARTBEAT_MS = 25_000;
/** How often to update activity for 7-day window */
const ACTIVITY_MS = 60_000;

function generateSessionId(): string {
  if (typeof window !== 'undefined') {
    const key = 'mettivo_presence_session_id';
    let sessionId = sessionStorage.getItem(key);
    if (!sessionId) {
      sessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem(key, sessionId);
    }
    return sessionId;
  }
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getDeviceType(): string {
  if (typeof window === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/mobile/i.test(ua)) return 'mobile';
  if (/tablet/i.test(ua)) return 'tablet';
  return 'web';
}

export default function PresenceHeartbeat() {
  const sessionIdRef = useRef<string>('');
  const heartbeatTimerRef = useRef<number | null>(null);
  const activityTimerRef = useRef<number | null>(null);
  const isActiveRef = useRef(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    sessionIdRef.current = generateSessionId();
    let cancelled = false;

    const startSession = async () => {
      if (cancelled) return;
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled || !session) return;

        await supabase.rpc('start_presence_session', {
          p_session_id: sessionIdRef.current,
          p_device_type: getDeviceType(),
          p_user_agent: navigator.userAgent,
        });
      } catch (err) {
        console.warn('[presence] failed to start session:', err);
      }
    };

    const heartbeat = async () => {
      if (cancelled || !isActiveRef.current) return;
      // Only send heartbeat if tab is visible and focused (website behavior)
      if (document.visibilityState === 'hidden') {
        return;
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled || !session) return;

        await supabase.rpc('heartbeat_presence_session', {
          p_session_id: sessionIdRef.current,
        });
      } catch (err) {
        console.warn('[presence] heartbeat failed:', err);
      }
    };

    const touchActivity = async () => {
      if (cancelled || document.visibilityState === 'hidden') return;
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled || !session) return;

        await supabase.rpc('touch_user_activity');
      } catch (err) {
        // Non-critical
      }
    };

    const endSession = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return;
        await supabase.rpc('end_presence_session', {
          p_session_id: sessionIdRef.current,
        });
      } catch (err) {
        // Best effort
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        isActiveRef.current = true;
        void heartbeat();
        void touchActivity();
      } else {
        isActiveRef.current = false;
        // Try to mark inactive when hidden
        void endSession();
      }
    };

    const handleFocus = () => {
      isActiveRef.current = true;
      void heartbeat();
    };

    const handleBlur = () => {
      // Don't immediately end on blur, but stop heartbeating
      // isActiveRef.current = false;
    };

    const handleBeforeUnload = () => {
      void endSession();
    };

    void startSession();
    void heartbeat();
    void touchActivity();

    heartbeatTimerRef.current = window.setInterval(() => void heartbeat(), HEARTBEAT_MS);
    activityTimerRef.current = window.setInterval(() => void touchActivity(), ACTIVITY_MS);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);

    return () => {
      cancelled = true;
      if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current);
      if (activityTimerRef.current) window.clearInterval(activityTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
      void endSession();
    };
  }, []);

  return null;
}
