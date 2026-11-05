'use client';

import { useCallback } from 'react';
import { RefreshCw } from 'lucide-react';

interface DiscoveryEmptyStateProps {
  onRefresh: () => void;
  refreshing: boolean;
}

export default function DiscoveryEmptyState({
  onRefresh,
  refreshing,
}: DiscoveryEmptyStateProps) {
  const handleRefresh = useCallback(() => {
    onRefresh();
  }, [onRefresh]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 text-center">
      <div className="w-24 h-24 rounded-full bg-[#211A28] border border-[#34283F]/40 flex items-center justify-center mb-6 text-4xl">
        <RefreshCw size={32} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </div>
      <h2 className="text-xl font-bold text-[#F2E9E4] mb-2">
        You&rsquo;ve seen everyone nearby.
      </h2>
      <p className="text-[#B58A83] text-sm max-w-xs mb-8 leading-relaxed">
        There are no more profiles in your discovery stack right now. Adjust
        your discovery filters or refresh to see new members.
      </p>
      <button
        type="button"
        onClick={handleRefresh}
        disabled={refreshing}
        className="px-8 py-3.5 rounded-full bg-[#D9B38C] text-[#17121A] font-semibold text-sm shadow-lg hover:bg-[#cfab83] active:scale-95 transition-all disabled:opacity-60 disabled:pointer-events-none"
      >
        {refreshing ? 'Refreshing…' : 'Refresh discovery'}
      </button>
    </div>
  );
}
