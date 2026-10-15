'use client';

import { useEffect } from 'react';

/**
 * Registers the Mettivo service worker and keeps it up to date.
 *
 * Registration is skipped during `next dev` (unless
 * NEXT_PUBLIC_ENABLE_SW=true) because a caching service worker serves stale
 * chunks over HMR. A service worker is only required for installability in
 * production anyway.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    const enabled =
      process.env.NODE_ENV === 'production' ||
      process.env.NEXT_PUBLIC_ENABLE_SW === 'true';

    if (!enabled) return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    let cancelled = false;
    let reloading = false;

    // Only reload on controllerchange when the page was already controlled:
    // on the very first install there is no controller, and reloading there
    // would cause a pointless refresh.
    const hadController = Boolean(navigator.serviceWorker.controller);

    const handleControllerChange = () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });

        if (cancelled) return;

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.addEventListener('statechange', () => {
            // A new worker finished installing while an old one is still in
            // control -> tell it to take over, then reload via the
            // controllerchange handler above.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              installing.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      } catch (error) {
        console.warn('[pwa] Service worker registration failed:', error);
      }
    };

    if (document.readyState === 'complete') {
      void register();
    } else {
      window.addEventListener('load', register, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener('load', register);
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  return null;
}
