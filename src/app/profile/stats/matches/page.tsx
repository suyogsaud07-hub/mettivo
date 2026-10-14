'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';  
import MobileNav from '../../../components/layout/MobileNav';

const MOCK_USERS = [
  { id: '1', name: 'venus', avatar: 'https://i.pravatar.cc/150?u=venus', flag: '🇵🇭', status: 'Active now' },
  { id: '2', name: 'Alex', avatar: 'https://i.pravatar.cc/150?u=alex', flag: '🇺🇸', status: 'Active recently' },
  { id: '3', name: 'Sarah', avatar: 'https://i.pravatar.cc/150?u=sarah', flag: '🇬🇧', status: 'Active now' },
];

export default function MatchesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/auth'); return; }
      setLoading(false);
    }
    checkAuth();
  }, [router]);

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', fontFamily: 'system-ui', paddingBottom: '100px' },
    header: { display: 'flex', alignItems: 'center', padding: '20px', borderBottom: '1px solid #29202D' },
    backBtn: { background: 'none', border: 'none', color: '#F2E9E4', cursor: 'pointer', marginRight: '16px' },
    headerTitle: { fontSize: '20px', fontWeight: '700', color: '#F2E9E4' },
    subtitle: { fontSize: '13px', color: '#B58A83', padding: '16px 20px 0 20px' },
    userList: { padding: '20px', display: 'flex', flexDirection: 'column' as const, gap: '12px' },
    userCard: { display: 'flex', alignItems: 'center', gap: '16px', backgroundColor: '#1C1822', padding: '16px', borderRadius: '16px', border: '1px solid #29202D' },
    avatar: { width: '50px', height: '50px', borderRadius: '50%', objectFit: 'cover' as const },
    userName: { fontSize: '16px', fontWeight: '700', color: '#F2E9E4' },
    userFlag: { fontSize: '14px' },
    userStatus: { fontSize: '12px', color: '#B58A83', marginTop: '2px' },
    emptyState: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center' as const },
    emptyIcon: { fontSize: '50px', marginBottom: '16px' },
    emptyText: { fontSize: '16px', color: '#B58A83' }
  };

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D0A10', color: '#D4B18A' }}>Loading...</div>;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => router.back()}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button>
        <div style={styles.headerTitle}>✨ My Matches</div>
      </div>
      <div style={styles.subtitle}>People you connected with</div>
      
      <div style={styles.userList}>
        {MOCK_USERS.map((user) => (
          <div key={user.id} style={styles.userCard} onClick={() => router.push(`/people`)}>
            <img src={user.avatar} alt={user.name} style={styles.avatar} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={styles.userFlag}>{user.flag}</span>
                <span style={styles.userName}>{user.name}</span>
              </div>
              <div style={styles.userStatus}>{user.status}</div>
            </div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B58A83" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>
        ))}
      </div>
      <MobileNav />
    </div>
  );
}