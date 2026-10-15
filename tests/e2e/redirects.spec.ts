import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_EMAIL, signedIn, stubSupabase } from './fixtures';

/**
 * Redirect behaviour for the public surfaces.
 *
 * The bug class this pins: this app had a redirect cycle where `/profile` sent
 * an unauthenticated request to `/auth`, and `/auth` sent a request whose
 * session cookie was not readable yet straight back to `/profile`. Two of the
 * three rules below exist because removing an automatic redirect is the fix —
 * so the absence of navigation is itself the assertion.
 *
 *   1. `/` is never auto-redirected, signed in or out.
 *   2. `/auth` and `/signup` never auto-redirect an authenticated visitor; they
 *      offer an explicit choice instead.
 *   3. Middleware never redirects at all.
 */

test.describe('§3.3 — the landing page never redirects', () => {
  test('a signed-out visitor stays on / and gets the "Let\'s Get Started" CTA', async ({ page }) => {
    await stubSupabase(page, { user: null });

    await page.goto('/');
    await expect(page.getByTestId('landing-primary-cta')).toBeVisible();
    // The primary CTA is the signup surface — never the app, never onboarding.
    await expect(page.getByTestId('landing-primary-cta')).toHaveAttribute('href', '/signup');
    await expect(page.getByTestId('landing-primary-cta')).toHaveText(/let'?s get started/i);
    // There is exactly ONE call to action: no dashboard button to bounce off.
    await expect(page.getByTestId('landing-dashboard-link')).toHaveCount(0);

    // Stay put: give any redirect a chance to fire.
    await page.waitForTimeout(1200);
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('the CTA opens every signup/login method on an explicit click', async ({ page }) => {
    await stubSupabase(page, { user: null });

    await page.goto('/');
    await page.getByTestId('landing-primary-cta').click();

    // The auth surface, with the full method list: email, phone and the four
    // social providers. A new visitor must meet this screen, not onboarding.
    await expect.poll(() => new URL(page.url()).pathname).toBe('/signup');
    await expect(page.getByTestId('auth-panel')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign up with email/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign up with phone/i })).toBeVisible();
    for (const provider of ['Google', 'Facebook', 'Twitter', 'Discord']) {
      await expect(
        page.getByRole('button', { name: new RegExp(`sign up with ${provider}`, 'i') })
      ).toBeVisible();
    }

    // No bounce onward: the member is on the auth surface until they choose.
    await page.waitForTimeout(1200);
    expect(new URL(page.url()).pathname).toBe('/signup');
  });

  test('a signed-in member stays on / and still gets the signup CTA, with no dashboard button', async ({
    page,
  }) => {
    await signedIn(page);
    await stubSupabase(page, {
      tables: {
        profiles: { onboarding_completed: true, intention: 'dating', interests: [], prompts: {} },
      },
    });

    await page.goto('/');

    // The landing page is REACHABLE while signed in — no bounce to /discover.
    await expect(page.getByTestId('landing-primary-cta')).toBeVisible();
    // The CTA is the same for a member: it opens the auth surface, where the
    // session choice and the sign-out live. No "Go to Dashboard" button.
    await expect(page.getByTestId('landing-primary-cta')).toHaveText(/let'?s get started/i);
    await expect(page.getByTestId('landing-primary-cta')).toHaveAttribute('href', '/signup');
    await expect(page.getByTestId('landing-dashboard-link')).toHaveCount(0);

    await page.waitForTimeout(1200);
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('clicking the primary CTA while signed in offers the session choice, not a bounce', async ({
    page,
  }) => {
    await signedIn(page);
    await stubSupabase(page, { user: null });

    await page.goto('/');
    await page.getByTestId('landing-primary-cta').click();

    // The auth surface renders, and because a session exists it asks first.
    await expect.poll(() => new URL(page.url()).pathname).toBe('/signup');
    await expect(page.getByTestId('session-choice')).toBeVisible();
    await expect(page.getByTestId('sign-out-here')).toBeVisible();

    // Nothing navigates on its own.
    await page.waitForTimeout(1500);
    expect(new URL(page.url()).pathname).toBe('/signup');
  });

  test('the app is still one deliberate choice away, through the auth surface', async ({ page }) => {
    await signedIn(page);
    await stubSupabase(page, {
      tables: {
        profiles: { onboarding_completed: true, intention: 'dating', interests: [], prompts: {} },
      },
    });

    await page.goto('/');
    await page.getByTestId('landing-primary-cta').click();
    await expect(page.getByTestId('continue-session')).toBeVisible();
    await page.getByTestId('continue-session').click();

    // `/profile` is the onboarding gate; an onboarded member lands on the
    // dashboard. Explicit choices only — this never happens on its own.
    await expect.poll(() => new URL(page.url()).pathname).toBe('/profile/dashboard');
  });

  test('browser Back from the auth surface returns to the landing page', async ({ page }) => {
    await signedIn(page);
    await stubSupabase(page, { user: null });

    await page.goto('/');
    await page.getByTestId('landing-primary-cta').click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/signup');

    await page.goBack();

    // This is the regression: the landing page used to bounce you straight back
    // out, making Back unusable.
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
    await page.waitForTimeout(1200);
    expect(new URL(page.url()).pathname).toBe('/');
  });
});

test.describe('§3.3 — an unfinished profile is never trapped in onboarding', () => {
  test('the wizard links back to the landing page, and it stays there', async ({ page }) => {
    await signedIn(page);
    await stubSupabase(page, {
      // The state that used to be a holding cell: signed in, not onboarded.
      tables: { profiles: { onboarding_completed: false } },
    });

    await page.goto('/profile/edit');
    await expect(page.getByText("Let's start with the basics")).toBeVisible();

    await page.getByTestId('back-to-landing').click();

    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
    await expect(page.getByTestId('landing-primary-cta')).toBeVisible();
    // Public page, public behaviour: no bounce back into onboarding.
    await page.waitForTimeout(1200);
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('the wizard can sign the member out, and they land signed out', async ({ page }) => {
    await signedIn(page);
    await stubSupabase(page, {
      tables: { profiles: { onboarding_completed: false } },
    });

    await page.goto('/profile/edit');
    await expect(page.getByText("Let's start with the basics")).toBeVisible();

    await page.getByTestId('wizard-sign-out').click();

    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
    // The session is gone, so this is the signed-out landing page.
    await expect(page.getByTestId('landing-dashboard-link')).toHaveCount(0);
    await expect(page.getByTestId('landing-primary-cta')).toHaveAttribute('href', '/signup');
  });
});

for (const route of ['/auth', '/signup'] as const) {
  test.describe(`§3.3 — ${route} offers a choice instead of redirecting`, () => {
    test('an authenticated visitor is offered continue-or-sign-out, not a redirect', async ({
      page,
    }) => {
      await signedIn(page);
      await stubSupabase(page, { user: null });

      await page.goto(route);

      // The panel is rendered…
      await expect(page.getByTestId('auth-panel')).toBeVisible();
      // …with the explicit choice…
      const choice = page.getByTestId('session-choice');
      await expect(choice).toBeVisible();
      await expect(page.getByTestId('session-email')).toHaveText(E2E_EMAIL);
      await expect(page.getByTestId('continue-session')).toBeVisible();
      await expect(page.getByTestId('sign-out-here')).toBeVisible();

      // …and NO automatic navigation away.
      await page.waitForTimeout(1500);
      expect(new URL(page.url()).pathname).toBe(route);
    });

    test('Continue as this account hands off to the onboarding gate', async ({ page }) => {
      await signedIn(page);
      await stubSupabase(page, {
        user: null,
        tables: {
          profiles: { onboarding_completed: true, intention: 'dating', interests: [], prompts: {} },
        },
      });

      await page.goto(route);
      await page.getByTestId('continue-session').click();

      await expect.poll(() => new URL(page.url()).pathname).toBe('/profile/dashboard');
    });

    test('signing out here reveals the signup form without leaving the page', async ({ page }) => {
      await signedIn(page);
      await stubSupabase(page, { user: null });

      await page.goto(route);
      await expect(page.getByTestId('session-choice')).toBeVisible();

      await page.getByTestId('sign-out-here').click();

      // Still on the same route — that is the point of signing out "here".
      await expect.poll(() => new URL(page.url()).pathname).toBe(route);
      // The choice is gone and the signup form is usable.
      await expect(page.getByTestId('session-choice')).toHaveCount(0);
      await expect(page.getByLabel('Email')).toBeVisible();
      await expect(page.getByRole('button', { name: /sign up with email/i })).toBeVisible();
      await expect(page.getByTestId('auth-notice')).toContainText(/signed out/i);

      // Signing out here is reversible: the member came from a session, so there
      // is a route back rather than a dead end.
      await expect(page.getByTestId('signed-out-note')).toBeVisible();
      await expect(page.getByTestId('back-to-app')).toBeVisible();
    });

    test('the loop that used to exist cannot form', async ({ page }) => {
      await signedIn(page);
      await stubSupabase(page, {
        // A member who has started but not finished onboarding. This is the
        // state that used to churn between the gate and the onboarding wizard.
        tables: { profiles: { onboarding_completed: false } },
      });

      await page.goto(route);
      // Choose to continue into onboarding, which lands on the wizard…
      await page.getByTestId('continue-session').click();
      await expect.poll(() => new URL(page.url()).pathname).toBe('/profile/edit');

      // …and settle there. No return to the auth screen, and no oscillation.
      await page.waitForTimeout(1500);
      expect(new URL(page.url()).pathname).toBe('/profile/edit');

      // The invariant, not a navigation count: once the member has chosen, the
      // auth screen is never entered again. A cycle needs that edge, and it is
      // gone. (Counting entries is unreliable — the App Router records a
      // client-side `replace` as its own framenavigated event.)
      await page.getByTestId('auth-panel').waitFor({ state: 'hidden', timeout: 1000 }).catch(() => {});
      expect(new URL(page.url()).pathname).not.toBe(route);
    });
  });
}

test.describe('§3.3 — a failed profile read must not bounce to /auth', () => {
  test('an authenticated member whose profile read fails lands in onboarding, not /auth', async ({
    page,
  }) => {
    await signedIn(page);

    // The profile endpoint fails outright — a transient 5xx, the case that used
    // to send a validly-signed-in member to `/auth` and start the cycle.
    await page.route('**/rest/v1/profiles**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'internal error' }),
      })
    );
    // `getSession()`/`getUser()` still see the seeded session.
    await page.route('**/auth/v1/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    );

    await page.goto('/profile');

    // Fail FORWARD into the idempotent wizard, never back to the auth screen.
    await expect.poll(() => new URL(page.url()).pathname).toBe('/profile/edit');
    await page.waitForTimeout(1500);
    expect(new URL(page.url()).pathname).toBe('/profile/edit');

    // And if the member then opens the auth screen, nothing bounces them back:
    // the cycle needs both halves, and this half is gone.
    await page.goto('/auth');
    await page.waitForTimeout(1200);
    expect(new URL(page.url()).pathname).toBe('/auth');
  });
});

test.describe('§3.3 — middleware is refresh-only', () => {
  test('the middleware never issues a redirect response', () => {
    // A source-level invariant. Any session-dependent `redirect()` in the
    // middleware reintroduces the loop this change removes, and a browser test
    // cannot see it: the loop needs the "session present but not yet readable"
    // window, which is exactly what a test cannot reproduce reliably.
    const source = readFileSync(join(process.cwd(), 'src', 'middleware.ts'), 'utf8');
    // Comments are stripped: the file documents the ban in prose.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    expect(code).not.toMatch(/NextResponse\.redirect/);
    expect(code).not.toMatch(/\bredirect\s*\(/);
    // It still does its actual job.
    expect(code).toMatch(/supabase\.auth\.getUser\(\)/);
  });
});
