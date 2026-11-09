'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchLocationSharingPrefs,
  setLocationSharing,
  setLocationRetention,
  type LocationSharingPrefs,
} from '@/lib/orbit-location';

interface LocationSharingSettingsProps {
  onChange?: (enabled: boolean) => void;
}

/** Location-sharing settings surface for the Orbit screen / settings sheet.
 *
 *  Renders toggle controls for:
 *    * Enable/disable location sharing (default OFF).
 *    * Retain last-known location for up to 24h (default ON).
 *
 *  Reads current prefs on mount and writes through the orbit-location lib,
 *  which talks to `user_preferences` via RLS-scoped upserts.
 */
export default function LocationSharingSettings({
  onChange,
}: LocationSharingSettingsProps) {
  const [prefs, setPrefs] = useState<LocationSharingPrefs | null>(null);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Load prefs on mount. setState is invoked inside the promise callback (not
  // synchronously within the effect body), satisfying the hooks rules.
  useEffect(() => {
    let cancelled = false;
    fetchLocationSharingPrefs()
      .then((p) => {
        if (!cancelled) setPrefs(p);
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : 'Failed to load preferences.'
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSharing = useCallback(
    async (enabled: boolean) => {
      setSaving((prev) => new Set([...prev, 'sharing']));
      setError(null);
      try {
        await setLocationSharing(enabled);
        setPrefs((prev) =>
          prev ? { ...prev, location_sharing_enabled: enabled } : null
        );
        onChange?.(enabled);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update sharing.');
      } finally {
        setSaving((prev) => {
          const next = new Set(prev);
          next.delete('sharing');
          return next;
        });
      }
    },
    [onChange]
  );

  const toggleRetention = useCallback(
    async (enabled: boolean) => {
      setSaving((prev) => new Set([...prev, 'retention']));
      setError(null);
      try {
        await setLocationRetention(enabled);
        setPrefs((prev) =>
          prev ? { ...prev, location_retention_enabled: enabled } : null
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update retention.');
      } finally {
        setSaving((prev) => {
          const next = new Set(prev);
          next.delete('retention');
          return next;
        });
      }
    },
    []
  );

  if (!prefs) {
    return null;
  }

  return (
    <section className="mt-8 px-6 space-y-6">
      <h2 className="text-sm font-bold text-[#F2E9E4] uppercase tracking-wider">
        Location sharing (Orbit)
      </h2>
      <p className="text-xs text-[#B58A83] leading-relaxed">
        When enabled, eligible members can see your location on Orbit. Your exact
        coordinates are never shared — only a ~1 km grid position and, optionally,
        your last-known location for up to 24 hours.
      </p>

      <div className="space-y-4">
        {/* Sharing toggle */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-[#F2E9E4]">
              Share my location on Orbit
            </h3>
            <p className="text-[11px] text-[#B58A83]">
              Eligible members (including people you have not matched with) can
              see your general location.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.location_sharing_enabled}
            disabled={saving.has('sharing')}
            onClick={() => toggleSharing(!prefs.location_sharing_enabled)}
            className={`relative inline-flex w-12 h-6 rounded-full transition-colors focus:outline-none ${
              prefs.location_sharing_enabled
                ? 'bg-[#D4B18A]'
                : 'bg-[#29202D] border border-[#34283F]/40'
            }`}
          >
            <span
              className={`inline-block w-4 h-4 rounded-full bg-white transform ${
                prefs.location_sharing_enabled ? 'translate-x-6' : 'translate-x-1'
              } transition-transform`}
              aria-hidden="true"
            />
          </button>
        </div>

        {/* Retention toggle */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-[#F2E9E4]">
              Keep last-known location
            </h3>
            <p className="text-[11px] text-[#B58A83]">
              Retain your last shared location for up to 24 hours after you stop
              updating. Turn off to remove it immediately.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.location_retention_enabled}
            disabled={
              saving.has('retention') || !prefs.location_sharing_enabled
            }
            onClick={() =>
              toggleRetention(!prefs.location_retention_enabled)
            }
            className={`relative inline-flex w-12 h-6 rounded-full transition-colors focus:outline-none ${
              !prefs.location_sharing_enabled || saving.has('retention')
                ? 'opacity-50 pointer-events-none'
                : prefs.location_retention_enabled
                  ? 'bg-[#D4B18A]'
                  : 'bg-[#29202D] border border-[#34283F]/40'
            }`}
          >
            <span
              className={`inline-block w-4 h-4 rounded-full bg-white transform ${
                prefs.location_retention_enabled ? 'translate-x-6' : 'translate-x-1'
              } transition-transform`}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      {error && (
        <p className="text-[11px] text-[#FCA5B5]">{error}</p>
      )}
    </section>
  );
}
