'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { choiceButtonStyle, mutedTextStyle, panelStyle, statusTextStyle } from './game-theme';
import { useGameRound, type GameOutcome, type GamePlayerProps } from './surface';
import { formatClock } from './deterministic';
import {
  SPEED_MATCH_MAX_SCORE,
  SPEED_MATCH_POINTS_PER_MATCH,
  SPEED_MATCH_SECONDS,
  speedMatchPairsFor,
} from './game-banks';

/**
 * `speed-matching` — timed this-or-that rounds.
 *
 * Ten paired prompts, one pick each, against a 45 second clock. A pick that
 * agrees with the partner's is a match, worth `SPEED_MATCH_POINTS_PER_MATCH` up
 * to the catalogue ceiling of 80. The round ends when the pairs run out or the
 * clock does, whichever comes first.
 */

function scoreFor(matches: number): number {
  return Math.min(SPEED_MATCH_MAX_SCORE, matches * SPEED_MATCH_POINTS_PER_MATCH);
}

function outcomeFor(matches: number, total: number): GameOutcome {
  if (matches * 2 >= total) return 'win';
  if (matches * 2 >= total / 2) return 'draw';
  return 'loss';
}

export default function SpeedMatching({ onFinish }: GamePlayerProps) {
  const round = useGameRound();
  const pairs = useMemo(() => speedMatchPairsFor(round), [round]);

  const [index, setIndex] = useState(0);
  const [matches, setMatches] = useState(0);
  const [lastResult, setLastResult] = useState<boolean | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(SPEED_MATCH_SECONDS);
  const finishedRef = useRef(false);

  const complete = index >= pairs.length;
  const pair = complete ? null : pairs[index];

  const pick = (option: number) => {
    if (!pair) return;
    const matched = option === pair.partnerIndex;
    setLastResult(matched);
    if (matched) setMatches((prev) => prev + 1);
    setIndex((prev) => prev + 1);
  };

  // Countdown. Stops the moment the pairs run out; cleared on unmount.
  useEffect(() => {
    if (complete) return;
    const handle = window.setInterval(
      () => setRemainingSeconds((prev) => Math.max(0, prev - 1)),
      1000
    );
    return () => window.clearInterval(handle);
  }, [complete]);

  // Out of pairs: score what was collected.
  useEffect(() => {
    if (!complete || finishedRef.current) return;
    finishedRef.current = true;
    onFinish(outcomeFor(matches, pairs.length), scoreFor(matches));
  }, [complete, matches, pairs.length, onFinish]);

  // Out of time: same treatment, with whatever was collected.
  useEffect(() => {
    if (remainingSeconds > 0 || complete || finishedRef.current) return;
    finishedRef.current = true;
    onFinish(outcomeFor(matches, pairs.length), scoreFor(matches));
  }, [remainingSeconds, complete, matches, pairs.length, onFinish]);

  return (
    <div style={panelStyle} data-testid="speed-matching" data-index={index} data-matches={matches}>
      <p style={statusTextStyle}>
        Round {Math.min(index + 1, pairs.length)}/{pairs.length} · Matches {matches} ·{' '}
        <span data-testid="speed-clock" role="timer">
          {formatClock(remainingSeconds)}
        </span>
      </p>

      {pair ? (
        <>
          <p
            style={{ margin: 0, fontSize: '17px', fontWeight: 800, lineHeight: 1.4 }}
            data-testid="speed-prompt"
          >
            {pair.prompt}
          </p>
          <div style={{ display: 'grid', gap: '10px' }}>
            {pair.options.map((option, optionIndex) => (
              <button
                key={option}
                type="button"
                onClick={() => pick(optionIndex)}
                style={choiceButtonStyle(false)}
                data-testid={`speed-option-${optionIndex}`}
              >
                {option}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p style={mutedTextStyle}>Every pair answered — counting up your matches.</p>
      )}

      {lastResult !== null && (
        <p style={statusTextStyle} role="status" data-testid="speed-last">
          {lastResult ? 'Match! 💚' : 'Different answers this time.'}
        </p>
      )}

      <p style={mutedTextStyle}>
        Answer as your match would. Each agreement is worth {SPEED_MATCH_POINTS_PER_MATCH} points, and the
        clock is the only thing that can stop you.
      </p>
    </div>
  );
}
