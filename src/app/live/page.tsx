'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useLiveSession } from '@/lib/live/useLiveSession';
import { countryFlagEmoji } from '@/lib/live/signaling';
import PermissionOverlay from '@/app/components/live/PermissionOverlay';
import LiveStage from '@/app/components/live/LiveStage';
import LiveControls from '@/app/components/live/LiveControls';
import LiveChatDrawer from '@/app/components/live/LiveChatDrawer';
import MobileNav from '@/app/components/layout/MobileNav';

/**
 * Mettivo Live — random 1-on-1 video, OmeTV style.
 *
 * The screen is a thin shell: `useLiveSession` owns the camera, the peer
 * connection and the Realtime channel, and this file only decides which of the
 * three states (pre-flight permission, in the pool, or connecting) to show. That
 * split is what keeps the teardown honest — there is exactly one place that
 * closes the camera.
 *
 * PRIVACY
 *   Names, ages and profiles are never fetched for a partner. The signaling
 *   payload carries nothing but a country, and the UI renders nothing but a flag.
 */

export default function LivePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [showPermission, setShowPermission] = useState(true);

  const session = useLiveSession();
  const {
    phase,
    error,
    localStream,
    remoteStream,
    myCountry,
    partnerCountry,
    peersOnline,
    messages,
    micEnabled,
    camEnabled,
    requestMedia,
    start,
    next,
    stop,
    sendChat,
    toggleMic,
    toggleCam,
  } = session;

  // Same gate as every other protected shell: no session, no live.
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!mounted) return;
      if (!user) {
        router.replace('/auth');
        return;
      }
      setReady(true);
    })();
    return () => {
      mounted = false;
    };
  }, [router]);

  if (!ready) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#131017', color: '#d8b38a' }}>
        Loading Mettivo Live…
      </div>
    );
  }

  const inPool = phase === 'searching' || phase === 'connecting' || phase === 'live';

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#131017',
        color: '#eae2f0',
        fontFamily: 'system-ui',
        padding: '16px 16px 110px 16px',
        boxSizing: 'border-box',
      }}
    >
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
        <button
          type="button"
          aria-label="Back"
          onClick={() => router.back()}
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            backgroundColor: '#211a28',
            border: '1px solid #34283f',
            color: '#eae2f0',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: '#e05a6d',
              animation: 'mr-live-pulse 1.4s ease-in-out infinite',
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '0.3px' }}>Mettivo Live</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          {inPool && (
            <span
              data-testid="live-peers-online"
              style={{ fontSize: '12px', fontWeight: 700, color: '#b58a83' }}
            >
              {peersOnline} live
            </span>
          )}
          <span
            data-testid="live-my-country"
            title="Your country"
            style={{
              padding: '6px 12px',
              borderRadius: '999px',
              backgroundColor: '#211a28',
              border: '1px solid #34283f',
              fontSize: '15px',
            }}
          >
            <span aria-hidden style={{ fontSize: '18px' }}>{countryFlagEmoji(myCountry)}</span>
          </span>
        </div>
      </div>

      <LiveStage
        phase={phase}
        remoteStream={remoteStream}
        localStream={localStream}
        partnerCountry={partnerCountry}
      />

      <LiveControls
        phase={phase}
        micEnabled={micEnabled}
        camEnabled={camEnabled}
        onStart={() => void start()}
        onNext={next}
        onStop={() => {
          stop();
          setShowPermission(true);
        }}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
      />

      {phase === 'live' && <LiveChatDrawer messages={messages} onSend={sendChat} />}

      {showPermission && (
        <PermissionOverlay
          phase={phase}
          error={error}
          localStream={localStream}
          onAllow={() => void requestMedia()}
          onStart={() => {
            setShowPermission(false);
            void start();
          }}
          onCancel={() => router.back()}
        />
      )}

      <MobileNav />
    </div>
  );
}
