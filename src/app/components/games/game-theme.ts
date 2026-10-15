import type { CSSProperties } from 'react';

/**
 * The Game Zone palette and the few shared inline styles the mini-games reuse.
 *
 * The hex values are the ones already in `src/app/game-zone/page.tsx` and
 * `src/app/game-zone/[gameId]/page.tsx`; no new colours are invented here.
 * Kept in its own module so a game component never has to import `engine.tsx`
 * (which imports the games) and create an import cycle.
 */

export const PALETTE = {
  bg: '#0D0A10',
  surface: '#1C1822',
  raised: '#29202D',
  border: '#29202D',
  accentBorder: '#4A1828',
  text: '#F2E9E4',
  muted: '#B58A83',
  gold: '#D4B18A',
  purple: '#A855F7',
  violet: '#7C3AED',
  green: '#10B981',
  greenText: '#86EFAC',
  greenBg: '#14321F',
  greenBorder: '#1F6F43',
  red: '#FCA5B5',
  redBg: '#3B1220',
  redBorder: '#7F1D2E',
} as const;

export const panelStyle: CSSProperties = {
  backgroundColor: PALETTE.surface,
  border: `1px solid ${PALETTE.accentBorder}`,
  borderRadius: '20px',
  padding: '20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

export const primaryButtonStyle: CSSProperties = {
  padding: '14px 28px',
  borderRadius: '30px',
  border: 'none',
  background: `linear-gradient(135deg, ${PALETTE.violet}, ${PALETTE.purple})`,
  color: '#FFFFFF',
  fontSize: '15px',
  fontWeight: 800,
  cursor: 'pointer',
};

export const ghostButtonStyle: CSSProperties = {
  padding: '12px 22px',
  borderRadius: '30px',
  border: `1px solid ${PALETTE.raised}`,
  backgroundColor: 'transparent',
  color: PALETTE.text,
  fontSize: '14px',
  fontWeight: 700,
  cursor: 'pointer',
};

/** A selectable answer. `selected` is the member's current choice. */
export function choiceButtonStyle(selected: boolean, tone: 'neutral' | 'good' | 'bad' = 'neutral'): CSSProperties {
  const border =
    selected && tone === 'good'
      ? PALETTE.greenBorder
      : selected && tone === 'bad'
        ? PALETTE.redBorder
        : selected
          ? PALETTE.gold
          : PALETTE.raised;

  const background =
    selected && tone === 'good' ? PALETTE.greenBg : selected && tone === 'bad' ? PALETTE.redBg : PALETTE.raised;

  return {
    width: '100%',
    textAlign: 'left',
    padding: '14px 16px',
    borderRadius: '14px',
    border: `1px solid ${border}`,
    backgroundColor: background,
    color: PALETTE.text,
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'border-color 0.15s ease, background-color 0.15s ease',
  };
}

export const mutedTextStyle: CSSProperties = {
  fontSize: '13px',
  color: PALETTE.muted,
  margin: 0,
  lineHeight: 1.5,
};

export const statusTextStyle: CSSProperties = {
  fontSize: '13px',
  fontWeight: 700,
  color: PALETTE.gold,
  margin: 0,
  minHeight: '20px',
};
