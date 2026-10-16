'use client';

import { useState } from 'react';
import { Modal } from '@/app/components/ui/Modal';
import { Button } from '@/app/components/ui/Button';
import {
  REPORT_CATEGORIES,
  ReportError,
  fileReport,
  type ReportCategory,
  type ReportTargetType,
} from '@/lib/reports';

/**
 * The one report dialog the whole app shares.
 *
 * WHY ONE COMPONENT
 *   Reporting used to be a page (`/report`) with a second, drifted copy inside
 *   chat. Both called the `reports` table directly. The M21 safety pipeline only
 *   runs inside the `file_report` function, so every report affordance — a chat
 *   message, a Moment, a comment, a profile, a live call — opens this dialog and
 *   nothing else. One dialog means one vocabulary, one error surface and one
 *   place to keep honest.
 *
 * WHY THE FORM IS A CHILD
 *   `Modal` renders nothing while closed, so `ReportForm` only exists while the
 *   dialog is open. That gives a fresh selection on every open WITHOUT a
 *   `setState` inside an effect, which React (rightly) flags as a cascading
 *   render.
 */

export interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The account being reported. */
  targetUserId: string;
  /** What the report points at. Defaults to the whole member. */
  targetType?: ReportTargetType;
  /** The message/moment/comment id, when the report is about one item. */
  targetId?: string | null;
  /** A live snapshot data URL, when reporting a live call. */
  evidenceImage?: string | null;
  /** A context headline, e.g. "Report this message". */
  title?: string;
  /** Called after a successful submission, before the dialog closes. */
  onSubmitted?: (result: { reportId: string; status: 'pending' | 'actioned' }) => void;
}

export function ReportModal({
  isOpen,
  onClose,
  targetUserId,
  targetType = 'user',
  targetId = null,
  evidenceImage = null,
  title = 'Report member',
  onSubmitted,
}: ReportModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} width="md">
      {isOpen && (
        <ReportForm
          targetUserId={targetUserId}
          targetType={targetType}
          targetId={targetId}
          evidenceImage={evidenceImage}
          onClose={onClose}
          onSubmitted={onSubmitted}
        />
      )}
    </Modal>
  );
}

interface ReportFormProps {
  targetUserId: string;
  targetType: ReportTargetType;
  targetId: string | null;
  evidenceImage: string | null;
  onClose: () => void;
  onSubmitted?: (result: { reportId: string; status: 'pending' | 'actioned' }) => void;
}

function ReportForm({
  targetUserId,
  targetType,
  targetId,
  evidenceImage,
  onClose,
  onSubmitted,
}: ReportFormProps) {
  const [category, setCategory] = useState<ReportCategory | ''>('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!category || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await fileReport({
        targetUserId,
        category,
        targetType,
        targetId,
        details,
        evidenceImage,
      });
      setDone(true);
      onSubmitted?.({ reportId: result.reportId, status: result.status });
    } catch (err) {
      const message =
        err instanceof ReportError ? err.message : 'We could not submit your report. Please try again.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Thank you. Subbu Bot reviews every report, and serious cases are actioned
          automatically with a platform-wide pause. You will not be told who reported whom.
        </p>
        <div className="flex justify-end">
          <Button variant="primary" type="button" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <div className="space-y-4">
        <fieldset disabled={submitting} className="space-y-2">
          <legend className="block text-sm font-medium mb-1">Reason for reporting</legend>
          {REPORT_CATEGORIES.map((item) => {
            const selected = category === item.value;
            return (
              <label
                key={item.value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                  selected
                    ? 'border-rose-500 bg-rose-50 dark:bg-rose-900/20'
                    : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600'
                }`}
              >
                <input
                  type="radio"
                  name="report-category"
                  value={item.value}
                  checked={selected}
                  onChange={() => setCategory(item.value)}
                  className="mt-1 accent-rose-500"
                />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {item.label}
                  </span>
                  <span className="block text-xs text-neutral-500 dark:text-neutral-500">
                    {item.hint}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="report-details">
            Anything else? (optional)
          </label>
          <textarea
            id="report-details"
            rows={3}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
            placeholder="Tell us more about what happened..."
            disabled={submitting}
          />
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="danger" type="submit" disabled={!category} loading={submitting}>
            Submit report
          </Button>
        </div>
      </div>
    </form>
  );
}
