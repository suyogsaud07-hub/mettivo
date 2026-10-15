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
    // A determined visitor can always dispatch a click. The handler must still
    // refuse, so the gate is not merely cosmetic.
    const dialogPromise = page.waitForEvent('dialog');

    // Deliberately NOT awaited: the handler calls `alert()`, which blocks the
    // renderer, so awaiting the dispatch would deadlock against the dialog that
    // is waiting to be dismissed.
    void page
      .getByRole('button', { name: /Sign up with Google|Log in with Google/ })
      .dispatchEvent('click');

    const dialog = await dialogPromise;
    expect(dialog.message()).toMatch(/18 or older/i);
    await dialog.dismiss();

    // Still on the sign-in screen: no session was attempted.
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
