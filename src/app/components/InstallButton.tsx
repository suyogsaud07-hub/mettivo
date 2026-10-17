'use client';

import { useCallback, useEffect, useState } from 'react';
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

/** True when the app is already running from the home screen / desktop. */
function isRunningStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches;
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

export default function InstallButton() {
  const { t } = useLanguage();
  /** The captured `beforeinstallprompt` event, ready to be shown on click. */
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  /** Whether the app is already installed (home screen / desktop). */
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    // Already installed (launched from home screen / desktop): hide the button.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsInstalled(isRunningStandalone());

    function onBeforeInstallPrompt(event: Event) {
      // Stop Chrome's mini-infobar so the in-app button drives installation.
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    }
    function onAppInstalled() {
      setIsInstalled(true);
      setDeferredPrompt(null);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    // React to display-mode changes (e.g. after install on some platforms).
    const media = window.matchMedia('(display-mode: standalone)');
    const onChange = () => setIsInstalled(media.matches);
    media.addEventListener('change', onChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      media.removeEventListener('change', onChange);
    };
  }, []);

  const handleInstallClick = useCallback(async () => {
    // iOS Safari (and any browser without beforeinstallprompt): show the
    // manual "Add to Home Screen" instructions instead of doing nothing.
    if (!deferredPrompt) {
      setShowHelp((open) => !open);
      return;
    }

    try {
      // This is what opens the native install dialog.
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      // A prompt object can only be used once.
      setDeferredPrompt(null);

      if (outcome !== 'accepted') {
        setShowHelp(true);
      }
      // On success the display-mode match / `appinstalled` event hides the button.
    } catch (error) {
      console.warn('[pwa] Install prompt failed:', error);
      setDeferredPrompt(null);
      setShowHelp(true);
    }
  }, [deferredPrompt]);

  if (isInstalled) return null;

  const helpText = isIOS()
    ? 'Tap the Share button in Safari, then choose "Add to Home Screen".'
    : 'Open your browser menu and choose "Install app" or "Add to Home Screen".';

  return (
    <div style={{ width: '100%' }}>
        <button
          type="button"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={handleInstallClick}
          aria-expanded={showHelp}
          data-testid="install-app"
          style={{
            width: '100%',
            padding: '16px',
            borderRadius: '9999px',
            backgroundColor: hovered ? '#4A1828' : '#29202D',
            border: '1px solid rgba(212, 177, 138, 0.5)',
            color: '#F2E9E4',
            fontSize: '16px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'background-color 0.2s ease, border-color 0.2s ease',
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
