'use client';

import { useState } from 'react';
import { PrivacyError, deleteMyAccount } from '@/lib/privacy';
import type { ToastMessage } from './Toast';

/**
 * Account erasure, behind a typed confirmation.
 *
 * WHY A TYPED WORD AND NOT "ARE YOU SURE?"
 *   Deletion is immediate and irreversible — it is the one action in the product
 *   that cannot be undone from inside the app. A second tap is muscle memory; the
 *   member has to read the warning, type DELETE, and only then is the destructive
 *   button enabled. The button is also the only place the deletion is triggered,
 *   so a stray tap anywhere else in the sheet is inert.
 *
 * The erasure itself is `delete_my_account()` (a SECURITY DEFINER RPC that acts on
 * `auth.uid()`); this sheet only gates the call.
 */

export interface DeleteAccountSheetProps {
  onClose: () => void;
  /** Called after a successful erasure; the caller redirects to the landing page. */
  onDeleted: () => void;
  onToast: (message: string, tone?: ToastMessage['tone']) => void;
}

const CONFIRM_WORD = 'DELETE';

export default function DeleteAccountSheet({ onClose, onDeleted, onToast }: DeleteAccountSheetProps) {
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = typed.trim().toUpperCase() === CONFIRM_WORD && !deleting;

  const handleDelete = async () => {
    if (!canDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteMyAccount();
      onToast('Your account has been deleted.');
      onDeleted();
    } catch (err) {
      console.error('[settings] account deletion failed:', err);
      setError(
        err instanceof PrivacyError ? err.message : 'Could not delete your account. Please try again.'
      );
      setDeleting(false);
    }
  };

  return (
    <div>
      <div
        style={{
          backgroundColor: 'var(--mr-burgundy, #4a1c2e)',
          border: '1px solid #7f1d2e',
          borderRadius: '14px',
          padding: '14px 16px',
          marginBottom: '16px',
        }}
      >
        <p style={{ margin: 0, fontSize: '13px', color: '#f6d6dc', lineHeight: 1.6 }}>
          This permanently erases your profile, photos, likes, matches, messages, blocks and reports,
          and removes your login. It cannot be undone.
        </p>
      </div>

      <label
        htmlFor="delete-confirm"
        style={{ display: 'block', fontSize: '13px', color: 'var(--mr-heading, #eae2f0)', marginBottom: '8px' }}
      >
        Type <strong style={{ color: 'var(--mr-gold, #d8b38a)' }}>{CONFIRM_WORD}</strong> to confirm.
      </label>
      <input
        id="delete-confirm"
        data-testid="delete-account-confirm-input"
        autoComplete="off"
        style={{
          width: '100%',
          padding: '13px 14px',
          borderRadius: '12px',
          border: '1px solid var(--mr-input-border, #3e314b)',
          backgroundColor: 'var(--mr-input, #251d2d)',
          color: 'var(--mr-heading, #eae2f0)',
          fontSize: '15px',
          outline: 'none',
          boxSizing: 'border-box',
          letterSpacing: '2px',
        }}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        placeholder={CONFIRM_WORD}
        disabled={deleting}
      />

      {error && (
        <p role="alert" data-testid="delete-account-error" style={{ margin: '12px 0 0', fontSize: '13px', color: '#fca5b5' }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: '12px', marginTop: '22px' }}>
        <button
          type="button"
          onClick={onClose}
          disabled={deleting}
          style={{
            flex: 1,
            padding: '14px',
            borderRadius: '16px',
            border: '1px solid var(--mr-card-border, #34283f)',
            backgroundColor: 'transparent',
            color: 'var(--mr-inactive-text, #b4a3c0)',
            fontWeight: 700,
            fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="delete-account-confirm"
          onClick={() => void handleDelete()}
          disabled={!canDelete}
          style={{
            flex: 1,
            padding: '14px',
            borderRadius: '16px',
            border: 'none',
            backgroundColor: canDelete ? '#b21f36' : 'var(--mr-inactive, #2d2336)',
            color: canDelete ? '#fff' : 'var(--mr-placeholder, #9b8ba6)',
            fontWeight: 800,
            fontSize: '14px',
            cursor: canDelete ? 'pointer' : 'default',
          }}
        >
          {deleting ? 'Deleting…' : 'Delete account'}
        </button>
      </div>
    </div>
  );
}
