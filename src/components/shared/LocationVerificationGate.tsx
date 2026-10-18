'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import LocationVerificationModal from './LocationVerificationModal';

/**
 * Resolves the signed-in member and mounts `LocationVerificationModal` for them.
 *
 * WHY A GATE AND NOT `userId={user.id}` IN THE ROOT LAYOUT
 *   `src/app/layout.tsx` is a Server Component: it has no session and renders no
 *   authenticated user. This small client component is the bridge — it reads the
 *   session in the browser and renders nothing when signed out.
 *
 * WHY IT DOES NOT RE-CHECK ON EVERY NAVIGATION
 *   It is mounted ONCE, in the root layout, and the App Router keeps a layout
 *   mounted across client-side navigations. The session subscription only fires
 *   on real auth events (initial session, sign-in/out, token refresh); a token
 *   refresh carries the SAME user id, so React bails out of the state update and
 *   the hook's effect does not re-run.
 */
export default function LocationVerificationGate() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setUserId(data.user?.id ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  if (!userId) return null;
  return <LocationVerificationModal userId={userId} />;
}
