'use client';

import { useEffect } from 'react';

interface ToastProps {
  type: 'like' | 'pass';
  message: string;
  onDismiss: () => void;
}

export default function Toast({ type, message, onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 1200);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const config = type === 'like'
    ? { color: '#10B981', shadow: 'rgba(16, 185, 129, 0.35)', icon: '❤️' }
    : { color: '#F3A7AD', shadow: 'rgba(243, 167, 173, 0.35)', icon: '✕' };

  return (
    <div
      className="fixed bottom-[220px] left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none"
    >
      <div
        className={`px-6 py-3 rounded-full bg-[#211A28] border border-[#34283F]/40 shadow-2xl flex items-center gap-2.5 text-[#F2E9E4] font-semibold text-sm animate-in fade-in slide-in-from-bottom-4 duration-300`}
        style={{
          boxShadow: `0 0 20px ${config.shadow}`,
          borderColor: config.color,
        }}
      >
        <span className="text-xl">{config.icon}</span>
        <span>{message}</span>
      </div>
    </div>
  );
}
