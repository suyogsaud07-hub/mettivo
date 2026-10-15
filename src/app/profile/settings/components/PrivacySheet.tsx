'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  DEFAULT_PRIVACY_PREFERENCES,
  PROFILE_VISIBILITY_OPTIONS,
  SettingsError,
  fetchPrivacyPreferences,
  savePrivacyPreferences,
  type PrivacyPreferences,
} from '@/lib/settings';
import ToggleRow from './ToggleRow';
import type { ToastMessage } from './Toast';

/**
 * Privacy controls: who sees the member, and how much.
 *
 * The visibility choice is a radio group rather than a switch because it is a
 * three-way choice, not a boolean — "Only me" is not "matches only with an extra
 * step". Each control saves on change and reverts on failure, the same contract
 * the notification sheet uses.
 *
 * HONEST SCOPE NOTE: these values are stored and honoured by the settings UI. The
 * discovery/query layer that reads `hide_distance` and `profile_visibility` is a
 * follow-up (M20 note) — the toggles record intent, they do not yet change what
 * `discover_profiles()` returns.
 */

export interface PrivacySheetProps {
  onToast: (message: string, tone?: ToastMessage['tone']) => void;
}

export default function PrivacySheet({ onToast }: PrivacySheetProps) {
  const [prefs, setPrefs] = useState<PrivacyPreferences>(DEFAULT_PRIVACY_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    void fetchPrivacyPreferences()
      .then((stored) => {
        if (isMounted) setPrefs(stored);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const persist = async (patch: Partial<PrivacyPreferences>) => {
    const previous = prefs;
    setPrefs((current) => ({ ...current, ...patch }));
    setError(null);
    try {
      await savePrivacyPreferences(patch);
    } catch (err) {
      setPrefs(previous);
      const message = err instanceof SettingsError ? err.message : 'Could not save that setting.';
      setError(message);
      onToast(message, 'error');
    }
  };

  if (loading) {
    return <p style={{ fontSize: '14px', color: 'var(--mr-placeholder, #9b8ba6)' }}>Loading your privacy settings…</p>;
  }

  return (
    <div>
      {error && (
        <p role="alert" data-testid="privacy-error" style={{ margin: '0 0 8px', fontSize: '13px', color: '#fca5b5' }}>
          {error}
        </p>
      )}

      <ToggleRow
        testId="privacy-toggle-online"
        label="Show online status"
        description="Let other members see when you are active."
        checked={prefs.show_online_status}
        onChange={(next) => void persist({ show_online_status: next })}
      />
      <ToggleRow
        testId="privacy-toggle-distance"
        label="Hide distance"
        description="Do not show how far away you are in discovery."
        checked={prefs.hide_distance}
        onChange={(next) => void persist({ hide_distance: next })}
      />

      <span
        style={{
          display: 'block',
          fontSize: '12px',
          fontWeight: 700,
          color: 'var(--mr-gold, #d8b38a)',
          margin: '22px 0 8px',
          letterSpacing: '0.3px',
        }}
      >
        Profile visibility
      </span>
      <div role="radiogroup" aria-label="Profile visibility">
        {PROFILE_VISIBILITY_OPTIONS.map((option) => {
          const active = prefs.profile_visibility === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`privacy-visibility-${option.value}`}
              onClick={() => void persist({ profile_visibility: option.value })}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                width: '100%',
                padding: '14px 0',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid var(--mr-card-border, #34283f)',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <span
                aria-hidden
                style={{
                  flexShrink: 0,
                  marginTop: '2px',
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  border: `2px solid ${active ? 'var(--mr-gold, #d8b38a)' : 'var(--mr-card-border, #34283f)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {active && (
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: 'var(--mr-gold, #d8b38a)' }} />
                )}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: 'var(--mr-heading, #eae2f0)' }}>
                  {option.label}
                </span>
                <span style={{ display: 'block', fontSize: '12px', color: 'var(--mr-placeholder, #9b8ba6)', marginTop: '3px', lineHeight: 1.45 }}>
                  {option.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <Link
        href="/privacy"
        style={{
          display: 'inline-block',
          marginTop: '18px',
          fontSize: '13px',
          fontWeight: 700,
          color: 'var(--mr-gold, #d8b38a)',
          textDecoration: 'none',
        }}
      >
        Read the full Privacy Notice →
      </Link>
    </div>
  );
}
