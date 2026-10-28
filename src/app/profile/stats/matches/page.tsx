'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import MobileNav from '../../../components/layout/MobileNav';

interface MatchedProfile {
  id: string;
  display_name: string | null;
  username: string | null;
  age: number | null;
  city: string | null;
  country: string | null;
  avatar_url: string | null;
}

interface MatchListItem {
  matchId: string;
  profile: MatchedProfile | null;
}

/**
 * The signed-in member's matches.
 *
 * This list is private: only the people in a match can read it (RLS
 * `matches_select_participant`). Another member sees the count on your profile
 * but never this list, which is why the public profile does not link here.
 */
export default function MatchesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<MatchListItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          router.push('/auth');
          return;
        }
        if (cancelled) return;

        const { data: matchRows, error: matchError } = await supabase
          .from('matches')
          .select('id, user_a_id, user_b_id')
          .eq('kind', 'match')
          .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`);

        if (matchError) throw new Error(matchError.message);

        const pairs = (matchRows ?? []).map((row) => ({
          matchId: row.id as string,
          otherId:
            (row.user_a_id === user.id ? row.user_b_id : row.user_a_id) as string,
        }));

        if (pairs.length === 0) {
          if (!cancelled) setMatches([]);
          return;
        }

        // Public, allow-listed view — never a private `profiles` read.
        const { data: profiles, error: profileError } = await supabase
          .from('public_profiles')
          .select('id, display_name, username, age, city, country, avatar_url')
          .in('id', pairs.map((pair) => pair.otherId));

        if (profileError) throw new Error(profileError.message);
        if (cancelled) return;

        const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
        setMatches(
          pairs.map((pair) => ({
            matchId: pair.matchId,
            profile: byId.get(pair.otherId) ?? null,
          }))
        );
      } catch (err) {
        console.error('[matches] load failed:', err);
        if (!cancelled) setMatches([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', fontFamily: 'system-ui', paddingBottom: '100px' },
    header: { display: 'flex', alignItems: 'center', padding: '20px', borderBottom: '1px solid #29202D' },
    backBtn: { background: 'none', border: 'none', color: '#F2E9E4', cursor: 'pointer', marginRight: '16px' },
    headerTitle: { fontSize: '20px', fontWeight: '700', color: '#F2E9E4' },
    subtitle: { fontSize: '13px', color: '#B58A83', padding: '16px 20px 0 20px' },
    userList: { padding: '20px', display: 'flex', flexDirection: 'column' as const, gap: '12px' },
    userCard: { display: 'flex', alignItems: 'center', gap: '16px', backgroundColor: '#1C1822', padding: '16px', borderRadius: '16px', border: '1px solid #29202D', cursor: 'pointer' },
    avatar: { width: '50px', height: '50px', borderRadius: '50%', objectFit: 'cover' as const, backgroundColor: '#29202D' },
    userName: { fontSize: '16px', fontWeight: '700', color: '#F2E9E4' },
    userStatus: { fontSize: '12px', color: '#B58A83', marginTop: '2px' },
    emptyState: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center' as const },
    emptyIcon: { fontSize: '50px', marginBottom: '16px' },
    emptyText: { fontSize: '16px', color: '#B58A83' },
  };

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D0A10', color: '#D4B18A' }}>Loading...</div>;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => router.back()}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <div style={styles.headerTitle}>✨ My Matches</div>
      </div>
      <div style={styles.subtitle}>People you connected with</div>

      {matches.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>💫</div>
          <div style={styles.emptyText}>No matches yet. Follow a member and follow each other back to connect.</div>
        </div>
      ) : (
        <div style={styles.userList}>
          {matches.map(({ matchId, profile }) => (
            <div key={matchId} style={styles.userCard} onClick={() => router.push(`/chat/${matchId}`)}>
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt={profile.display_name ?? 'Match'} style={styles.avatar} />
              ) : (
                <div style={{ ...styles.avatar, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '20px' }}>👤</div>
              )}
              <div style={{ flex: 1 }}>
                <div style={styles.userName}>
                  {profile?.display_name ?? 'Member'}{profile?.age ? `, ${profile.age}` : ''}
                  {profile?.username ? (
                    <span style={{ display: 'block', marginTop: '2px', fontSize: '12px', color: '#D4B18A' }}>
                      @{profile.username}
                    </span>
                  ) : null}
                </div>
                <div style={styles.userStatus}>
                  📍 {profile?.city || 'Global'}{profile?.country ? `, ${profile.country}` : ''}
                </div>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B58A83" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </div>
          ))}
        </div>
      )}
      <MobileNav />
    </div>
  );
}
