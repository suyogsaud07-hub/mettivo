'use client';

import { useMemo, useRef, useState } from 'react';
import { mutedTextStyle, panelStyle, primaryButtonStyle, ghostButtonStyle, statusTextStyle, PALETTE } from './game-theme';
import { useGameRound, type GameOutcome, type GamePlayerProps } from './surface';
import { TRUTH_OR_DARE_MAX_SCORE, TRUTH_OR_DARE_TURNS, truthOrDareDeckFor } from './game-banks';

/**
 * `truth-or-dare` — a pass-and-play prompt deck.
 *
 * The deck is a seeded shuffle of the bank, consumed in order and capped at
 * `TRUTH_OR_DARE_TURNS`, so no prompt can repeat within a game. Reading the
 * whole deck is a win worth the catalogue ceiling of 15; stopping early banks a
 * partial score instead of losing everything.
 */
export default function TruthOrDare({ onFinish }: GamePlayerProps) {
  const round = useGameRound();
  const deck = useMemo(() => truthOrDareDeckFor(round).slice(0, TRUTH_OR_DARE_TURNS), [round]);

  /** How many cards have been read out loud. */
  const [shown, setShown] = useState(0);
  const finishedRef = useRef(false);

  const currentCard = shown > 0 ? deck[shown - 1] : null;
  const complete = shown === deck.length;

  const finish = (outcome: GameOutcome) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish(outcome, Math.round((TRUTH_OR_DARE_MAX_SCORE * shown) / deck.length));
  };

  const next = () => {
    if (complete) {
      finish('win');
      return;
    }
    setShown((prev) => prev + 1);
  };

  const label = complete ? 'Finish the round' : shown === 0 ? 'Reveal the first prompt' : 'Next prompt →';

  return (
    <div style={panelStyle} data-testid="truth-or-dare" data-shown={shown}>
      <p style={statusTextStyle}>
        Prompt {shown}/{deck.length} · Deck has no repeats
      </p>

      {currentCard ? (
        <div
          style={{
            backgroundColor: currentCard.kind === 'truth' ? PALETTE.raised : PALETTE.greenBg,
            border: `1px solid ${currentCard.kind === 'truth' ? PALETTE.accentBorder : PALETTE.greenBorder}`,
            borderRadius: '18px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
          data-testid="truth-or-dare-card"
        >
          <span
            style={{
              fontSize: '11px',
              fontWeight: 800,
              letterSpacing: '1px',
              color: currentCard.kind === 'truth' ? PALETTE.gold : PALETTE.greenText,
            }}
          >
            {currentCard.kind === 'truth' ? 'TRUTH' : 'DARE'}
          </span>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 700, lineHeight: 1.5, color: PALETTE.text }}>
            {currentCard.text}
          </p>
        </div>
      ) : (
        <p style={mutedTextStyle}>
          Take turns. Read the prompt out loud, answer it honestly, then pass the phone on. Every card in
          this deck is unique.
        </p>
      )}

      <button type="button" onClick={next} style={primaryButtonStyle} data-testid="truth-or-dare-next">
        {label}
      </button>

      {shown > 0 && !complete && (
        <button
          type="button"
          onClick={() => finish('draw')}
          style={ghostButtonStyle}
          data-testid="truth-or-dare-stop"
        >
          Stop here and bank {Math.round((TRUTH_OR_DARE_MAX_SCORE * shown) / deck.length)} points
        </button>
      )}
    </div>
  );
}
