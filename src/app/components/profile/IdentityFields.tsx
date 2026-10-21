'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  MAX_FIRST_NAME_LENGTH,
  MAX_LAST_NAME_LENGTH,
  MAX_USERNAME_LENGTH,
  USERNAME_HINT,
  displayUsername,
  normalizeUsername,
  validateUsername,
} from '@/lib/identity';

type Availability = 'idle' | 'invalid' | 'checking' | 'available' | 'taken' | 'error';

export interface IdentityFieldsProps {
  firstName: string;
  lastName: string;
  hasLastName: boolean;
  username: string;
  /** The member's saved handle, so it is not reported as taken by themselves. */
  currentUsername?: string;
  onChange: (patch: {
    firstName?: string;
    lastName?: string;
    hasLastName?: boolean;
    username?: string;
  }) => void;
  disabled?: boolean;
}

/**
 * The split display identity shared by onboarding, profile editing and settings.
 *
 * Availability is a real RPC call, debounced and guarded against stale
 * responses. Local validation prevents a pointless request; the unique index in
 * PostgreSQL remains the authorisation boundary, and `saveProfile` maps a
 * `23505` conflict to the same friendly sentence.
 */
export default function IdentityFields({
  firstName,
  lastName,
  hasLastName,
  username,
  currentUsername,
  onChange,
  disabled = false,
}: IdentityFieldsProps) {
  const ids = useId();
  const [check, setCheck] = useState<{
    username: string;
    status: Exclude<Availability, 'idle' | 'checking'>;
  } | null>(null);
  const requestId = useRef(0);

  const normalized = normalizeUsername(username);
  const localProblem = validateUsername(username);
  const isCurrent = Boolean(
    currentUsername && normalized && normalized === normalizeUsername(currentUsername)
  );
  const shouldCheck = Boolean(username.trim()) && !localProblem && !isCurrent;
  const availability: Availability = !username.trim()
    ? 'idle'
    : localProblem
      ? 'invalid'
      : isCurrent
        ? 'available'
        : check?.username === normalized
          ? check.status
          : shouldCheck
            ? 'checking'
            : 'idle';

  useEffect(() => {
    requestId.current += 1;
    const id = requestId.current;

    if (!shouldCheck) return;

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { data, error } = await supabase.rpc('check_username_available', {
            p_username: normalized,
          });

          if (requestId.current !== id) return;

          if (error) {
            console.error('[identity] username availability failed:', error.message);
            setCheck({ username: normalized, status: 'error' });
            return;
          }

          setCheck({ username: normalized, status: data === true ? 'available' : 'taken' });
        } catch (error) {
          if (requestId.current !== id) return;
          console.error('[identity] username availability threw:', error);
          setCheck({ username: normalized, status: 'error' });
        }
      })();
    }, 400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [normalized, shouldCheck]);

  const availabilityMessage =
    availability === 'checking'
      ? 'Checking availability…'
      : availability === 'available'
        ? isCurrent
          ? 'This is your current username.'
          : `${displayUsername(normalized)} is available.`
        : availability === 'taken'
          ? 'That username is already taken. Try another one.'
          : availability === 'error'
            ? 'We could not check availability. You can still save; the server will confirm it.'
            : null;

  const statusMessage = localProblem
    ? username.trim()
      ? localProblem
      : 'Choose a unique username.'
    : availabilityMessage;
  const statusIsError =
    availability === 'invalid' || availability === 'taken' || availability === 'error';

  return (
    <div className="pf-identity-fields">
      <div className="pf-field">
        <label className="pf-field-label" htmlFor={`${ids}-first`}>
          First name
        </label>
        <input
          id={`${ids}-first`}
          className="pf-input"
          value={firstName}
          onChange={(event) => onChange({ firstName: event.target.value })}
          maxLength={MAX_FIRST_NAME_LENGTH}
          autoComplete="given-name"
          placeholder="First name"
          disabled={disabled}
          required
        />
      </div>

      <div className="pf-field">
        <label className="pf-field-label" htmlFor={`${ids}-last`}>
          Last name
        </label>
        <input
          id={`${ids}-last`}
          className="pf-input"
          value={lastName}
          onChange={(event) => onChange({ lastName: event.target.value })}
          maxLength={MAX_LAST_NAME_LENGTH}
          autoComplete="family-name"
          placeholder={hasLastName ? 'Last name' : 'Optional'}
          disabled={disabled || !hasLastName}
          aria-describedby={`${ids}-no-last`}
          required={hasLastName}
        />
        <label className="pf-checkbox-row" htmlFor={`${ids}-no-last`}>
          <input
            id={`${ids}-no-last`}
            type="checkbox"
            checked={!hasLastName}
            onChange={(event) => onChange({ hasLastName: !event.target.checked })}
            disabled={disabled}
          />
          <span>I don&apos;t have a last name</span>
        </label>
      </div>

      <div className="pf-field">
        <label className="pf-field-label" htmlFor={`${ids}-username`}>
          Username
        </label>
        <div className="pf-username-wrap">
          <span className="pf-username-prefix" aria-hidden="true">
            @
          </span>
          <input
            id={`${ids}-username`}
            className="pf-input pf-username-input"
            value={username}
            onChange={(event) => onChange({ username: event.target.value })}
            onBlur={() => {
              if (username !== normalized) onChange({ username: normalized });
            }}
            maxLength={MAX_USERNAME_LENGTH + 1}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="your_username"
            disabled={disabled}
            required
            aria-describedby={`${ids}-username-hint ${ids}-username-status`}
            aria-invalid={Boolean(localProblem) || availability === 'taken'}
          />
        </div>
        <p className="pf-detail-hint" id={`${ids}-username-hint`}>
          {USERNAME_HINT}
        </p>
        <p
          id={`${ids}-username-status`}
          className={`pf-username-status pf-username-${availability}`}
          role={statusIsError ? 'alert' : 'status'}
          aria-live="polite"
        >
          {statusMessage ?? '\u00a0'}
        </p>
      </div>
    </div>
  );
}
