'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GameOutcome } from './TicTacToe';

type Colour = 'red' | 'yellow' | 'green' | 'blue';
type CardColour = Colour | 'wild';

interface Card {
  id: string;
  colour: CardColour;
  /** '0'-'9' | 'skip' | 'reverse' | 'draw2' | 'wild' */
  value: string;
}

const COLOURS: Colour[] = ['red', 'yellow', 'green', 'blue'];

const COLOUR_HEX: Record<CardColour, string> = {
  red: '#EF4444',
  yellow: '#EAB308',
  green: '#22C55E',
  blue: '#3B82F6',
  wild: '#1C1822',
};

/** Short glyph for the card face. */
function cardLabel(card: Card): string {
  switch (card.value) {
    case 'skip':
      return '⊘';
    case 'reverse':
      return '⇄';
    case 'draw2':
      return '+2';
    case 'wild':
      return 'W';
    default:
      return card.value;
  }
}

function buildDeck(): Card[] {
  const deck: Card[] = [];
  let n = 0;
  const nextId = () => `c${n++}`;

  for (const colour of COLOURS) {
    deck.push({ id: nextId(), colour, value: '0' });
    for (let value = 1; value <= 9; value += 1) {
      deck.push({ id: nextId(), colour, value: String(value) });
      deck.push({ id: nextId(), colour, value: String(value) });
    }
    for (const action of ['skip', 'reverse', 'draw2']) {
      deck.push({ id: nextId(), colour, value: action });
      deck.push({ id: nextId(), colour, value: action });
    }
  }

  // Wilds. (Wild Draw Four is deliberately omitted; see the note in the UI.)
  for (let i = 0; i < 4; i += 1) {
    deck.push({ id: nextId(), colour: 'wild', value: 'wild' });
  }

  return deck;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function isPlayable(card: Card, top: Card, activeColour: Colour): boolean {
  if (card.colour === 'wild') return true;
  return card.colour === activeColour || card.value === top.value;
}

/** Wilds have no chosen colour in this build, so pick the holder's commonest. */
function dominantColour(hand: Card[]): Colour {
  const counts: Record<Colour, number> = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const card of hand) {
    if (card.colour !== 'wild') counts[card.colour] += 1;
  }
  return COLOURS.reduce((best, colour) => (counts[colour] > counts[best] ? colour : best), 'red');
}

interface UnoState {
  deck: Card[];
  player: Card[];
  ai: Card[];
  top: Card;
  activeColour: Colour;
  turn: 'player' | 'ai';
}

function deal(): UnoState {
  const deck = shuffle(buildDeck());
  const player = deck.splice(0, 7);
  const ai = deck.splice(0, 7);

  // Start on a plain number card so the first turn always has options.
  let startIndex = deck.findIndex((card) => card.colour !== 'wild' && /^[0-9]$/.test(card.value));
  if (startIndex < 0) startIndex = 0;
  const [top] = deck.splice(startIndex, 1);

  return {
    deck,
    player,
    ai,
    top,
    activeColour: top.colour === 'wild' ? 'red' : top.colour,
    turn: 'player',
  };
}

