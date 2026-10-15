'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileNav from '../components/layout/MobileNav';
import { supabase } from '@/lib/supabase';
import { FEATURED_GAME, fetchGameResults, summariseResults } from '@/lib/games';
import type { GameStats } from '@/lib/types';

/**
 * Grid content in the owner's original order. Each entry now carries the
 * `game_id` its card routes to, so the tiles are real links instead of alerts.
 */
const GRID_GAMES = [
  { id: 'ludo-royale', title: 'Ludo Royale', players: 6, duration: '15m', image: 'https://images.unsplash.com/photo-1605870445919-838d190e8e1b?q=80&w=400&auto=format&fit=crop', icon: '🎲' },
  { id: 'ludo-dash', title: 'Ludo Dash', players: 8, duration: '8m', image: 'https://images.unsplash.com/photo-1611996575749-79a3a250f948?q=80&w=400&auto=format&fit=crop', icon: '🎲' },
  { id: 'uno-lite', title: 'UNO', players: 12, duration: '6m', image: 'https://images.unsplash.com/photo-1596451190630-186e58a1e1c6?q=80&w=400&auto=format&fit=crop', icon: '🃏' },
  { id: 'tic-tac-toe', title: 'Tic Tac Toe', players: 6, duration: '5m', image: 'https://images.unsplash.com/photo-1585504198199-20277593b94f?q=80&w=400&auto=format&fit=crop', icon: '❌' },
];

/** Games that can actually be launched, for Quick Play. */
const PLAYABLE_IDS = ['uno-lite', 'tic-tac-toe'];

