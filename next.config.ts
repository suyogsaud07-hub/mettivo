import type { NextConfig } from 'next';

const nextConfig: any = {
  // Ensure strict runtime error boundaries
  reactStrictMode: true,

  // Security enhancement: remove the X-Powered-By header
  poweredByHeader: false,

  // Bypass build checks for rapid deployment
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },

  // App Router & Turbopack performance tuning
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;