'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase'; 


const LANGUAGES = [
  'English (United Kingdom)', 'English (United States)', 'Mandarin Chinese (中文)', 'Hindi (हिन्दी)',
  'Spanish (Español)', 'French (Français)', 'Arabic (العربية)', 'Bengali (বাংলা)', 'Portuguese (Português)',
  'Russian (Русский)', 'Urdu (اردو)', 'Nepali (नेपाली)', 'Japanese (日本語)', 'Korean (한국어)'
];

export default function SettingsPage() {
  const router = useRouter();
  const [isLangModalOpen, setIsLangModalOpen] = useState(false);
  const [selectedLang, setSelectedLang] = useState('English (United Kingdom)');
  const [isSigningOut, setIsSigningOut] = useState(false);
  
  // Ref for the avatar upload
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    await supabase.auth.signOut();
    router.push('/auth');
  };

  const handleClearCache = () => {
    localStorage.clear();
    alert('Cache cleared successfully!');
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = reader.result as string;
        // Update the avatar in Supabase
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { error } = await supabase.from('profiles').update({ avatar_url: base64String }).eq('id', user.id);
          if (error) {
            alert(`Error updating avatar: ${error.message}`);
          } else {
            alert('Avatar updated successfully!');
          }
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLanguageSelect = (lang: string) => {
    setSelectedLang(lang);
    localStorage.setItem('mettivo_preferred_lang', lang);
    setIsLangModalOpen(false);
  };

  // Reusable styles for the menu items
  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', fontFamily: 'system-ui', paddingBottom: '40px' },
    header: { display: 'flex', alignItems: 'center', padding: '20px', borderBottom: '1px solid #29202D' },
    backBtn: { background: 'none', border: 'none', color: '#F2E9E4', cursor: 'pointer', marginRight: '16px' },
    headerTitle: { fontSize: '20px', fontWeight: '700', color: '#F2E9E4' },
    
    // Menu Groups
    group: { backgroundColor: '#1C1822', marginTop: '16px', borderTop: '1px solid #29202D', borderBottom: '1px solid #29202D' },
    row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid #29202D', cursor: 'pointer' },
    rowLast: { borderBottom: 'none' },
    rowLabel: { fontSize: '15px', fontWeight: '500', color: '#F2E9E4' },
    rowValue: { fontSize: '13px', color: '#B58A83', marginLeft: 'auto', marginRight: '10px' },
    chevron: { color: '#B58A83', fontSize: '18px' },
    signOutText: { color: '#EF4444', fontWeight: '700' },
    
    // Language Modal
    modalOverlay: { position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(13, 10, 16, 0.8)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'flex-end', flexDirection: 'column' as const, zIndex: 2000 },
    modalBox: { backgroundColor: '#1C1822', borderTopLeftRadius: '30px', borderTopRightRadius: '30px', padding: '30px 24px', borderTop: '1px solid #4A1828', maxHeight: '80vh', overflowY: 'auto' as const },
    modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
    modalTitle: { fontSize: '20px', fontWeight: '700', color: '#F2E9E4' },
    closeBtn: { background: 'none', border: 'none', color: '#B58A83', fontSize: '24px', cursor: 'pointer' },
    langItem: { padding: '16px', fontSize: '15px', color: '#F2E9E4', cursor: 'pointer', borderRadius: '12px', borderBottom: '1px solid #29202D', textAlign: 'center' as const },
    langItemActive: { backgroundColor: '#4A1828', color: '#D4B18A', fontWeight: '700' }
  };

  return (
    <div style={styles.container}>
      
      {/* Hidden Avatar Input */}
      <input type="file" accept="image/*" ref={avatarInputRef} style={{ display: 'none' }} onChange={handleAvatarUpload} />

      {/* Header */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => router.back()}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <div style={styles.headerTitle}>Settings</div>
      </div>

      {/* Top Group */}
      <div style={styles.group}>
        <div style={styles.row} onClick={() => alert('Switch Mode coming soon!')}>
          <span style={styles.rowLabel}>Switch Mode</span>
          <span style={styles.chevron}>›</span>
        </div>
        <div style={styles.row} onClick={() => router.push('/profile/edit')}>
          <span style={styles.rowLabel}>Edit Profile</span>
          <span style={styles.chevron}>›</span>
        </div>
        <div style={styles.row} onClick={() => avatarInputRef.current?.click()}>
          <span style={styles.rowLabel}>Change Avatar</span>
          <span style={{ ...styles.chevron, fontSize: '24px' }}>👤</span>
        </div>
      </div>

      {/* Middle Group */}
      <div style={styles.group}>
        <div style={styles.row} onClick={() => alert('Notification settings coming soon!')}>
          <span style={styles.rowLabel}>Notifications</span>
          <span style={styles.chevron}>›</span>
        </div>
        <div style={styles.row} onClick={() => setIsLangModalOpen(true)}>
          <span style={styles.rowLabel}>Language</span>
          <span style={styles.rowValue}>{selectedLang}</span>
          <span style={styles.chevron}>›</span>
        </div>
        <div style={{ ...styles.row, ...styles.rowLast }} onClick={() => alert('Help Center coming soon!')}>
          <span style={styles.rowLabel}>Help Center</span>
          <span style={styles.chevron}>›</span>
        </div>
      </div>

      {/* Bottom Group */}
      <div style={styles.group}>
        <div style={styles.row} onClick={() => alert('Community Guidelines coming soon!')}><span style={styles.rowLabel}>Community Guidelines</span><span style={styles.chevron}>›</span></div>
        <div style={styles.row} onClick={() => alert('Safety Center coming soon!')}><span style={styles.rowLabel}>Safety Center</span><span style={styles.chevron}>›</span></div>
        <div style={styles.row} onClick={() => alert('Terms of Use coming soon!')}><span style={styles.rowLabel}>Terms of Use</span><span style={styles.chevron}>›</span></div>
        <div style={styles.row} onClick={() => alert('About Us coming soon!')}><span style={styles.rowLabel}>About Us</span><span style={styles.chevron}>›</span></div>
        <div style={styles.row} onClick={() => alert('Block List coming soon!')}><span style={styles.rowLabel}>Block List</span><span style={styles.chevron}>›</span></div>
        <div style={styles.row} onClick={handleClearCache}><span style={styles.rowLabel}>Clear Cache</span><span style={styles.chevron}>›</span></div>
        <div style={styles.row} onClick={() => alert('Account settings coming soon!')}><span style={styles.rowLabel}>Account</span><span style={styles.chevron}>›</span></div>
        <div style={styles.row} onClick={() => alert('Privacy Control coming soon!')}><span style={styles.rowLabel}>Privacy Control</span><span style={styles.chevron}>›</span></div>
        <div style={{ ...styles.row, ...styles.rowLast }} onClick={() => alert('Privacy Control coming soon!')}>
          <span style={styles.rowLabel}>Privacy Control</span>
          <span style={styles.chevron}>›</span>
        </div>
      </div>

      {/* Sign Out */}
      <div style={styles.group}>
        <div style={{ ...styles.row, ...styles.rowLast }} onClick={handleSignOut}>
          <span style={{ ...styles.rowLabel, ...styles.signOutText }}>
            {isSigningOut ? 'Signing Out...' : 'Sign Out'}
          </span>
        </div>
      </div>

      {/* Language Selection Modal */}
      {isLangModalOpen && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalBox}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>Select Language</div>
              <button style={styles.closeBtn} onClick={() => setIsLangModalOpen(false)}>×</button>
            </div>
            {LANGUAGES.map((lang) => (
              <div 
                key={lang} 
                style={{ ...styles.langItem, ...(selectedLang === lang ? styles.langItemActive : {}) }} 
                onClick={() => handleLanguageSelect(lang)}
              >
                {lang}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}