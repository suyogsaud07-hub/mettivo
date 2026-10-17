'use client';

import Link from 'next/link';
import { useCallback, useEffect } from 'react';

const DRAWER_LINKS = [
  { label: 'Discover', href: '/discover' },
  { label: 'People', href: '/people' },
  { label: 'Notifications', href: '/notifications' },
  { label: 'Moments', href: '/moments' },
  { label: 'Game Zone', href: '/game-zone' },
  { label: 'Profile', href: '/profile/dashboard' },
];

/**
 * The full-screen immersive mobile drawer opened by the header hamburger.
 *
 * It covers the viewport in Midnight Dark, lists the app's primary
 * destinations, locks body scroll while open, and closes on Escape or a tap
 * outside the menu. Choosing a link closes the drawer and navigates normally.
 */

export default function MobileDrawer({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    },
    [onClose]
  );

  // Lock body scroll while the drawer immerses the screen; restore on unmount.
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] bg-[#17121C]/98 backdrop-blur-sm flex flex-col items-center justify-center gap-10 p-10 text-center"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-6 right-6 text-[#F2E9E4]/50 hover:text-[#F2E9E4] transition-colors"
        aria-label="Close menu"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <nav className="flex flex-col gap-6">
        {DRAWER_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={onClose}
            className="text-[#F2E9E4] text-3xl font-medium tracking-tight hover:text-[#D4B18A] transition-colors"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
