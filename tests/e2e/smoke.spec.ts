import { expect, test } from '@playwright/test';
import { signedIn, stubSupabase } from './fixtures';

/**
 * §3.3 — routes, PWA artefacts and the protected navigation.
 *
 * `AGENTS.md` calls the owner-built navigation "first-class features, not
 * scaffolding". A grep proves the route literals are still in the source; only a
 * real browser proves the buttons actually render and are reachable.
 */

const NAV_HREFS = [
  '/discover',
  '/people',
  '/notifications',
  '/moments',
  '/game-zone',
  '/profile/dashboard',
];

test.describe('§3.3 — public surfaces', () => {
  test('serves the offline fallback without a session', async ({ page }) => {
    const response = await page.goto('/offline');
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toBeVisible();
  });

  test('serves the legal pages without a session', async ({ page }) => {
    for (const path of ['/privacy', '/terms']) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} must be publicly reachable`).toBe(200);
    }
  });

  test('reports a healthy configuration', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.checks.environment.configured).toBe(true);
    // The health body must never carry a configured value.
    expect(JSON.stringify(body)).not.toContain('e2e-anon-key');
  });

  test('serves the manifest and a revalidated service worker', async ({ request }) => {
    const manifest = await request.get('/manifest.json');
    expect(manifest.status()).toBe(200);
    expect(manifest.headers()['content-type']).toContain('manifest+json');

    const serviceWorker = await request.get('/sw.js');
    expect(serviceWorker.status()).toBe(200);
    // R-10: a stale worker would pin members to an old bundle.
    expect(serviceWorker.headers()['cache-control']).toContain('no-store');
  });
});

test.describe('§3.3 — protected navigation and routes (R-12)', () => {
  test.beforeEach(async ({ page }) => {
    await signedIn(page);
    await stubSupabase(page, {
      tables: {
        profiles: [{ onboarding_completed: true, intention: 'dating', interests: [], prompts: {} }],
      },
      rpc: { discover_profiles: [], unread_counts: [] },
    });
  });

  test('keeps all six bottom-nav destinations, including the three owner-added ones', async ({
    page,
  }) => {
    await page.goto('/discover');

    for (const href of NAV_HREFS) {
      await expect(
        page.locator(`a[href="${href}"]`).first(),
        `${href} must remain in the bottom navigation`
      ).toBeVisible();
    }
  });

  test('renders each owner-built route page', async ({ page }) => {
    for (const path of ['/notifications', '/moments', '/game-zone']) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} must render`).toBe(200);

      // The page rendered its own nav, so the route is wired and not a 404 shell.
      await expect(
        page.locator('a[href="/notifications"]').first(),
        `${path} must render the app shell`
      ).toBeVisible();
    }
  });
});
