'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { setDisappearingMessages } from '@/lib/messages';
import { blockMember, BlockingError } from '@/lib/blocking';
import { ReportModal } from '@/app/components/moderation/ReportModal';

const PANEL = '#131017';
const TEXT = '#F2E9E4';
const ACCENT = '#D4B18A';
const ROSE = '#C24A6E';

interface StorySlide {
  id: string;
  type: 'avatar' | 'media';
  url: string;
  mediaType?: 'image' | 'video';
  caption?: string | null;
}

interface ProfileStoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
  userUsername: string | null;
  avatarUrl: string | null;
  /** Conversation match id, used to toggle disappearing messages. */
  matchId?: string;
}

export default function ProfileStoryModal({
  isOpen,
  onClose,
  userId,
  userName,
  userUsername,
  avatarUrl,
  matchId,
}: ProfileStoryModalProps) {
  const router = useRouter();
  const [slides, setSlides] = useState<StorySlide[]>([]);
  const [current, setCurrent] = useState(0);
  const [progressWidth, setProgressWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [disappearing, setDisappearing] = useState<number | null>(null);
  const [toggling, setToggling] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const frameRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);

  const handleGoProfile = useCallback(() => {
    if (userUsername) {
      onClose();
      router.push(`/profile/${userUsername}`);
    } else if (userId) {
      onClose();
      router.push(`/profile/${userId}`);
    }
  }, [userUsername, userId, onClose, router]);

  const fetchMoments = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('moment_feed')
        .select('id, caption, media, media_type, duration_seconds, created_at')
        .eq('author_id', userId)
        .eq('moderation_status', 'approved')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;

      const built: StorySlide[] = [];
      if (avatarUrl) {
        built.push({ id: 'avatar', type: 'avatar', url: avatarUrl });
      }
      const rows = Array.isArray(data) ? data : [];
      for (const row of rows) {
        const media = Array.isArray(row.media) ? row.media : [];
        const first = media[0];
        if (first) {
          built.push({
            id: `${row.id}-0`,
            type: 'media',
            url: first,
            mediaType: row.media_type ?? 'image',
            caption: row.caption ?? null,
          });
        }
      }
      setSlides(built);
      setCurrent(0);
    } catch (err) {
      console.error('[story] load moments failed:', err);
      if (avatarUrl) setSlides([{ id: 'avatar', type: 'avatar', url: avatarUrl }]);
    } finally {
      setLoading(false);
    }
  }, [userId, avatarUrl]);

  useEffect(() => {
    if (!isOpen) return;
    // The loader updates state only after an await, so this is a one-shot mount
    // fetch rather than a synchronous cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchMoments();
    if (matchId) {
      void supabase
        .from('chat_settings')
        .select('disappear_after_seconds')
        .eq('match_id', matchId)
        .maybeSingle()
        .then(({ data }) => {
          const row = data as { disappear_after_seconds: unknown } | null;
          const v = row?.disappear_after_seconds;
          setDisappearing(typeof v === 'number' ? v : null);
        });
    }
  }, [isOpen, fetchMoments, matchId]);

  const restartProgress = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    setProgressWidth(0);
    // Animate fill over 5s per slide.
    let start: number | null = null;
    const step = (now: number) => {
      if (!start) start = now;
      const elapsed = now - start;
      const pct = Math.min(100, (elapsed / 5000) * 100);
      setProgressWidth(pct);
      if (pct < 100) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        // Auto-advance to next slide.
        setCurrent((c) => (c + 1 < slides.length ? c + 1 : c));
      }
    };
    frameRef.current = requestAnimationFrame(step);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    restartProgress();
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [current, slides.length, restartProgress]);

  const nextSlide = () => {
    setCurrent((c) => (c + 1 < slides.length ? c + 1 : c));
  };
  const prevSlide = () => {
    setCurrent((c) => (c - 1 >= 0 ? c - 1 : 0));
  };

  const handleBlock = async () => {
    if (!userId) return;
    setBlocking(true);
    try {
      await blockMember(userId);
      setBlocking(false);
      onClose();
    } catch (err) {
      setBlocking(false);
      if (err instanceof BlockingError) {
        // surface via report/alert could be added; keep silent to avoid spam
        console.error('[story] block failed:', err.message);
      }
    }
  };

  const toggleDisappearing = async () => {
    if (!matchId) return;
    setToggling(true);
    try {
      const next = await setDisappearingMessages(
        matchId,
        disappearing ? null : 86_400
      );
      setDisappearing(next);
    } catch (err) {
      console.error('[story] disappearing toggle failed:', err);
    } finally {
      setToggling(false);
    }
  };

  if (!isOpen) return null;

  const slide = slides[current];
  const isLast = current === slides.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 bg-[#131017]/95 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: close + progress bar */}
        <div className="absolute top-0 left-0 right-0 z-10 px-4 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-[#1C1822]/80 backdrop-blur flex items-center justify-center text-[#F2E9E4] hover:bg-[#1C1822]"
            aria-label="Close story"
          >
            ✕
          </button>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" aria-hidden="true" />
            <span className="text-xs text-[#B58A83]">Online</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-[#1C1822]/80 backdrop-blur flex items-center justify-center text-[#F2E9E4] hover:bg-[#1C1822]"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1 bg-[#34283F]/40 rounded-full overflow-hidden">
          <div
            id="story-progress-fill"
            className="h-full bg-[#D4B18A] rounded-full transition-all duration-100 linear"
            style={{ width: `${progressWidth}%` }}
          />
        </div>
        <div className="flex justify-center gap-1 mt-2">
          {slides.map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === current ? 'bg-[#D4B18A]' : 'bg-[#B58A83]/40'
              }`}
            />
          ))}
        </div>

        {/* Story viewer */}
        <div
          className="relative w-full max-w-md aspect-video rounded-2xl overflow-hidden bg-black flex items-center justify-center"
          onClick={(e) => {
            // Taps on right half advance, left half go back.
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            if (e.clientX > rect.left + rect.width / 2) nextSlide();
            else prevSlide();
          }}
        >
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-[#D4B18A]/30 border-t-[#D4B18A] rounded-full animate-spin" />
            </div>
          ) : slide ? (
            <>
              <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]">
                {slide.type === 'avatar' ? (
                  <img
                    src={slide.url}
                    alt={userName}
                    className="w-40 h-40 rounded-full border-4 border-[#D4B18A] object-cover shadow-2xl"
                    onClick={handleGoProfile}
                  />
                ) : (
                  <>
                    {slide.mediaType === 'video' ? (
                      <video
                        src={slide.url}
                        autoPlay
                        muted
                        playsInline
                        loop
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <img
                        src={slide.url}
                        alt="Story"
                        className="w-full h-full object-cover"
                      />
                    )}
                    {slide.caption && (
                      <div className="absolute bottom-4 left-4 right-4 text-[#F2E9E4] text-sm drop-shadow-md">
                        {slide.caption}
                      </div>
                    )}
                  </>
                )}
              </div>
              {/* Navigation hints */}
              <div className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 flex items-center justify-center text-[#F2E9E4] opacity-30 hover:opacity-100 transition" aria-label="Previous">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </div>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 flex items-center justify-center text-[#F2E9E4] opacity-30 hover:opacity-100 transition" aria-label="Next">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </div>
              {!isLast && (
                <div className="absolute bottom-4 right-4 w-10 h-10 rounded-full bg-black/60 flex items-center justify-center text-white text-xs">
                  {slides.length - current - 1}
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Bottom: identity + actions */}
        <div
          className="absolute bottom-0 left-0 right-0 z-10 px-6 pb-6"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 mb-3 cursor-pointer" onClick={handleGoProfile}>
            {avatarUrl ? (
              <img src={avatarUrl} alt={userName} className="w-10 h-10 rounded-full border border-[#D4B18A] object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-[#1C1822] border border-[#34283F] flex items-center justify-center text-lg">👤</div>
            )}
            <div className="flex flex-col min-w-0">
              <p className="text-sm font-bold text-[#F2E9E4] truncate" onClick={handleGoProfile} role="button" tabIndex={0}>
                {userName}
              </p>
              {userUsername && (
                <p className="text-xs text-[#D4B18A]/90 truncate">@{userUsername}</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 px-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-3 py-2.5 rounded-xl bg-[#1C1822] border border-[#34283F] text-[#F2E9E4] text-sm font-medium hover:bg-[#29202D] disabled:opacity-50"
              disabled={toggling}
            >
              Mute
            </button>
            <button
              type="button"
              onClick={handleBlock}
              className="flex-1 px-3 py-2.5 rounded-xl bg-[#1C1822] border border-[#34283F] text-[#F2E9E4] text-sm font-medium hover:bg-[#29202D] disabled:opacity-50"
              disabled={blocking}
            >
              {blocking ? 'Blocking…' : 'Block'}
            </button>
            <button
              type="button"
              onClick={() => {
                setReportOpen(true);
              }}
              className="flex-1 px-3 py-2.5 rounded-xl bg-[#1C1822] border border-[#34283F] text-[#F2E9E4] text-sm font-medium hover:bg-[#29202D]"
            >
              Report
            </button>
            <button
              type="button"
              onClick={toggleDisappearing}
              className="flex-1 px-3 py-2.5 rounded-xl border border-[#D4B18A]/50 text-[#D4B18A] text-sm font-medium hover:bg-[#D4B18A]/10 disabled:opacity-50"
              disabled={toggling || !matchId}
            >
              {toggling ? 'Updating…' : disappearing ? '24h: On' : '24h: Off'}
            </button>
          </div>
        </div>

        <ReportModal
          isOpen={reportOpen}
          onClose={() => setReportOpen(false)}
          targetUserId={userId}
          targetType="user"
          title="Report member"
          onSubmitted={() => {
            setReportOpen(false);
            onClose();
          }}
        />
      </div>
    </div>
  );
}
