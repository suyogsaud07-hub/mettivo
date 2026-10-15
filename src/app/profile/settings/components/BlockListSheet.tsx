'use client';

import { useEffect, useState } from 'react';
import { BlockingError, listBlockedMembers, unblockMember, type BlockedMemberRow } from '@/lib/blocking';
import { supabase } from '@/lib/supabase';
import type { ToastMessage } from './Toast';

/**
 * The members this account has blocked, with a way back.
 *
 * A block is enforced in the database (`block_member` / `unblock_member` RPCs);
 * this sheet is only a view onto it. Names are resolved from `profiles` in one
 * follow-up query rather than per row, and a member whose profile row is gone is
 * shown as "Member" instead of an empty row.
 */

interface BlockedRowView extends BlockedMemberRow {
  displayName: string;
  avatarUrl: string | null;
}

export interface BlockListSheetProps {
  onToast: (message: string, tone?: ToastMessage['tone']) => void;
}

export default function BlockListSheet({ onToast }: BlockListSheetProps) {
  const [rows, setRows] = useState<BlockedRowView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        const blocked = await listBlockedMembers();
        if (!isMounted) return;

        if (blocked.length === 0) {
          setRows([]);
          return;
        }

        const ids = blocked.map((row) => row.blockedUserId);
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name, avatar_url')
          .in('id', ids);

        if (!isMounted) return;

        const byId = new Map<string, { display_name: string | null; avatar_url: string | null }>();
        for (const profile of profiles ?? []) {
          byId.set(profile.id, { display_name: profile.display_name, avatar_url: profile.avatar_url });
        }

        setRows(
          blocked.map((row) => ({
            ...row,
            displayName: byId.get(row.blockedUserId)?.display_name ?? 'Member',
            avatarUrl: byId.get(row.blockedUserId)?.avatar_url ?? null,
          }))
        );
      } catch (err) {
        if (isMounted) {
          setError(err instanceof BlockingError ? err.message : 'We could not load your blocked list.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    void load();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleUnblock = async (row: BlockedRowView) => {
    setBusyId(row.blockedUserId);
    setError(null);
    try {
      await unblockMember(row.blockedUserId);
      setRows((current) => current.filter((entry) => entry.blockedUserId !== row.blockedUserId));
      onToast(`${row.displayName} has been unblocked`);
    } catch (err) {
      const message = err instanceof BlockingError ? err.message : 'We could not unblock that member.';
      setError(message);
      onToast(message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <p style={{ fontSize: '14px', color: 'var(--mr-placeholder, #9b8ba6)' }}>Loading your blocked list…</p>;
  }

  return (
    <div>
      {error && (
        <p role="alert" data-testid="blocklist-error" style={{ margin: '0 0 8px', fontSize: '13px', color: '#fca5b5' }}>
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p data-testid="blocklist-empty" style={{ fontSize: '14px', color: 'var(--mr-placeholder, #9b8ba6)', lineHeight: 1.6 }}>
          You have not blocked anyone. People you block will appear here.
        </p>
      ) : (
        rows.map((row) => (
          <div
            key={row.blockedUserId}
            data-testid={`blocklist-row-${row.blockedUserId}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 0',
              borderBottom: '1px solid var(--mr-card-border, #34283f)',
            }}
          >
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                width: '42px',
                height: '42px',
                borderRadius: '50%',
                overflow: 'hidden',
                backgroundColor: 'var(--mr-inactive, #2d2336)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--mr-placeholder, #9b8ba6)',
                fontWeight: 700,
              }}
            >
              {row.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                row.displayName.charAt(0).toUpperCase()
              )}
            </span>

            <span style={{ flex: 1, minWidth: 0, fontSize: '14px', fontWeight: 600, color: 'var(--mr-heading, #eae2f0)' }}>
              {row.displayName}
            </span>

            <button
              type="button"
              data-testid={`blocklist-unblock-${row.blockedUserId}`}
              onClick={() => void handleUnblock(row)}
              disabled={busyId === row.blockedUserId}
              style={{
                padding: '9px 16px',
                borderRadius: '12px',
                border: '1px solid var(--mr-gold, #d8b38a)',
                backgroundColor: 'transparent',
                color: 'var(--mr-gold, #d8b38a)',
                fontSize: '13px',
                fontWeight: 700,
                cursor: busyId === row.blockedUserId ? 'default' : 'pointer',
                opacity: busyId === row.blockedUserId ? 0.6 : 1,
              }}
            >
              {busyId === row.blockedUserId ? '…' : 'Unblock'}
            </button>
          </div>
        ))
      )}
    </div>
  );
}
