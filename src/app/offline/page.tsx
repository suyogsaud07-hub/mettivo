'use client';

/**
 * Offline fallback, precached by the service worker as `/offline`.
 *
 * This page is intentionally dependency-free (no Supabase, no language
 * context, inline styles only) so that it still renders correctly when the
 * network is unavailable and no other assets have been cached.
 */
export default function OfflinePage() {
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
        padding: '32px',
        textAlign: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
        style={{
          width: '56px',
          height: '56px',
          fill: 'none',
          stroke: '#D4B18A',
          strokeWidth: 9,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          opacity: 0.85,
        }}
      >
        <path d="M 25,30 C 15,30 15,70 25,70 C 40,70 60,30 75,30 C 85,30 85,70 75,70 C 60,70 40,30 25,30 Z" />
      </svg>

      <h1
        style={{
          fontSize: '22px',
          fontWeight: 700,
          letterSpacing: '0.5px',
          margin: 0,
        }}
      >
        You&apos;re offline
      </h1>

      <p
        style={{
          fontSize: '14px',
          color: '#B58A83',
          maxWidth: '300px',
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        Mettivo needs a connection to load new content. Check your network and
        try again.
      </p>

      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          marginTop: '8px',
          backgroundColor: '#D4B18A',
          color: '#17121C',
          padding: '14px 32px',
          borderRadius: '30px',
          fontSize: '15px',
          fontWeight: 700,
          border: 'none',
          cursor: 'pointer',
        }}
      >
        Try again
      </button>
    </div>
  );
}
