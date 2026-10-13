"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";

const LINKS = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/discover", label: "Discover", icon: "❤️" },
  { href: "/chat", label: "Messages", icon: "💬" },
  { href: "/report", label: "Report", icon: "🚩" },
  { href: "/profile", label: "Profile", icon: "👤" },
];

export const MobileNav: React.FC = () => {
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 z-40 bg-white/90 dark:bg-neutral-950/90 backdrop-blur-md border-t border-neutral-200 dark:border-neutral-800 pb-safe">
      <ul className="flex items-center justify-between px-2 py-2 max-w-md mx-auto">
        {LINKS.map((link) => {
          const isActive = pathname === link.href;
          return (
            <li key={link.href} className="flex-1 flex flex-col items-center gap-0.5">
              <Link
                href={link.href}
                className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${
                  isActive
                    ? "text-rose-500"
                    : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-300"
                }`}
              >
                <span className={`text-2xl transition-transform ${isActive ? "scale-110" : ""}`}>
                  {link.icon}
                </span>
                <span
                  className={`text-[10px] font-medium ${
                    isActive ? "opacity-100" : "opacity-0 h-0"
                  } transition-all`}
                >
                  {link.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
