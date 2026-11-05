'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { Download } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

function isRunningStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches;
}

function isIOS(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const iOSDevice = /iPad|iPhone|iPod/.test(ua);
  const iPadOS = window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;
  return iOSDevice || iPadOS;
}

export default function InstallButton() {
  const { t } = useLanguage();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsInstalled(isRunningStandalone());

    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    }
    function onAppInstalled() {
      setIsInstalled(true);
      setDeferredPrompt(null);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

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
    if (!deferredPrompt) {
      setShowHelp((open) => !open);
      return;
    }

    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      setDeferredPrompt(null);

      if (outcome !== 'accepted') {
        setShowHelp(true);
      }
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
    <div className="w-full">
      <button
        type="button"
        onClick={handleInstallClick}
        aria-expanded={showHelp}
        data-testid="install-app"
        className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-6 rounded-full bg-[#29202D] border border-[#D4B18A]/60 text-[#D4B18A] text-sm font-bold tracking-tight uppercase transition-all hover:bg-[#D4B18A]/10 hover:text-[#F2E9E4] focus:outline-none"
      >
        <Download size={16} />
        {t('get_app') || 'Get the app'}
      </button>

      {showHelp && (
        <p
          role="status"
          className="mt-3 text-xs leading-relaxed text-[#B58A83] bg-[#1C1822] border border-[#29202D] rounded-xl p-3 text-left"
        >
          {helpText}
        </p>
      )}
    </div>
  );
}