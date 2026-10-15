import { defineConfig, devices } from '@playwright/test';

/**
 * §3.3 — end-to-end browser journeys.
 *
 * SAFETY: this suite must never touch the production Supabase project.
 *
 *  1. The dev server is started with `NEXT_PUBLIC_SUPABASE_URL` pointed at a
 *     reserved `.invalid` hostname. Next.js does not let `.env.local` override an
 *     environment variable that is already set, so this wins.
 *  2. Every Supabase call the browser makes is additionally intercepted in
 *     `tests/e2e/fixtures.ts`, which is what makes the journeys deterministic.
 *
 * If an interception is ever missed, the request fails harmlessly against
 * `e2e.invalid` instead of creating real accounts or reading real profiles.
 */

const PORT = 3100;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The PWA install prompt is Chromium-only; a mobile-sized viewport also
    // exercises the bottom navigation, which is the primary way members move
    // around the product.
    ...devices['Pixel 7'],
  },

  projects: [{ name: 'chromium', use: { ...devices['Pixel 7'] } }],

  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/offline`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // Reserved TLD: guaranteed not to resolve to a real backend.
      NEXT_PUBLIC_SUPABASE_URL: 'https://e2e.invalid.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-anon-key-not-a-real-secret-xxxxxxxxxxxxxxxxxxxx',
    },
  },
});
