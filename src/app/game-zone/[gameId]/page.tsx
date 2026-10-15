'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { GameShell, type GameOutcome } from '@/app/components/games/engine';
import { GameError, getGame, recordGameResult } from '@/lib/games';

/**
 * `/game-zone/[gameId]` — hosts a single playable game.
 *
 * `GameShell` is the embedded runner: it owns the shared chrome (title, timer,
 * restart, outcome banner) and the three render modes — React component players,
 * an HTML5 canvas game and a sandboxed iframe viewer — selected from the
 * `GAME_PLAYERS` registry. This page only decides whether the game is playable
 * and persists the result.
 *
 * Games that need realtime multiplayer render an explicit "in progress" panel
 * naming what is missing, rather than a dead-end alert. Their catalogue entry
 * has `is_playable = false`, and `record_game_result()` rejects them too, so the
 * UI and the database agree.
 */
export default function GameRoutePage() {
  const router = useRouter();
  const params = useParams<{ gameId: string }>();
  const gameId = typeof params?.gameId === 'string' ? params.gameId : '';
  const game = getGame(gameId);

  const [error, setError] = useState<string | null>(null);

  const handleFinish = useCallback(
    async (outcome: GameOutcome, score: number) => {
      setError(null);

      try {
        await recordGameResult(gameId, outcome, score, null);
      } catch (err) {
        console.error('Failed to save game result:', err);
        setError(
          err instanceof GameError
            ? err.message
            : 'Your result could not be saved, but your game counted.'
        );
      }
    },
    [gameId]
  );

  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: '#0D0A10',
      color: '#F2E9E4',
      fontFamily: 'system-ui',
      padding: '20px',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '20px',
    },
    header: { display: 'flex', alignItems: 'center', gap: '14px' },
    backBtn: { background: 'none', border: 'none', color: '#F2E9E4', cursor: 'pointer', padding: 0 },
    title: { fontSize: '20px', fontWeight: 800, margin: 0 },
    subtitle: { fontSize: '12px', color: '#B58A83', marginTop: '2px' },
    error: {
      backgroundColor: '#3B1220',
      border: '1px solid #7F1D2E',
      color: '#FCA5B5',
      borderRadius: '14px',
      padding: '12px 16px',
      fontSize: '13px',
    },
    pending: {
      backgroundColor: '#1C1822',
      border: '1px solid #4A1828',
      borderRadius: '20px',
      padding: '24px',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '14px',
    },
    body: { fontSize: '13px', color: '#B58A83', lineHeight: 1.6, margin: 0 },
    cta: {
      alignSelf: 'flex-start',
      backgroundColor: '#D4B18A',
      color: '#17121C',
      padding: '12px 26px',
      borderRadius: '30px',
      fontSize: '14px',
      fontWeight: 700,
      textDecoration: 'none',
    },
  };

  if (!game) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <button style={styles.backBtn} onClick={() => router.back()} aria-label="Back">
            ←
          </button>
          <h1 style={styles.title}>Game not found</h1>
        </div>
        <div style={styles.pending}>
          <p style={styles.body}>
            There is no game called <strong>{gameId || '(empty)'}</strong>.
          </p>
          <Link href="/game-zone" style={styles.cta}>
            Back to Game Zone
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => router.back()} aria-label="Back">
          ←
        </button>
        <div>
          <h1 style={styles.title}>
            {game.icon} {game.title}
          </h1>
          <div style={styles.subtitle}>
            {game.playable ? 'Playing solo vs AI' : 'Not available yet'}
          </div>
        </div>
      </div>

      {/* A save failure is surfaced here; the outcome itself is announced by
          GameShell's own status banner, so there is exactly one of each. */}
      {error && (
        <div style={styles.error} role="alert">
          {error}
        </div>
      )}

      {game.playable ? (
        <GameShell gameId={game.id} onFinish={(outcome, score) => void handleFinish(outcome, score)} />
      ) : (
        <div style={styles.pending}>
          <p style={{ ...styles.body, color: '#F2E9E4', fontWeight: 700, fontSize: '15px' }}>
            {game.title} is not playable yet
          </p>
          <p style={styles.body}>{game.pendingReason}</p>
          <p style={styles.body}>
            In the meantime, the icebreakers, Memory Match, Word Guessing and Tic Tac Toe are fully
            playable, and your results are saved to your profile.
          </p>
          <Link href="/game-zone" style={styles.cta}>
            Play a game that works
          </Link>
        </div>
      )}
    </div>
  );
}
