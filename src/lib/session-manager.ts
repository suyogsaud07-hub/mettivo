'use client';

import { supabase } from '@/lib/supabase';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export class SessionManager {
  private static instance: SessionManager;
  private activityTimer: number | null = null;
  private lastActivityKey = 'mettivo_last_activity';

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
    // Update activity on user interactions
    const updateActivity = () => {
      const now = Date.now();
      localStorage.setItem(this.lastActivityKey, now.toString());
      void this.touchActivity();
    };

    // Track various user activities
    window.addEventListener('click', updateActivity, { passive: true });
    window.addEventListener('keydown', updateActivity, { passive: true });
    window.addEventListener('scroll', updateActivity, { passive: true });
    window.addEventListener('mousemove', updateActivity, { passive: true });

    // Set initial activity
    updateActivity();

    // Periodically check session validity
    this.activityTimer = window.setInterval(() => {
      void this.checkSessionValidity();
    }, 60000); // Check every minute
  }

  private async touchActivity() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await supabase.rpc('touch_user_activity');
      }
    } catch (err) {
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
          // User has been inactive for more than 7 days
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
