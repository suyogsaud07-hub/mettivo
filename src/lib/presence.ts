'use client';

import { supabase } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

type PresenceState = {
  [key: string]: Array<{
    user_id: string;
    session_id: string;
    device_type: string;
    online_at: string;
  }>;
};

class PresenceManager {
  private static instance: PresenceManager;
  private channels: Map<string, RealtimeChannel> = new Map();
  private presenceCache: Map<string, boolean> = new Map();
  private subscribers: Map<string, Set<(online: boolean) => void>> = new Map();

  static getInstance(): PresenceManager {
    if (!PresenceManager.instance) {
      PresenceManager.instance = new PresenceManager();
    }
    return PresenceManager.instance;
  }

  async getUserOnlineStatus(userId: string): Promise<boolean> {
    // Check cache first
    if (this.presenceCache.has(userId)) {
      return this.presenceCache.get(userId)!;
    }

    try {
      // Check using the RPC
      const { data } = await supabase.rpc('user_is_online', { p_user_id: userId });
      const isOnline = data === true;
      this.presenceCache.set(userId, isOnline);
      return isOnline;
    } catch (err) {
      // Fallback to direct query
      try {
        const { data } = await supabase
          .from('presence_sessions')
          .select('id')
          .eq('user_id', userId)
          .eq('is_active', true)
          .gt('expires_at', new Date().toISOString())
          .limit(1);
        
        const isOnline = (data?.length || 0) > 0;
        this.presenceCache.set(userId, isOnline);
        return isOnline;
      } catch {
        return false;
      }
    }
  }

  async getMultipleUsersOnlineStatus(userIds: string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    const uncached: string[] = [];

    for (const id of userIds) {
      if (this.presenceCache.has(id)) {
        result.set(id, this.presenceCache.get(id)!);
      } else {
        uncached.push(id);
      }
    }

    if (uncached.length > 0) {
      try {
        const { data } = await supabase
          .from('presence_sessions')
          .select('user_id')
          .in('user_id', uncached)
          .eq('is_active', true)
          .gt('expires_at', new Date().toISOString());

        const onlineSet = new Set((data || []).map(d => d.user_id));
        for (const id of uncached) {
          const isOnline = onlineSet.has(id);
          result.set(id, isOnline);
          this.presenceCache.set(id, isOnline);
        }
      } catch (err) {
        for (const id of uncached) {
          result.set(id, false);
          this.presenceCache.set(id, false);
        }
      }
    }

    return result;
  }

  subscribeToUser(userId: string, callback: (online: boolean) => void): () => void {
    if (!this.subscribers.has(userId)) {
      this.subscribers.set(userId, new Set());
    }
    this.subscribers.get(userId)!.add(callback);

    // Initial fetch
    void this.getUserOnlineStatus(userId).then(callback);

    return () => {
      const subs = this.subscribers.get(userId);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.subscribers.delete(userId);
        }
      }
    };
  }

  clearCache() {
    this.presenceCache.clear();
  }
}

export const presenceManager = PresenceManager.getInstance();
