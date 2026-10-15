'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { MAX_BIO_LENGTH } from '@/lib/profile';
import { PROFILE_HOBBIES_OPTIONS, PROFILE_INTENTION_OPTIONS } from '@/lib/profile-options';
import { isMissingColumnError } from '@/lib/postgrest-errors';
import type { ToastMessage } from './Toast';

/**
 * Inline editing of the profile fields a member changes most often: name, bio,
 * intention, location and interests.
 *
 * It reads its own row on mount rather than taking the values as props: the
 * settings page has no reason to hold the profile, and a fresh read is the only
 * way the form cannot show a stale value from another screen.
 *
 * The write is an `upsert` keyed on `id` (AGENTS.md hard constraint 6) — only the
 * named columns change, so the rest of the profile is untouched, and a brand-new
 * member whose row has not been created yet still gets a correct result.
 */

export interface EditableProfileValues {
  displayName: string;
  bio: string;
  intention: string;
  city: string;
  country: string;
  hobbies: string[];
}

const EMPTY: EditableProfileValues = {
  displayName: '',
  bio: '',
  intention: '',
  city: '',
  country: '',
  hobbies: [],
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '13px 14px',
  borderRadius: '12px',
  border: '1px solid var(--mr-input-border, #3e314b)',
  backgroundColor: 'var(--mr-input, #251d2d)',
  color: 'var(--mr-heading, #eae2f0)',
  fontSize: '15px',
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 700,
  color: 'var(--mr-gold, #d8b38a)',
  margin: '16px 0 6px',
  letterSpacing: '0.3px',
};

export interface EditProfileSheetProps {
  onClose: () => void;
  onSaved: (values: EditableProfileValues) => void;
  onToast: (message: string, tone?: ToastMessage['tone']) => void;
}

