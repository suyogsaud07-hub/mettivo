'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mic, Phone, Video, MoreVertical } from 'lucide-react';

interface ChatHeaderProps {
  otherUserId: string | null;
  otherUserName: string | null;
  otherUserUsername: string | null;
  otherUserAvatar: string | null;
  isOnline: boolean | null;
  onVoiceCall: () => void;
  onVideoCall: () => void;
  onBack: () => void;
  onMore: () => void;
}

export default function ChatHeader({
  otherUserId,
  otherUserName,
  otherUserUsername,
  otherUserAvatar,
  isOnline,
  onVoiceCall,
  onVideoCall,
  onBack,
  onMore,
}: ChatHeaderProps) {
  const router = useRouter();

  const handleGoProfile = () => {
    if (!otherUserId) return;
    router.push(`/profile/${otherUserId}`);
  };

  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[#34283F] shrink-0 bg-[#131017]/80 backdrop-blur-md z-10">
      <button
        type="button"
        onClick={onBack}
        className="px-3 py-1.5 rounded-md bg-[#1C1822] border border-[#34283F] text-[#F2E9E4] hover:bg-[#29202D] shrink-0"
        aria-label="Back"
      >
        <span style={{ fontSize: 20, lineHeight: 1 }}>&larr;</span>
      </button>

      <button
        type="button"
        onClick={handleGoProfile}
        className="flex items-center gap-3 min-w-0 cursor-pointer"
        aria-label="Open profile"
      >
        {otherUserAvatar ? (
          <img
            src={otherUserAvatar}
            alt=""
            className="w-10 h-10 rounded-full border border-[#34283F] object-cover"
            style={{ width: 40, height: 40 }}
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-[#1C1822] border border-[#34283F] flex items-center justify-center text-lg">
            👤
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-[#F2E9E4] truncate">
              {otherUserName ?? 'Member'}
            </span>
            {isOnline ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#10B981]/20 text-[#10B981] text-[10px] font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" /> Online
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#6B5B79]/20 text-[#6B5B79] text-[10px] font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-[#6B5B79]" /> Offline
              </span>
            )}
          </div>
          {otherUserUsername && (
            <p className="truncate text-xs text-[#D4B18A]/90">
              @{otherUserUsername}
            </p>
          )}
        </div>
      </button>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onVoiceCall}
          className="p-2 rounded-full bg-[#1C1822] border border-[#34283F] text-[#F2E9E4] hover:bg-[#29202D] shrink-0"
          aria-label="Voice call"
        >
          <Phone size={18} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={onVideoCall}
          className="p-2 rounded-full bg-[#1C1822] border border-[#34283F] text-[#F2E9E4] hover:bg-[#29202D] shrink-0"
          aria-label="Video call"
        >
          <Video size={18} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={onMore}
          className="p-2 rounded-full bg-[#1C1822] border border-[#34283F] text-[#F2E9E4] hover:bg-[#29202D] shrink-0"
          aria-label="More options"
        >
          <MoreVertical size={18} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}
