'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import MobileNav from '../components/layout/MobileNav';
import IntentionBadge from '../components/profile/IntentionBadge';

/**
 * `/people` — the member's connections.
 *
 * This page previously shipped as a scaffold: a full-height dark div containing
 * nothing but the bottom navigation, with the author's own empty JSX comment
 * markers still in the source. It is one of the six protected bottom-nav
 * destinations, so every member who tapped "People" got an empty screen.
 *
 * It now lists mutual matches — the members you can actually talk to — linking
 * each straight into the conversation.
 *
 * PRIVACY: the profile read uses an explicit column allow-list. `select('*')` is
 * forbidden on a surface like this by `AGENTS.md`, and it would also break at
 * runtime once `birth_date` carries a column-level revoke — see
 * `supabase/migrations/20261015260000_m15_revoke_birth_date.sql`.
 */

interface Connection {
  matchId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  age: number | null;
  city: string | null;
  country: string | null;
  intention: string | null;
  isOnline: boolean;
}

interface MatchRow {
  id: string;
  user_a: string;
  user_b: string;
}

/** The only columns we may read about another member. */
const PROFILE_COLUMNS = 'id, display_name, age, city, country, avatar_url, intention, is_online';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export default function PeoplePage() {
  const router = useRouter();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace('/auth');
        return;
      }

      // Same gatekeeper as every other authenticated surface: a member who has
      // not finished onboarding belongs in the wizard, not here.
      const { data: profileCheck, error: gateError } = await supabase
        .from('profiles')
        .select('onboarding_completed')
        .eq('id', user.id)
        .maybeSingle();

      if (gateError) {
        console.error('[people] gatekeeper failed:', gateError.message);
        setError('We could not load your connections. Please try again.');
        return;
      }

      if (!profileCheck || profileCheck.onboarding_completed === false) {
        router.replace('/profile');
        return;
      }

      // RLS (`matches_select_participant`) already limits this to my own
      // matches; the filter is stated explicitly so the intent stays readable.
      const { data: matches, error: matchError } = await supabase
        .from('matches')
        .select('id, user_a, user_b')
        .or(`user_a.eq.${user.id},user_b.eq.${user.id}`);

      if (matchError) {
        console.error('[people] matches failed:', matchError.message);
        setError('We could not load your connections. Please try again.');
        return;
      }

      const rows: MatchRow[] = (matches ?? [])
        .filter(isRecord)
        .filter((row): row is Record<string, unknown> & MatchRow => {
          return typeof row.id === 'string' && typeof row.user_a === 'string' && typeof row.user_b === 'string';
        });

      if (rows.length === 0) {
        setConnections([]);
        return;
      }

      const otherIds = rows.map((row) => (row.user_a === user.id ? row.user_b : row.user_a));

      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .in('id', otherIds);

      if (profileError) {
        console.error('[people] profiles failed:', profileError.message);
        setError('We could not load your connections. Please try again.');
        return;
      }

      const byId = new Map<string, Record<string, unknown>>();
      for (const row of profiles ?? []) {
        if (isRecord(row)) byId.set(String(row.id), row);
      }

      setConnections(
        rows.map((row) => {
          const otherId = row.user_a === user.id ? row.user_b : row.user_a;
          const profile = byId.get(otherId);

          return {
            matchId: row.id,
            userId: otherId,
            displayName: str(profile?.display_name) ?? 'Member',
            avatarUrl: str(profile?.avatar_url),
            age: num(profile?.age),
            city: str(profile?.city),
            country: str(profile?.country),
            intention: str(profile?.intention),
            isOnline: profile?.is_online === true,
          };
        })
      );
    } catch (caught) {
      console.error('[people] unexpected failure:', caught);
      setError('We could not load your connections. Please try again.');
    } finally {
      // CONSTITUTION Article 2.8: the loading state must always terminate.
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadConnections();
  }, [loadConnections]);

  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: '#0D0A10',
      color: '#F2E9E4',
      paddingBottom: '100px',
    },
    header: { padding: '20px', borderBottom: '1px solid #29202D' },
    title: { fontSize: '20px', fontWeight: 700, margin: 0 },
    subtitle: { fontSize: '13px', color: '#B58A83', marginTop: '6px' },
    list: {
      padding: '20px',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '12px',
      listStyle: 'none',
      margin: 0,
    },
    card: {
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      backgroundColor: '#1C1822',
      border: '1px solid #29202D',
      borderRadius: '16px',
      padding: '14px',
      textDecoration: 'none',
      color: '#F2E9E4',
    },
    avatar: {
      width: '52px',
      height: '52px',
      borderRadius: '50%',
      objectFit: 'cover' as const,
      backgroundColor: '#0D0A10',
      flexShrink: 0,
    },
    avatarFallback: {
      width: '52px',
      height: '52px',
      borderRadius: '50%',
      backgroundColor: '#0D0A10',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '22px',
      flexShrink: 0,
    },
    name: { fontSize: '15px', fontWeight: 600, margin: 0 },
    meta: { fontSize: '12px', color: '#B58A83', margin: '4px 0 0 0' },
    online: { fontSize: '11px', color: '#34D399', margin: '4px 0 0 0' },
    profileLink: {
      display: 'inline-block',
      marginTop: '8px',
      marginLeft: '66px',
      fontSize: '12px',
      fontWeight: 700,
      color: '#D8B38A',
      textDecoration: 'none',
    },
    empty: { padding: '48px 24px', textAlign: 'center' as const },
    emptyTitle: { fontSize: '15px', color: '#F2E9E4', margin: 0 },
    emptyBody: { fontSize: '13px', color: '#B58A83', margin: '8px 0 20px', lineHeight: 1.5 },
    cta: {
      display: 'inline-block',
      backgroundColor: '#D4B18A',
      color: '#17121C',
      padding: '12px 28px',
      borderRadius: '30px',
      fontSize: '14px',
      fontWeight: 700,
      textDecoration: 'none',
    },
    error: {
      margin: '20px',
      backgroundColor: '#3B1220',
      border: '1px solid #7F1D2E',
      color: '#FCA5B5',
      borderRadius: '14px',
      padding: '12px 16px',
      fontSize: '13px',
    },
    loading: { padding: '24px 20px', color: '#B58A83', fontSize: '14px' },
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Connections</h1>
        <div style={styles.subtitle}>
          {loading
            ? 'Loading…'
            : connections.length === 0
              ? 'Nobody yet'
              : `${connections.length} mutual ${connections.length === 1 ? 'match' : 'matches'}`}
        </div>
      </header>

      {error && (
        <div role="alert" style={styles.error}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={styles.loading}>Loading your connections…</p>
      ) : connections.length === 0 ? (
        <div style={styles.empty}>
          <p style={styles.emptyTitle}>No connections yet</p>
          <p style={styles.emptyBody}>
            When you and another member both express interest, you become a match and can message
            each other.
          </p>
          <Link href="/discover" style={styles.cta}>
            Start discovering
          </Link>
        </div>
      ) : (
        <ul style={styles.list}>
          {connections.map((connection) => (
            <li key={connection.matchId}>
              <Link href={`/chat/${connection.matchId}`} style={styles.card}>
                {connection.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={connection.avatarUrl}
                    alt={connection.displayName}
                    style={styles.avatar}
                  />
                ) : (
                  <div style={styles.avatarFallback}>👤</div>
                )}

                <div style={{ minWidth: 0 }}>
                  <p style={styles.name}>{connection.displayName}</p>
                  <p style={styles.meta}>
                    {[
                      connection.age !== null ? `${connection.age}` : null,
                      connection.city,
                      connection.country,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'No details yet'}
                  </p>
                  <div style={{ marginTop: '6px' }}>
                    <IntentionBadge intention={connection.intention} />
                  </div>
                  {connection.isOnline && <p style={styles.online}>● Online now</p>}
                </div>
              </Link>
              <Link href={`/profile/${connection.userId}`} style={styles.profileLink}>
                View profile
              </Link>
            </li>
          ))}
        </ul>
      )}

      <MobileNav />
    </div>
  );
}
