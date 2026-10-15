'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { SettingsError, fetchAccountMeta, type AccountMeta } from '@/lib/settings';
import type { ToastMessage } from './Toast';

/**
 * Account metadata and credential changes.
 *
 * Everything shown here comes from the auth user (`fetchAccountMeta`), not from
 * `profiles`: email, phone, the creation date and the linked providers are
 * properties of the login, not the dating profile, and this sheet is the one
 * place that distinction matters.
 *
 * Email and password changes go through `supabase.auth.updateUser`, which is
 * the only supported path — the browser cannot write `auth.users` directly.
 */

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

const actionBtn: React.CSSProperties = {
  padding: '12px 18px',
  borderRadius: '12px',
  border: '1px solid var(--mr-gold, #d8b38a)',
  backgroundColor: 'transparent',
  color: 'var(--mr-gold, #d8b38a)',
  fontSize: '14px',
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const PROVIDER_LABELS: Record<string, string> = {
  email: 'Email & password',
  phone: 'Phone',
  google: 'Google',
  facebook: 'Facebook',
  twitter: 'Twitter / X',
  discord: 'Discord',
  apple: 'Apple',
};

function prettyProviders(providers: string[]): string {
  if (providers.length === 0) return 'Not available';
  return providers.map((provider) => PROVIDER_LABELS[provider] ?? provider).join(', ');
}

function prettyDate(value: string | null): string {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export interface AccountSheetProps {
  onToast: (message: string, tone?: ToastMessage['tone']) => void;
}

export default function AccountSheet({ onToast }: AccountSheetProps) {
  const [meta, setMeta] = useState<AccountMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState<'email' | 'password' | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    void fetchAccountMeta()
      .then((data) => {
        if (isMounted) setMeta(data);
      })
      .catch((err: unknown) => {
        if (isMounted) {
          setError(err instanceof SettingsError ? err.message : 'We could not load your account details.');
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleChangeEmail = async () => {
    const value = newEmail.trim();
    if (!value) {
      setFieldError('Enter a new email address.');
      return;
    }
    setBusy('email');
    setFieldError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ email: value });
      if (updateError) {
        setFieldError(updateError.message);
        return;
      }
      setNewEmail('');
      onToast(`Confirmation link sent to ${value}`);
    } finally {
      setBusy(null);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 6) {
      setFieldError('Use at least 6 characters for your password.');
      return;
    }
    setBusy('password');
    setFieldError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        setFieldError(updateError.message);
        return;
      }
      setNewPassword('');
      onToast('Password updated');
    } finally {
      setBusy(null);
    }
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '14px',
    padding: '12px 0',
    borderBottom: '1px solid var(--mr-card-border, #34283f)',
  };
  const valueStyle: React.CSSProperties = {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--mr-heading, #eae2f0)',
    textAlign: 'right',
    wordBreak: 'break-word',
  };

  if (loading) {
    return <p style={{ fontSize: '14px', color: 'var(--mr-placeholder, #9b8ba6)' }}>Loading your account…</p>;
  }

  return (
    <div>
      {error && (
        <p role="alert" style={{ margin: '0 0 8px', fontSize: '13px', color: '#fca5b5' }}>
          {error}
        </p>
      )}

      {meta && (
        <div>
          <div style={rowStyle}>
            <span style={{ fontSize: '13px', color: 'var(--mr-placeholder, #9b8ba6)' }}>Email</span>
            <span data-testid="account-email" style={valueStyle}>
              {meta.email ?? 'Not set'}
            </span>
          </div>
          <div style={rowStyle}>
            <span style={{ fontSize: '13px', color: 'var(--mr-placeholder, #9b8ba6)' }}>Phone</span>
            <span data-testid="account-phone" style={valueStyle}>
              {meta.phone ? meta.phone : 'Not set'}
            </span>
          </div>
          <div style={rowStyle}>
            <span style={{ fontSize: '13px', color: 'var(--mr-placeholder, #9b8ba6)' }}>Member since</span>
            <span data-testid="account-created" style={{ ...valueStyle, fontWeight: 500 }}>
              {prettyDate(meta.createdAt)}
            </span>
          </div>
          <div style={{ ...rowStyle, borderBottom: 'none' }}>
            <span style={{ fontSize: '13px', color: 'var(--mr-placeholder, #9b8ba6)' }}>Sign-in methods</span>
            <span data-testid="account-providers" style={{ ...valueStyle, fontWeight: 500 }}>
              {prettyProviders(meta.providers)}
            </span>
          </div>
        </div>
      )}

      {fieldError && (
        <p role="alert" data-testid="account-error" style={{ margin: '12px 0 0', fontSize: '13px', color: '#fca5b5' }}>
          {fieldError}
        </p>
      )}

      <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--mr-gold, #d8b38a)', margin: '22px 0 6px' }} htmlFor="account-new-email">
        Change email
      </label>
      <div style={{ display: 'flex', gap: '10px' }}>
        <input
          id="account-new-email"
          type="email"
          autoComplete="email"
          data-testid="account-new-email"
          style={inputStyle}
          value={newEmail}
          onChange={(event) => setNewEmail(event.target.value)}
          placeholder="you@example.com"
        />
        <button type="button" style={actionBtn} onClick={() => void handleChangeEmail()} disabled={busy !== null}>
          {busy === 'email' ? 'Sending…' : 'Update'}
        </button>
      </div>

      <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--mr-gold, #d8b38a)', margin: '18px 0 6px' }} htmlFor="account-new-password">
        Change password
      </label>
      <div style={{ display: 'flex', gap: '10px' }}>
        <input
          id="account-new-password"
          type="password"
          autoComplete="new-password"
          data-testid="account-new-password"
          style={inputStyle}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          placeholder="New password"
        />
        <button type="button" style={actionBtn} onClick={() => void handleChangePassword()} disabled={busy !== null}>
          {busy === 'password' ? 'Saving…' : 'Update'}
        </button>
      </div>
    </div>
  );
}
