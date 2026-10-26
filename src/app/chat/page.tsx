'use client';

// ✅ This forces Vercel to build this page dynamically, not statically
export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  fetchInbox,
  setConversationArchived,
  type InboxConversation,
} from '@/lib/inbox';
import MobileNav from '../components/layout/MobileNav';

type InboxTab = 'all' | 'requests' | 'online' | 'archived';

const TABS: ReadonlyArray<{ key: InboxTab; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'requests', label: 'Requests' },
  { key: 'online', label: 'Online' },
  { key: 'archived', label: 'Archive' },
];

function formatTimestamp(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function matchesTab(conversation: InboxConversation, tab: InboxTab): boolean {
  if (tab === 'archived') return conversation.isArchived;
  if (conversation.isArchived) return false;
  if (tab === 'requests') return conversation.isRequest;
  if (tab === 'online') return conversation.isOnline;
  return true;
}

function emptyMessage(tab: InboxTab): string {
  if (tab === 'requests') {
    return 'No message requests. When someone new writes to you first, their conversation appears here.';
  }
  if (tab === 'online') return 'No one from your matches is online right now.';
  if (tab === 'archived') return 'Your archive is empty.';
  return 'No conversations yet. Find someone you connect with to start one.';
}

export default function ChatListPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [tab, setTab] = useState<InboxTab>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyMatchId, setBusyMatchId] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace('/auth?next=/chat');
        return;
      }

      setConversations(await fetchInbox());
    } catch (err) {
      console.error('Failed to load conversations:', err);
      setError(
        err instanceof Error ? err.message : 'Your conversations could not be loaded.'
      );
    } finally {
      setLoading(false);
    }
  }, [router]);

  // The fetch starts with an await; state is not set synchronously here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadConversations();
  }, [loadConversations]);

  const counts = useMemo(() => {
    return {
      all: conversations.filter((conversation) => matchesTab(conversation, 'all')).length,
      requests: conversations.filter((conversation) =>
        matchesTab(conversation, 'requests')
      ).length,
      online: conversations.filter((conversation) =>
        matchesTab(conversation, 'online')
      ).length,
      archived: conversations.filter((conversation) =>
        matchesTab(conversation, 'archived')
      ).length,
    };
  }, [conversations]);

  const visible = useMemo(
    () => conversations.filter((conversation) => matchesTab(conversation, tab)),
    [conversations, tab]
  );

  const toggleArchive = async (conversation: InboxConversation) => {
    const nextArchived = !conversation.isArchived;
    setBusyMatchId(conversation.matchId);
    setError(null);

    try {
      await setConversationArchived(conversation.matchId, nextArchived);
      setConversations((previous) =>
        previous.map((row) =>
          row.matchId === conversation.matchId
            ? { ...row, isArchived: nextArchived }
            : row
        )
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'That conversation could not be updated.'
      );
    } finally {
      setBusyMatchId(null);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0D0A10',
        color: '#F2E9E4',
        paddingBottom: '100px',
      }}
    >
      <header style={{ padding: '20px', borderBottom: '1px solid #29202D' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>Messages</h1>
        <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#B58A83' }}>
          Requests stay separate until you reply.
        </p>
      </header>

      {/* ✅ SUBBU AI BLOCK STARTS HERE */}
      <ul style={{ listStyle: 'none', margin: 0, padding: '20px 20px 0' }}>
        <li>
          <Link
            href="/chat/subbu"
            style={{
              display: 'block',
              backgroundColor: '#1C1822',
              border: '1px solid #3A2E44',
              borderRadius: '16px',
              padding: '16px',
              textDecoration: 'none',
              color: '#F2E9E4',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span
                aria-hidden="true"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  backgroundColor: '#D4B18A',
                  color: '#17121C',
                  flexShrink: 0,
                  fontSize: '20px',
                  lineHeight: 1,
                }}
              >
                ✨
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#F2E9E4' }}>
                  Subbu AI
                </p>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#B58A83' }}>
                  Your personal app assistant
                </p>
              </div>
            </div>
          </Link>
        </li>
      </ul>
      {/* ✅ SUBBU AI BLOCK ENDS HERE */}

      <div
        role="tablist"
        aria-label="Conversation filters"
        style={{
          display: 'flex',
          gap: '8px',
          overflowX: 'auto',
          padding: '16px 20px 0',
        }}
      >
        {TABS.map((item) => {
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.key)}
              style={{
                flexShrink: 0,
                border: active ? '1px solid #D4B18A' : '1px solid #29202D',
                backgroundColor: active ? '#D4B18A' : '#1C1822',
                color: active ? '#17121C' : '#B58A83',
                borderRadius: '999px',
                padding: '8px 14px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {item.label}
              {item.key === 'requests' && counts.requests > 0 ? ` (${counts.requests})` : ''}
            </button>
          );
        })}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            margin: '16px 20px 0',
            padding: '12px 14px',
            borderRadius: '12px',
            border: '1px solid #4A1828',
            backgroundColor: '#4A1828',
            color: '#F2E9E4',
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ padding: '24px 20px', color: '#B58A83', fontSize: '14px' }} role="status">
          Loading conversations...
        </p>
      ) : visible.length === 0 ? (
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <p style={{ color: '#B58A83', fontSize: '14px', marginBottom: '20px' }}>
            {emptyMessage(tab)}
          </p>
          <Link
            href="/discover"
            style={{
              display: 'inline-block',
              backgroundColor: '#D4B18A',
              color: '#17121C',
              padding: '12px 28px',
              borderRadius: '30px',
              fontSize: '14px',
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            Start discovering
          </Link>
        </div>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: '16px 20px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {visible.map((conversation) => {
            const busy = busyMatchId === conversation.matchId;
            return (
              <li
                key={conversation.matchId}
                style={{
                  display: 'flex',
                  alignItems: 'stretch',
                  backgroundColor: '#1C1822',
                  border: '1px solid #29202D',
                  borderRadius: '16px',
                  overflow: 'hidden',
                }}
              >
                <Link
                  href={`/chat/${conversation.matchId}`}
                  style={{
                    display: 'block',
                    flex: 1,
                    minWidth: 0,
                    padding: '16px',
                    textDecoration: 'none',
                    color: '#F2E9E4',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ position: 'relative', flexShrink: 0 }}>
                      {conversation.avatarUrl ? (
                        <img
                          src={conversation.avatarUrl}
                          alt=""
                          aria-hidden="true"
                          style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '50%',
                            objectFit: 'cover',
                            display: 'block',
                          }}
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '44px',
                            height: '44px',
                            borderRadius: '50%',
                            backgroundColor: '#29202D',
                            color: '#D4B18A',
                            fontSize: '14px',
                            fontWeight: 700,
                          }}
                        >
                          {initials(conversation.displayName)}
                        </span>
                      )}
                      {conversation.isOnline && (
                        <span
                          aria-label="Online"
                          title="Online"
                          style={{
                            position: 'absolute',
                            right: 0,
                            bottom: 0,
                            width: '12px',
                            height: '12px',
                            borderRadius: '50%',
                            backgroundColor: '#5FBF8F',
                            border: '2px solid #1C1822',
                          }}
                        />
                      )}
                    </span>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          justifyContent: 'space-between',
                          gap: '10px',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <p
                            style={{
                              margin: 0,
                              fontSize: '14px',
                              fontWeight: 700,
                              color: '#F2E9E4',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {conversation.displayName}
                          </p>
                          {conversation.username ? (
                            <p
                              style={{
                                margin: '2px 0 0 0',
                                fontSize: '12px',
                                color: '#D4B18A',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              @{conversation.username.replace(/^@/, '')}
                            </p>
                          ) : null}
                        </div>
                        <span
                          style={{
                            flexShrink: 0,
                            fontSize: '11px',
                            color: '#B58A83',
                          }}
                        >
                          {formatTimestamp(conversation.lastMessageAt)}
                        </span>
                      </div>

                      <p
                        style={{
                          margin: '6px 0 0 0',
                          fontSize: '13px',
                          color: conversation.isRequest ? '#D4B18A' : '#B58A83',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {conversation.lastMessage
                          ? conversation.lastMessageIsMine
                            ? `You: ${conversation.lastMessage}`
                            : conversation.lastMessage
                          : 'New match — say hello.'}
                      </p>

                      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                        {conversation.isRequest && (
                          <span
                            style={{
                              backgroundColor: '#4A1828',
                              color: '#F2E9E4',
                              borderRadius: '10px',
                              padding: '2px 10px',
                              fontSize: '11px',
                              fontWeight: 700,
                            }}
                          >
                            Message request
                          </span>
                        )}
                        {conversation.unreadCount > 0 && (
                          <span
                            style={{
                              backgroundColor: '#D4B18A',
                              color: '#17121C',
                              borderRadius: '10px',
                              padding: '2px 10px',
                              fontSize: '11px',
                              fontWeight: 700,
                            }}
                          >
                            {conversation.unreadCount} new
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>

                <button
                  type="button"
                  onClick={() => void toggleArchive(conversation)}
                  disabled={busy}
                  aria-label={
                    conversation.isArchived
                      ? `Restore conversation with ${conversation.displayName}`
                      : `Archive conversation with ${conversation.displayName}`
                  }
                  style={{
                    flexShrink: 0,
                    width: '76px',
                    border: 'none',
                    borderLeft: '1px solid #29202D',
                    backgroundColor: 'transparent',
                    color: '#B58A83',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: busy ? 'wait' : 'pointer',
                    opacity: busy ? 0.5 : 1,
                  }}
                >
                  {busy ? '…' : conversation.isArchived ? 'Restore' : 'Archive'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <MobileNav />
    </div>
  );
}
