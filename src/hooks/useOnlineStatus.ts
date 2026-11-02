'use client';

import { useEffect, useState } from 'react';
import { presenceManager } from '@/lib/presence';

export function useOnlineStatus(userId: string | null | undefined): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      const id = setTimeout(() => {
        if (!cancelled) setIsOnline(false);
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(id);
      };
    }

    const unsubscribe = presenceManager.subscribeToUser(userId, (online) => {
      if (!cancelled) setIsOnline(online);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId]);

  return isOnline;
}

export function useMultipleOnlineStatus(userIds: (string | null | undefined)[]): Map<string, boolean> {
  const idsString = JSON.stringify(userIds);
  const [statusMap, setStatusMap] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const parsedIds = JSON.parse(idsString) as (string | null | undefined)[];
    const validIds = parsedIds.filter((id): id is string => Boolean(id));
    if (validIds.length === 0) {
      const id = setTimeout(() => {
        if (!cancelled) setStatusMap(new Map());
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(id);
      };
    }

    void presenceManager.getMultipleUsersOnlineStatus(validIds).then((map) => {
      if (!cancelled) setStatusMap(map);
    });
    return () => {
      cancelled = true;
    };
  }, [idsString]);

  return statusMap;
}