export default function GameZonePage() {
  const router = useRouter();
  const [userName, setUserName] = useState('there');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<GameStats | null>(null);
  const [playedToday, setPlayedToday] = useState(0);

  const featuredGame = {
    title: FEATURED_GAME.title,
    description: FEATURED_GAME.description,
    players: FEATURED_GAME.players,
    image: FEATURED_GAME.image,
    icon: FEATURED_GAME.icon,
  };

  const allGames = GRID_GAMES;

  const howItWorks = [
    { step: '01', title: 'Pick a game', desc: 'Tap Quick Play for a random match, or choose a game from the grid above.', icon: '🎮' },
    { step: '02', title: 'Get matched', desc: 'We pair you with another player from your country who is online and ready. Usually under 30 seconds.', icon: '👥' },
    { step: '03', title: 'Chat & react while you play', desc: 'Tap the speech bubble to chat, drop emoji reactions, and send little gifts mid-game.', icon: '💬' },
    { step: '04', title: 'Send a match request', desc: 'After the game ends you get 60 seconds to tap the heart. If they tap too, it\'s a match.', icon: '❤️' },
    { step: '05', title: 'Keep the vibe going', desc: 'Once matched, jump straight into a chat and turn the game into a real connection.', icon: '✨' },
  ];

  const loadGameData = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace('/auth');
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, avatar_url')
        .eq('id', user.id)
        .maybeSingle();

      if (profile) {
        setUserName(profile.display_name ?? 'there');
        setAvatarUrl(profile.avatar_url ?? null);
      }

      const results = await fetchGameResults();
      setStats(summariseResults(results));

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      setPlayedToday(
        results.filter((row) => new Date(row.created_at).getTime() >= startOfDay.getTime()).length
      );
    } catch (err) {
      // Stats are decorative: a failure here must not block playing.
      console.error('Failed to load game stats:', err);
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadGameData();
  }, [loadGameData]);

  const openGame = (gameId: string) => {
    router.push(`/game-zone/${gameId}`);
  };

  const handleQuickPlay = () => {
    const pick = PLAYABLE_IDS[Math.floor(Math.random() * PLAYABLE_IDS.length)];
    openGame(pick);
  };

  const formatWinRate = (): string => {
    if (!stats || stats.winRate === null) return '-';
    return `${stats.winRate}%`;
  };

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', fontFamily: 'system-ui', paddingBottom: '100px', display: 'flex', flexDirection: 'column' as const },
    
    // Header
    header: { padding: '24px 20px 20px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    headerLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
    backBtn: { background: 'none', border: 'none', color: '#F2E9E4', cursor: 'pointer' },
    headerTitle: { fontSize: '24px', fontWeight: '800', color: '#F2E9E4', letterSpacing: '-0.5px' },
    headerSubtitle: { fontSize: '13px', color: '#B58A83', marginTop: '2px' },
    headerRight: { display: 'flex', gap: '8px' },
    iconBtn: { width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#1C1822', border: '1px solid #29202D', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#F2E9E4', cursor: 'pointer' },

    // User Banner
    banner: { margin: '0 20px 20px 20px', backgroundColor: '#1C1822', borderRadius: '24px', padding: '20px', border: '1px solid #29202D' },
    bannerTop: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' },
    avatar: { width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover' as const, border: '2px solid #D4B18A' },
    avatarFallback: { width: '56px', height: '56px', borderRadius: '50%', border: '2px solid #D4B18A', backgroundColor: '#29202D', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' },
    greeting: { fontSize: '18px', fontWeight: '700', color: '#F2E9E4' },
    subGreeting: { fontSize: '13px', color: '#B58A83' },
    statsRow: { display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #29202D', paddingTop: '16px' },
    statItem: { textAlign: 'center' as const, flex: 1 },
    statValue: { fontSize: '20px', fontWeight: '800', color: '#F2E9E4' },
    statLabel: { fontSize: '11px', color: '#B58A83', textTransform: 'uppercase' as const, marginTop: '4px', fontWeight: '600' },

    // Quick Play
    quickPlayBtn: { margin: '0 20px 24px 20px', padding: '18px', borderRadius: '20px', background: 'linear-gradient(135deg, #7C3AED, #A855F7)', color: '#FFFFFF', fontSize: '16px', fontWeight: '800', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', boxShadow: '0 10px 30px rgba(168, 85, 247, 0.4)' },

    // Featured Game
    sectionTitle: { fontSize: '14px', fontWeight: '800', color: '#B58A83', textTransform: 'uppercase' as const, letterSpacing: '1px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' },
    featuredCard: { margin: '0 20px 24px 20px', backgroundColor: '#1C1822', borderRadius: '24px', padding: '16px', border: '1px solid #4A1828', position: 'relative' as const, overflow: 'hidden' },
    featuredBadge: { position: 'absolute' as const, top: '16px', right: '16px', backgroundColor: '#D4B18A', color: '#17121C', fontSize: '10px', fontWeight: '800', padding: '4px 10px', borderRadius: '12px' },
    featuredImage: { width: '100%', height: '120px', borderRadius: '16px', objectFit: 'cover' as const, marginBottom: '16px' },
    featuredTitle: { fontSize: '22px', fontWeight: '800', color: '#F2E9E4', marginBottom: '8px' },
    featuredDesc: { fontSize: '13px', color: '#B58A83', lineHeight: '1.5', marginBottom: '16px' },
    featuredBottom: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    playerCount: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#10B981', fontWeight: '600' },
    playNowBtn: { backgroundColor: '#A855F7', color: '#FFFFFF', padding: '10px 20px', borderRadius: '20px', fontSize: '14px', fontWeight: '700', border: 'none', cursor: 'pointer' },

    // All Games Grid
    grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', margin: '0 20px 24px 20px' },
    gameCard: { position: 'relative' as const, height: '180px', borderRadius: '20px', overflow: 'hidden', cursor: 'pointer' },
    gameCardImage: { width: '100%', height: '100%', objectFit: 'cover' as const },
    gameCardGradient: { position: 'absolute' as const, inset: 0, background: 'linear-gradient(to top, rgba(13,10,16,0.95) 0%, rgba(13,10,16,0.4) 60%, transparent 100%)' },
    gameCardContent: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, padding: '16px' },
    gameTitle: { fontSize: '16px', fontWeight: '800', color: '#FFFFFF', marginBottom: '4px' },
    gameStats: { display: 'flex', gap: '10px', fontSize: '11px', color: '#B58A83', fontWeight: '600' },
    gamePlayIcon: { position: 'absolute' as const, bottom: '16px', right: '16px', width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#FFFFFF', border: '1px solid rgba(255,255,255,0.3)' },
    soonBadge: { position: 'absolute' as const, top: '12px', left: '12px', backgroundColor: 'rgba(13,10,16,0.85)', color: '#B58A83', fontSize: '10px', fontWeight: 800, padding: '4px 8px', borderRadius: '10px', letterSpacing: '0.5px' },

    // How it works
    howItWorksCard: { margin: '0 20px 24px 20px', backgroundColor: '#1C1822', borderRadius: '24px', padding: '24px', border: '1px solid #29202D' },
    stepItem: { display: 'flex', gap: '16px', marginBottom: '20px', position: 'relative' as const },
    stepIcon: { width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#29202D', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '18px', flexShrink: 0 },
    stepContent: { flex: 1 },
    stepTitle: { fontSize: '15px', fontWeight: '700', color: '#F2E9E4', marginBottom: '4px' },
    stepDesc: { fontSize: '13px', color: '#B58A83', lineHeight: '1.5' },
    stepNumber: { fontSize: '11px', fontWeight: '800', color: '#D4B18A', marginBottom: '2px' },
    
    // Footer note
    footerNote: { margin: '0 20px 24px 20px', backgroundColor: '#1C1822', borderRadius: '16px', padding: '16px', border: '1px solid #29202D', fontSize: '12px', color: '#B58A83', lineHeight: '1.5', display: 'flex', gap: '10px' }
  };

  return (
    <div style={styles.container}>
      
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <button style={styles.backBtn} onClick={() => router.back()}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <div>
            <div style={styles.headerTitle}>Game Zone</div>
            <div style={styles.headerSubtitle}>Play & vibe with someone new</div>
          </div>
        </div>
        <div style={styles.headerRight}>
          <div style={styles.iconBtn}>🕒</div>
          <div style={styles.iconBtn}>📊</div>
          <div style={styles.iconBtn}>🏆</div>
        </div>
      </div>

      {/* User Banner */}
      <div style={styles.banner}>
        <div style={styles.bannerTop}>
          {avatarUrl ? (
            <img src={avatarUrl} alt="User" style={styles.avatar} />
          ) : (
            <div style={styles.avatarFallback}>🎮</div>
          )}
          <div>
            <div style={styles.greeting}>Hey, {userName} 👋</div>
            <div style={styles.subGreeting}>Ready to play?</div>
          </div>
        </div>
        <div style={styles.statsRow}>
          <div style={styles.statItem}>
            <div style={styles.statValue}>{stats?.gamesPlayed ?? 0}</div>
            <div style={styles.statLabel}>Games</div>
          </div>
          <div style={styles.statItem}>
            <div style={styles.statValue}>{stats?.wins ?? 0}</div>
            <div style={styles.statLabel}>Wins</div>
          </div>
          <div style={styles.statItem}>
            <div style={styles.statValue}>{formatWinRate()}</div>
            <div style={styles.statLabel}>Win Rate</div>
          </div>
          <div style={styles.statItem}>
            <div style={styles.statValue}>{playedToday}</div>
            <div style={styles.statLabel}>Today</div>
          </div>
        </div>
      </div>

      {/* Quick Play */}
      <button style={styles.quickPlayBtn} onClick={handleQuickPlay}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>
        Quick Play
      </button>

      {/* Featured Game */}
      <div style={styles.sectionTitle}>⭐ Featured Today</div>
      <div style={styles.featuredCard}>
        <div style={styles.featuredBadge}>FEATURED TODAY</div>
        <img src={featuredGame.image} alt={featuredGame.title} style={styles.featuredImage} />
        <div style={styles.featuredTitle}>{featuredGame.title}</div>
        <div style={styles.featuredDesc}>{featuredGame.description}</div>
        <div style={styles.featuredBottom}>
          <div style={styles.playerCount}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10B981' }} />
            {featuredGame.players} playing
          </div>
          <button style={styles.playNowBtn} onClick={() => openGame(FEATURED_GAME.id)}>▶ Play Now</button>
        </div>
      </div>

      {/* All Games Grid */}
      <div style={styles.sectionTitle}>🔥 All Games</div>
      <div style={styles.grid}>
        {allGames.map((game) => {
          const playable = PLAYABLE_IDS.includes(game.id);
          return (
            <div key={game.id} style={styles.gameCard} onClick={() => openGame(game.id)}>
              <img src={game.image} alt={game.title} style={styles.gameCardImage} />
              <div style={styles.gameCardGradient} />
              {!playable && <div style={styles.soonBadge}>SOON</div>}
              <div style={styles.gameCardContent}>
                <div style={styles.gameTitle}>{game.title}</div>
                <div style={styles.gameStats}>
                  <span>👥 {game.players}</span>
                  <span>⏱ {game.duration}</span>
                </div>
              </div>
              <div style={styles.gamePlayIcon}>▶</div>
            </div>
          );
        })}
      </div>

      {/* How it works */}
      <div style={styles.sectionTitle}>GETTING STARTED</div>
      <div style={styles.howItWorksCard}>
        <div style={{ fontSize: '18px', fontWeight: '800', color: '#F2E9E4', marginBottom: '20px' }}>How Game Zone works</div>
        {howItWorks.map((step, index) => (
          <div key={index} style={styles.stepItem}>
            <div style={styles.stepIcon}>{step.icon}</div>
            <div style={styles.stepContent}>
              <div style={styles.stepNumber}>{step.step}</div>
              <div style={styles.stepTitle}>{step.title}</div>
              <div style={styles.stepDesc}>{step.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer Note */}
      <div style={styles.footerNote}>
        <span>⚠️</span>
        <span>Be respectful — every game is a chance to make a real connection. Inappropriate behavior can get you reported.</span>
      </div>

      {/* Bottom Navigation */}
      <MobileNav />

    </div>
  );
}
