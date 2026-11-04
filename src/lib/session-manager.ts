'use client';

import { supabase } from '@/lib/supabase';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVITY_THROTTLE_MS = 5 * 60 * 1000; // Only ping DB every 5 minutes

export class SessionManager {
  private static instance: SessionManager;
  private activityTimer: number | null = null;
  private lastActivityKey = 'mettivo_last_activity';
  private lastPingTime = 0;

  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  constructor() {
    if (typeof window !== 'undefined') {
      this.init();
    }
  }

  private init() {
    // ⚡ PERFORMANCE FIX: Throttle activity updates.
    // We don't want to hit the database on every mouse move!
    const updateActivity = () => {
      const now = Date.now();
      
      // Update local storage (cheap, synchronous, prevents 7-day inactivity)
      localStorage.setItem(this.lastActivityKey, now.toString());

      // Throttle database pings
      if (now - this.lastPingTime > ACTIVITY_THROTTLE_MS) {
        this.lastPingTime = now;
        void this.touchActivity();
      }
    };

    // Track user activity
    window.addEventListener('click', updateActivity, { passive: true });
    window.addEventListener('keydown', updateActivity, { passive: true });
    window.addEventListener('scroll', updateActivity, { passive: true });
    window.addEventListener('mousemove', updateActivity, { passive: true });

    // Set initial activity
    updateActivity();

    // Periodically check session validity (Every 5 minutes instead of 1)
    this.activityTimer = window.setInterval(() => {
      void this.checkSessionValidity();
    }, 5 * 60 * 1000); 
  }

  private async touchActivity() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await supabase.rpc('touch_user_activity');
      }
    } catch {
      // Non-critical
    }
  }

  private async checkSessionValidity() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Check if within 7 days of inactivity
      const lastActivity = localStorage.getItem(this.lastActivityKey);
      if (lastActivity) {
        const lastActivityTime = parseInt(lastActivity, 10);
        const now = Date.now();
        if (now - lastActivityTime > SEVEN_DAYS_MS) {
          console.warn('[session] Inactive for more than 7 days, signing out');
          await supabase.auth.signOut();
          if (typeof window !== 'undefined') {
            window.location.assign('/auth');
          }
          return;
        }
      }

      // Also check server-side
      const { data: isValid } = await supabase.rpc('check_activity_validity');
      if (isValid === false) {
        await supabase.auth.signOut();
        if (typeof window !== 'undefined') {
          window.location.assign('/auth');
        }
      }
    } catch (err) {
      console.error('[session] Error checking session validity:', err);
    }
  }

  destroy() {
    if (this.activityTimer) {
      window.clearInterval(this.activityTimer);
    }
  }
}

export function initSessionManager() {
  if (typeof window !== 'undefined') {
    SessionManager.getInstance();
  }
}