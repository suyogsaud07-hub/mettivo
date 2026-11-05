'use client';

import { getCasualIntentConfig, type CasualIntent } from '@/lib/casual-intent';

interface CasualIntentBadgeProps {
  intent: CasualIntent;
  size?: 'sm' | 'md';
}

export default function CasualIntentBadge({
  intent,
  size = 'sm',
}: CasualIntentBadgeProps) {
  if (!intent) return null;

  const config = getCasualIntentConfig(intent);
  if (!config) return null;

  const isSmall = size === 'sm';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
        isSmall ? 'text-xs' : 'text-sm'
      } font-medium border-[#34283F]/60 bg-[#17121A]/80 backdrop-blur-sm text-[#D9B38C]`}
      aria-label={config.label}
      title={config.label}
    >
      <span className="text-xs">{config.icon}</span>
      <span className="leading-none">{config.label}</span>
    </span>
  );
}
