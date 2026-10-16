'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase'; 
import { fetchDiscoveryCandidates, rankDiscovery } from '@/lib/discovery';
import { ReportButton } from '@/app/components/moderation/ReportButton';
import {
  NO_RESTRICTIONS,
  describeRestriction,
  fetchMyRestrictions,
  isAccountRestricted,
  type MyRestrictions,
} from '@/lib/reports';

import { useRouter } from 'next/navigation';

interface Profile {
  id: string;
  display_name: string;
  gender: string;
  avatar_url: string;
  intention: string;
  is_online: boolean;
}

const getGenderIcon = (gender: string) => {
  if (gender === 'Woman') return '♀️';
  if (gender === 'Man') return '♂️';
  return '⚧';
};

const VOICE_TAGS = ['Soft', 'Mysterious', 'Chill', 'Energetic', 'Sweet'];

/**
 * Deterministic bucket derived from a seed string.
 *
 * These values render on the server and again on the client, so they must NOT
 * come from Math.random(): that causes a hydration mismatch and makes the
 * labels change on every re-render.
 */
const seedIndex = (seed: string, buckets: number): number => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % buckets;
};

const tagFor = (id: string): string =>
  VOICE_TAGS[seedIndex(`${id}:tag`, VOICE_TAGS.length)];

// Stable "voice card" length between 3 and 10 seconds.
const durationFor = (id: string): number => 3 + seedIndex(`${id}:duration`, 8);

