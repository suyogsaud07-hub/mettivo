'use client';

import { useCallback, useState } from 'react';
import { Info } from 'lucide-react';
import MobileNav from '@/app/components/layout/MobileNav';
import { useDiscovery } from './hooks/useDiscovery';
import DiscoveryCard from './components/DiscoveryCard';
import DiscoveryActionButtons from './components/DiscoveryActionButtons';
import DiscoveryEmptyState from './components/DiscoveryEmptyState';
import DiscoveryCardSkeleton from './components/DiscoveryCardSkeleton';
import Toast from '@/app/components/ui/Toast';

export default function PeoplePage() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<{ type: 'like' | 'pass'; message: string } | null>(null);

  const {
    current,
    loading,
    refreshing,
    error,
    empty,
    decisionPending,
    isFollowing,
    handleLike,
    handlePass,
    handleFollow,
    refresh,
  } = useDiscovery({
    batchSize: 10,
    radiusKm: 10,
  });

  const clearToast = useCallback(() => {
    setTimeout(() => setToast(null), 1200);
  }, []);

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

  const handleFollowAction = useCallback(
    (targetId: string) => {
      void handleFollow(targetId);
    },
    [handleFollow]
  );

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
      {/* Header */}
      <header className="absolute top-0 left-0 right-0 z-30 p-6 flex justify-between items-center pointer-events-none">
        <div className="bg-[#211A28]/80 backdrop-blur-md rounded-xl px-4 py-2 pointer-events-auto">
          <h1 className="text-lg font-bold text-[#F2E9E4]">People</h1>
        </div>
        <div className="bg-[#211A28]/80 backdrop-blur-md rounded-xl px-4 py-2 pointer-events-auto">
          <span className="text-sm text-[#B58A83]">
            {current.displayName}{current.age ? `, ${current.age}` : ''}
          </span>
        </div>
      </header>

      {/* Discovery card area — full screen, photos 65-75% */}
      <main className="relative flex flex-col h-full w-full items-center justify-center pt-20 pb-24 px-4">
        <DiscoveryCard
          profile={{
            id: current.id,
            displayName: current.displayName,
            age: current.age,
            city: current.city,
            country: current.country,
            bio: current.bio,
            intention: current.intention,
            casualIntent: current.casualIntent,
            interests: current.interests,
            photos: current.photos,
            avatarUrl: current.avatarUrl,
            distanceText: current.distanceText,
            distanceMeters: current.distanceMeters,
            isOnline: current.online,
            isVerified: current.isVerified,
          }}
          isSheetOpen={sheetOpen}
          onSheetToggle={() => setSheetOpen((prev) => !prev)}
          onLike={handleLikeAction}
          onPass={handlePassAction}
          disabled={decisionPending === current.id || loading}
        />
      </main>

      {/* Action buttons — Tinder style overlay */}
      <div className="absolute bottom-[120px] left-0 right-0 z-40 flex justify-center items-end pb-12">
        <DiscoveryActionButtons
          current={{
            id: current.id,
            displayName: current.displayName,
          }}
          isLiked={false}
          isPassed={false}
          isFollowing={isFollowing(current.id)}
          decisionPending={decisionPending}
          onLike={handleLikeAction}
          onPass={handlePassAction}
          onFollow={handleFollowAction}
        />
      </div>

      {toast && (
        <Toast type={toast.type} message={toast.message} onDismiss={() => setToast(null)} />
      )}

      <MobileNav />
    </div>
  );
}
