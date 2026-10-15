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
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!isMounted) return;

        if (!session) {
          router.replace('/auth');
          return;
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('onboarding_completed')
          .eq('id', session.user.id)
          .maybeSingle();

        if (!isMounted) return;

        if (!profile || profile.onboarding_completed === false) {
          router.replace('/profile/edit');
        } else {
          router.replace('/profile/dashboard');
        }
      } catch (error) {
        console.error('Profile entry routing failed:', error);
        if (isMounted) router.replace('/auth');
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
