'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Check if the user already dismissed the prompt
    if (localStorage.getItem('pwa-prompt-dismissed') === 'true') return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsVisible(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setIsVisible(false);
    localStorage.setItem('pwa-prompt-dismissed', 'true');
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 flex items-center justify-between rounded-xl bg-neutral-900 p-4 border border-neutral-700 shadow-2xl md:hidden">
      <div>
        <p className="text-sm font-semibold text-white">Install Mettivo</p>
        <p className="text-xs text-neutral-400">Add to home screen for the best experience.</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleInstallClick}
          className="flex items-center gap-1 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600"
        >
          <Download size={14} /> Install
        </button>
        <button onClick={handleDismiss} className="p-1.5 text-neutral-400 hover:text-white">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}