'use client';

// ✅ This forces Vercel to build this page dynamically, not statically
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { type MessageRow } from '@/lib/types';
import { fetchUnreadCounts } from '@/lib/messages';
import { fetchPublicIdentities, type PublicIdentity } from '@/lib/public-profiles';
import MobileNav from '../components/layout/MobileNav';

interface ConversationSummary {
  matchId: string;
  otherUserId: string | null;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  lastMessage: string;
  lastMessageAt: string;
  isMine: boolean;
  unread: number;
}

interface MatchParticipants {
  id: string;
  user_a: string;
  user_b: string;
}

function formatTimestamp(value: string): string {
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

export default function ChatListPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const loadConversations = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!isMounted) return;

        if (!user) {
          router.replace('/auth');
          return;
        }

        const { data, error } = await supabase
          .from('messages')
          .select('id, match_id, sender_id, content, created_at')
          .order('created_at', { ascending: false })
          .limit(200);

        if (!isMounted) return;

        if (error) {
          console.error('Failed to load conversations:', error.message);
          return;
        }

        const rows = (data ?? []) as MessageRow[];
        const seen = new Set<string>();
        const summaries: ConversationSummary[] = [];
        const otherSenderByMatch = new Map<string, string>();

        for (const row of rows) {
          if (row.sender_id !== user.id && !otherSenderByMatch.has(row.match_id)) {
            otherSenderByMatch.set(row.match_id, row.sender_id);
          }
        }

        for (const row of rows) {
          if (seen.has(row.match_id)) continue;
          seen.add(row.match_id);
          summaries.push({
            matchId: row.match_id,
            otherUserId: otherSenderByMatch.get(row.match_id) ?? null,
            displayName: 'Member',
            username: null,
            avatarUrl: null,
            lastMessage: row.content || 'Photo',
            lastMessageAt: row.created_at,
            isMine: row.sender_id === user.id,
            unread: 0,
          });
        }

        // Resolve the other participant from the match as well as the thread.
        // A brand-new conversation may contain only the caller's messages, so
        // the sender ids alone cannot identify who they are talking to.
        if (summaries.length > 0) {
          const { data: matchRows, error: matchError } = await supabase
            .from('matches')
            .select('id, user_a, user_b')
            .in('id', summaries.map((summary) => summary.matchId));

          if (matchError) {
            console.error('Failed to load conversation participants:', matchError.message);
          } else {
            for (const match of (matchRows ?? []) as MatchParticipants[]) {
              const other =
                match.user_a === user.id ? match.user_b : match.user_a;
              if (other) otherSenderByMatch.set(match.id, other);
            }
          }

          for (const summary of summaries) {
            summary.otherUserId = otherSenderByMatch.get(summary.matchId) ?? null;
          }

          const identities = await fetchPublicIdentities(
            summaries
              .map((summary) => summary.otherUserId)
              .filter((id): id is string => Boolean(id))
          ).catch((identityError: unknown) => {
            // A directory failure must not erase the conversation list. Names
            // fall back to "Member" until the next load.
            console.error('Failed to load conversation profiles:', identityError);
            return new Map<string, PublicIdentity>();
          });

          if (!isMounted) return;

          for (const summary of summaries) {
            const identity = summary.otherUserId
              ? identities.get(summary.otherUserId)
              : undefined;
            if (!identity) continue;
            summary.displayName =
              identity.display_name?.trim() || identity.username || 'Member';
            summary.username = identity.username;
            summary.avatarUrl = identity.avatar_url;
          }
        }

        const counts = await fetchUnreadCounts();
        if (!isMounted) return;

        setConversations(
          summaries.map((summary) => ({ ...summary, unread: counts[summary.matchId] ?? 0 }))
        );
      } catch (err) {
        console.error('Failed to load conversations:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    void loadConversations();

    return () => {
      isMounted = false;
    };
  }, [router]);

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

      {loading ? (
        <p style={{ padding: '24px 20px', color: '#B58A83', fontSize: '14px' }}>
          Loading conversations...
        </p>
      ) : conversations.length === 0 ? (
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <p style={{ color: '#B58A83', fontSize: '14px', marginBottom: '20px' }}>
            No conversations yet. Find someone you connect with to start one.
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
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {conversations.map((conversation) => (
            <li key={conversation.matchId}>
              <Link
                href={`/chat/${conversation.matchId}`}
                style={{
                  display: 'block',
                  backgroundColor: '#1C1822',
                  border: '1px solid #29202D',
                  borderRadius: '16px',
                  padding: '16px',
                  textDecoration: 'none',
                  color: '#F2E9E4',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
                        flexShrink: 0,
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
                        flexShrink: 0,
                        fontSize: '14px',
                        fontWeight: 700,
                      }}
                    >
                      {initials(conversation.displayName)}
                    </span>
                  )}

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
                        color: '#B58A83',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {conversation.isMine
                        ? `You: ${conversation.lastMessage}`
                        : conversation.lastMessage}
                    </p>
                    {conversation.unread > 0 && (
                      <span
                        style={{
                          display: 'inline-block',
                          marginTop: '8px',
                          backgroundColor: '#D4B18A',
                          color: '#17121C',
                          borderRadius: '10px',
                          padding: '2px 10px',
                          fontSize: '11px',
                          fontWeight: 700,
                        }}
                      >
                        {conversation.unread} new
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <MobileNav />
    </div>
  );
}