'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase'; 
import { useRouter } from 'next/navigation';
import MobileNav from '../components/layout/MobileNav';
import IntentionBadge from '../components/profile/IntentionBadge';
import FollowButton from '../components/profile/FollowButton';
import ProfileLink from '../components/profile/ProfileLink';
import { recordLike, LikeError } from '@/lib/likes';
import { blockMember, BlockingError } from '@/lib/blocking';
import { fetchDiscoveryCandidates, rankDiscovery } from '@/lib/discovery';
import { gendersForLookingFor } from '@/lib/dating-preferences';

interface Profile {
  id: string;
  display_name: string;
  username: string | null;
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
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [minAge, setMinAge] = useState(18);
  const [maxAge, setMaxAge] = useState(50);
  const [distance, setDistance] = useState(50);
  const [selectedGenders, setSelectedGenders] = useState<string[]>(['Woman', 'Man', 'Nonbinary']);
  const [isRecording, setIsRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  // M10: like/pass state
  const [decisionPending, setDecisionPending] = useState<string | null>(null);
  const [matchNotice, setMatchNotice] = useState<{ name: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // NOTE: `loading` already defaults to true, so this must not set it
  // synchronously — doing so inside the mount effect causes a cascading render.
  const loadOnlineProfiles = async (genderFilter?: string[], applyPreferences = false) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/auth'); return; }

    // GATEKEEPER: Check if profile exists first. This also loads the fields the
    // ranking engine scores me on, so the feed is ordered for the actual member
    // rather than for a generic one.
    const { data: profileCheck } = await supabase
      .from('profiles')
      .select('onboarding_completed, gender, intention, interests, prompts, looking_for')
      .eq('id', user.id)
      .single();

    if (!profileCheck || profileCheck.onboarding_completed === false) {
      router.push('/profile');
      return;
    }

    const savedPreferences = Array.isArray(profileCheck.looking_for)
      ? profileCheck.looking_for
      : [];
    const preferredGenders = gendersForLookingFor(savedPreferences);
    const effectiveGenders = applyPreferences
      ? preferredGenders
      : (genderFilter ?? selectedGenders);

    if (applyPreferences) setSelectedGenders(preferredGenders);

    try {
      // M12: eligibility is decided by `discover_profiles()` in PostgreSQL --
      // blocked pairs, suspended members, anyone already liked/passed and
      // anyone already matched are removed before the browser sees them.
      // M9: ordering is the deterministic rule-based score, applied here.
      const candidates = await fetchDiscoveryCandidates({
        minAge,
        maxAge,
        genders: effectiveGenders,
        onlineOnly: false,
        limit: 50,
      });

      const me = {
        id: user.id,
        gender: typeof profileCheck.gender === 'string' ? profileCheck.gender : null,
        intention: typeof profileCheck.intention === 'string' ? profileCheck.intention : null,
        interests: Array.isArray(profileCheck.interests) ? profileCheck.interests : [],
        promptAnswers:
          typeof profileCheck.prompts === 'object' && profileCheck.prompts !== null
            ? (profileCheck.prompts as Record<string, string>)
            : {},
        lookingFor: savedPreferences,
      };

      const ranked = rankDiscovery(me, candidates, { limit: 50 });

      setProfiles(
        ranked.map(({ profile }) => ({
          id: profile.id,
          display_name: profile.displayName,
          username: profile.username,
          age: profile.age ?? 18,
          gender: profile.gender ?? '',
          city: profile.city ?? '',
          country: profile.country ?? '',
          avatar_url: profile.avatarUrl ?? '',
          intention: profile.intention ?? '',
          is_online: profile.online,
        }))
      );
    } catch (err) {
      console.error('[discover] failed to load candidates:', err);
      setActionError(
        err instanceof Error ? err.message : 'We could not load members right now. Please try again.'
      );
    } finally {
      // CONSTITUTION Article 2.8: the loading state must always terminate.
      setLoading(false);
    }
  };

  // `loadOnlineProfiles` only calls setState after an `await`, so this is a
  // one-shot mount fetch, not a synchronous setState that cascades renders.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadOnlineProfiles(undefined, true); }, []);

  const toggleGender = (gender: string) => {
    setSelectedGenders(prev => prev.includes(gender) ? prev.filter(g => g !== gender) : [...prev, gender]);
  };

  /**
   * M10: record a like or a pass.
   *
   * The decision is persisted server-side in a single transaction that also
   * creates the match when the interest turns out to be mutual. The card is
   * removed from the feed optimistically because the decision is final either
   * way — re-liking the same person is idempotent.
   */
  const handleDecision = async (profile: Profile, isLike: boolean) => {
    if (decisionPending) return;

    setDecisionPending(profile.id);
    setActionError(null);

    try {
      const result = await recordLike(profile.id, isLike);

      setProfiles((prev) => prev.filter((item) => item.id !== profile.id));
      setMenuOpen(null);

      if (result.matched) {
        setMatchNotice({ name: profile.display_name });
      }
    } catch (err) {
      console.error('Failed to record decision:', err);
      setActionError(
        err instanceof LikeError
          ? err.message
          : 'Something went wrong. Please try again.'
      );
    } finally {
      // Guarantees the buttons never stay stuck in a pending state.
      setDecisionPending(null);
    }
  };

  /**
   * M12: block a member inline, without leaving the feed.
   *
   * The whole operation is one transaction in the database — the block, severing
   * the match, and clearing both like decisions — so this is a single call and
   * cannot half-apply. The card is removed locally because the member is now
   * invisible to the server-side feed as well.
   *
   * Previously this menu item navigated to `/report?block=…`, which meant a
   * member had to leave discovery to use the safety control.
   */
  const handleBlock = async (profile: Profile) => {
    if (decisionPending) return;

    setDecisionPending(profile.id);
    setActionError(null);
    setMenuOpen(null);

    try {
      await blockMember(profile.id);
      setProfiles((prev) => prev.filter((item) => item.id !== profile.id));
    } catch (err) {
      console.error('Failed to block member:', err);
      setActionError(
        err instanceof BlockingError ? err.message : 'We could not block this member.'
      );
    } finally {
      // Guarantees the button never stays stuck in a pending state.
      setDecisionPending(null);
    }
  };

  const handleApplyFilters = () => {
    setIsFilterOpen(false);
    setLoading(true);
    void loadOnlineProfiles(selectedGenders);
  };

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
      alert('Microphone access denied. Please allow microphone permissions.');
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
    if (isRecording) stopRecording();
    else startRecording();
  };

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', fontFamily: 'system-ui', paddingBottom: '100px', display: 'flex', flexDirection: 'column' as const },
    header: { background: 'linear-gradient(135deg, #4A1828 0%, #1C1822 100%)', padding: '24px 20px 30px 20px', borderBottomLeftRadius: '30px', borderBottomRightRadius: '30px', position: 'relative' as const, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' },
    headerTitle: { fontSize: '32px', fontWeight: '900', color: '#F2E9E4', textAlign: 'center' as const, marginBottom: '20px', textShadow: '0 2px 10px rgba(0,0,0,0.5)' },
    filterBtn: { position: 'absolute' as const, top: '24px', right: '20px', width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'rgba(28, 24, 34, 0.8)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', color: '#F2E9E4' },
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
    username: { fontSize: '12px', color: '#D4B18A', marginTop: '2px' },
    genderIcon: { fontSize: '14px', color: '#D4B18A' },
    bioText: { fontSize: '13px', color: '#B58A83', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' },
    emptyState: { flex: 1, display: 'flex', flexDirection: 'column' as const, justifyContent: 'center', alignItems: 'center', padding: '40px', textAlign: 'center' as const },
    emptyTitle: { fontSize: '20px', fontWeight: '700', color: '#F2E9E4', marginBottom: '8px' },
    emptySubtitle: { fontSize: '14px', color: '#B58A83', marginBottom: '24px' },
    moreBtn: { width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(28, 24, 34, 0.8)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', color: '#F2E9E4' },
    menuDropdown: { position: 'absolute' as const, top: '100%', right: '0', backgroundColor: '#1C1822', border: '1px solid #4A1828', borderRadius: '12px', overflow: 'hidden', minWidth: '140px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', zIndex: 100 },
    menuItem: { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', color: '#F2E9E4', fontSize: '14px', cursor: 'pointer', background: 'none', border: 'none', width: '100%', textAlign: 'left' as const },
    menuItemHover: { backgroundColor: '#4A1828' },
    decisionBtn: { width: '40px', height: '40px', borderRadius: '50%', border: '1px solid #4A1828', backgroundColor: 'transparent', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, lineHeight: '1' },
    modalOverlay: { position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(13, 10, 16, 0.9)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 3000 },
    modalBox: { backgroundColor: '#1C1822', width: '90%', maxWidth: '350px', borderRadius: '24px', padding: '30px 24px', border: '1px solid #4A1828', textAlign: 'center' as const },
    modalTitle: { fontSize: '20px', fontWeight: '700', color: '#F2E9E4', marginBottom: '12px' },
    modalSub: { fontSize: '14px', color: '#B58A83', marginBottom: '24px', lineHeight: '1.5' },
    endCallBtn: { width: '100%', padding: '16px', borderRadius: '16px', backgroundColor: '#EF4444', color: '#FFFFFF', fontSize: '15px', fontWeight: '700', border: 'none', cursor: 'pointer' },
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
      <div style={styles.header}>
        <h1 style={styles.headerTitle}>Discover</h1>
        <button style={styles.filterBtn} onClick={() => setIsFilterOpen(true)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg></button>
      </div>

      <div style={{ ...styles.echoBanner, cursor: 'pointer' }} onClick={() => router.push('/discover/mettivo_voice')}>
        <div style={styles.echoLeft}>
          <div style={styles.echoTitleRow}><span style={styles.echoTitle}>Mettivo Voice</span><span style={styles.echoBadge}>{profiles.length} online</span></div>
          <span style={styles.echoSubtitle}>Listen to Voice Cards, Start a Voice Chat</span>
        </div>
        <div style={styles.echoIcons}>
          <div style={styles.echoIconBtn}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg></div>
          <div style={styles.echoIconBtn}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg></div>
          <div style={{ ...styles.echoIconBtn, backgroundColor: 'transparent' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D4B18A" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg></div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', marginTop: '40px', color: '#B58A83' }}>Finding people for you...</div>
      ) : profiles.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={{ fontSize: '50px', marginBottom: '16px' }}>🫥</div>
          <div style={styles.emptyTitle}>No one to discover right now</div>
          <div style={styles.emptySubtitle}>Try adjusting your filters or check back later.</div>
          <button style={{ backgroundColor: '#D4B18A', color: '#17121C', padding: '14px 24px', borderRadius: '20px', border: 'none', fontWeight: '700', cursor: 'pointer' }} onClick={() => setIsFilterOpen(true)}>Adjust Filters</button>
        </div>
      ) : (
        <div style={styles.listContainer}>
          {profiles.map((profile) => (
            <div key={profile.id} style={styles.listItem}>
              <ProfileLink userId={profile.id} label={`View ${profile.display_name}'s profile`} style={styles.avatarWrapper}>
                {profile.avatar_url ? <img src={profile.avatar_url} alt={profile.display_name} style={styles.avatar} /> : <div style={{ ...styles.avatar, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '24px' }}>👤</div>}
                {profile.is_online && <span style={styles.onlineDot} aria-label="Online" title="Online" />}
              </ProfileLink>
              <ProfileLink userId={profile.id} label={`View ${profile.display_name}'s profile`} style={styles.infoWrapper}>
                <div style={styles.nameRow}><span style={styles.flag}>{getCountryFlag(profile.country)}</span><span style={styles.name}>{profile.display_name}</span><span style={styles.genderIcon}>{getGenderIcon(profile.gender)}</span></div>
                {profile.username ? <div style={styles.username}>@{profile.username}</div> : null}
                <IntentionBadge intention={profile.intention} />
              </ProfileLink>

              {/* M10: like / pass. M18: follow, without leaving the feed. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FollowButton targetUserId={profile.id} />
                <button
                  type="button"
                  aria-label={`Pass on ${profile.display_name}`}
                  disabled={decisionPending === profile.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDecision(profile, false);
                  }}
                  style={{ ...styles.decisionBtn, color: '#B58A83', opacity: decisionPending === profile.id ? 0.5 : 1 }}
                >
                  ✕
                </button>
                <button
                  type="button"
                  aria-label={`Like ${profile.display_name}`}
                  disabled={decisionPending === profile.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDecision(profile, true);
                  }}
                  style={{ ...styles.decisionBtn, backgroundColor: '#4A1828', color: '#D4B18A', opacity: decisionPending === profile.id ? 0.5 : 1 }}
                >
                  {decisionPending === profile.id ? '…' : '♥'}
                </button>
              </div>

              <div style={{ position: 'relative' }}>
                <button
                  style={styles.moreBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(menuOpen === profile.id ? null : profile.id);
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                </button>
                {menuOpen === profile.id && (
                  <div style={styles.menuDropdown}>
                    <button
                      style={styles.menuItem}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(null);
                        window.location.href = `/report?report=${profile.id}`;
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      Report
                    </button>
                    <button
                      style={styles.menuItem}
                      disabled={decisionPending !== null}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleBlock(profile);
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
                      {decisionPending === profile.id ? 'Blocking…' : 'Block'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          style={{
            margin: '0 20px 16px 20px',
            backgroundColor: '#3B1220',
            border: '1px solid #7F1D2E',
            color: '#FCA5B5',
            borderRadius: '14px',
            padding: '12px 16px',
            fontSize: '13px',
            lineHeight: 1.5,
          }}
        >
          {actionError}
        </div>
      )}

      {/* M10: mutual match celebration */}
      {matchNotice && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalBox}>
            <div style={{ fontSize: '44px', marginBottom: '12px' }}>💛</div>
            <div style={{ ...styles.emptyTitle, marginBottom: '8px' }}>It&apos;s a match!</div>
            <div style={{ ...styles.emptySubtitle, marginBottom: '20px' }}>
              You and {matchNotice.name} liked each other.
            </div>
            <button
              type="button"
              onClick={() => setMatchNotice(null)}
              style={{
                backgroundColor: '#D4B18A',
                color: '#17121C',
                padding: '14px 28px',
                borderRadius: '20px',
                border: 'none',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Keep browsing
            </button>
          </div>
        </div>
      )}

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

      {isFilterOpen && (
        <div style={styles.filterOverlay}>
          <div style={styles.filterBox}>
            <div style={styles.filterHeader}><div style={styles.filterTitle}>Filters</div><button style={styles.closeBtn} onClick={() => setIsFilterOpen(false)}>×</button></div>
            <div style={styles.filterSection}><label style={styles.filterLabel}>Age Range</label><div style={styles.inputRow}><input type="number" value={minAge} onChange={(e) => setMinAge(Number(e.target.value))} min="18" max={maxAge} style={styles.filterInput} /><input type="number" value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value))} min={minAge} max="100" style={styles.filterInput} /></div></div>
            <div style={styles.filterSection}><label style={styles.filterLabel}>Maximum Distance (km)</label><div style={styles.sliderContainer}><input type="range" min="1" max="100" value={distance} onChange={(e) => setDistance(Number(e.target.value))} style={styles.slider} /><div style={styles.sliderLabels}><span>1 km</span><span style={{ color: '#D4B18A', fontWeight: '700' }}>{distance} km</span><span>100 km</span></div></div></div>
            <div style={styles.filterSection}><label style={styles.filterLabel}>Show Me</label><div style={styles.genderPillContainer}>{['Woman', 'Man', 'Nonbinary'].map((gender) => (<button key={gender} onClick={() => toggleGender(gender)} style={{ ...styles.genderPill, ...(selectedGenders.includes(gender) ? styles.genderPillActive : {}) }}>{gender}</button>))}</div></div>
            <button style={styles.applyBtn} onClick={handleApplyFilters}>Apply Filters</button>
            <button style={styles.resetBtn} onClick={() => { setMinAge(18); setMaxAge(50); setDistance(50); setSelectedGenders(['Woman', 'Man', 'Nonbinary']); }}>Reset to Default</button>
          </div>
        </div>
      )}
      <MobileNav />
    </div>
  );
}