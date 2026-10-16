import { expect, test } from '@playwright/test';
import {
  E2E_OTHER_USER_ID,
  E2E_USER_ID,
  signedIn,
  stubSupabase,
} from './fixtures';

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
  '/chat',
  '/moments',
  '/game-zone',
  '/profile/dashboard',
  '/live',
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

test.describe('§3.3 — the founder welcome letter', () => {
  test('the dedicated letter route is public and renders the letter', async ({ page }) => {
    const response = await page.goto('/letter');
    expect(response?.status()).toBe(200);
    // The copy comes from `src/lib/welcome-letter.ts`.
    await expect(page.getByText('Welcome to Mettivo. Explore and enjoy!')).toBeVisible();
    await expect(page.getByText('Suyog Saund.')).toBeVisible();
  });

  test('the landing letter is reachable only from the corner pill', async ({ page }) => {
    await page.goto('/');

    // The redundant header trigger beside the language picker was removed; the
    // floating bottom-left pill is the single landing-page entry point.
    await expect(page.getByTestId('founder-letter-header')).toHaveCount(0);

    await page.getByTestId('founder-letter-corner').click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/letter');
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

  test('keeps every bottom-nav destination, including the owner-added ones', async ({
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

  test('renders the Mettivo Live surface with its pre-flight permission step', async ({
    page,
  }) => {
    const response = await page.goto('/live');
    expect(response?.status(), '/live must render').toBe(200);

    await expect(page.getByRole('heading', { name: 'Mettivo Live' })).toBeVisible();
    // Camera access is requested deliberately, behind a button — never on load.
    await expect(page.getByTestId('live-allow')).toBeVisible();
    await expect(page.getByTestId('live-permission-cancel')).toBeVisible();
    // The nav entry that leads here is present on the page too.
    await expect(page.locator('a[href="/live"]').first()).toBeVisible();
  });

  test('renders real content on /people, not an empty scaffold', async ({ page }) => {
    // Regression guard. `/people` previously shipped as a full-height dark div
    // containing nothing but <MobileNav />, with the author's own
    // `{/* ... content ... */}` markers still in the source. It is a protected
    // nav destination, so every member who tapped it got a blank screen.
    await page.goto('/people');

    await expect(page.getByRole('heading', { name: /connections/i })).toBeVisible();
    // With no matches stubbed, the empty state is the content that must exist.
    await expect(page.getByText(/no connections yet/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /start discovering/i })).toBeVisible();
  });

  test('lists a mutual match and links it to the conversation', async ({ page }) => {
    await stubSupabase(page, {
      tables: {
        // Two different reads hit `profiles`: the gatekeeper wants one row, the
        // connection lookup wants a list with names. Branch on the query.
        profiles: (url) =>
          url.searchParams.get('select')?.includes('onboarding_completed')
            ? { onboarding_completed: true, intention: 'dating', interests: [], prompts: {} }
            : [
                {
                  id: E2E_OTHER_USER_ID,
                  display_name: 'Bo',
                  age: 30,
                  city: 'Pokhara',
                  country: 'Nepal',
                  avatar_url: null,
                  is_online: true,
                },
              ],
        matches: [{ id: 'match-1', user_a: E2E_USER_ID, user_b: E2E_OTHER_USER_ID }],
      },
      rpc: { discover_profiles: [] },
    });
    await page.goto('/people');

    await expect(page.getByText('Bo')).toBeVisible();
    await expect(page.locator('a[href="/chat/match-1"]')).toBeVisible();
  });

  test('no protected route renders a bare navigation shell', async ({ page }) => {
    // The general form of the bug above: a route that technically returns 200
    // and paints the nav, but no content of its own.
    const NAV_LABELS = [
      'Discover',
      'People',
      'Notifications',
      'Messages',
      'Moments',
      'Games',
      'Profile',
    ];

    for (const path of ['/people', '/notifications', '/moments', '/game-zone']) {
      await page.goto(path);

      const bodyText = (await page.locator('body').innerText()).trim();
      const withoutNav = NAV_LABELS.reduce(
        (text, label) => text.replaceAll(label, ''),
        bodyText
      ).replace(/\s+/g, '');

      expect(
        withoutNav.length,
        `${path} renders no content of its own — only the navigation shell`
      ).toBeGreaterThan(0);
    }
  });
});
