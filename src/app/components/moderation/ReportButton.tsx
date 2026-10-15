'use client';

import { useState } from 'react';
import { ReportModal } from './ReportModal';
import type { ReportTargetType } from '@/lib/reports';

/**
 * A report affordance you can drop onto any surface.
 *
 * It renders a flag button, owns the open/closed state of the shared dialog and
 * stops click propagation, because most of the places it is used — a message
 * row, a Moment card, a live overlay — sit inside something else that is itself
 * clickable. Reporting must never also do the thing underneath.
 *
 * NOTE: the icon is a bare path with no `<circle>`, so it cannot be mistaken for
 * the Discover overflow control by that page's tests.
 */

export interface ReportButtonProps {
  /** The account being reported. */
  targetUserId: string;
  targetType?: ReportTargetType;
  targetId?: string | null;
  evidenceImage?: string | null;
  /**
   * Capture evidence at the moment of the tap (a live snapshot). Resolves to a
   * data URL, or null when nothing could be captured — a report must still be
   * filable without it.
   */
  captureEvidence?: () => Promise<string | null>;
  /** A context headline for the dialog, e.g. "Report this message". */
  title?: string;
  /** Visible text. When omitted the button is an icon only. */
  label?: string;
  /** Accessible name for the icon-only form. */
  ariaLabel?: string;
  /** Extra classes for the trigger. */
  className?: string;
  /** Called after a successful submission. */
  onSubmitted?: (result: { reportId: string; status: 'pending' | 'actioned' }) => void;
}

export function ReportButton({
  targetUserId,
  targetType = 'user',
  targetId = null,
  evidenceImage = null,
  captureEvidence,
  title,
  label,
  ariaLabel = 'Report',
  className = '',
  onSubmitted,
}: ReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState<string | null>(evidenceImage);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    // Stop first: the tap must not also trigger whatever this sits on top of.
    event.stopPropagation();
    if (captureEvidence) {
      void captureEvidence()
        .then((captured) => setEvidence(captured ?? null))
        .catch(() => setEvidence(null))
        .finally(() => setOpen(true));
      return;
    }
    setEvidence(evidenceImage);
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={handleClick}
        className={`inline-flex items-center gap-1.5 rounded-full text-neutral-500 hover:text-rose-500 transition-colors ${className}`}
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 21V4m0 0h11l-1.5 4H20l-2 5h-9"
          />
        </svg>
        {label && <span className="text-sm">{label}</span>}
      </button>

      <ReportModal
        isOpen={open}
        onClose={() => setOpen(false)}
        targetUserId={targetUserId}
        targetType={targetType}
        targetId={targetId}
        evidenceImage={evidence}
        title={title}
        onSubmitted={onSubmitted}
      />
    </>
  );
}
