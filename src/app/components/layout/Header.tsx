'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";

const LINKS = [
  { href: "/discover", label: "Discover", icon: "❤️" },
  { href: "/chat", label: "Messages", icon: "💬" },
  { href: "/report", label: "Report", icon: "⚠️" },
  { href: "/profile", label: "Profile", icon: "👤" },
];

interface HeaderProps {
  showBack?: boolean;
  onBack?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ showBack = false, onBack }) => {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-md border-b border-neutral-200 dark:border-neutral-800">
      <div className="flex items-center justify-between px-4 py-3 max-w-md mx-auto">
        <div className="flex items-center gap-3 flex-1">
          {showBack ? (
            <button
              onClick={onBack}
              className="p-1 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors"
              aria-label="Go back"
            >
              <svg
                className="h-5 w-5 stroke-neutral-700 dark:stroke-neutral-300"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          ) : (
            <Link href="/" className="flex items-center gap-2">
              <span className="text-2xl">🔥</span>
              <span className="font-bold text-lg text-neutral-900 dark:text-white">
                Mettivo
              </span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
};