export default function EditProfileSheet({ onClose, onSaved, onToast }: EditProfileSheetProps) {
  const [values, setValues] = useState<EditableProfileValues>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          if (isMounted) setError('You need to be signed in to edit your profile.');
          return;
        }

        const { data, error: loadError } = await supabase
          .from('profiles')
          .select('display_name, bio, intention, city, country, hobbies')
          .eq('id', user.id)
          .maybeSingle();

        if (!isMounted) return;

        if (loadError && !isMissingColumnError(loadError)) {
          setError('We could not load your profile. Please try again.');
          return;
        }

        setValues({
          displayName: data?.display_name ?? '',
          bio: data?.bio ?? '',
          intention: data?.intention ?? '',
          city: data?.city ?? '',
          country: data?.country ?? '',
          hobbies: Array.isArray(data?.hobbies) ? data.hobbies : [],
        });
      } catch {
        if (isMounted) setError('We could not load your profile. Please try again.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    void load();
    return () => {
      isMounted = false;
    };
  }, []);

  const toggleHobby = (hobby: string) => {
    setValues((prev) => ({
      ...prev,
      hobbies: prev.hobbies.includes(hobby)
        ? prev.hobbies.filter((entry) => entry !== hobby)
        : [...prev.hobbies, hobby],
    }));
  };

  const handleSave = async () => {
    if (saving) return;

    const displayName = values.displayName.trim();
    if (!displayName) {
      setError('Please add a display name.');
      return;
    }
    if (values.bio.trim().length > MAX_BIO_LENGTH) {
      setError(`Your bio must be ${MAX_BIO_LENGTH} characters or fewer.`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError('You need to be signed in to edit your profile.');
        return;
      }

      const payload = {
        id: user.id,
        display_name: displayName,
        bio: values.bio.trim(),
        intention: values.intention.trim(),
        city: values.city.trim(),
        country: values.country.trim(),
        hobbies: values.hobbies,
      };

      const { error: saveError } = await supabase
        .from('profiles')
        .upsert(payload, { onConflict: 'id' });

      if (saveError) {
        setError(`We could not save your profile: ${saveError.message}`);
        return;
      }

      onSaved({ ...values, displayName, bio: values.bio.trim() });
      onToast('Profile updated');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p style={{ fontSize: '14px', color: 'var(--mr-placeholder, #9b8ba6)' }}>Loading your profile…</p>;
  }

  return (
    <div>
      {error && (
        <p
          role="alert"
          data-testid="edit-profile-error"
          style={{ margin: '0 0 8px', fontSize: '13px', color: '#fca5b5' }}
        >
          {error}
        </p>
      )}

      <label style={labelStyle} htmlFor="edit-display-name">
        Name
      </label>
      <input
        id="edit-display-name"
        data-testid="edit-profile-name"
        style={inputStyle}
        value={values.displayName}
        maxLength={60}
        onChange={(event) => setValues((prev) => ({ ...prev, displayName: event.target.value }))}
        placeholder="Your display name"
      />

      <label style={labelStyle} htmlFor="edit-bio">
        Bio
      </label>
      <textarea
        id="edit-bio"
        data-testid="edit-profile-bio"
        style={{ ...inputStyle, minHeight: '96px', resize: 'vertical', fontFamily: 'inherit' }}
        value={values.bio}
        maxLength={MAX_BIO_LENGTH}
        onChange={(event) => setValues((prev) => ({ ...prev, bio: event.target.value }))}
        placeholder="Tell people a little about yourself."
      />
      <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--mr-placeholder, #9b8ba6)', textAlign: 'right' }}>
        {values.bio.length}/{MAX_BIO_LENGTH}
      </p>

      <label style={labelStyle} htmlFor="edit-intention">
        Intention
      </label>
      <select
        id="edit-intention"
        data-testid="edit-profile-intention"
        style={{ ...inputStyle, appearance: 'none' }}
        value={values.intention}
        onChange={(event) => setValues((prev) => ({ ...prev, intention: event.target.value }))}
      >
        <option value="">Prefer not to say</option>
        {PROFILE_INTENTION_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <label style={labelStyle} htmlFor="edit-city">
        Location
      </label>
      <div style={{ display: 'flex', gap: '10px' }}>
        <input
          id="edit-city"
          data-testid="edit-profile-city"
          style={inputStyle}
          value={values.city}
          onChange={(event) => setValues((prev) => ({ ...prev, city: event.target.value }))}
          placeholder="City"
        />
        <input
          aria-label="Country"
          data-testid="edit-profile-country"
          style={inputStyle}
          value={values.country}
          onChange={(event) => setValues((prev) => ({ ...prev, country: event.target.value }))}
          placeholder="Country"
        />
      </div>

      <span style={labelStyle}>Interests</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {PROFILE_HOBBIES_OPTIONS.map((hobby) => {
          const active = values.hobbies.includes(hobby);
          return (
            <button
              key={hobby}
              type="button"
              aria-pressed={active}
              data-testid={`edit-profile-hobby-${hobby}`}
              onClick={() => toggleHobby(hobby)}
              style={{
                padding: '8px 14px',
                borderRadius: '999px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                border: `1px solid ${active ? 'var(--mr-gold, #d8b38a)' : 'var(--mr-card-border, #34283f)'}`,
                backgroundColor: active ? 'var(--mr-gold, #d8b38a)' : 'transparent',
                color: active ? 'var(--mr-gold-text, #1a130c)' : 'var(--mr-heading, #eae2f0)',
              }}
            >
              {hobby}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        data-testid="edit-profile-save"
        onClick={() => void handleSave()}
        disabled={saving}
        style={{
          width: '100%',
          marginTop: '22px',
          padding: '15px',
          borderRadius: '16px',
          border: 'none',
          background: 'linear-gradient(135deg, var(--mr-gold, #d8b38a), #c78c8d)',
          color: 'var(--mr-gold-text, #1a130c)',
          fontSize: '15px',
          fontWeight: 800,
          cursor: saving ? 'default' : 'pointer',
          opacity: saving ? 0.7 : 1,
        }}
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}
