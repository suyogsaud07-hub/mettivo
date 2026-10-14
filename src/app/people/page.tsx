'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase'; 

import { useRouter } from 'next/navigation';

interface Profile {
  id: string;
  display_name: string;
  age: number;
  city: string;
  country: string;
  avatar_url: string;
  photos: string[];
  intention: string;
  gender: string;
}

export default function PeoplePage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isAnimating, setIsAnimating] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | 'up' | 'down' | null>(null);

  // Filter States
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [minAge, setMinAge] = useState(18);
  const [maxAge, setMaxAge] = useState(50);
  const [distance, setDistance] = useState(50); // in km
  const [selectedGenders, setSelectedGenders] = useState<string[]>(['Woman', 'Man', 'Nonbinary']);

  // Load Profiles with Filters
  const loadProfiles = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/auth');
      return;
    }

    let query = supabase
      .from('profiles')
      .select('*')
      .neq('id', user.id)
      .eq('onboarding_completed', true)
      .gte('age', minAge)
      .lte('age', maxAge);

    // Only apply gender filter if not all are selected
    if (selectedGenders.length > 0 && selectedGenders.length < 3) {
      query = query.in('gender', selectedGenders);
    }

    const { data, error } = await query.limit(20);

    if (error) {
      console.error("Error fetching profiles:", error);
    } else if (data) {
      setProfiles(data);
      setCurrentIndex(0); // Reset deck
    }
    setLoading(false);
  };

  useEffect(() => {
    loadProfiles();
  }, []); // Initial load

  const handleAction = (action: 'dislike' | 'like' | 'superlike' | 'rewind') => {
    if (isAnimating) return;

    if (action === 'rewind') {
      if (currentIndex > 0) {
        setIsAnimating(true);
        setSwipeDirection('right');
        setTimeout(() => {
          setCurrentIndex(prev => prev - 1);
          setSwipeDirection(null);
          setIsAnimating(false);
        }, 300);
      }
      return;
    }

    setIsAnimating(true);
    setSwipeDirection(action === 'dislike' ? 'left' : 'right');

    setTimeout(() => {
      // In a real app, save the like/dislike to Supabase here
      // await supabase.from('likes').insert({ user_id: user.id, liked_id: activeProfile.id, type: action })
      setCurrentIndex(prev => prev + 1);
      setSwipeDirection(null);
      setIsAnimating(false);
    }, 300);
  };

  const toggleGender = (gender: string) => {
    setSelectedGenders(prev => 
      prev.includes(gender) 
        ? prev.filter(g => g !== gender)
        : [...prev, gender]
    );
  };

  const handleApplyFilters = () => {
    setIsFilterOpen(false);
    loadProfiles();
  };

  const activeProfile = profiles[currentIndex];

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', fontFamily: 'system-ui', display: 'flex', flexDirection: 'column' as const, position: 'relative' as const, overflow: 'hidden' },
    topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px', position: 'absolute' as const, top: 0, left: 0, right: 0, zIndex: 10 },
    iconButton: { width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'rgba(28, 24, 34, 0.8)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', color: '#F2E9E4' },
    
    cardContainer: { flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px', paddingTop: '80px', paddingBottom: '120px', position: 'relative' as const },
    card: { 
      width: '100%', maxWidth: '400px', height: '100%', maxHeight: '650px', 
      borderRadius: '24px', overflow: 'hidden', position: 'relative' as const, 
      boxShadow: '0 20px 50px rgba(0,0,0,0.5)', backgroundColor: '#1C1822',
      transition: 'transform 0.3s ease, opacity 0.3s ease',
      transform: swipeDirection === 'left' ? 'translateX(-120%) rotate(-15deg)' : 
                 swipeDirection === 'right' ? 'translateX(120%) rotate(15deg)' : 
                 swipeDirection === 'up' ? 'translateY(-120%)' : 'translateX(0) rotate(0)',
      opacity: isAnimating ? 0 : 1
    },
    image: { width: '100%', height: '100%', objectFit: 'cover' as const },
    gradient: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(to top, rgba(13,10,16,0.95) 0%, rgba(13,10,16,0.6) 50%, transparent 100%)' },
    infoContainer: { position: 'absolute' as const, bottom: '100px', left: '24px', right: '24px', zIndex: 5 },
    nameRow: { display: 'flex', alignItems: 'flex-end', gap: '10px', marginBottom: '6px' },
    name: { fontSize: '32px', fontWeight: '800', color: '#FFFFFF', textShadow: '0 2px 10px rgba(0,0,0,0.5)' },
    age: { fontSize: '26px', fontWeight: '400', color: '#D4B18A', textShadow: '0 2px 10px rgba(0,0,0,0.5)' },
    locationRow: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' },
    locationText: { fontSize: '14px', color: '#F2E9E4', fontWeight: '500', textShadow: '0 2px 5px rgba(0,0,0,0.5)' },
    tagContainer: { display: 'flex', gap: '8px', flexWrap: 'wrap' as const },
    tag: { backgroundColor: 'rgba(212, 177, 138, 0.2)', backdropFilter: 'blur(10px)', color: '#D4B18A', border: '1px solid #D4B18A', padding: '6px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' },
    
    actionBar: { position: 'absolute' as const, bottom: '30px', left: 0, right: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px', zIndex: 10 },
    actionBtn: { width: '60px', height: '60px', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', transition: 'all 0.2s', border: 'none', boxShadow: '0 8px 20px rgba(0,0,0,0.4)' },
    btnRewind: { backgroundColor: '#1C1822', border: '2px solid #F59E0B', color: '#F59E0B' },
    btnDislike: { backgroundColor: '#1C1822', border: '2px solid #EF4444', color: '#EF4444', width: '70px', height: '70px' },
    btnSuperLike: { backgroundColor: '#1C1822', border: '2px solid #3B82F6', color: '#3B82F6' },
    btnLike: { backgroundColor: '#1C1822', border: '2px solid #10B981', color: '#10B981', width: '70px', height: '70px' },
    
    emptyState: { flex: 1, display: 'flex', flexDirection: 'column' as const, justifyContent: 'center', alignItems: 'center', padding: '40px', textAlign: 'center' as const },
    emptyTitle: { fontSize: '24px', fontWeight: '700', color: '#F2E9E4', marginBottom: '12px' },
    emptySubtitle: { fontSize: '15px', color: '#B58A83', marginBottom: '30px', lineHeight: '1.5' },
    refreshBtn: { backgroundColor: '#D4B18A', color: '#17121C', padding: '16px 32px', borderRadius: '30px', fontSize: '16px', fontWeight: '700', border: 'none', cursor: 'pointer' },

    // Filter Modal Styles
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
      
      {/* Top Bar */}
      <div style={styles.topBar}>
        <button style={styles.iconButton} onClick={() => router.push('/discover')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        </button>
        
        {/* Filter Button */}
        <button style={styles.iconButton} onClick={() => setIsFilterOpen(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>
        </button>
      </div>

      {/* Main Card Area */}
      {activeProfile ? (
        <div style={styles.cardContainer}>
          <div style={styles.card}>
            {activeProfile.avatar_url ? (
              <img src={activeProfile.avatar_url} alt={activeProfile.display_name} style={styles.image} />
            ) : (
              <div style={{ ...styles.image, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '40px', color: '#B58A83' }}>👤</div>
            )}
            
            <div style={styles.gradient} />

            <div style={styles.infoContainer}>
              <div style={styles.nameRow}>
                <span style={styles.name}>{activeProfile.display_name}</span>
                <span style={styles.age}>{activeProfile.age}</span>
              </div>
              
              <div style={styles.locationRow}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D4B18A" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                <span style={styles.locationText}>
                  {activeProfile.city ? `${activeProfile.city}, ` : ''}{activeProfile.country || 'Nearby'}
                </span>
              </div>

              <div style={styles.tagContainer}>
                {activeProfile.intention && <span style={styles.tag}>{activeProfile.intention}</span>}
                {activeProfile.gender && <span style={styles.tag}>{activeProfile.gender}</span>}
              </div>
            </div>

            <div style={styles.actionBar}>
              <button style={{ ...styles.actionBtn, ...styles.btnRewind }} onClick={() => handleAction('rewind')}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
              </button>
              <button style={{ ...styles.actionBtn, ...styles.btnDislike }} onClick={() => handleAction('dislike')}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
              <button style={{ ...styles.actionBtn, ...styles.btnSuperLike }} onClick={() => handleAction('superlike')}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
              </button>
              <button style={{ ...styles.actionBtn, ...styles.btnLike }} onClick={() => handleAction('like')}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div style={styles.emptyState}>
          <div style={{ fontSize: '60px', marginBottom: '20px' }}>🔍</div>
          <div style={styles.emptyTitle}>No more profiles nearby</div>
          <div style={styles.emptySubtitle}>
            We've run out of people to show you in your area. Try adjusting your filters or check back later.
          </div>
          <button style={styles.refreshBtn} onClick={() => setIsFilterOpen(true)}>
            Adjust Filters
          </button>
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

            {/* Age Filter */}
            <div style={styles.filterSection}>
              <label style={styles.filterLabel}>Age Range</label>
              <div style={styles.inputRow}>
                <input 
                  type="number" 
                  value={minAge} 
                  onChange={(e) => setMinAge(Number(e.target.value))}
                  min="18"
                  max={maxAge}
                  style={styles.filterInput} 
                />
                <input 
                  type="number" 
                  value={maxAge} 
                  onChange={(e) => setMaxAge(Number(e.target.value))}
                  min={minAge}
                  max="100"
                  style={styles.filterInput} 
                />
              </div>
            </div>

            {/* Distance Filter */}
            <div style={styles.filterSection}>
              <label style={styles.filterLabel}>Maximum Distance (km)</label>
              <div style={styles.sliderContainer}>
                <input 
                  type="range" 
                  min="1" 
                  max="100" 
                  value={distance} 
                  onChange={(e) => setDistance(Number(e.target.value))}
                  style={styles.slider} 
                />
                <div style={styles.sliderLabels}>
                  <span>1 km</span>
                  <span style={{ color: '#D4B18A', fontWeight: '700' }}>{distance} km</span>
                  <span>100 km</span>
                </div>
              </div>
            </div>

            {/* Gender Filter */}
            <div style={styles.filterSection}>
              <label style={styles.filterLabel}>Show Me</label>
              <div style={styles.genderPillContainer}>
                {['Woman', 'Man', 'Nonbinary'].map((gender) => (
                  <button
                    key={gender}
                    onClick={() => toggleGender(gender)}
                    style={{
                      ...styles.genderPill,
                      ...(selectedGenders.includes(gender) ? styles.genderPillActive : {})
                    }}
                  >
                    {gender}
                  </button>
                ))}
              </div>
            </div>

            <button style={styles.applyBtn} onClick={handleApplyFilters}>
              Apply Filters
            </button>
            <button 
              style={styles.resetBtn} 
              onClick={() => {
                setMinAge(18);
                setMaxAge(50);
                setDistance(50);
                setSelectedGenders(['Woman', 'Man', 'Nonbinary']);
              }}
            >
              Reset to Default
            </button>
          </div>
        </div>
      )}

    </div>
  );
}