'use client';

import { useId } from 'react';

/**
 * The red rose bouquet.
 *
 * The grip is at the local origin and the blooms sit above it (negative y), so
 * a character can place this group at the centre of a hand and rotate it around
 * the grip without the flowers drifting away from the fingers. The stems, wrap
 * and ribbon all converge on that point.
 *
 * Every gradient is namespaced with `useId` because the same bouquet is held by
 * the man and then by the woman; duplicate ids would make the second instance
 * inherit the first instance's defs (and break if one unmounted).
 */

export default function Bouquet() {
  const raw = useId();
  const uid = `bq${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <g>
      <defs>
        <radialGradient id={`${uid}-rose`} cx="0.35" cy="0.3" r="0.85">
          <stop offset="0" stopColor="#e05a63" />
          <stop offset="0.45" stopColor="#b52f3e" />
          <stop offset="1" stopColor="#6e1a28" />
        </radialGradient>
        <radialGradient id={`${uid}-roseLight`} cx="0.4" cy="0.35" r="0.9">
          <stop offset="0" stopColor="#f0838a" />
          <stop offset="0.6" stopColor="#c84352" />
          <stop offset="1" stopColor="#8d2233" />
        </radialGradient>
        <linearGradient id={`${uid}-wrap`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4e9dc" />
          <stop offset="0.55" stopColor="#ddc8b4" />
          <stop offset="1" stopColor="#b99e88" />
        </linearGradient>
        <linearGradient id={`${uid}-leaf`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3f7d5c" />
          <stop offset="1" stopColor="#1e4b38" />
        </linearGradient>
      </defs>

      {/* Invisible centred padding: it makes the bounding-box centre the grip, so
          a parent can rotate this group around the hand without guessing. */}
      <rect x="-34" y="-64" width="68" height="128" fill="#fff" fillOpacity="0" />

      {/* Stems converge on the grip. */}
      <g fill="none" stroke="#2f6b4f" strokeWidth="2.2" strokeLinecap="round">
        <path d="M 0 2 C -8 -12 -14 -26 -16 -40" />
        <path d="M 0 2 C -2 -14 -4 -30 -3 -48" />
        <path d="M 0 2 C 6 -12 10 -26 12 -42" />
        <path d="M 0 2 C 12 -8 18 -18 22 -30" />
      </g>

      {/* Leaves behind the blooms. */}
      <path
        d="M -6 -18 C -20 -22 -26 -16 -28 -8 C -18 -6 -10 -10 -6 -18 Z"
        fill={`url(#${uid}-leaf)`}
      />
      <path
        d="M 8 -16 C 20 -22 28 -16 30 -8 C 20 -6 12 -9 8 -16 Z"
        fill={`url(#${uid}-leaf)`}
      />

      {/* Paper wrap and wine ribbon around the grip. */}
      <path
        d="M -14 -4 L 14 -4 L 8 18 C 4 22 -4 22 -8 18 Z"
        fill={`url(#${uid}-wrap)`}
      />
      <path
        d="M -14 -4 C -8 2 8 2 14 -4"
        fill="none"
        stroke="#f8f0e6"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.8"
      />
      <path d="M -12 2 L 12 2 L 11 8 L -11 8 Z" fill="#7a2236" />
      <path
        d="M -11 8 C -20 12 -22 22 -18 28 C -10 24 -8 16 -11 8 Z"
        fill="#5d1728"
      />
      <path
        d="M 11 8 C 20 12 22 22 18 28 C 10 24 8 16 11 8 Z"
        fill="#5d1728"
      />

      {/* Five identifiable blooms. */}
      <Rose x={-14} y={-42} r={9} uid={uid} />
      <Rose x={-2} y={-52} r={10} uid={uid} />
      <Rose x={10} y={-44} r={10} uid={uid} />
      <Rose x={18} y={-34} r={8} uid={uid} />
      <Rose x={-2} y={-31} r={7} uid={uid} />
    </g>
  );
}

function Rose({ x, y, r, uid }: { x: number; y: number; r: number; uid: string }) {
  const scale = r / 10;

  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <circle r="10" fill={`url(#${uid}-rose)`} />
      <path
        d="M -8 1 C -9 -6 -2 -10 2 -5 C 7 -10 11 -4 8 2 C 11 7 5 10 1 6 C -3 10 -9 7 -8 1 Z"
        fill={`url(#${uid}-roseLight)`}
        opacity="0.9"
      />
      <path
        d="M -5 0 C -6 -4 0 -6 1 -2 C 4 -6 7 -2 5 1 C 7 4 3 6 1 3 C -2 6 -6 4 -5 0 Z"
        fill="none"
        stroke="#f3a0a6"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.75"
      />
    </g>
  );
}
