import type { Metadata, Viewport } from 'next';
import './globals.css';
import { LanguageProvider } from '@/context/LanguageContext';
import ServiceWorkerRegistrar from '@/app/components/ServiceWorkerRegistrar';
import IntroSplashAnimation from '@/app/components/IntroSplashAnimation';

const APP_NAME = 'Mettivo';
const APP_DESCRIPTION =
  'An intimate space to find meaningful connections wrapped in luxury.';

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    default: 'Mettivo',
    template: '%s | Mettivo',
  },
  description: APP_DESCRIPTION,
  manifest: '/manifest.json',
  // Enables the native "Add to Home Screen" behaviour on iOS/iPadOS.
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    // 'black' keeps an opaque status bar so app content is never hidden
    // underneath it (which is what 'black-translucent' would do).
    statusBarStyle: 'black',
  },
  formatDetection: {
    telephone: false,
  },
  // Next.js 16 emits the modern `mobile-web-app-capable` tag for
  // appleWebApp.capable. iOS Safari below 17 only honours the Apple-prefixed
  // variant, so emit it explicitly as well.
  other: {
    'apple-mobile-web-app-capable': 'yes',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      {
        url: '/icons/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  },
};

export const viewport: Viewport = {
  // Midnight Romance page colour (`--mr-page`). The browser chrome must match
  // the page it frames, or the installed app shows a band of the wrong plum.
  themeColor: '#131017',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  // Deliberately not 1: capping zoom breaks accessibility.
  maximumScale: 5,
  // Let the app paint into the notch / home-indicator area when installed.
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#131017] text-[#eae2f0] antialiased">
        <LanguageProvider>
          {children}
          {/*
            The intro splash lives in the ROOT layout, not on the landing page.

            It is a once-per-session curtain over the whole app, so it has to be
            above whatever route the member lands on first — someone who opens
            `/discover` or a shared `/chat/...` link has never seen the landing
            page, and a splash mounted there would never run for them. It renders
            nothing of its own until the client decides (see the component), so it
            cannot introduce a hydration mismatch.
          */}
          <IntroSplashAnimation />
          <ServiceWorkerRegistrar />
        </LanguageProvider>
      </body>
    </html>
  );
}
