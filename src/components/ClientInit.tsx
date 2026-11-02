'use client';

import { useEffect } from 'react';
import { initSessionManager } from '@/lib/session-manager';

export default function ClientInit() {
  useEffect(() => {
    initSessionManager();
  }, []);

  return null;
}
