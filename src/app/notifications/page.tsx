'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileNav from '../components/layout/MobileNav'; // Adjust path if needed

// Mock Data based on your reference image and typical dating app notifications
const MOCK_NOTIFICATIONS = [
  {
    id: 1,
    type: 'visitor',
    name: 'venus',
    gender: 'Woman',
    avatar: 'https://i.pravatar.cc/150?u=venus',
    message: 'And 4 other people visited your profile..',
    timestamp: '2 hours ago',
    action: null,
  },
  {
    id: 2,
    type: 'follow',
    name: 'Deactivated User',
    gender: 'Woman',
    avatar: 'https://i.pravatar.cc/150?u=deactivated',
    message: 'starts following you..',
    timestamp: '74 days ago',
    action: 'Follow',
  },
  {
    id: 3,
    type: 'like',
    name: 'Sarah',
    gender: 'Woman',
    avatar: 'https://i.pravatar.cc/150?u=sarah',
    message: 'liked your photo.',
    timestamp: '5 minutes ago',
    action: 'Match',
  },
  {
    id: 4,
    type: 'superlike',
    name: 'Alex',
    gender: 'Man',
    avatar: 'https://i.pravatar.cc/150?u=alex',
    message: 'sent you a Super Like!',
    timestamp: '1 hour ago',
    action: 'Match',
  }
];

const getGenderIcon = (gender: string) => {
  if (gender === 'Woman') return '♀️';
  if (gender === 'Man') return '♂️';
  return '⚧';
};

export default function NotificationsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('All');
  
  const tabs = ['All', 'Follows', 'Likes', 'Activity', 'Visitors'];

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', fontFamily: 'system-ui', paddingBottom: '100px', display: 'flex', flexDirection: 'column' as const },
    header: { display: 'flex', alignItems: 'center', padding: '20px', borderBottom: '1px solid #29202D' },
    backBtn: { background: 'none', border: 'none', color: '#F2E9E4', cursor: 'pointer', marginRight: '16px' },
    headerTitle: { fontSize: '20px', fontWeight: '700', color: '#F2E9E4' },
    
    // Tabs
    tabsContainer: { display: 'flex', gap: '20px', padding: '16px 20px', overflowX: 'auto' as const, borderBottom: '1px solid #29202D' },
    tab: { fontSize: '15px', fontWeight: '600', color: '#B58A83', cursor: 'pointer', background: 'none', border: 'none', whiteSpace: 'nowrap' as const, paddingBottom: '8px', position: 'relative' as const },
    tabActive: { color: '#D4B18A' },
    tabUnderline: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: '3px', backgroundColor: '#D4B18A', borderRadius: '3px' },
    
    // Notification List
    listContainer: { padding: '0 20px', display: 'flex', flexDirection: 'column' as const, gap: '16px', marginTop: '16px' },
    notificationCard: { display: 'flex', alignItems: 'center', gap: '16px', padding: '16px', backgroundColor: '#1C1822', borderRadius: '16px', border: '1px solid #29202D' },
    avatar: { width: '50px', height: '50px', borderRadius: '50%', objectFit: 'cover' as const, backgroundColor: '#29202D' },
    content: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: '4px' },
    nameRow: { display: 'flex', alignItems: 'center', gap: '6px' },
    name: { fontSize: '15px', fontWeight: '700', color: '#F2E9E4' },
    genderIcon: { fontSize: '12px', color: '#D4B18A' },
    message: { fontSize: '13px', color: '#B58A83', lineHeight: '1.4' },
    timestamp: { fontSize: '11px', color: '#666666' },
    
    // Action Button
    actionBtn: { padding: '8px 16px', borderRadius: '20px', backgroundColor: '#D4B18A', color: '#17121C', fontSize: '12px', fontWeight: '700', border: 'none', cursor: 'pointer' }
  };

  return (
    <div style={styles.container}>
      
      {/* Header */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => router.back()}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <div style={styles.headerTitle}>Notifications</div>
      </div>

      {/* Tabs */}
      <div style={styles.tabsContainer}>
        {tabs.map(tab => (
          <button 
            key={tab} 
            style={{ ...styles.tab, ...(activeTab === tab ? styles.tabActive : {}) }}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
            {activeTab === tab && <div style={styles.tabUnderline} />}
          </button>
        ))}
      </div>

      {/* Notification List */}
      <div style={styles.listContainer}>
        {MOCK_NOTIFICATIONS.map((notif) => (
          <div key={notif.id} style={styles.notificationCard}>
            <img src={notif.avatar} alt={notif.name} style={styles.avatar} />
            <div style={styles.content}>
              <div style={styles.nameRow}>
                <span style={styles.name}>{notif.name}</span>
                <span style={styles.genderIcon}>{getGenderIcon(notif.gender)}</span>
              </div>
              <div style={styles.message}>{notif.message}</div>
              <div style={styles.timestamp}>{notif.timestamp}</div>
            </div>
            {notif.action && (
              <button style={styles.actionBtn}>{notif.action}</button>
            )}
          </div>
        ))}
      </div>

      {/* Bottom Navigation */}
      <MobileNav />

    </div>
  );
}