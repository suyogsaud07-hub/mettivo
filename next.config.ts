import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Catch render-time bugs early by double-invoking components in development.
  reactStrictMode: true,

  // Security: do not advertise the framework.
  poweredByHeader: false,

  // Tailwind CSS v4 is wired through its Turbopack loader. Turbopack is the
  // default bundler for `next dev` and `next build` in Next.js 16, so no
  // PostCSS config file is required.
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },

  async headers() {
    return [
      {
        // Baseline hardening for every response.
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        // The service worker must always be revalidated, otherwise clients can
        // stay pinned to a stale worker and never receive updates.
        source: '/sw.js',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8',
          },
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          // Lets /sw.js control the whole origin.
          { key: 'Service-Worker-Allowed', value: '/' },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
      {
        // The manifest is read by the browser during installability checks.
        source: '/manifest.json',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/manifest+json; charset=utf-8',
          },
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
    ];
  },
};

export default nextConfig;
