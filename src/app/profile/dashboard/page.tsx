'use client';

import { useState, useEffect } from 'react';
// FIXED: Using 4 levels up to reach src/lib and src/components
import { supabase } from '@/lib/supabase'; 
import { useRouter } from 'next/navigation';
import MobileNav from '../../components/layout/MobileNav';

interface Profile {
  id: string;
  display_name: string;
  age: number;
  gender: string;
  city: string;
  country: string;
  avatar_url: string;
  photos: string[];
  intention: string;
  looking_for: string[];
  hobbies: string[];
  pets: string[];
  personality: string[];
  religion: string;
  politics: string;
  drinking: string;
  smoking: string;
  birth_date: string;
  followers?: number;
  following?: number;
  friends?: number;
}

export default function ProfileDashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'about' | 'gallery'>('about');

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/auth');
        return;
      }
      setUserEmail(user.email || 'Not set');

      const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      
      if (error) console.error("Error fetching profile:", error);
      setProfile(data);
      setLoading(false);
    }
    loadProfile();
  }, [router]);

  const calculateCompletion = () => {
    if (!profile) return 0;
    const fields = [
      profile.display_name, profile.age, profile.gender, profile.city, 
      profile.country, profile.avatar_url, profile.intention, 
      profile.looking_for?.length, profile.hobbies?.length, 
      profile.pets?.length, profile.personality?.length, 
      profile.religion, profile.politics, profile.drinking, profile.smoking
    ];
    const filledFields = fields.filter(field => field !== null && field !== undefined && field !== '' && field !== 0).length;
    return Math.round((filledFields / fields.length) * 100);
  };

  const completionPercentage = calculateCompletion();

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D0A10', color: '#D4B18A' }}>Loading Profile...</div>;

  if (!profile) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '20px' }}>
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '12px' }}>Profile not found.</h2>
            <button onClick={() => router.push('/profile')} style={{ backgroundColor: '#D4B18A', color: '#17121C', padding: '16px 32px', borderRadius: '30px', fontSize: '16px', fontWeight: '700', border: 'none', cursor: 'pointer' }}>Start Onboarding</button>
          </div>
        </div>
        <MobileNav />
      </div>
    );
  }

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', fontFamily: 'system-ui', paddingBottom: '100px' },
    topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px', borderBottom: '1px solid #29202D' },
    iconButton: { width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#1C1822', border: '1px solid #29202D', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', color: '#F2E9E4' },
    title: { fontSize: '18px', fontWeight: '700', color: '#F2E9E4', letterSpacing: '0.5px' },
    heroSection: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', padding: '30px 20px' },
    avatarContainer: { position: 'relative' as const, marginBottom: '16px' },
    avatar: { width: '120px', height: '120px', borderRadius: '50%', objectFit: 'cover' as const, border: '3px solid #D4B18A', backgroundColor: '#29202D' },
    onlineBadge: { position: 'absolute' as const, bottom: '5px', right: '10px', width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#34D399', border: '3px solid #0D0A10' },
    nameRow: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' },
    name: { fontSize: '26px', fontWeight: '800', color: '#F2E9E4' },
    ageBadge: { backgroundColor: '#4A1828', color: '#D4B18A', padding: '4px 12px', borderRadius: '20px', fontSize: '14px', fontWeight: '700' },
    location: { fontSize: '14px', color: '#B58A83', marginBottom: '16px' },
    intentionTag: { backgroundColor: '#29202D', color: '#D4B18A', border: '1px solid #4A1828', padding: '6px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' },
    
    // Stats Grid - With Clickable Handlers
    statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', padding: '0 20px', marginBottom: '24px' },
    statCard: { backgroundColor: '#1C1822', borderRadius: '16px', padding: '16px 8px', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', border: '1px solid #29202D', cursor: 'pointer', transition: 'transform 0.1s' },
    statIcon: { fontSize: '22px', marginBottom: '8px' },
    statValue: { fontSize: '18px', fontWeight: '800', color: '#F2E9E4', marginBottom: '4px' },
    statLabel: { fontSize: '10px', color: '#B58A83', fontWeight: '600', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
    
    progressCard: { margin: '0 20px 24px 20px', backgroundColor: '#1C1822', borderRadius: '16px', padding: '20px', display: 'flex', alignItems: 'center', gap: '16px', border: '1px solid #29202D' },
    progressCircle: { width: '50px', height: '50px' },
    progressText: { flex: 1 },
    progressTitle: { fontSize: '15px', fontWeight: '700', color: '#F2E9E4', marginBottom: '4px' },
    progressSubtitle: { fontSize: '12px', color: '#B58A83' },
    completeBtn: { backgroundColor: '#D4B18A', color: '#17121C', padding: '10px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: '700', border: 'none', cursor: 'pointer' },
    
    tabsContainer: { display: 'flex', padding: '0 20px', marginBottom: '24px', gap: '12px' },
    tab: { flex: 1, padding: '14px', borderRadius: '14px', textAlign: 'center' as const, fontSize: '14px', fontWeight: '700', cursor: 'pointer', transition: 'all 0.2s', border: '1px solid #29202D' },
    tabActive: { background: 'linear-gradient(135deg, #D4B18A, #B58A83)', color: '#17121C', border: 'none' },
    tabInactive: { backgroundColor: '#1C1822', color: '#B58A83' },
    
    section: { margin: '0 20px 24px 20px', backgroundColor: '#1C1822', borderRadius: '20px', padding: '20px', border: '1px solid #29202D' },
    sectionHeader: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' },
    sectionIcon: { width: '32px', height: '32px', borderRadius: '10px', background: 'linear-gradient(135deg, #4A1828, #D4B18A)', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '16px' },
    sectionTitle: { fontSize: '16px', fontWeight: '700', color: '#F2E9E4' },
    
    infoRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #29202D' },
    infoLabel: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: '#B58A83', fontWeight: '500' },
    infoValue: { fontSize: '14px', color: '#F2E9E4', fontWeight: '600', textAlign: 'right' as const, maxWidth: '60%' },
    
    galleryGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
    galleryImage: { width: '100%', aspectRatio: '1/1', borderRadius: '16px', objectFit: 'cover' as const, backgroundColor: '#29202D', border: '1px solid #4A1828' },
    galleryEmpty: { width: '100%', aspectRatio: '1/1', borderRadius: '16px', backgroundColor: '#29202D', border: '2px dashed #4A1828', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#B58A83', fontSize: '24px' }
  };

  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (completionPercentage / 100) * circumference;
  const displayLocation = profile.city && profile.country ? `${profile.city}, ${profile.country}` : profile.city || profile.country || 'Location not set';

  return (
    <div style={styles.container}>
      <div style={styles.topBar}>
        <button style={styles.iconButton} onClick={() => router.back()}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg></button>
        <div style={styles.title}>My Profile</div>
        <button style={styles.iconButton} onClick={() => router.push('/profile/settings')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
        </button>
      </div>

      <div style={styles.heroSection}>
        <div style={styles.avatarContainer}>
          {profile.avatar_url ? <img src={profile.avatar_url} alt="Avatar" style={styles.avatar} /> : <div style={{ ...styles.avatar, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '40px' }}>👤</div>}
          <div style={styles.onlineBadge} />
        </div>
        <div style={styles.nameRow}><span style={styles.name}>{profile.display_name}</span><span style={styles.ageBadge}>{profile.age}</span></div>
        <div style={styles.location}>{profile.gender} • {displayLocation}</div>
        <div style={styles.intentionTag}>{profile.intention || 'Looking for connections'}</div>
      </div>

      {/* Stats Grid - WITH CLICKABLE CARDS */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard} onClick={() => router.push('/profile/stats/photos')}>
          <span style={styles.statIcon}>📸</span>
          <span style={styles.statValue}>{profile.photos?.filter(p => p).length || 0}</span>
          <span style={styles.statLabel}>Photos</span>
        </div>
        <div style={styles.statCard} onClick={() => router.push('/profile/stats/interests')}>
          <span style={styles.statIcon}>❤️</span>
          <span style={styles.statValue}>{profile.hobbies?.length || 0}</span>
          <span style={styles.statLabel}>Interests</span>
        </div>
        <div style={styles.statCard} onClick={() => router.push('/profile/stats/matches')}>
          <span style={styles.statIcon}>✨</span>
          <span style={styles.statValue}>0</span>
          <span style={styles.statLabel}>Matches</span>
        </div>
        <div style={styles.statCard} onClick={() => router.push('/profile/stats/followers')}>
          <span style={styles.statIcon}>👥</span>
          <span style={styles.statValue}>{profile.followers || 0}</span>
          <span style={styles.statLabel}>Followers</span>
        </div>
        <div style={styles.statCard} onClick={() => router.push('/profile/stats/following')}>
          <span style={styles.statIcon}>➕</span>
          <span style={styles.statValue}>{profile.following || 0}</span>
          <span style={styles.statLabel}>Following</span>
        </div>
        <div style={styles.statCard} onClick={() => router.push('/profile/stats/friends')}>
          <span style={styles.statIcon}>🤝</span>
          <span style={styles.statValue}>{profile.friends || 0}</span>
          <span style={styles.statLabel}>Friends</span>
        </div>
      </div>

      <div style={styles.progressCard}>
        <svg style={styles.progressCircle} viewBox="0 0 50 50"><circle cx="25" cy="25" r={radius} fill="none" stroke="#29202D" strokeWidth="4" /><circle cx="25" cy="25" r={radius} fill="none" stroke="#D4B18A" strokeWidth="4" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} strokeLinecap="round" transform="rotate(-90 25 25)" /><text x="25" y="28" textAnchor="middle" fill="#F2E9E4" fontSize="10" fontWeight="bold">{completionPercentage}%</text></svg>
        <div style={styles.progressText}><div style={styles.progressTitle}>Complete your profile</div><div style={styles.progressSubtitle}>Add more info to attract matches</div></div>
        <button style={styles.completeBtn} onClick={() => router.push('/profile/edit')}>Complete</button>
      </div>

      <div style={styles.tabsContainer}>
        <div style={{ ...styles.tab, ...(activeTab === 'about' ? styles.tabActive : styles.tabInactive) }} onClick={() => setActiveTab('about')}>About</div>
        <div style={{ ...styles.tab, ...(activeTab === 'gallery' ? styles.tabActive : styles.tabInactive) }} onClick={() => setActiveTab('gallery')}>Gallery</div>
      </div>

      {activeTab === 'about' && (
        <div>
          <div style={styles.section}>
            <div style={styles.sectionHeader}><div style={styles.sectionIcon}>👤</div><div style={styles.sectionTitle}>About Me</div></div>
            <div style={styles.infoRow}><div style={styles.infoLabel}>📝 Bio</div><div style={styles.infoValue}>{profile.intention || 'No bio added yet.'}</div></div>
            <div style={{ ...styles.infoRow, borderBottom: 'none' }}><div style={styles.infoLabel}>🎂 Birthday</div><div style={styles.infoValue}>{profile.birth_date ? new Date(profile.birth_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set'} ({profile.age} years)</div></div>
            <div style={{ ...styles.infoRow, borderBottom: 'none' }}><div style={styles.infoLabel}>👥 Gender</div><div style={styles.infoValue}>{profile.gender || 'Not set'}</div></div>
            <div style={{ ...styles.infoRow, borderBottom: 'none' }}><div style={styles.infoLabel}>❤️ Looking for</div><div style={styles.infoValue}>{profile.looking_for?.join(', ') || 'Not set'}</div></div>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionHeader}><div style={styles.sectionIcon}>✨</div><div style={styles.sectionTitle}>More About Me</div></div>
            <div style={styles.infoRow}><div style={styles.infoLabel}>💫 Intention</div><div style={styles.infoValue}>{profile.intention || 'Not set'}</div></div>
            <div style={styles.infoRow}><div style={styles.infoLabel}>🍷 Drinking</div><div style={styles.infoValue}>{profile.drinking || 'Not set'}</div></div>
            <div style={styles.infoRow}><div style={styles.infoLabel}>🚬 Smoking</div><div style={styles.infoValue}>{profile.smoking || 'Not set'}</div></div>
            <div style={styles.infoRow}><div style={styles.infoLabel}>🛐 Religion</div><div style={styles.infoValue}>{profile.religion || 'Not set'}</div></div>
            <div style={styles.infoRow}><div style={styles.infoLabel}>⚖️ Politics</div><div style={styles.infoValue}>{profile.politics || 'Not set'}</div></div>
            <div style={{ ...styles.infoRow, borderBottom: 'none' }}><div style={styles.infoLabel}>🐾 Pets</div><div style={styles.infoValue}>{profile.pets?.join(', ') || 'Not set'}</div></div>
            <div style={{ ...styles.infoRow, borderBottom: 'none' }}><div style={styles.infoLabel}>🧠 Personality</div><div style={styles.infoValue}>{profile.personality?.join(', ') || 'Not set'}</div></div>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionHeader}><div style={styles.sectionIcon}>📞</div><div style={styles.sectionTitle}>Contact</div></div>
            <div style={styles.infoRow}><div style={styles.infoLabel}>📧 Email</div><div style={styles.infoValue}>{userEmail}</div></div>
            <div style={{ ...styles.infoRow, borderBottom: 'none' }}><div style={styles.infoLabel}>📱 Phone</div><div style={styles.infoValue}>Not set</div></div>
          </div>
        </div>
      )}

      {activeTab === 'gallery' && (
        <div style={styles.section}>
          <div style={styles.sectionHeader}><div style={styles.sectionIcon}>🖼️</div><div style={styles.sectionTitle}>Verification Gallery</div></div>
          <div style={styles.galleryGrid}>
            {profile.photos && profile.photos.length > 0 ? profile.photos.map((photo, index) => (photo ? <img key={index} src={photo} alt={`Gallery ${index}`} style={styles.galleryImage} /> : <div key={index} style={styles.galleryEmpty}>+</div>)) : Array.from({ length: 6 }).map((_, index) => <div key={index} style={styles.galleryEmpty}>+</div>)}
          </div>
        </div>
      )}

      <MobileNav />
    </div>
  );
}