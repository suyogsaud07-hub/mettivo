'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import MobileNav from '../../components/layout/MobileNav';

interface UserProfile {
  id: string;
  display_name: string;
  age: number;
  city: string;
  country: string;
  avatar_url: string;
  is_followed_by_me: boolean;
}

interface UserListProps {
  type: 'followers' | 'following' | 'friends' | 'likes';
}

export default function UserList({ type }: UserListProps) {
  const router = useRouter();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string>('');

  useEffect(() => {
    async function loadData() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/auth'); return; }
      setCurrentUserId(user.id);

      // 1. Fetch all relevant follow relationships for this user
      const { data: followingData } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', user.id);

      const { data: followerData } = await supabase
        .from('follows')
        .select('follower_id')
        .eq('following_id', user.id);

      const followingIds = followingData?.map(f => f.following_id) || [];
      const followerIds = followerData?.map(f => f.follower_id) || [];

      let targetIds: string[] = [];

      if (type === 'following') {
        targetIds = followingIds;
      } else if (type === 'followers') {
        targetIds = followerIds;
      } else if (type === 'friends') {
        // Friends = Mutuals (Intersection of following and followers)
        targetIds = followingIds.filter(id => followerIds.includes(id));
      } else if (type === 'likes') {
        // Members who liked this user's profile. RLS (`likes_select_involved`)
        // permits reading rows where the caller is either side of the like.
        const { data: likeData } = await supabase
          .from('likes')
          .select('liker_id')
          .eq('liked_id', user.id)
          .eq('is_like', true);
        targetIds = likeData?.map(l => l.liker_id) || [];
      }

      if (targetIds.length === 0) {
        setLoading(false);
        return;
      }

      // 2. Fetch the actual profiles for these IDs
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, display_name, age, city, country, avatar_url')
        .in('id', targetIds);

      // 3. Map through and check if I follow them back (for UI button state)
      const enrichedUsers = profilesData?.map(profile => ({
        ...profile,
        is_followed_by_me: followingIds.includes(profile.id)
      })) || [];

      setUsers(enrichedUsers);
      setLoading(false);
    }
    loadData();
  }, [router, type]);

  const handleToggleFollow = async (targetId: string, isCurrentlyFollowing: boolean) => {
    // Optimistic UI Update
    setUsers(prev => prev.map(u => 
      u.id === targetId ? { ...u, is_followed_by_me: !isCurrentlyFollowing } : u
    ));

    if (isCurrentlyFollowing) {
      // Unfollow
      await supabase.from('follows').delete().match({ follower_id: currentUserId, following_id: targetId });
    } else {
      // Follow
      await supabase.from('follows').insert({ follower_id: currentUserId, following_id: targetId });
    }
  };

  const filteredUsers = users.filter(u => 
    u.display_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
    emptyText: { fontSize: '16px', color: '#B58A83' }
  };

  const getTitle = () => {
    if (type === 'followers') return '👥 Followers';
    if (type === 'following') return '➕ Following';
    if (type === 'likes') return '💛 Profile Likes';
    return '🤝 Friends';
  };

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D0A10', color: '#D4B18A' }}>Loading...</div>;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => router.back()}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button>
        <div style={styles.headerTitle}>{getTitle()}</div>
      </div>
      
      <div style={styles.subtitle}>
        {type === 'followers' && 'People who follow you'}
        {type === 'following' && 'People you follow'}
        {type === 'friends' && 'Mutual connections (you follow each other)'}
        {type === 'likes' && 'People who liked your profile'}
      </div>

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
                <img src={user.avatar_url} alt={user.display_name} style={styles.avatar} />
              ) : (
                <div style={{ ...styles.avatar, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '20px' }}>👤</div>
              )}
              <div style={styles.userInfo}>
                <div style={styles.userName}>{user.display_name}, {user.age}</div>
                <div style={styles.userStatus}>📍 {user.city || 'Global'}, {user.country || ''}</div>
              </div>
              <button 
                style={{ ...styles.followBtn, ...(user.is_followed_by_me ? styles.followBtnActive : styles.followBtnInactive) }}
                onClick={() => handleToggleFollow(user.id, user.is_followed_by_me)}
              >
                {user.is_followed_by_me ? 'Following' : 'Follow'}
              </button>
            </div>
          ))}
        </div>
      )}

      <MobileNav />
    </div>
  );
}