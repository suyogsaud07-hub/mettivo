'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PALETTE, mutedTextStyle, panelStyle, statusTextStyle } from './game-theme';
import { useGameRound, type GamePlayerProps } from './surface';
import {
  WORD_GUESS_MAX_SCORE,
  WORD_GUESS_MAX_WRONG,
  WORD_GUESS_PENALTY,
  wordGuessRoundFor,
} from './game-banks';

/**
 * `word-guess` — hangman against a fixed, dependency-free word list.
 *
 * The word for a round is a seeded pick from the bank (identical on the server
 * and in the browser), six wrong guesses end the round, and each wrong guess
 * costs ten of the sixty available points.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default function WordGuess({ onFinish }: GamePlayerProps) {
  const round = useGameRound();
  const entry = useMemo(() => wordGuessRoundFor(round), [round]);

  const [guessed, setGuessed] = useState<string[]>([]);
  const finishedRef = useRef(false);

  const letters = useMemo(() => entry.word.split(''), [entry.word]);
  const wrong = guessed.filter((letter) => !letters.includes(letter)).length;
  const solved = letters.every((letter) => guessed.includes(letter));
  const failed = wrong >= WORD_GUESS_MAX_WRONG;
  const over = solved || failed;

  const score = Math.max(0, WORD_GUESS_MAX_SCORE - wrong * WORD_GUESS_PENALTY);

  useEffect(() => {
    if (!over || finishedRef.current) return;
    finishedRef.current = true;
    onFinish(solved ? 'win' : 'loss', score);
  }, [over, solved, score, onFinish]);

  return (
    <div style={panelStyle} data-testid="word-guess" data-wrong={wrong}>
      <p style={statusTextStyle}>
        Wrong guesses {wrong}/{WORD_GUESS_MAX_WRONG} · {score} points still in play
      </p>

      <p style={mutedTextStyle}>Hint: {entry.hint}</p>

      <p
        data-testid="word-guess-mask"
        style={{
          margin: 0,
          fontSize: '28px',
          fontWeight: 800,
          letterSpacing: '6px',
          color: over && failed ? PALETTE.red : PALETTE.text,
          textAlign: 'center',
        }}
      >
        {letters.map((letter) => (guessed.includes(letter) ? letter : '•')).join(' ')}
      </p>

      {(solved || failed) && (
        <p style={statusTextStyle} role="status" data-testid="word-guess-result">
          {solved ? 'Solved it! 🎉' : `Out of guesses — the word was ${entry.word}.`}
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px' }}>
        {ALPHABET.map((letter) => {
          const used = guessed.includes(letter);
          const hit = used && letters.includes(letter);
          return (
            <button
              key={letter}
              type="button"
              disabled={used || over}
              onClick={() => setGuessed((prev) => [...prev, letter])}
              data-testid={`word-guess-letter-${letter}`}
              style={{
                padding: '10px 0',
                borderRadius: '10px',
                border: `1px solid ${hit ? PALETTE.greenBorder : used ? PALETTE.redBorder : PALETTE.raised}`,
                backgroundColor: hit ? PALETTE.greenBg : used ? PALETTE.redBg : PALETTE.raised,
                color: PALETTE.text,
                fontSize: '13px',
                fontWeight: 800,
                cursor: used || over ? 'default' : 'pointer',
              }}
            >
              {letter}
            </button>
          );
        })}
      </div>
    </div>
  );
}
