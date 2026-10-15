import { expect, test } from '@playwright/test';
import { E2E_OTHER_USER_ID, candidate, signedIn, stubSupabase } from './fixtures';

/**
 * §3.3 — the journeys that must never regress.
 *
 *   the 18+ gate  →  onboarding wizard  →  discovery  →  block a member
 *
 * These are the safety-critical ones. The wizard covers `RISK_REGISTER.md` R-05
 * (a minor must not be able to complete onboarding) and the discovery journey
 * covers R-06 (a block must remove the member from the feed).
 */

test.describe('§3.3 — the 18+ gate', () => {
  test.beforeEach(async ({ page }) => {
    // No session: this is the very first screen a visitor sees.
    await stubSupabase(page, { user: null });
    await page.goto('/auth');
  });

  test('keeps the provider buttons inert until age is confirmed', async ({ page }) => {
    const google = page.getByRole('button', { name: /Sign up with Google|Log in with Google/ });

    // The gate is enforced in the DOM: the button container is not interactive.
    const pointerEvents = await google.evaluate(
      (el) => getComputedStyle(el.parentElement as HTMLElement).pointerEvents
    );
    expect(pointerEvents).toBe('none');
  });

  test('refuses a forced click that bypasses the pointer-events guard', async ({ page }) => {
    // A determined visitor can always dispatch a click, so the handler must
    // refuse too — the gate is not merely cosmetic.
    //
    // `dispatchEvent` rather than `click({ force: true })`: forcing only skips
    // Playwright's actionability checks, the event is still hit-tested by the
    // browser and `pointer-events: none` on the container swallows it. This
    // dispatches straight onto the element, which is the actual bypass.
    await page
      .getByRole('button', { name: /Sign up with Google|Log in with Google/ })
      .dispatchEvent('click');

    // The refusal is now an inline message rather than a browser `alert()`.
    await expect(page.getByTestId('auth-error')).toHaveText(/18 or older/i);

    // Still on the sign-in screen: no session was attempted.
    expect(new URL(page.url()).pathname).toBe('/auth');
  });

  test('offers Discord, branded and wired to the discord provider', async ({ page }) => {
    const discord = page.getByRole('button', { name: /Discord/ });
    await expect(discord).toBeVisible();

    // Discord blurple is #5865F2. Asserting the computed colour proves the brand
    // style is actually applied rather than merely present in a style object.
    await page.getByText('I confirm I am 18 years or older').click();
    await expect
      .poll(async () => discord.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe('rgb(88, 101, 242)');

    // And it launches the Discord provider, not a neighbour's.
    await discord.click();
    await expect.poll(() => page.url()).toContain('provider=discord');
  });

  test('renders an inline email form instead of a browser prompt', async ({ page }) => {
    // The email flow used `prompt()` and `alert()`; both are gone. The fields
    // sit directly below the Sign Up / Log In toggle.
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign up with email/i })).toBeVisible();

    // …and above the Google button it replaces.
    const emailTop = (await page.getByLabel('Email').boundingBox())?.y ?? 0;
    const googleTop =
      (await page.getByRole('button', { name: /Sign up with Google/ }).boundingBox())?.y ?? 0;
    expect(emailTop).toBeLessThan(googleTop);

    const toggleTop = (await page.getByRole('button', { name: 'Sign Up', exact: true }).boundingBox())?.y ?? 0;
    expect(toggleTop).toBeLessThan(emailTop);
  });

  test('validates the inline email form without a dialog', async ({ page }) => {
    let dialogOpened = false;
    page.on('dialog', (dialog) => {
      dialogOpened = true;
      void dialog.dismiss();
    });

    const submit = page.getByRole('button', { name: /sign up with email/i });

    // Age not confirmed.
    await page.getByLabel('Email').fill('sujata@example.com');
    await page.getByLabel('Password').fill('correct-horse');
    await submit.click();
    await expect(page.getByTestId('auth-error')).toHaveText(/18 or older/i);

    // Confirm age, then an invalid address.
    await page.getByText('I confirm I am 18 years or older').click();
    await page.getByLabel('Email').fill('not-an-email');
    await submit.click();
    await expect(page.getByTestId('auth-error')).toHaveText(/email address/i);

    // Then a too-short password.
    await page.getByLabel('Email').fill('sujata@example.com');
    await page.getByLabel('Password').fill('short');
    await submit.click();
    await expect(page.getByTestId('auth-error')).toHaveText(/at least 6 characters/i);

    // Nothing was ever a browser dialog.
    expect(dialogOpened, 'the email flow must not open a browser dialog').toBe(false);

    // And nothing was submitted: no auth request left the page.
    expect(new URL(page.url()).pathname).toBe('/auth');
  });

  test('unlocks the providers once age is confirmed, then reaches the provider', async ({
    page,
  }) => {
    await page.getByText('I confirm I am 18 years or older').click();

    const google = page.getByRole('button', { name: /Sign up with Google|Log in with Google/ });
    await expect
      .poll(async () =>
        google.evaluate((el) => getComputedStyle(el.parentElement as HTMLElement).pointerEvents)
      )
      .toBe('auto');

    await google.click();

    // `signInWithOAuth` navigates to /auth/v1/authorize, fulfilled locally.
    await expect.poll(() => page.url()).toContain('provider=google');
  });
});

