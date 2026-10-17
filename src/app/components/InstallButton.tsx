'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useLanguage } from '@/context/LanguageContext';

/**
 * The non-standard event Chrome/Edge fire when the app becomes installable.
 * It is not part of lib.dom, so it is declared locally.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const DISPLAY_MODES = [
  'standalone',
  'minimal-ui',
  'fullscreen',
  'window-controls-overlay',
];

/** Set once the `appinstalled` event fires in this browsing session. */
let appInstalledThisSession = false;

/** True when the app is already running from the home screen / desktop. */
function isRunningStandalone(): boolean {
  if (typeof window === 'undefined') return false;

  const byDisplayMode = DISPLAY_MODES.some(
    (mode) => window.matchMedia(`(display-mode: ${mode})`).matches
  );

  // iOS Safari does not implement display-mode for home-screen apps.
  const byNavigator =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

  return byDisplayMode || byNavigator;
}

function isIOS(): boolean {
  if (typeof window === 'undefined') return false;

  const ua = window.navigator.userAgent;
  const iOSDevice = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ masquerades as macOS, but is distinguishable by touch points.
  const iPadOS =
    window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;

  return iOSDevice || iPadOS;
}

/* ======================================================================
   The install prompt is EXTERNAL, NON-REACT state, so it is read through
   `useSyncExternalStore` — the pattern CODING_STANDARDS §2 mandates. Two
   things make this a store rather than a `useState` in the component body:

   1. RACE. `beforeinstallprompt` can fire during hydration, before any
      effect has run. A listener attached inside `useEffect` would miss it,
      the prompt would be gone forever, and the button would silently fall
      back to the manual-instructions textbox. The listener is therefore
      attached at MODULE SCOPE (guarded for the server), the moment this
      chunk executes in the browser — strictly earlier than any effect.
   2. `useState` here would also trip `react-hooks/set-state-in-effect`.
   ====================================================================== */

let capturedPrompt: BeforeInstallPromptEvent | null = null;
const promptSubscribers = new Set<() => void>();

function emitPromptChange() {
  for (const notify of promptSubscribers) notify();
}

function captureInstallPrompt(event: BeforeInstallPromptEvent) {
  capturedPrompt = event;
  emitPromptChange();
}

function clearInstallPrompt() {
  capturedPrompt = null;
  emitPromptChange();
}

function subscribeToInstallPrompt(onStoreChange: () => void) {
  promptSubscribers.add(onStoreChange);
  return () => {
    promptSubscribers.delete(onStoreChange);
  };
}

function getInstallPromptSnapshot(): BeforeInstallPromptEvent | null {
  return capturedPrompt;
}

/** The server never has a prompt; the client decides after hydration. */
function getInstallPromptServerSnapshot(): BeforeInstallPromptEvent | null {
  return null;
}

// Attached once, at module scope. `typeof window` is false during SSR, so this
// is a no-op on the server, and this module is only imported by client
// components in the first place.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Stop Chrome's mini-infobar so the in-app button drives installation.
    event.preventDefault();
    captureInstallPrompt(event as BeforeInstallPromptEvent);
  });

  // Once installed the prompt is spent and the button must disappear.
  window.addEventListener('appinstalled', () => {
    appInstalledThisSession = true;
    clearInstallPrompt();
  });
}

/* ----- "already installed" is external state too, read via a store ----- */

function subscribeInstalled(onStoreChange: () => void) {
  const queries = DISPLAY_MODES.map((mode) =>
    window.matchMedia(`(display-mode: ${mode})`)
  );

  const handleChange = () => onStoreChange();
  const handleInstalled = () => {
    appInstalledThisSession = true;
    onStoreChange();
  };

  queries.forEach((query) => query.addEventListener('change', handleChange));
  window.addEventListener('appinstalled', handleInstalled);

  return () => {
    queries.forEach((query) => query.removeEventListener('change', handleChange));
    window.removeEventListener('appinstalled', handleInstalled);
  };
}

function getInstalledSnapshot(): boolean {
  return appInstalledThisSession || isRunningStandalone();
}

function getInstalledServerSnapshot(): boolean {
  return false;
}

export default function InstallButton() {
  const { t } = useLanguage();

  const isInstalled = useSyncExternalStore(
    subscribeInstalled,
    getInstalledSnapshot,
    getInstalledServerSnapshot
  );
  const deferredPrompt = useSyncExternalStore(
    subscribeToInstallPrompt,
    getInstallPromptSnapshot,
    getInstallPromptServerSnapshot
  );

  // Flips only after the detection window closes, so the button never flashes
  // on browsers that will fire `beforeinstallprompt` a moment later.
  const [detectionDone, setDetectionDone] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDetectionDone(true), 1500);
    return () => window.clearTimeout(timer);
  }, []);

  const handleInstallClick = useCallback(async () => {
    // No native prompt available (iOS Safari, Firefox, Safari on macOS, or the
    // app is already past the point where Chrome offers it): show the manual
    // instructions instead of doing nothing.
    if (!deferredPrompt) {
      setShowHelp((open) => !open);
      return;
    }

    try {
      // This is what opens the native install dialog.
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      // A prompt object can only be used once.
      clearInstallPrompt();

      if (outcome !== 'accepted') {
        setShowHelp(true);
      }
      // On success the `appinstalled` event flips `isInstalled`, which removes
      // this button from the tree.
    } catch (error) {
      console.warn('[pwa] Install prompt failed:', error);
      clearInstallPrompt();
      setShowHelp(true);
    }
  }, [deferredPrompt]);

  // Nothing to offer: already installed, or still within the detection window
  // with no native prompt captured.
  if (isInstalled) return null;
  if (!detectionDone && !deferredPrompt) return null;

  const helpText = isIOS()
    ? 'Tap the Share button in Safari, then choose "Add to Home Screen".'
    : 'Open your browser menu and choose "Install app" or "Add to Home Screen".';

  return (
    <div style={{ width: '100%' }}>
      <button
        type="button"
        onClick={handleInstallClick}
        aria-expanded={showHelp}
        data-testid="install-app"
        style={{
          width: '100%',
          padding: '16px',
          borderRadius: '30px',
          backgroundColor: 'var(--mr-gold, #d8b38a)',
          border: 'none',
          color: 'var(--mr-gold-text, #1a130c)',
          fontSize: '16px',
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        {t('get_app')}
      </button>

      {showHelp && (
        <p
          role="status"
          style={{
            marginTop: '10px',
            fontSize: '12px',
            lineHeight: 1.5,
            color: '#B58A83',
            backgroundColor: '#1C1822',
            border: '1px solid #29202D',
            borderRadius: '12px',
            padding: '10px 14px',
            textAlign: 'left',
          }}
        >
          {helpText}
        </p>
      )}
    </div>
  );
}
