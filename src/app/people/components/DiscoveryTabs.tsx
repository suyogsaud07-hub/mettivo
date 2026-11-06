'use client';

import { useCallback } from 'react';
import { Star, Users, Sparkles } from 'lucide-react';

type DiscoveryTab = 'for-you' | 'double-date' | 'astrology';

interface TabItem {
  key: DiscoveryTab;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabItem[] = [
  {
    key: 'for-you',
    label: 'For You',
    icon: <Sparkles size={18} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    key: 'double-date',
    label: 'Double Date',
    icon: <Users size={18} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    key: 'astrology',
    label: 'Astrology',
    icon: <Star size={18} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />,
  },
];

interface DiscoveryTabsProps {
  activeTab: DiscoveryTab;
  onTabChange: (tab: DiscoveryTab) => void;
}

export default function DiscoveryTabs({
  activeTab,
  onTabChange,
}: DiscoveryTabsProps) {
  const handleTab = useCallback(
    (tab: DiscoveryTab) => {
      onTabChange(tab);
    },
    [onTabChange]
  );

  return (
    <div className="flex items-center gap-1 rounded-xl bg-[#211A28]/60 backdrop-blur-md border border-[#34283F]/40 px-1.5 py-1.5">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => handleTab(tab.key)}
            aria-pressed={isActive}
            aria-label={tab.label}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors flex items-center gap-2 ${
              isActive
                ? 'bg-[#D9B38C] text-[#17121A] shadow-sm'
                : 'text-[#B58A83] hover:text-[#F2E9E4] hover:bg-[#211A28]/40'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

interface DiscoveryComingSoonProps {
  tab: Extract<DiscoveryTab, 'double-date' | 'astrology'>;
}

export function DiscoveryComingSoon({ tab }: DiscoveryComingSoonProps) {
  const titles: Record<DiscoveryComingSoonProps['tab'], string> = {
    'double-date': 'Double Date',
    astrology: 'Astrology',
  };
  const messages: Record<DiscoveryComingSoonProps['tab'], string> = {
    'double-date':
      'Invite a friend and discover together. Double Date is coming soon.',
    astrology: 'Cosmic compatibility, unlocked by the stars. Astrology is coming soon.',
  };

  return (
    <div className="h-full w-full flex flex-col items-center justify-center p-10 text-center">
      <div className="w-16 h-16 rounded-full bg-[#211A28] border border-[#34283F]/40 flex items-center justify-center mb-6 text-3xl text-[#D9B38C]">
        <Star size={32} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </div>
      <h2 className="text-xl md:text-2xl font-bold text-[#F2E9E4] mb-2">
        {titles[tab]} is coming soon
      </h2>
      <p className="text-[#B58A83] text-sm max-w-xs leading-relaxed">
        {messages[tab]}
      </p>
    </div>
  );
}
