'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

/**
 * Entry point for `/profile`.
 *
 * This route is where both the landing page and the OAuth callback send a
 * signed-in user whose profile is not finished, so it acts as an onboarding
 * gate:
 *
 *   no session                      -> /auth
 *   onboarded completed             -> /profile/dashboard
 *   missing profile / not onboarded -> /profile/edit
 *
 * Every other profile screen lives under `/profile/*` and is reached from here.
 */
export default function ProfileEntryPage() {
  const router = useRouter();

  useEffect(() => {
    let isMounted = true;

    const resolveDestination = async () => {
      /**
       * NO SESSION is the only condition that may send a member here.
       *
       * This is the loop-breaker. The page previously redirected to `/auth`
       * whenever the profile *read* failed (`.maybeSingle()` reports zero rows
       * as an error) and from its own `catch`. A member with a perfectly valid
       * session whose profile query failed — a cold cache, a transient 5xx — was
       * therefore sent to `/auth`, and any auth screen worth having sends a
       * signed-in visitor back into the app. That is the cycle:
       *
       *   /profile (read failed) -> /auth -> /profile (read failed) -> …
       *
       * The session is established by middleware before this code runs, so a
       * failure past this point can only mean the read failed, never that the
       * member is signed out.
       */
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!isMounted) return;

        if (!session) {
          router.replace('/auth');
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('onboarding_completed')
          .eq('id', session.user.id)
          .maybeSingle();

        if (!isMounted) return;

        if (profileError) {
          // Fail FORWARD, not back to the auth screen. The wizard is idempotent
          // and re-reads what it can, so it is a safe, non-looping destination
          // while the profile read is unreliable.
          console.error('[profile] could not read onboarding state:', profileError.message);
          router.replace('/profile/edit');
          return;
        }

        // No row, or onboarding unfinished -> the wizard.
        if (!profile || profile.onboarding_completed === false) {
          router.replace('/profile/edit');
        } else {
          router.replace('/profile/dashboard');
        }
      } catch (error) {
        console.error('Profile entry routing failed:', error);
        // Same reasoning: a throw here means the gate could not decide, not that
        // the member is signed out. Sending them to `/auth` would be a loop.
        if (isMounted) router.replace('/profile/edit');
      }
    };

    void resolveDestination();

    return () => {
      isMounted = false;
    };
  }, [router]);

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0D0A10',
        color: '#F2E9E4',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '20px',
      }}
    >
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
        style={{
          width: '48px',
          height: '48px',
          fill: 'none',
          stroke: '#D4B18A',
          strokeWidth: 8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          opacity: 0.9,
        }}
      >
        <path d="M 25,30 C 15,30 15,70 25,70 C 40,70 60,30 75,30 C 85,30 85,70 75,70 C 60,70 40,30 25,30 Z" />
      </svg>
      <span
        style={{
          fontSize: '12px',
          letterSpacing: '3px',
          color: '#B58A83',
          textTransform: 'uppercase',
        }}
      >
        Loading Mettivo...
      </span>
    </div>
  );
}
