import type { NextConfig } from 'next';

const nextConfig: NextConfig = {  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  // Catch render-time bugs early by double-invoking components in development.
  reactStrictMode: true,

  // Security: do not advertise the framework.
  poweredByHeader: false,

  // Tailwind CSS v4 is wired through its Turbopack loader. Turbopack is the
  // default bundler for `next dev` and `next build` in Next.js 16, so no
  // PostCSS config file is required.
  turbopack: {
    root: __dirname,
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
          // NEW: Force HTTPS for 2 years
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          // NEW: Block unauthorized camera/mic/location access
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
          // NEW: Global Content Security Policy (whitelists Supabase, Stripe, Groq, etc.)
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://*.vercel.app https://vercel.com; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://*.supabase.co https://*.stripe.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://api.groq.com https://vercel.com https://*.vercel.app; frame-src 'self' https://js.stripe.com https://hooks.stripe.com; font-src 'self' data:; object-src 'none'; base-uri 'self';"
          }
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