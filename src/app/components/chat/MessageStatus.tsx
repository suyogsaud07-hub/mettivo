'use client';

/**
 * Real-time message status ticks (M26): sent → delivered → seen.
 *
 * A single tick means the row is stored (always true once it renders), a double
 * tick means the recipient's device has fetched it, and a gold double tick means
 * they have read it with the thread open. The receipt timestamps come straight
 * from `messages.delivered_at`/`seen_at`, so the ticks update over Realtime.
 */

export interface MessageStatusProps {
  deliveredAt: string | null;
  seenAt: string | null;
  className?: string;
}

type Status = 'sent' | 'delivered' | 'seen';

function statusOf(deliveredAt: string | null, seenAt: string | null): Status {
  if (seenAt) return 'seen';
  if (deliveredAt) return 'delivered';
  return 'sent';
}

const LABEL: Record<Status, string> = {
  sent: 'Sent',
  delivered: 'Delivered',
  seen: 'Seen',
};

function Check({ double, tone }: { double: boolean; tone: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={tone}
    >
      <path d="M2 12.5 7 17.5 17 6" />
      {double && <path d="M11 12.5 16 17.5 26 6" />}
    </svg>
  );
}

export default function MessageStatus({ deliveredAt, seenAt, className }: MessageStatusProps) {
  const status = statusOf(deliveredAt, seenAt);
  const double = status !== 'sent';
  const tone = status === 'seen' ? 'text-amber-400' : 'text-neutral-400';

  return (
    <span
      className={`inline-flex items-center ${className ?? ''}`}
      title={LABEL[status]}
      aria-label={LABEL[status]}
      data-status={status}
      data-testid="message-status"
    >
      <Check double={double} tone={tone} />
    </span>
  );
}
