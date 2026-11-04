'use client';

import { useEffect, useState } from 'react';
import { fetchMyRestrictions, type MyRestrictions, NO_RESTRICTIONS } from '@/lib/reports';

export default function RestrictionBanner() {
  const [restrictions, setRestrictions] = useState<MyRestrictions>(NO_RESTRICTIONS);
  const [timeRemaining, setTimeRemaining] = useState<string>('');

  useEffect(() => {
    const loadRestrictions = async () => {
      try {
        const res = await fetchMyRestrictions();
        setRestrictions(res);
      } catch (err) {
        console.error('Failed to load restrictions:', err);
      }
    };

    loadRestrictions();
    const interval = setInterval(loadRestrictions, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!restrictions.suspended || !restrictions.suspendedUntil) {
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const end = new Date(restrictions.suspendedUntil!).getTime();
      const diff = end - now;

      if (diff <= 0) {
        fetchMyRestrictions().then(setRestrictions);
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeRemaining(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
    };

    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [restrictions.suspended, restrictions.suspendedUntil]);

  if (!restrictions.suspended) {
    return null;
  }

  const reason = restrictions.suspendedReason
    ? restrictions.suspendedReason.replace(/_/g, ' ')
    : 'Community guidelines violation';

  const endDate = restrictions.suspendedUntil
    ? new Date(restrictions.suspendedUntil).toLocaleString()
    : '';

  return (
    <div
      role="status"
      style={{
        margin: '16px 20px',
        backgroundColor: '#2A1420',
        border: '1px solid #8B2635',
        color: '#F3C9D3',
        borderRadius: '14px',
        padding: '16px 18px',
        fontSize: '13px',
        lineHeight: 1.6,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '8px' }}>
        Your account has temporary interaction restrictions
      </div>
      <div style={{ marginBottom: '6px' }}>
        <strong>Reason:</strong> {reason}
      </div>
      {restrictions.suspendedUntil && (
        <>
          <div style={{ marginBottom: '6px' }}>
            <strong>Expires:</strong> {endDate}
          </div>
          {timeRemaining && (
            <div style={{ marginBottom: '8px', fontSize: '15px', fontWeight: 600, color: '#FFB6C1' }}>
              Time remaining: {timeRemaining}
            </div>
          )}
        </>
      )}
      <div style={{ fontSize: '12px', color: '#D4A574', marginTop: '10px' }}>
        You can browse, view profiles, watch Moments and Reels, and play permitted games in read-only mode.
        Social actions like messaging, liking, commenting, and following are restricted.
        <br />
        <a href="/report" style={{ color: '#F3C9D3', textDecoration: 'underline' }}>
          Contact support or submit an appeal
        </a>
      </div>
    </div>
  );
}
