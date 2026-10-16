'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { type MessageRow } from '@/lib/types';
import { fetchUnreadCounts } from '@/lib/messages';
import MobileNav from '../components/layout/MobileNav';

interface ConversationSummary {
  matchId: string;
  lastMessage: string;
  lastMessageAt: string;
  isMine: boolean;
  /** M11: unread messages from the other member, computed by the database. */
  unread: number;
}

/** `YYYY-MM-DD HH:mm` — deterministic, so it cannot differ between renders. */
function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/**
 * `/chat` — conversation list.
 *
 * This route previously rendered a copy of the individual chat room, but it has
 * no `[matchId]` segment, so every query ran with `match_id = undefined` and
 * the room was permanently empty.
 *
 * Rows are grouped from the `messages` table; RLS decides which conversations
 * are visible to the signed-in user.
 */
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

        // Rows arrive newest-first, so the first row seen per match is the latest.
        const seen = new Set<string>();
        const summaries: ConversationSummary[] = [];

        for (const row of (data ?? []) as MessageRow[]) {
          if (seen.has(row.match_id)) continue;
          seen.add(row.match_id);
          summaries.push({
            matchId: row.match_id,
            lastMessage: row.content,
            lastMessageAt: row.created_at,
            isMine: row.sender_id === user.id,
            unread: 0,
          });
        }

        // M11: the badge comes from `unread_counts()` in the database, so it
        // agrees with the messages RLS actually lets this member see.
        const counts = await fetchUnreadCounts();
        if (!isMounted) return;

        setConversations(
          summaries.map((summary) => ({ ...summary, unread: counts[summary.matchId] ?? 0 }))
        );
      } catch (err) {
        // A rejected auth/unread call must not leave the list spinning forever.
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
                <p
                  style={{
                    margin: 0,
                    fontSize: '14px',
                    color: '#F2E9E4',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {conversation.isMine ? `You: ${conversation.lastMessage}` : conversation.lastMessage}
                </p>
                <p
                  style={{
                    margin: '6px 0 0 0',
                    fontSize: '11px',
                    color: '#B58A83',
                  }}
                >
                  {formatTimestamp(conversation.lastMessageAt)}
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
              </Link>
            </li>
          ))}
        </ul>
      )}

      <MobileNav />
    </div>
  );
}
