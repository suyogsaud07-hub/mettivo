'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import MobileNav from '../components/layout/MobileNav';
import { supabase } from '@/lib/supabase';
import { FEATURED_GAME, GAMES, fetchGameResults, summariseResults } from '@/lib/games';
import type { GameStats } from '@/lib/types';

/**
 * `/game-zone` — the Game Hub.
 *
 * The grid is driven entirely by the `GAMES` catalogue in `src/lib/games.ts`.
 * It used to be a second hardcoded list living here, plus a `PLAYABLE_IDS`
 * array, which meant a game could exist in the catalogue (and be accepted by
 * `record_game_result()` in the database) while being invisible — or shown as
 * "SOON" long after it became playable. One catalogue, one source of truth.
 */

/** Section headings for the hub, keyed by catalogue category. */
const CATEGORY_LABELS: Record<string, string> = {
  icebreaker: '💬 Icebreakers',
  competitive: '🏆 Competitive',
  quick: '⚡ Quick Play',
};

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

  const playableGames = GAMES.filter((game) => game.playable);
  const allGames = GAMES;

  /** Catalogue categories, in catalogue order, so the hub cannot drift from it. */
  const categories: string[] = [];
  for (const game of allGames) {
    if (!categories.includes(game.category)) categories.push(game.category);
  }

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

  /** Quick Play only ever picks a game that is actually launchable. */
  const handleQuickPlay = () => {
    if (playableGames.length === 0) return;
    const pick = playableGames[Math.floor(Math.random() * playableGames.length)];
    openGame(pick.id);
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
    quickPlayBtn: { margin: '0 20px 24px 20px', padding: '18px', borderRadius: '20px', background: 'linear-gradient(135deg, #7C3AED, #A855F7)', color: '#FFFFFF', fontSize: '16px', fontWeight: '800', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', boxShadow: '0 10px 30px rgba(168, 85, 247, 0.4)', textDecoration: 'none' },

    // Featured Game
    sectionTitle: { fontSize: '14px', fontWeight: '800', color: '#B58A83', textTransform: 'uppercase' as const, letterSpacing: '1px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' },
    featuredCard: { margin: '0 20px 24px 20px', backgroundColor: '#1C1822', borderRadius: '24px', padding: '16px', border: '1px solid #4A1828', position: 'relative' as const, overflow: 'hidden' },
    featuredBadge: { position: 'absolute' as const, top: '16px', right: '16px', backgroundColor: '#D4B18A', color: '#17121C', fontSize: '10px', fontWeight: '800', padding: '4px 10px', borderRadius: '12px' },
    featuredImage: { width: '100%', height: '120px', borderRadius: '16px', objectFit: 'cover' as const, marginBottom: '16px' },
    featuredTitle: { fontSize: '22px', fontWeight: '800', color: '#F2E9E4', marginBottom: '8px' },
    featuredDesc: { fontSize: '13px', color: '#B58A83', lineHeight: '1.5', marginBottom: '16px' },
    featuredBottom: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    playerCount: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#10B981', fontWeight: '600' },
    playNowBtn: { backgroundColor: '#A855F7', color: '#FFFFFF', padding: '10px 20px', borderRadius: '20px', fontSize: '14px', fontWeight: '700', border: 'none', cursor: 'pointer', textDecoration: 'none', display: 'inline-block' },

    // All Games Grid
    grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', margin: '0 20px 24px 20px' },
    gameCard: { position: 'relative' as const, height: '180px', borderRadius: '20px', overflow: 'hidden', cursor: 'pointer', border: 'none', padding: 0, background: 'none', width: '100%', textAlign: 'left' as const, color: 'inherit' },
    gameCardImage: { width: '100%', height: '100%', objectFit: 'cover' as const },
    gameCardGradient: { position: 'absolute' as const, inset: 0, background: 'linear-gradient(to top, rgba(13,10,16,0.95) 0%, rgba(13,10,16,0.4) 60%, transparent 100%)' },
    gameCardContent: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, padding: '16px' },
    gameTitle: { fontSize: '16px', fontWeight: '800', color: '#FFFFFF', marginBottom: '4px' },
    gameStats: { display: 'flex', gap: '10px', fontSize: '11px', color: '#B58A83', fontWeight: '600' },
    gamePlayIcon: { position: 'absolute' as const, bottom: '16px', right: '16px', width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#FFFFFF', border: '1px solid rgba(255,255,255,0.3)' },
    soonBadge: { position: 'absolute' as const, top: '12px', left: '12px', backgroundColor: 'rgba(13,10,16,0.85)', color: '#B58A83', fontSize: '10px', fontWeight: 800, padding: '4px 8px', borderRadius: '10px', letterSpacing: '0.5px' },
    liveBadge: { position: 'absolute' as const, top: '12px', left: '12px', backgroundColor: 'rgba(16,185,129,0.9)', color: '#04120B', fontSize: '10px', fontWeight: 800, padding: '4px 8px', borderRadius: '10px', letterSpacing: '0.5px' },

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
          <button style={styles.backBtn} onClick={() => router.back()} aria-label="Back">
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

      {/* Quick Play — a random game from the catalogue that is actually playable. */}
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
          <Link href={`/game-zone/${FEATURED_GAME.id}`} style={styles.playNowBtn}>▶ Play Now</Link>
        </div>
      </div>

      {/* All Games, grouped by catalogue category */}
      {categories.map((category) => {
        const games = allGames.filter((game) => game.category === category);
        if (games.length === 0) return null;

        return (
          <div key={category}>
            <div style={styles.sectionTitle}>{CATEGORY_LABELS[category] ?? category}</div>
            <div style={styles.grid}>
              {games.map((game) => (
                <button
                  key={game.id}
                  type="button"
                  style={styles.gameCard}
                  onClick={() => openGame(game.id)}
                  aria-label={`Play ${game.title}`}
                >
                  <img src={game.image} alt={game.title} style={styles.gameCardImage} />
                  <div style={styles.gameCardGradient} />
                  {game.playable ? (
                    <div style={styles.liveBadge}>PLAY</div>
                  ) : (
                    <div style={styles.soonBadge}>SOON</div>
                  )}
                  <div style={styles.gameCardContent}>
                    <div style={styles.gameTitle}>{game.title}</div>
                    <div style={styles.gameStats}>
                      <span>👥 {game.players}</span>
                      <span>⏱ {game.duration}</span>
                    </div>
                  </div>
                  <div style={styles.gamePlayIcon}>▶</div>
                </button>
              ))}
            </div>
          </div>
        );
      })}

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
