"use client";

import { usePathname } from "next/navigation";
import { Header } from "./Header";
import { MobileNav } from "./MobileNav";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const hideShell = pathname === "/" || pathname.startsWith("/auth");

  return (
    <>
      {!hideShell && <Header />}
      <main className="flex-1 w-full max-w-md mx-auto pb-20 sm:pb-4">{children}</main>
      {!hideShell && <MobileNav />}
    </>
  );
}
