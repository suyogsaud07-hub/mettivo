'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '../../../lib/supabase'; 
import MobileNav from '../../../components/layout/MobileNav';

// Mock data for lists that don't have a database yet
const MOCK_USERS = [
  { id: '1', name: 'venus', avatar: 'https://i.pravatar.cc/150?u=venus', flag: '🇵🇭' },
  { id: '2', name: 'Alex', avatar: 'https://i.pravatar.cc/150?u=alex', flag: '🇺🇸' },
  { id: '3', name: 'Sarah', avatar: 'https://i.pravatar.cc/150?u=sarah', flag: '🇬🇧' },
];

export default function StatsDetailPage() {
  const router = useRouter();
  const params = useParams();
  const statType = params.type as string; // e.g., 'photos', 'interests', 'followers'

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    async function loadData() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/auth'); return; }

      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      setProfile(data);
      setLoading(false);
    }
    loadData();
  }, [router]);

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D0A10', color: '#D4B18A' }}>Loading...</div>;
  }

  // Dynamic Titles & Descriptions based on the route
  const statConfig: Record<string, { title: string, subtitle: string, icon: string }> = {
    photos: { title: 'My Photos', subtitle: 'Your gallery of moments', icon: '📸' },
    interests: { title: 'My Interests', subtitle: 'Things you love', icon: '❤️' },
    matches: { title: 'My Matches', subtitle: 'People you connected with', icon: '✨' },
    followers: { title: 'Followers', subtitle: 'People following you', icon: '👥' },
    following: { title: 'Following', subtitle: 'People you follow', icon: '➕' },
    friends: { title: 'Friends', subtitle: 'Your mutual connections', icon: '🤝' },
  };

  const config = statConfig[statType] || statConfig.photos;

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', fontFamily: 'system-ui', paddingBottom: '100px' },
    header: { display: 'flex', alignItems: 'center', padding: '20px', borderBottom: '1px solid #29202D' },
    backBtn: { background: 'none', border: 'none', color: '#F2E9E4', cursor: 'pointer', marginRight: '16px' },
    headerTitle: { fontSize: '20px', fontWeight: '700', color: '#F2E9E4' },
    subtitle: { fontSize: '13px', color: '#B58A83', padding: '16px 20px 0 20px' },
    
    // Photo Grid
    photoGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', padding: '20px' },
    photo: { width: '100%', aspectRatio: '1/1', borderRadius: '16px', objectFit: 'cover' as const, backgroundColor: '#1C1822', border: '1px solid #29202D' },
    
    // Interests List
    interestList: { display: 'flex', flexWrap: 'wrap' as const, gap: '10px', padding: '20px' },
    interestTag: { padding: '12px 20px', borderRadius: '20px', backgroundColor: '#1C1822', border: '1px solid #4A1828', color: '#D4B18A', fontSize: '14px', fontWeight: '600' },
    
    // User List (Followers, Following, Friends, Matches)
    userList: { padding: '20px', display: 'flex', flexDirection: 'column' as const, gap: '12px' },
    userCard: { display: 'flex', alignItems: 'center', gap: '16px', backgroundColor: '#1C1822', padding: '16px', borderRadius: '16px', border: '1px solid #29202D' },
    avatar: { width: '50px', height: '50px', borderRadius: '50%', objectFit: 'cover' as const },
    userName: { fontSize: '16px', fontWeight: '700', color: '#F2E9E4' },
    userFlag: { fontSize: '14px' },
    
    // Empty State
    emptyState: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center' as const },
    emptyIcon: { fontSize: '50px', marginBottom: '16px' },
    emptyText: { fontSize: '16px', color: '#B58A83' }
  };

  // Render content based on the clicked stat
  const renderContent = () => {
    if (statType === 'photos') {
      const photos = profile?.photos?.filter((p: string) => p) || [];
      if (photos.length === 0) return <div style={styles.emptyState}><div style={styles.emptyIcon}>📸</div><div style={styles.emptyText}>No photos yet.</div></div>;
      return (
        <div style={styles.photoGrid}>
          {photos.map((url: string, i: number) => <img key={i} src={url} alt="Photo" style={styles.photo} />)}
        </div>
      );
    }

    if (statType === 'interests') {
      const hobbies = profile?.hobbies || [];
      if (hobbies.length === 0) return <div style={styles.emptyState}><div style={styles.emptyIcon}>❤️</div><div style={styles.emptyText}>No interests added yet.</div></div>;
      return (
        <div style={styles.interestList}>
          {hobbies.map((hobby: string, i: number) => <div key={i} style={styles.interestTag}>{hobby}</div>)}
        </div>
      );
    }

    // For Matches, Followers, Following, Friends -> Show mock user list
    return (
      <div style={styles.userList}>
        {MOCK_USERS.map((user) => (
          <div key={user.id} style={styles.userCard} onClick={() => router.push(`/people`)}>
            <img src={user.avatar} alt={user.name} style={styles.avatar} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={styles.userFlag}>{user.flag}</span>
                <span style={styles.userName}>{user.name}</span>
              </div>
              <div style={{ fontSize: '12px', color: '#B58A83', marginTop: '2px' }}>Active now</div>
            </div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B58A83" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => router.back()}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <div style={styles.headerTitle}>{config.icon} {config.title}</div>
      </div>
      
      <div style={styles.subtitle}>{config.subtitle}</div>
      
      {renderContent()}

      <MobileNav />
    </div>
  );
}