export default function UnoLite({
  onFinish,
}: {
  onFinish: (outcome: GameOutcome, score: number) => void;
}) {
  const [state, setState] = useState<UnoState>(() => deal());
  const [message, setMessage] = useState('Your turn — match the colour or the number.');
  const [ended, setEnded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [score, setScore] = useState(0);

  const reset = useCallback(() => {
    setState(deal());
    setMessage('Your turn — match the colour or the number.');
    setEnded(false);
    setBusy(false);
    setScore(0);
  }, []);

  const finish = useCallback(
    (outcome: GameOutcome, finalScore: number) => {
      setEnded(true);
      onFinish(outcome, finalScore);
    },
    [onFinish]
  );

  /** Applies one card and returns the updated piles plus any turn effect. */
  const applyCard = (
    current: UnoState,
    who: 'player' | 'ai',
    card: Card
  ): UnoState => {
    const hand = who === 'player' ? current.player : current.ai;
    const other = who === 'player' ? current.ai : current.player;

    const newHand = hand.filter((item) => item.id !== card.id);
    const newOther = [...other];
    const deck = [...current.deck];

    const activeColour: Colour =
      card.colour === 'wild' ? dominantColour(newHand.length ? newHand : hand) : card.colour;

    let skipOpponent = false;

    if (card.value === 'draw2') {
      const drawn = deck.splice(0, 2);
      newOther.push(...drawn);
      skipOpponent = true;
    } else if (card.value === 'skip' || card.value === 'reverse') {
      // With two players, Reverse behaves like Skip.
      skipOpponent = true;
    }

    const nextTurn: 'player' | 'ai' = skipOpponent ? who : who === 'player' ? 'ai' : 'player';

    return {
      deck,
      player: who === 'player' ? newHand : newOther,
      ai: who === 'ai' ? newHand : newOther,
      top: card,
      activeColour,
      turn: nextTurn,
    };
  };

  const playCard = (card: Card) => {
    if (ended || busy || state.turn !== 'player') return;
    if (!isPlayable(card, state.top, state.activeColour)) return;

    setBusy(true);
    const next = applyCard(state, 'player', card);
    setState(next);
    setScore((prev) => prev + 10);

    if (next.player.length === 0) {
      setMessage('You win! 🎉');
      setBusy(false);
      finish('win', score + 10 + next.ai.length * 5);
      return;
    }

    setMessage('Opponent is playing...');
    setBusy(false);
  };

  const drawForPlayer = () => {
    if (ended || busy || state.turn !== 'player') return;

    setBusy(true);
    setState((current) => {
      const deck = [...current.deck];
      const drawn = deck.splice(0, 1);
      if (drawn.length === 0) return { ...current, turn: 'ai', deck };

      const player = [...current.player, ...drawn];
      const next = { ...current, deck, player };

      // Auto-play if the drawn card happens to be legal; otherwise pass.
      if (isPlayable(drawn[0], current.top, current.activeColour)) {
        return applyCard(next, 'player', drawn[0]);
      }
      return { ...next, turn: 'ai' };
    });
    setMessage('You drew a card.');
    setBusy(false);
  };

  // AI turn.
  useEffect(() => {
    if (ended || state.turn !== 'ai') return;

    const timer = window.setTimeout(() => {
      const playable = state.ai.filter((card) => isPlayable(card, state.top, state.activeColour));

      if (playable.length === 0) {
        const deck = [...state.deck];
        const drawn = deck.splice(0, 1);

        if (drawn.length === 0) {
          setMessage('The deck ran out — this round is a draw.');
          finish('draw', score);
          return;
        }

        const ai = [...state.ai, ...drawn];
        if (isPlayable(drawn[0], state.top, state.activeColour)) {
          const next = applyCard({ ...state, deck, ai }, 'ai', drawn[0]);
          setState(next);
          setMessage(next.ai.length === 0 ? 'Opponent wins this one.' : 'Your turn.');
          if (next.ai.length === 0) finish('loss', score);
          return;
        }

        setState({ ...state, deck, ai, turn: 'player' });
        setMessage('Opponent drew a card. Your turn.');
        return;
      }

      // Prefer action cards to make the opponent feel alive.
      const action = playable.find((card) => card.value !== 'wild' && !/^[0-9]$/.test(card.value));
      const choice = action ?? playable[0];
      const next = applyCard(state, 'ai', choice);
      setState(next);

      if (next.ai.length === 0) {
        setMessage('Opponent wins this one.');
        finish('loss', score);
        return;
      }
      setMessage('Your turn — match the colour or the number.');
    }, 700);

    return () => window.clearTimeout(timer);
    // `busy` is intentionally excluded: it only guards player input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, ended, finish, score]);

  const styles = {
    board: { display: 'flex', flexDirection: 'column' as const, gap: '18px', alignItems: 'center', width: '100%' },
    row: { display: 'flex', gap: '8px', flexWrap: 'wrap' as const, justifyContent: 'center' },
    pile: { display: 'flex', alignItems: 'center', gap: '16px', margin: '4px 0' },
    label: { fontSize: '11px', color: '#B58A83', textTransform: 'uppercase' as const, letterSpacing: '0.5px', fontWeight: 700 },
    message: { fontSize: '14px', fontWeight: 700, color: '#D4B18A', minHeight: '20px', textAlign: 'center' as const },
    drawBtn: { padding: '12px 24px', borderRadius: '24px', border: '1px solid #4A1828', backgroundColor: '#1C1822', color: '#F2E9E4', fontSize: '14px', fontWeight: 700, cursor: 'pointer' },
    resetBtn: { padding: '14px 32px', borderRadius: '30px', border: 'none', background: 'linear-gradient(135deg, #7C3AED, #A855F7)', color: '#FFFFFF', fontSize: '15px', fontWeight: 800, cursor: 'pointer' },
  };

  const faceStyle = (card: Card, disabled: boolean): React.CSSProperties => ({
    width: '54px',
    height: '78px',
    borderRadius: '10px',
    border: '2px solid rgba(255,255,255,0.25)',
    backgroundColor: COLOUR_HEX[card.colour],
    color: card.colour === 'yellow' ? '#1C1822' : '#FFFFFF',
    fontSize: '20px',
    fontWeight: 800,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    padding: 0,
  });

  return (
    <div style={styles.board}>
      <p style={styles.message} role="status">{message}</p>

      <div style={styles.pile}>
        <div>
          <div style={styles.label}>Opponent ({state.ai.length})</div>
          <div style={{ ...faceStyle({ id: 'back', colour: 'wild', value: 'back' }, true), backgroundImage: 'repeating-linear-gradient(45deg, #29202D, #29202D 6px, #1C1822 6px, #1C1822 12px)' }} />
        </div>
        <div>
          <div style={styles.label}>Discard</div>
          <div style={{ ...faceStyle(state.top, false), cursor: 'default' }}>{cardLabel(state.top)}</div>
        </div>
        <div>
          <div style={styles.label}>Colour</div>
          <div
            aria-label={`Active colour ${state.activeColour}`}
            style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: COLOUR_HEX[state.activeColour], border: '2px solid rgba(255,255,255,0.25)' }}
          />
        </div>
      </div>

      <div style={styles.label}>Your hand ({state.player.length})</div>
      <div style={styles.row}>
        {state.player.map((card) => {
          const canPlay = !ended && !busy && state.turn === 'player' && isPlayable(card, state.top, state.activeColour);
          return (
            <button
              key={card.id}
              type="button"
              aria-label={`Play ${card.colour} ${card.value}`}
              disabled={!canPlay}
              onClick={() => playCard(card)}
              style={faceStyle(card, !canPlay)}
            >
              {cardLabel(card)}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          type="button"
          style={styles.drawBtn}
          disabled={ended || busy || state.turn !== 'player'}
          onClick={drawForPlayer}
        >
          Draw a card
        </button>
        <button type="button" style={styles.resetBtn} onClick={reset}>
          {ended ? 'Play again' : 'Restart'}
        </button>
      </div>

      <p style={{ fontSize: '11px', color: '#B58A83', textAlign: 'center', lineHeight: 1.5, margin: 0 }}>
        Simplified rules: Skips, Reverses and Draw Twos are active (with two players a Reverse acts
        as a Skip), and playing a Wild picks your most common colour. Wild Draw Four is not included
        in this build.
      </p>
    </div>
  );
}
