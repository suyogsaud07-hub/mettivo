'use client';

import { useEffect } from 'react';
import { reportException } from '@/lib/report-error';

/**
 * R-08 — route-level error boundary.
 *
 * Before this existed, any render-time throw produced a blank screen and left no
 * trace anywhere. A member saw a white page; we saw nothing at all.
 *
 * The report is sent once per error (the dependency array is the error object),
 * and the boundary offers a real recovery path rather than a dead end — which is
 * also `CONSTITUTION.md` Article 2.9's rule about never trapping someone in a
 * state they cannot leave.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportException(error, 'app.route_error', {
      digest: error.digest,
      boundary: 'route',
    });
  }, [error]);

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
        gap: '16px',
        padding: '32px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '40px' }}>⚠️</div>
      <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Something went wrong</h1>
      <p style={{ margin: 0, fontSize: '14px', color: '#B58A83', maxWidth: '32ch', lineHeight: 1.5 }}>
        This screen could not load. The problem has been reported — you can try again.
      </p>

      <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
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
          Try again
        </button>
        <a
          href="/discover"
          style={{
            border: '1px solid #4A1828',
            color: '#F2E9E4',
            padding: '12px 26px',
            borderRadius: '30px',
            fontSize: '14px',
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Back to Mettivo
        </a>
      </div>
    </div>
  );
}
