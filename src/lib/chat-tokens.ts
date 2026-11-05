/**
 * Mettivo chat design tokens — Midnight Romance palette.
 *
 * Centralised so every chat component shares the same colours, radii and
 * spacing, keeping the UI consistent with the rest of the app.
 */

export const CHAT_TOKENS = {
  // Backgrounds
  page: '#131017',
  surface: '#1C1822',
  surfaceElevated: '#29202D',
  border: '#34283F',
  borderHover: '#4A3E55',

  // Text
  text: '#F2E9E4',
  textMuted: '#B58A83',
  textSoft: '#8A7693',
  inverse: '#17121C',

  // Accents
  accent: '#D4B18A',
  accentHover: '#E4C9A0',
  accentSoft: '#D4B18A/15',
  rose: '#C24A6E',
  roseSoft: '#C24A6E/15',

  // Status
  online: '#10B981',
  offline: '#6B5B79',
  sent: '#6B5B79',
  delivered: '#B58A83',
  read: '#D4B18A',

  // Radii
  bubble: 'rounded-2xl',
  bubbleSent: 'rounded-tr-sm',
  bubbleReceived: 'rounded-tl-sm',
  avatar: 'rounded-full',
  button: 'rounded-full',
  panel: 'rounded-2xl',

  // Layout
  bubbleMaxWidth: 'max-w-[75%]',
  bubbleWidth: 'w-fit',
  composerHeight: 'h-12',
} as const;

export type ChatTone = 'sent' | 'delivered' | 'read';

export function toneColor(tone: ChatTone | null): string {
  switch (tone) {
    case 'read':
      return CHAT_TOKENS.read;
    case 'delivered':
      return CHAT_TOKENS.delivered;
    case 'sent':
      return CHAT_TOKENS.sent;
    default:
      return CHAT_TOKENS.textMuted;
  }
}

export function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diffMins = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor((now.getTime() - date.getTime()) / 3_600_000);
  if (diffHours < 24) return `${diffHours}h`;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (
    date.getTime() >= startOfYesterday.getTime() &&
    date.getTime() < startOfToday.getTime()
  ) {
    return 'Yesterday';
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function formatCallDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function isSameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}