export default function MettivoVoicePage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('For you');
  const [restrictions, setRestrictions] = useState<MyRestrictions>(NO_RESTRICTIONS);

  const [isRecording, setIsRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const tabs = ['For you', 'Just Chatting', 'Sing a Song', 'Gaming'];

  useEffect(() => {
    let isMounted = true;

    async function loadProfiles() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!isMounted) return;
      if (!user) { router.push('/auth'); return; }

      // M25: a paused account can browse Voice but not start a call or record.
      try {
        const mine = await fetchMyRestrictions();
        if (isMounted) setRestrictions(mine);
      } catch {
        // A read-only notice; never block browsing on it.
      }

      try {
        // M9/M12: this surface used to read the plain `public_profiles` view, so
        // a blocked member could still appear here. Eligibility now comes from
        // `discover_profiles()` in PostgreSQL — blocked pairs, suspended
        // members, anyone already liked/passed and anyone already matched are
        // removed before the browser sees them — and ordering comes from the
        // deterministic rule-based score.
        const { data: me } = await supabase
          .from('profiles')
          .select('intention, interests, prompts')
          .eq('id', user.id)
          .maybeSingle();

        const candidates = await fetchDiscoveryCandidates({ onlineOnly: true, limit: 20 });

        const ranked = rankDiscovery(
          {
            id: user.id,
            intention: typeof me?.intention === 'string' ? me.intention : null,
            interests: Array.isArray(me?.interests) ? me.interests : [],
            promptAnswers:
              typeof me?.prompts === 'object' && me?.prompts !== null
                ? (me.prompts as Record<string, string>)
                : {},
          },
          candidates,
          { limit: 20 }
        );

        if (!isMounted) return;

        setProfiles(
          ranked.map(({ profile }) => ({
            id: profile.id,
            display_name: profile.displayName,
            gender: profile.gender ?? '',
            avatar_url: profile.avatarUrl ?? '',
            intention: profile.intention ?? '',
            is_online: profile.online,
          }))
        );
      } catch (err) {
        console.error('[mettivo-voice] failed to load profiles:', err);
      } finally {
        // CONSTITUTION Article 2.8: the loading state must always terminate.
        if (isMounted) setLoading(false);
      }
    }

    void loadProfiles();

    return () => {
      isMounted = false;
    };
  }, [router, activeTab]);

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

  const handleRecordClick = () => {
    if (isRecording) stopRecording();
    else startRecording();
  };

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', fontFamily: 'system-ui', display: 'flex', flexDirection: 'column' as const },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px' },
    headerTitle: { fontSize: '20px', fontWeight: '700', color: '#F2E9E4' },
    headerIcons: { display: 'flex', gap: '16px' },
    iconBtn: { background: 'none', border: 'none', color: '#F2E9E4', cursor: 'pointer', fontSize: '20px' },
    tabsContainer: { display: 'flex', gap: '20px', padding: '0 20px', overflowX: 'auto' as const, borderBottom: '1px solid #29202D', paddingBottom: '16px' },
    tab: { fontSize: '15px', fontWeight: '600', color: '#B58A83', cursor: 'pointer', background: 'none', border: 'none', whiteSpace: 'nowrap' as const, paddingBottom: '8px', position: 'relative' as const },
    tabActive: { color: '#D4B18A' },
    tabUnderline: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: '3px', backgroundColor: '#D4B18A', borderRadius: '3px' },
    recordBanner: { backgroundColor: '#A855F7', margin: '20px', borderRadius: '16px', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 20px rgba(168, 85, 247, 0.3)' },
    recordText: { color: '#FFFFFF', fontSize: '13px', fontWeight: '600', flex: 1 },
    recordBtn: { backgroundColor: '#FFFFFF', color: '#A855F7', border: 'none', padding: '8px 16px', borderRadius: '20px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' },
    recordBtnActive: { backgroundColor: '#EF4444', color: '#FFFFFF' },
    audioPlayer: { margin: '0 20px 20px 20px', width: 'calc(100% - 40px)', height: '40px' },
    listContainer: { padding: '0 20px', display: 'flex', flexDirection: 'column' as const, gap: '16px' },
    card: { backgroundColor: '#1C1822', borderRadius: '20px', padding: '16px', display: 'flex', alignItems: 'center', gap: '16px', border: '1px solid #29202D' },
    avatarWrapper: { position: 'relative' as const },
    avatar: { width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover' as const, backgroundColor: '#29202D' },
    onlineDot: { position: 'absolute' as const, bottom: '2px', right: '2px', width: '14px', height: '14px', borderRadius: '50%', backgroundColor: '#10B981', border: '2px solid #1C1822' },
    cardInfo: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: '4px' },
    tagRow: { display: 'flex', gap: '6px' },
    tagSoft: { backgroundColor: '#EC4899', color: '#FFFFFF', fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '10px' },
    tagChatting: { backgroundColor: 'transparent', border: '1px solid #B58A83', color: '#B58A83', fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '10px' },
    nameRow: { display: 'flex', alignItems: 'center', gap: '6px' },
    name: { fontSize: '18px', fontWeight: '700', color: '#F2E9E4' },
    statusText: { fontSize: '12px', color: '#B58A83' },
    voiceCardBtn: { display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#A855F7', color: '#FFFFFF', border: 'none', padding: '6px 12px', borderRadius: '16px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', alignSelf: 'flex-start', marginTop: '4px' },
    callBtn: { width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#A855F7', border: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', boxShadow: '0 4px 15px rgba(168, 85, 247, 0.4)' },
    callBtnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
    cardActions: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '8px' },
    restriction: { margin: '0 20px 16px 20px', backgroundColor: '#2A1420', border: '1px solid #542036', color: '#F3C9D3', borderRadius: '14px', padding: '12px 14px', fontSize: '13px', lineHeight: 1.5 }
  };

  const restrictionMessage = describeRestriction(restrictions);
  const paused = isAccountRestricted(restrictions);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.iconBtn} onClick={() => router.back()}>←</button>
        <div style={styles.headerTitle}>Mettivo Voice</div>
        <div style={styles.headerIcons}>
          <button style={styles.iconBtn}>⏱️</button>
          <button style={styles.iconBtn}>🎧</button>
        </div>
      </div>

      {restrictionMessage && (
        <div role="status" style={styles.restriction}>
          {restrictionMessage}
        </div>
      )}

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

      <div style={styles.recordBanner}>
        <span style={styles.recordText}>🎤 Record a voice intro to start calling!</span>
        <button 
          style={{ ...styles.recordBtn, ...(isRecording ? styles.recordBtnActive : {}), ...(paused ? styles.callBtnDisabled : {}) }} 
          onClick={() => {
            if (paused) return;
            handleRecordClick();
          }}
          aria-disabled={paused}
        >
          {isRecording ? 'Stop' : 'Record'}
        </button>
      </div>

      {audioUrl && (
        <audio controls src={audioUrl} style={styles.audioPlayer} />
      )}

      {loading ? (
        <div style={{ textAlign: 'center', marginTop: '40px', color: '#B58A83' }}>Finding people online...</div>
      ) : profiles.length === 0 ? (
        <div style={{ textAlign: 'center', marginTop: '40px', color: '#B58A83', padding: '20px' }}>
          No one is online right now. Check back later!
        </div>
      ) : (
        <div style={styles.listContainer}>
          {profiles.map((profile) => (
            <div key={profile.id} style={styles.card}>
              <div style={styles.avatarWrapper}>
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt={profile.display_name} style={styles.avatar} />
                ) : (
                  <div style={{ ...styles.avatar, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '24px' }}>👤</div>
                )}
                <div style={styles.onlineDot} />
              </div>

              <div style={styles.cardInfo}>
                <div style={styles.tagRow}>
                  <span style={styles.tagSoft}>{tagFor(profile.id)}</span>
                  <span style={styles.tagChatting}>{activeTab}</span>
                </div>
                <div style={styles.nameRow}>
                  <span style={styles.name}>{profile.display_name}</span>
                  <span style={{ color: '#D4B18A', fontSize: '14px' }}>{getGenderIcon(profile.gender)}</span>
                </div>
                <div style={styles.statusText}>Active now</div>
                
                <button style={styles.voiceCardBtn} onClick={() => alert('Playing voice card...')}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  {`${durationFor(profile.id)}"`}
                </button>
              </div>

              <div style={styles.cardActions}>
                <ReportButton
                  targetUserId={profile.id}
                  targetType="voice"
                  title="Report this voice profile"
                  ariaLabel={`Report ${profile.display_name}`}
                />
                <button
                  style={{ ...styles.callBtn, ...(paused ? styles.callBtnDisabled : {}) }}
                  onClick={() => {
                    if (paused) return;
                    alert(`Calling ${profile.display_name}...`);
                  }}
                  aria-label={`Call ${profile.display_name}`}
                  aria-disabled={paused}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}