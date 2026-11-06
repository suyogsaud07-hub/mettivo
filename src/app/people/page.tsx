'use client';

import { useCallback, useState } from 'react';
import { Info } from 'lucide-react';
import MobileNav from '@/app/components/layout/MobileNav';
import { useDiscovery } from './hooks/useDiscovery';
import DiscoveryCard from './components/DiscoveryCard';
import DiscoveryActionButtons from './components/DiscoveryActionButtons';
import DiscoveryEmptyState from './components/DiscoveryEmptyState';
import DiscoveryCardSkeleton from './components/DiscoveryCardSkeleton';
import DiscoveryTabs from './components/DiscoveryTabs';
import { DiscoveryComingSoon } from './components/DiscoveryTabs';
import Toast from '@/app/components/ui/Toast';

type TabId = 'for-you' | 'double-date' | 'astrology';

export default function PeoplePage() {
  const [activeTab, setActiveTab] = useState<TabId>('for-you');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [toast, setToast] = useState<{ type: 'like' | 'pass'; message: string } | null>(null);
  const [infoToast, setInfoToast] = useState<string | null>(null);

  const {
    current,
    loading,
    refreshing,
    error,
    empty,
    decisionPending,
    canRewind,
    isRewinding,
    rewindError,
    handleLike,
    handlePass,
    handleRewind,
    handleSuperLike,
    handleMessage,
    refresh,
  } = useDiscovery({
    batchSize: 10,
    radiusKm: 10,
  });

  const clearToast = useCallback(() => {
    setTimeout(() => setToast(null), 1200);
  }, []);

  const clearInfoToast = useCallback(() => {
    setTimeout(() => setInfoToast(null), 2000);
  }, []);

  const showInfo = useCallback((message: string) => {
    setInfoToast(message);
    clearInfoToast();
  }, [clearInfoToast]);

  const handleLikeAction = useCallback(
    (targetId: string) => {
      setToast({ type: 'like', message: 'Like sent' });
      void handleLike(targetId);
      clearToast();
    },
    [handleLike, clearToast]
  );

  const handlePassAction = useCallback(
    (targetId: string) => {
      setToast({ type: 'pass', message: 'Passed' });
      void handlePass(targetId);
      clearToast();
    },
    [handlePass, clearToast]
  );

  const handleRewindAction = useCallback(async () => {
    const ok = await handleRewind();
    if (!ok && rewindError) {
      setInfoToast(rewindError);
    }
  }, [handleRewind, rewindError]);

  const handleSuperLikeAction = useCallback(() => {
    void handleSuperLike();
    showInfo('Super Like is coming soon.');
  }, [handleSuperLike, showInfo]);

  const handleMessageAction = useCallback(
    async (targetId: string) => {
      await handleMessage(targetId);
    },
    [handleMessage]
  );

  const isComingSoon = activeTab !== 'for-you';

  if (loading) {
    return (
      <div className="h-screen dvh:h-[100dvh] bg-[#17121A] text-[#F2E9E4] flex items-center justify-center">
        <DiscoveryCardSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen dvh:h-[100dvh] bg-[#17121A] text-[#F2E9E4] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-[#211A28] border border-[#34283F]/40 flex items-center justify-center mb-4 text-[#D9B38C]">
          <Info size={24} strokeWidth={2} />
        </div>
        <h2 className="text-xl font-bold text-[#F2E9E4] mb-2">
          We could not load People
        </h2>
        <p className="text-[#B58A83] text-sm max-w-xs mb-6 leading-relaxed">{error}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="px-8 py-3 rounded-full bg-[#D9B38C] text-[#17121A] font-semibold text-sm shadow-lg hover:bg-[#cfab83] active:scale-95 transition-all"
        >
          Try again
        </button>
        <MobileNav />
      </div>
    );
  }

  if (empty || !current) {
    return (
      <div className="h-screen dvh:h-[100dvh] bg-[#17121A] text-[#F2E9E4] flex flex-col items-center justify-center p-6">
        <DiscoveryEmptyState onRefresh={() => void refresh()} refreshing={refreshing} />
        <MobileNav />
      </div>
    );
  }

  return (
    <div className="h-screen dvh:h-[100dvh] bg-[#17121A] text-[#F2E9E4] relative overflow-hidden">
      {/* Header + navigation tabs */}
      <header className="absolute top-0 left-0 right-0 z-30 p-6 flex flex-col items-center gap-4 pointer-events-none">
        <div className="bg-[#211A28]/80 backdrop-blur-md rounded-xl px-4 py-2 pointer-events-auto">
          <h1 className="text-lg font-bold text-[#F2E9E4]">People</h1>
        </div>
        <DiscoveryTabs activeTab={activeTab} onTabChange={(tab) => setActiveTab(tab)} />
      </header>

      <main className="relative flex flex-col h-full w-full items-center justify-center pt-24 pb-20 px-4">
        {isComingSoon ? (
          <DiscoveryComingSoon tab={activeTab} />
        ) : (
          <>
            <DiscoveryCard
              profile={current}
              isModalOpen={isModalOpen}
              onModalToggle={() => setIsModalOpen((prev) => !prev)}
              onLike={handleLikeAction}
              onPass={handlePassAction}
              disabled={decisionPending === current.id || loading}
            />

            <DiscoveryActionButtons
              current={{
                id: current.id,
                displayName: current.displayName,
              }}
              decisionPending={decisionPending}
              canRewind={canRewind}
              isRewinding={isRewinding}
              onRewind={handleRewindAction}
              onPass={handlePassAction}
              onSuperLike={handleSuperLikeAction}
              onLike={handleLikeAction}
              onMessage={handleMessageAction}
            />

            {rewindError && (
              <p className="mt-2 text-xs text-[#EF4444] text-center">{rewindError}</p>
            )}
          </>
        )}
      </main>

      {toast && (
        <Toast type={toast.type} message={toast.message} onDismiss={() => setToast(null)} />
      )}

      {infoToast && (
        <Toast type="like" message={infoToast} onDismiss={() => setInfoToast(null)} />
      )}

      <MobileNav />
    </div>
  );
}
