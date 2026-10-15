'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ghostButtonStyle, mutedTextStyle, panelStyle, statusTextStyle } from './game-theme';
import { useSandbox, type GamePlayerProps } from './surface';
import { WHEEL_MAX_SCORE, WHEEL_SEGMENTS } from './game-banks';

/**
 * `spin-the-wheel` — the shell's genuinely sandboxed `<iframe>` mode.
 *
 * The wheel itself lives in `spin-wheel-document.ts`, a self-contained document
 * the shell loads with `sandbox="allow-scripts"` and WITHOUT `allow-same-origin`.
 * It therefore runs in an opaque origin with no access to this app's DOM,
 * cookies or session, and its only channel back is `postMessage`. This component
 * is the receiving end: it acknowledges the handshake, records each spin, and
 * scores the round once the wheel has covered every segment.
 */

interface SpinOutcome {
  index: number;
  label: string;
  spin: number;
  remaining: number;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export default function SpinTheWheel({ onFinish }: GamePlayerProps) {
  const sandbox = useSandbox();
  const [ready, setReady] = useState(false);
  const [results, setResults] = useState<SpinOutcome[]>([]);
  const finishedRef = useRef(false);

  const handleMessage = useCallback(
    (data: unknown) => {
      const record = readRecord(data);
      if (!record) return;

      if (record.type === 'mettivo:ready') {
        setReady(true);
        return;
      }

      if (record.type !== 'mettivo:spin-result') return;

      const outcome: SpinOutcome = {
        index: readNumber(record.index, -1),
        label: readString(record.label, 'Something fun'),
        spin: readNumber(record.spin, 0),
        remaining: readNumber(record.remaining, 0),
      };

      setResults((prev) => [...prev, outcome]);

      if (outcome.remaining === 0 && !finishedRef.current) {
        finishedRef.current = true;
        onFinish('win', WHEEL_MAX_SCORE);
      }
    },
    [onFinish]
  );

  useEffect(() => {
    if (!sandbox) return undefined;
    return sandbox.onMessage(handleMessage);
  }, [sandbox, handleMessage]);

  const distinct = new Set(results.map((result) => result.index)).size;
  const total = WHEEL_SEGMENTS.length;
  const latest = results.length > 0 ? results[results.length - 1] : null;
  const complete = distinct === total;

  const stopEarly = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish('draw', Math.round((WHEEL_MAX_SCORE * distinct) / total));
  };

  return (
    <div style={panelStyle} data-testid="spin-wheel" data-spins={results.length} data-distinct={distinct}>
      <p style={statusTextStyle} data-testid="spin-wheel-ready">
        {ready ? 'Wheel ready — spin inside the panel.' : 'Starting the sandboxed wheel…'}
      </p>

      {latest && (
        <p style={{ margin: 0, fontSize: '17px', fontWeight: 800 }} data-testid="spin-wheel-result">
          {latest.label}
        </p>
      )}

      <p style={mutedTextStyle}>
        The wheel runs in a sealed document with no access to this page. Land on all {total} ideas to reach{' '}
        {WHEEL_MAX_SCORE} points; the order is fixed, so nothing repeats until the wheel is exhausted.
      </p>

      {results.length > 0 && (
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '4px' }}>
          {results.map((result) => (
            <li key={`${result.spin}-${result.index}`} style={mutedTextStyle}>
              {result.spin}. {result.label}
            </li>
          ))}
        </ol>
      )}

      {results.length > 0 && !complete && (
        <button type="button" onClick={stopEarly} style={ghostButtonStyle} data-testid="spin-wheel-stop">
          Stop here and bank {Math.round((WHEEL_MAX_SCORE * distinct) / total)} points
        </button>
      )}
    </div>
  );
}
