'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase'; 
import { useRouter } from 'next/navigation';

interface Profile {
  id: string;
  display_name: string;
  age: number;
  gender: string;
  city: string;
  country: string;
  avatar_url: string;
  intention: string;
  is_online: boolean;
}

const getCountryFlag = (country: string) => {
  const flags: { [key: string]: string } = {
    'Nepal': '🇳🇵', 'United States': '🇺🇸', 'United Kingdom': '🇬🇧', 'India': '🇮🇳',
    'Australia': '🇦🇺', 'Canada': '🇨🇦', 'Philippines': '🇵🇭', 'Indonesia': '🇮🇩',
    'Singapore': '🇸🇬', 'Japan': '🇯🇵', 'South Korea': '🇰🇷', 'Germany': '🇩🇪',
    'France': '🇫🇷', 'Brazil': '🇧🇷'
  };
  return flags[country] || '🌐';
};

const getGenderIcon = (gender: string) => {
  if (gender === 'Woman') return '♀️';
  if (gender === 'Man') return '♂️';
  return '⚧';
};

export default function DiscoverPage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter States
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [minAge, setMinAge] = useState(18);
  const [maxAge, setMaxAge] = useState(50);
  const [distance, setDistance] = useState(50);
  const [selectedGenders, setSelectedGenders] = useState<string[]>(['Woman', 'Man', 'Nonbinary']);

  // Voice Feature States
  const [isRecording, setIsRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const loadOnlineProfiles = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/auth'); return; }

    let query = supabase
      .from('profiles')
      .select('*')
      .neq('id', user.id)
      .eq('onboarding_completed', true)
      .eq('is_online', true)
      .gte('age', minAge)
      .lte('age', maxAge)
      .order('display_name', { ascending: true });

    if (selectedGenders.length > 0 && selectedGenders.length < 3) {
      query = query.in('gender', selectedGenders);
    }

    const { data, error } = await query.limit(50);
    if (!error && data) setProfiles(data);
    setLoading(false);
  };

  useEffect(() => { loadOnlineProfiles(); }, []);

  const toggleGender = (gender: string) => {
    setSelectedGenders(prev => prev.includes(gender) ? prev.filter(g => g !== gender) : [...prev, gender]);
  };

  const handleApplyFilters = () => {
    setIsFilterOpen(false);
    loadOnlineProfiles();
  };

  // --- VOICE RECORDING LOGIC ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setAudioUrl(null); 
    } catch (err) {
      alert('Microphone access denied. Please allow microphone permissions in your browser settings.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const handleMicClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', fontFamily: 'system-ui', paddingBottom: '100px', display: 'flex', flexDirection: 'column' as const },
    header: { background: 'linear-gradient(135deg, #4A1828 0%, #1C1822 100%)', padding: '24px 20px 30px 20px', borderBottomLeftRadius: '30px', borderBottomRightRadius: '30px', position: 'relative' as const, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' },
    headerTitle: { fontSize: '32px', fontWeight: '900', color: '#F2E9E4', textAlign: 'center' as const, marginBottom: '20px', textShadow: '0 2px 10px rgba(0,0,0,0.5)' },
    filterBtn: { position: 'absolute' as const, top: '24px', right: '20px', width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'rgba(28, 24, 34, 0.8)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', color: '#F2E9E4' },
    
    // Mettivo Live Banner
    echoBanner: { backgroundColor: '#1C1822', margin: '20px', borderRadius: '20px', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #29202D' },
    echoLeft: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
    echoTitleRow: { display: 'flex', alignItems: 'center', gap: '8px' },
    echoTitle: { fontSize: '18px', fontWeight: '800', color: '#F2E9E4' },
    echoBadge: { backgroundColor: '#29202D', color: '#D4B18A', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '700' },
    echoSubtitle: { fontSize: '13px', color: '#B58A83' },
    echoIcons: { display: 'flex', gap: '8px', alignItems: 'center' },
    echoIconBtn: { width: '40px', height: '40px', borderRadius: '50%', backgroundColor: isRecording ? '#EF4444' : '#29202D', display: 'flex', justifyContent: 'center', alignItems: 'center', color: isRecording ? '#FFFFFF' : '#D4B18A', cursor: 'pointer', transition: 'all 0.2s' },
    audioPlayer: { marginTop: '10px', width: '100%', height: '30px' },

    listContainer: { padding: '0 20px' },
    listItem: { display: 'flex', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid #29202D', cursor: 'pointer' },
    avatarWrapper: { position: 'relative' as const, marginRight: '16px' },
    avatar: { width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover' as const, backgroundColor: '#29202D' },
    onlineDot: { position: 'absolute' as const, bottom: '0px', right: '0px', width: '14px', height: '14px', borderRadius: '50%', backgroundColor: '#10B981', border: '2px solid #0D0A10' },
    infoWrapper: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: '4px' },
    nameRow: { display: 'flex', alignItems: 'center', gap: '6px' },
    flag: { fontSize: '16px' },
    name: { fontSize: '16px', fontWeight: '700', color: '#F2E9E4' },
    genderIcon: { fontSize: '14px', color: '#D4B18A' },
    bioText: { fontSize: '13px', color: '#B58A83', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' },

    emptyState: { flex: 1, display: 'flex', flexDirection: 'column' as const, justifyContent: 'center', alignItems: 'center', padding: '40px', textAlign: 'center' as const },
    emptyTitle: { fontSize: '20px', fontWeight: '700', color: '#F2E9E4', marginBottom: '8px' },
    emptySubtitle: { fontSize: '14px', color: '#B58A83', marginBottom: '24px' },

    // Modals (Call & Filter)
    modalOverlay: { position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(13, 10, 16, 0.9)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 3000 },
    modalBox: { backgroundColor: '#1C1822', width: '90%', maxWidth: '350px', borderRadius: '24px', padding: '30px 24px', border: '1px solid #4A1828', textAlign: 'center' as const },
    modalTitle: { fontSize: '20px', fontWeight: '700', color: '#F2E9E4', marginBottom: '12px' },
    modalSub: { fontSize: '14px', color: '#B58A83', marginBottom: '24px', lineHeight: '1.5' },
    modalBtn: { width: '100%', padding: '16px', borderRadius: '16px', backgroundColor: '#29202D', color: '#F2E9E4', fontSize: '15px', fontWeight: '600', border: '1px solid #4A1828', cursor: 'pointer', marginBottom: '12px' },
    endCallBtn: { width: '100%', padding: '16px', borderRadius: '16px', backgroundColor: '#EF4444', color: '#FFFFFF', fontSize: '15px', fontWeight: '700', border: 'none', cursor: 'pointer' },

    // Filter Styles
    filterOverlay: { position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(13, 10, 16, 0.8)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'flex-end', flexDirection: 'column' as const, zIndex: 2000 },
    filterBox: { backgroundColor: '#1C1822', borderTopLeftRadius: '30px', borderTopRightRadius: '30px', padding: '30px 24px', borderTop: '1px solid #4A1828', maxHeight: '90vh', overflowY: 'auto' as const },
    filterHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' },
    filterTitle: { fontSize: '20px', fontWeight: '700', color: '#F2E9E4' },
    closeBtn: { background: 'none', border: 'none', color: '#B58A83', fontSize: '24px', cursor: 'pointer' },
    filterSection: { marginBottom: '24px' },
    filterLabel: { fontSize: '13px', fontWeight: '700', color: '#D4B18A', textTransform: 'uppercase' as const, letterSpacing: '1px', marginBottom: '12px', display: 'block' },
    inputRow: { display: 'flex', gap: '12px' },
    filterInput: { flex: 1, padding: '14px', borderRadius: '16px', border: '1px solid #4A1828', backgroundColor: '#0D0A10', color: '#F2E9E4', fontSize: '15px', outline: 'none', textAlign: 'center' as const },
    sliderContainer: { display: 'flex', flexDirection: 'column' as const, gap: '8px' },
    slider: { width: '100%', accentColor: '#D4B18A', height: '6px', borderRadius: '3px', cursor: 'pointer' },
    sliderLabels: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#B58A83' },
    genderPillContainer: { display: 'flex', gap: '10px', flexWrap: 'wrap' as const },
    genderPill: { padding: '12px 20px', borderRadius: '20px', border: '1px solid #4A1828', backgroundColor: '#0D0A10', color: '#B58A83', cursor: 'pointer', fontWeight: '600', fontSize: '14px', transition: 'all 0.2s' },
    genderPillActive: { backgroundColor: '#D4B18A', color: '#17121C', borderColor: '#D4B18A' },
    applyBtn: { width: '100%', padding: '18px', borderRadius: '30px', backgroundColor: '#D4B18A', color: '#17121C', fontSize: '16px', fontWeight: '700', border: 'none', cursor: 'pointer', marginTop: '10px' },
    resetBtn: { width: '100%', padding: '16px', borderRadius: '30px', backgroundColor: 'transparent', color: '#B58A83', fontSize: '15px', fontWeight: '600', border: 'none', cursor: 'pointer', marginTop: '12px' }
  };

  return (
    <div style={styles.container}>
      
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.headerTitle}>Discover</h1>
        <button style={styles.filterBtn} onClick={() => setIsFilterOpen(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>
        </button>
      </div>

      {/* Mettivo Live Banner - UPDATED TO ROUTE TO SEPARATE PAGE */}
      <div 
        style={{ ...styles.echoBanner, cursor: 'pointer' }} 
        onClick={() => router.push('/discover/mettivo_live')}
      >
        <div style={styles.echoLeft}>
          <div style={styles.echoTitleRow}>
            <span style={styles.echoTitle}>Mettivo Live</span>
            <span style={styles.echoBadge}>{profiles.length} online</span>
          </div>
          <span style={styles.echoSubtitle}>Listen to Voice Cards, Start a Voice Chat</span>
        </div>
        
        <div style={styles.echoIcons}>
          {/* Mic Icon */}
          <div style={styles.echoIconBtn}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
          </div>
          {/* Phone Icon */}
          <div style={styles.echoIconBtn}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
          </div>
          {/* Forward Arrow */}
          <div style={{ ...styles.echoIconBtn, backgroundColor: 'transparent' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D4B18A" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>
        </div>
      </div>

      {/* Scrollable Online Users List */}
      {loading ? (
        <div style={{ textAlign: 'center', marginTop: '40px', color: '#B58A83' }}>Finding people online...</div>
      ) : profiles.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={{ fontSize: '50px', marginBottom: '16px' }}>🫥</div>
          <div style={styles.emptyTitle}>No one is online right now</div>
          <div style={styles.emptySubtitle}>Try adjusting your filters or check back later.</div>
          <button style={{ backgroundColor: '#D4B18A', color: '#17121C', padding: '14px 24px', borderRadius: '20px', border: 'none', fontWeight: '700', cursor: 'pointer' }} onClick={() => setIsFilterOpen(true)}>Adjust Filters</button>
        </div>
      ) : (
        <div style={styles.listContainer}>
          {profiles.map((profile) => (
            <div key={profile.id} style={styles.listItem} onClick={() => alert(`Opening profile for ${profile.display_name}`)}>
              <div style={styles.avatarWrapper}>
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt={profile.display_name} style={styles.avatar} />
                ) : (
                  <div style={{ ...styles.avatar, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '24px' }}>👤</div>
                )}
                <div style={styles.onlineDot} />
              </div>
              <div style={styles.infoWrapper}>
                <div style={styles.nameRow}>
                  <span style={styles.flag}>{getCountryFlag(profile.country)}</span>
                  <span style={styles.name}>{profile.display_name}</span>
                  <span style={styles.genderIcon}>{getGenderIcon(profile.gender)}</span>
                </div>
                <div style={styles.bioText}>{profile.intention || 'Hey there! I am using Mettivo.'}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* --- VOICE CALL MODAL --- */}
      {isCallModalOpen && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalBox}>
            <div style={{ fontSize: '40px', marginBottom: '16px' }}>📞</div>
            <div style={styles.modalTitle}>Connecting...</div>
            <div style={styles.modalSub}>Finding someone online to chat with. Please wait.</div>
            <button style={styles.endCallBtn} onClick={() => setIsCallModalOpen(false)}>End Call</button>
          </div>
        </div>
      )}

      {/* --- FILTER MODAL OVERLAY --- */}
      {isFilterOpen && (
        <div style={styles.filterOverlay}>
          <div style={styles.filterBox}>
            <div style={styles.filterHeader}>
              <div style={styles.filterTitle}>Filters</div>
              <button style={styles.closeBtn} onClick={() => setIsFilterOpen(false)}>×</button>
            </div>

            <div style={styles.filterSection}>
              <label style={styles.filterLabel}>Age Range</label>
              <div style={styles.inputRow}>
                <input type="number" value={minAge} onChange={(e) => setMinAge(Number(e.target.value))} min="18" max={maxAge} style={styles.filterInput} />
                <input type="number" value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value))} min={minAge} max="100" style={styles.filterInput} />
              </div>
            </div>

            <div style={styles.filterSection}>
              <label style={styles.filterLabel}>Maximum Distance (km)</label>
              <div style={styles.sliderContainer}>
                <input type="range" min="1" max="100" value={distance} onChange={(e) => setDistance(Number(e.target.value))} style={styles.slider} />
                <div style={styles.sliderLabels}>
                  <span>1 km</span>
                  <span style={{ color: '#D4B18A', fontWeight: '700' }}>{distance} km</span>
                  <span>100 km</span>
                </div>
              </div>
            </div>

            <div style={styles.filterSection}>
              <label style={styles.filterLabel}>Show Me</label>
              <div style={styles.genderPillContainer}>
                {['Woman', 'Man', 'Nonbinary'].map((gender) => (
                  <button key={gender} onClick={() => toggleGender(gender)} style={{ ...styles.genderPill, ...(selectedGenders.includes(gender) ? styles.genderPillActive : {}) }}>
                    {gender}
                  </button>
                ))}
              </div>
            </div>

            <button style={styles.applyBtn} onClick={handleApplyFilters}>Apply Filters</button>
            <button style={styles.resetBtn} onClick={() => { setMinAge(18); setMaxAge(50); setDistance(50); setSelectedGenders(['Woman', 'Man', 'Nonbinary']); }}>
              Reset to Default
            </button>
          </div>
        </div>
      )}

    </div>
  );
}