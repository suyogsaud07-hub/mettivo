'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import MobileNav from '../../components/layout/MobileNav';

interface UserProfile {
  id: string;
  display_name: string | null;
  age: number | null;
  city: string | null;
  country: string | null;
  avatar_url: string | null;
  is_followed_by_me: boolean;
}

interface UserListProps {
  type: 'followers' | 'following' | 'friends' | 'likes';
}

/**
 * A social list surface.
 *
 * Privacy is decided by the database, not this component:
 *   * `?user=<id>` targets another member's list. Followers are public, so the
 *     `list_followers` RPC returns them for anyone; Following is owner-only and
 *     the `list_following` RPC raises 42501, which renders as "private".
 *   * Without a `user` param the list is the signed-in member's own.
 *   * Friends (mutuals) and Profile Likes are self-only and read `follows` /
 *     `likes` directly under RLS.
 */
export default function UserList({ type }: UserListProps) {
  const router = useRouter();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [targetId, setTargetId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError(null);

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          router.push('/auth');
          return;
        }
        if (cancelled) return;

        setCurrentUserId(user.id);

        const query = new URLSearchParams(window.location.search).get('user');
        const target = query && query.length > 0 ? query : user.id;
        setTargetId(target);

        // Followers / Following go through the database RPCs. The RPC derives
        // the acting member from auth.uid(), so this is the only supported read
        // path for another member's graph.
        if (type === 'followers' || type === 'following') {
          const rpc = type === 'followers' ? 'list_followers' : 'list_following';
          const { data, error: rpcError } = await supabase.rpc(rpc, { p_user: target });

          if (cancelled) return;

          if (rpcError) {
            if (type === 'following' && target !== user.id) {
              setUsers([]);
              setError('This list is private.');
              return;
            }
            throw new Error(rpcError.message);
          }

          setUsers(((data ?? []) as UserProfile[]).filter(Boolean));
          return;
        }

        // Friends and Likes are self-only.
        const { data: followingData } = await supabase
          .from('follows')
          .select('following_id')
          .eq('follower_id', user.id);

        const { data: followerData } = await supabase
          .from('follows')
          .select('follower_id')
          .eq('following_id', user.id);

        const followingIds = followingData?.map((f) => f.following_id) || [];
        const followerIds = followerData?.map((f) => f.follower_id) || [];

        let targetIds: string[] = [];

        if (type === 'friends') {
          targetIds = followingIds.filter((id) => followerIds.includes(id));
        } else {
          const { data: likeData } = await supabase
            .from('likes')
            .select('liker_id')
            .eq('liked_id', user.id)
            .eq('is_like', true);
          targetIds = likeData?.map((l) => l.liker_id) || [];
        }

        if (targetIds.length === 0) {
          if (!cancelled) setUsers([]);
          return;
        }

        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, display_name, age, city, country, avatar_url')
          .in('id', targetIds);

        if (cancelled) return;

        setUsers(
          (profilesData ?? []).map((profile) => ({
            ...profile,
            is_followed_by_me: followingIds.includes(profile.id),
          }))
        );
      } catch (err) {
        console.error('[UserList] load failed:', err);
        if (!cancelled) setUsers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [router, type]);

  const handleToggleFollow = async (targetUserId: string, isCurrentlyFollowing: boolean) => {
    if (!currentUserId || targetUserId === currentUserId) return;

    setUsers((prev) =>
      prev.map((u) =>
        u.id === targetUserId ? { ...u, is_followed_by_me: !isCurrentlyFollowing } : u
      )
    );

    const { error: writeError } = isCurrentlyFollowing
      ? await supabase
          .from('follows')
          .delete()
          .match({ follower_id: currentUserId, following_id: targetUserId })
      : await supabase
          .from('follows')
          .insert({ follower_id: currentUserId, following_id: targetUserId });

    if (writeError) {
      console.error('[UserList] follow toggle failed:', writeError.message);
      setUsers((prev) =>
        prev.map((u) =>
          u.id === targetUserId ? { ...u, is_followed_by_me: isCurrentlyFollowing } : u
        )
      );
    }
  };

  const filteredUsers = users.filter((u) =>
    (u.display_name ?? '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isSelf = targetId === currentUserId;

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', fontFamily: 'system-ui', paddingBottom: '100px' },
    header: { display: 'flex', alignItems: 'center', padding: '20px', borderBottom: '1px solid #29202D' },
    backBtn: { background: 'none', border: 'none', color: '#F2E9E4', cursor: 'pointer', marginRight: '16px' },
    headerTitle: { fontSize: '20px', fontWeight: '700', color: '#F2E9E4' },
    subtitle: { fontSize: '13px', color: '#B58A83', padding: '16px 20px 0 20px' },

    searchContainer: { padding: '16px 20px' },
    searchInput: { width: '100%', padding: '14px 16px', borderRadius: '16px', backgroundColor: '#1C1822', border: '1px solid #29202D', color: '#F2E9E4', fontSize: '14px', outline: 'none' },

    userList: { padding: '0 20px', display: 'flex', flexDirection: 'column' as const, gap: '12px' },
    userCard: { display: 'flex', alignItems: 'center', gap: '16px', backgroundColor: '#1C1822', padding: '16px', borderRadius: '16px', border: '1px solid #29202D' },
    avatar: { width: '50px', height: '50px', borderRadius: '50%', objectFit: 'cover' as const, backgroundColor: '#29202D' },
    userInfo: { flex: 1 },
    userName: { fontSize: '16px', fontWeight: '700', color: '#F2E9E4' },
    userStatus: { fontSize: '12px', color: '#B58A83', marginTop: '2px' },

    followBtn: { padding: '8px 20px', borderRadius: '20px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', transition: 'all 0.2s', border: 'none' },
    followBtnActive: { backgroundColor: '#29202D', color: '#D4B18A', border: '1px solid #4A1828' },
    followBtnInactive: { backgroundColor: '#D4B18A', color: '#17121C' },

    emptyState: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center' as const },
    emptyIcon: { fontSize: '50px', marginBottom: '16px' },
    emptyText: { fontSize: '16px', color: '#B58A83' },
  };

  const getTitle = () => {
    if (type === 'followers') return '👥 Followers';
    if (type === 'following') return '➕ Following';
    if (type === 'likes') return '💛 Profile Likes';
    return '🤝 Friends';
  };

  const getSubtitle = () => {
    const whose = isSelf ? 'you' : 'this member';
    if (type === 'followers') return `People who follow ${whose}`;
    if (type === 'following') return isSelf ? 'People you follow' : 'Private list';
    if (type === 'friends') return 'Mutual connections (you follow each other)';
    return 'People who liked your profile';
  };

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D0A10', color: '#D4B18A' }}>Loading...</div>;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => router.back()}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button>
        <div style={styles.headerTitle}>{getTitle()}</div>
      </div>

      <div style={styles.subtitle}>{getSubtitle()}</div>

      {error ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>🔒</div>
          <div style={styles.emptyText}>{error}</div>
        </div>
      ) : (
        <>
          <div style={styles.searchContainer}>
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={styles.searchInput}
            />
          </div>

          {filteredUsers.length === 0 ? (
            <div style={styles.emptyState}>
              <div style={styles.emptyIcon}>👻</div>
              <div style={styles.emptyText}>No users found here.</div>
            </div>
          ) : (
            <div style={styles.userList}>
              {filteredUsers.map((user) => (
                <div key={user.id} style={styles.userCard}>
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt={user.display_name ?? 'Member'} style={styles.avatar} />
                  ) : (
                    <div style={{ ...styles.avatar, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '20px' }}>👤</div>
                  )}
                  <div style={styles.userInfo}>
                    <div style={styles.userName}>
                      {user.display_name ?? 'Member'}{user.age ? `, ${user.age}` : ''}
                    </div>
                    <div style={styles.userStatus}>📍 {user.city || 'Global'}{user.country ? `, ${user.country}` : ''}</div>
                  </div>
                  {user.id !== currentUserId && (
                    <button
                      style={{ ...styles.followBtn, ...(user.is_followed_by_me ? styles.followBtnActive : styles.followBtnInactive) }}
                      onClick={() => handleToggleFollow(user.id, user.is_followed_by_me)}
                    >
                      {user.is_followed_by_me ? 'Following' : 'Follow'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <MobileNav />
    </div>
  );
}
