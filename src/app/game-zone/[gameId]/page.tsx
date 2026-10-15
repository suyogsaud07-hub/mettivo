'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import TicTacToe, { type GameOutcome } from '@/app/components/games/TicTacToe';
import UnoLite from '@/app/components/games/UnoLite';
import { GameError, getGame, recordGameResult } from '@/lib/games';

/**
 * `/game-zone/[gameId]` — hosts a single playable game.
 *
 * Games that need realtime multiplayer render an explicit "in progress" panel
 * naming what is missing, rather than a dead-end alert. Their catalogue entry
 * has `is_playable = false`, and the server rejects results for them too, so the
 * UI and the database agree.
 */
export default function GameRoutePage() {
  const router = useRouter();
  const params = useParams<{ gameId: string }>();
  const gameId = typeof params?.gameId === 'string' ? params.gameId : '';
  const game = getGame(gameId);

  const [result, setResult] = useState<{ outcome: GameOutcome; score: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFinish = useCallback(
    async (outcome: GameOutcome, score: number) => {
      setResult({ outcome, score });

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
    banner: {
      backgroundColor: '#14321F',
      border: '1px solid #1F6F43',
      color: '#86EFAC',
      borderRadius: '14px',
      padding: '12px 16px',
      fontSize: '13px',
    },
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
          <div style={styles.subtitle}>{game.playable ? 'Playing solo vs AI' : 'Not available yet'}</div>
        </div>
      </div>

      {result && (
        <div style={styles.banner} role="status">
          {result.outcome === 'win'
            ? `You won! Score +${result.score}.`
            : result.outcome === 'draw'
              ? `Drawn. Score +${result.score}.`
              : 'Better luck next round.'}
        </div>
      )}

      {error && (
        <div style={styles.error} role="alert">
          {error}
        </div>
      )}

      {game.playable ? (
        gameId === 'tic-tac-toe' ? (
          <TicTacToe onFinish={(outcome, score) => void handleFinish(outcome, score)} />
        ) : (
          <UnoLite onFinish={(outcome, score) => void handleFinish(outcome, score)} />
        )
      ) : (
        <div style={styles.pending}>
          <p style={{ ...styles.body, color: '#F2E9E4', fontWeight: 700, fontSize: '15px' }}>
            {game.title} is not playable yet
          </p>
          <p style={styles.body}>{game.pendingReason}</p>
          <p style={styles.body}>
            In the meantime, Tic Tac Toe and UNO are fully playable against an opponent, and your
            results are saved to your profile.
          </p>
          <Link href="/game-zone" style={styles.cta}>
            Play a game that works
          </Link>
        </div>
      )}
    </div>
  );
}
