'use client';

import { useEffect } from 'react';
import { reportException } from '@/lib/report-error';

/**
 * R-08 — root error boundary.
 *
 * Catches a throw from the root layout itself, which `app/error.tsx` cannot: at
 * that point there is no layout to render into, so this file must supply the
 * whole document.
 *
 * It is intentionally dependency-free — no context providers, no i18n, no
 * Supabase — because whatever failed may be exactly those things.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportException(error, 'app.global_error', {
      digest: error.digest,
      boundary: 'global',
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          backgroundColor: '#0D0A10',
          color: '#F2E9E4',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          padding: '32px',
          textAlign: 'center',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div style={{ fontSize: '40px' }}>🛠️</div>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
          Mettivo could not start
        </h1>
        <p style={{ margin: 0, fontSize: '14px', color: '#B58A83', maxWidth: '34ch', lineHeight: 1.5 }}>
          Something failed before the app could load. The problem has been reported.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            backgroundColor: '#D4B18A',
            color: '#17121C',
            border: 'none',
            padding: '12px 26px',
            borderRadius: '30px',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
