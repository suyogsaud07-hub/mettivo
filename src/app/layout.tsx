import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "./components/layout/Header";
import { MobileNav } from "./components/layout/MobileNav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Spark — Meet new people around you",
  description:
    "A social discovery app for friendship and dating. Create a profile, discover people with shared interests, and start real conversations.",
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  // Shell (header + bottom nav) is hidden on the welcome and auth screens.
  const showShell =
    typeof window !== "undefined" &&
    window.location.pathname !== "/" &&
    window.location.pathname !== "/auth";

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {showShell && <Header />}
        <main className="flex-1 w-full max-w-md mx-auto pb-20 sm:pb-4">{children}</main>
        {showShell && <MobileNav />}
      </body>
    </html>
  );
}