test.describe('§3.3 — the onboarding wizard', () => {
  test('refuses a minor and submits an adult profile', async ({ page }) => {
    await signedIn(page);

    const stub = await stubSupabase(page, {
      // A brand-new account: no profiles row yet.
      tables: {
        profiles: [],
        interest_categories: [{ id: 'outdoors', label: 'Outdoors', icon: null, sort_order: 1 }],
        interests: [{ id: 'hiking', category_id: 'outdoors', label: 'Hiking', sort_order: 1 }],
        prompt_catalogue: [
          {
            id: 'simple-pleasures',
            category: 'about-me',
            question: 'The simple pleasures I enjoy are…',
            hint: 'Coffee at sunrise',
            sort_order: 1,
          },
        ],
      },
      rpc: {
        // The wizard prefills the date of birth through this owner-only RPC,
        // because `profiles.birth_date` is revoked for every role.
        my_birth_date: null,
      },
    });

    await page.goto('/profile/edit');
    await expect(page.getByText("Let's start with the basics")).toBeVisible();

    const next = page.getByRole('button', { name: 'Next →' });

    // --- step 1: a display name is required ---------------------------------
    await next.click();
    await expect(page.getByText(/provide a display name/i)).toBeVisible();

    await page.getByPlaceholder('Your name or nickname').fill('Sujata');
    await next.click();
    await expect(page.getByText('How do you identify?')).toBeVisible();

    // --- step 3: the age gate ----------------------------------------------
    await next.click(); // step 2 -> 3
    await expect(page.getByText('When is your birthday?')).toBeVisible();

    const dob = page.locator('input[type="date"]');
    await dob.fill('2015-01-01'); // 11 years old
    await next.click();

    // The wizard must refuse and stay on the step. It must NOT clamp the age.
    await expect(page.getByText(/for adults only/i)).toBeVisible();
    await expect(page.getByText('When is your birthday?')).toBeVisible();

    await dob.fill('1998-05-04'); // adult
    await next.click();
    await expect(page.getByText('Where are you based?')).toBeVisible();

    // --- walk the remaining steps ------------------------------------------
    // The step counter is read explicitly and `Next` is only accepted once it
    // has advanced. Checking visibility immediately after a click races the
    // React re-render, which silently skipped the interests step in an earlier
    // version of this test.
    const stepLabel = page.getByText(/Step \d+ of 15/);

    for (let guard = 0; guard < 20; guard += 1) {
      const label = (await stepLabel.textContent()) ?? '';
      const step = Number(/Step (\d+)/.exec(label)?.[1] ?? 0);

      // Step 9: interests come from the M8 catalogue and are stored as ids.
      // `exact` matters: the legacy hobby list also contains "Outdoors &
      // Hiking", which a substring match would collide with.
      if (step === 9) {
        await page.getByRole('button', { name: 'Hiking', exact: true }).click();
      }

      // Step 8: the prompt slot select only appears after "+ Add a prompt".
      if (step === 8) {
        await page.getByRole('button', { name: '+ Add a prompt' }).click();
        await page.locator('select').last().selectOption('simple-pleasures');
        await page
          .getByPlaceholder('Coffee at sunrise')
          .fill('Coffee at sunrise and a good playlist');
      }

      if (step >= 15) break;

      await next.click();
      await expect(stepLabel).not.toHaveText(label);
    }

    // --- submit -------------------------------------------------------------
    await page.getByRole('button', { name: /Complete & Launch/ }).click();

    await expect
      .poll(() => stub.writes.filter((write) => write.table === 'profiles').length)
      .toBeGreaterThan(0);

    const write = stub.writes.find((entry) => entry.table === 'profiles');
    const payload = write?.body as Record<string, unknown>;

    // The persisted age is an ADULT age derived from the date of birth, never a
    // clamped value, and onboarding is marked complete in the same upsert.
    expect(payload.age).toBeGreaterThanOrEqual(18);
    expect(payload.birth_date).toBe('1998-05-04');
    expect(payload.onboarding_completed).toBe(true);
    expect(payload.display_name).toBe('Sujata');
    // M8: the curated prompt answer travelled with the payload.
    expect(payload.prompts).toMatchObject({
      'simple-pleasures': 'Coffee at sunrise and a good playlist',
    });
    // M8: interests are stored as catalogue ids, not labels.
    expect(payload.interests).toContain('hiking');
  });
});

test.describe('§3.3 — discovery and blocking', () => {
  test('renders a candidate and removes them from the feed when blocked', async ({ page }) => {
    await signedIn(page);

    const stub = await stubSupabase(page, {
      tables: {
        // A plain object so the gatekeeper's single-row read is deterministic,
        // which is what gives the ranking engine a real intention to score on.
        profiles: { onboarding_completed: true, intention: 'dating', interests: [], prompts: {} },
        blocked_users: [],
      },
      rpc: {
        discover_profiles: [candidate({ display_name: 'Bo' })],
        block_member: {
          blocked: true,
          other_user_id: E2E_OTHER_USER_ID,
          matches_removed: 0,
        },
      },
    });

    await page.goto('/discover');

    // The mocked candidate is rendered from the `discover_profiles` RPC.
    await expect(page.getByText('Bo')).toBeVisible();

    // Open the card menu (the button carrying the three-dot SVG) and block.
    await page.locator('button:has(svg circle)').first().click();
    await page.getByRole('button', { name: 'Block' }).click();

    // The block is dispatched fire-and-forget (`void handleBlock(profile)`), so
    // the click resolves before the RPC is sent. Poll rather than assert once.
    await expect
      .poll(() => stub.writes.some((write) => write.table === 'rpc/block_member'))
      .toBe(true);

    // ...and the member is gone from the feed.
    await expect(page.getByText('Bo')).toHaveCount(0);
  });
});
