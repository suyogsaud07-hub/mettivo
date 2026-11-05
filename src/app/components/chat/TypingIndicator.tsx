'use client';

import { useLanguage } from '@/context/LanguageContext';

interface TypingIndicatorProps {
  userNames: string[];
}

export default function TypingIndicator({ userNames }: TypingIndicatorProps) {
  const text =
    userNames.length === 1
      ? `${userNames[0]} is typing…`
      : `${userNames.length} are typing…`;

  return (
    <div className="flex items-start gap-2 px-4 pb-1 text-[#B58A83] text-sm">
      <span className="mt-0.5">{text}</span>
      <div className="flex gap-1 mt-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[#D4B18A] animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-[#D4B18A] animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-[#D4B18A] animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}
