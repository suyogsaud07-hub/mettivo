import { expect, test, type Page } from '@playwright/test';
import {
  E2E_OTHER_USER_ID,
  candidate,
  signedIn,
  stubBrowserMedia,
  stubSupabase,
  stubVerification,
} from './fixtures';

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
    await page.getByTestId('age-gate').click();
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
    await page.getByTestId('age-gate').click();
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
    await page.getByTestId('age-gate').click();

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

/** A real (tiny) PNG, so the wizard's FileReader produces a usable data URL. */
const PNG_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * Four DISTINCT gallery images.
 *
 * `PhotoVerificationStep` rejects duplicates by data-URL identity, so reusing one
 * buffer four times would drop three photos. Each append makes the byte stream —
 * and therefore the data URL — unique; the gallery stage never decodes them, it
 * only forwards them to the (stubbed) verifier.
 */
const GALLERY_PNGS = [1, 2, 3, 4].map((n) => Buffer.concat([PNG_PIXEL, Buffer.from([n])]));

/**
 * Drives the mandatory face + voice check to a pass.
 *
 * `stubBrowserMedia` supplies the camera/analyser/recorder and `stubVerification`
 * the route verdicts, so this exercises the real modal wiring — phase
 * transitions, the busy states and the `onVerified` hand-off — without a device.
 */
async function verifyFaceAndVoice(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Verify my face & voice' }).click();

  const dialog = page.getByRole('dialog', { name: 'Face and voice verification' });
  await expect(dialog).toBeVisible();

  await page.getByRole('button', { name: 'Capture & verify face' }).click();
  await page.getByRole('button', { name: 'Record phrase' }).click();

  // The analyser reports a steady 200 Hz tone, which is what proves a sample was
  // actually collected before stopping (an empty sample set would be rejected).
  await expect(page.getByText(/Listening/)).toBeVisible();
  await expect(page.getByText(/Hz/)).toBeVisible();

  await page.getByRole('button', { name: 'Stop & submit' }).click();
  await expect(dialog).toHaveCount(0);
}

/** The wizard starts on step 1 and reports its position in this exact format. */
const STEP_LABEL = /Step (\d+) of 15/;

/**
 * Satisfies whichever requirement the current step enforces.
 *
 * The wizard's own rule is the contract: "Next →" is disabled until the step is
 * valid, and `validateOnboardingStep` refuses a programmatic click. So this
 * helper supplies valid input for the step it is pointed at, and the journey
 * fails loudly (the label never advances) if a requirement is missed — which is
 * exactly the regression we want to catch.
 */
async function completeStep(page: Page, step: number): Promise<void> {
  const next = page.getByRole('button', { name: 'Next →' });

  if (step === 1) {
    // M24: step 1 is the display name ONLY. Photos moved to the final step and
    // now require AI authenticity verification, so the name is the sole gate.
    await page.getByPlaceholder('Your name or nickname').fill('Sujata');
  }

  if (step === 2) {
    await page.getByRole('button', { name: 'Woman', exact: true }).click();
  }

  if (step === 3) {
    await page.locator('input[type="date"]').fill('1998-05-04');
  }

  if (step === 4) {
    // Country and city are both mandatory; the dropdown must not auto-continue.
    await expect(next).toBeDisabled();
    await page.locator('select').first().selectOption('Nepal');
    await page.getByPlaceholder('e.g. Kathmandu, San Francisco').fill('Kathmandu');
  }

  if (step === 5) {
    await page.getByPlaceholder('e.g. 175 cm').fill('170 cm');
  }

  if (step === 6) {
    await page.getByRole('button', { name: 'Long-term Relationship / Dating' }).click();
  }

  if (step === 7) {
    await page.getByRole('button', { name: 'Women', exact: true }).click();
  }

  if (step === 8) {
    await page.getByRole('button', { name: 'INFJ', exact: true }).click();
    await page.getByRole('button', { name: '+ Add a prompt' }).click();
    await page.locator('select').last().selectOption('simple-pleasures');
    await page
      .getByPlaceholder('Coffee at sunrise')
      .fill('Coffee at sunrise and a good playlist');
  }

  if (step === 9) {
    // Curated interests come from the M8 catalogue; `exact` matters because the
    // legacy hobby list also contains "Outdoors & Hiking".
    await page.getByRole('button', { name: 'Hiking', exact: true }).click();
  }

  if (step === 10) {
    await page.getByRole('button', { name: 'Dog lover', exact: true }).click();
  }

  if (step === 11) {
    await page.locator('select').nth(0).selectOption('Non-smoker');
    await page.locator('select').nth(1).selectOption('Social drinker');
    await page.locator('select').nth(2).selectOption('A few times a week');
  }

  if (step === 12) {
    await page
      .getByPlaceholder("e.g. Bachelor's Degree, Master's, High School")
      .fill("Bachelor's Degree");
    await page.getByPlaceholder('e.g. Software Engineer, Designer, Student').fill('Engineer');
  }

  if (step === 13) {
    await page.getByRole('button', { name: 'English', exact: true }).click();
  }

  if (step === 14) {
    await page
      .getByPlaceholder(/Tell others what makes you unique/)
      .fill('Coffee, mountains and long conversations.');
  }
}

test.describe('§3.3 — the onboarding wizard', () => {
  test('blocks every incomplete step, then submits a complete adult profile', async ({ page }) => {
    await signedIn(page);
    await stubVerification(page);
    await stubBrowserMedia(page);

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
    const stepLabel = page.getByText(STEP_LABEL);

    // --- step 1: the display name is the only requirement now -----------------
    await expect(next).toBeDisabled();

    await page.getByPlaceholder('Your name or nickname').fill('Sujata');
    await expect(next).toBeEnabled();
    await next.click();
    await expect(stepLabel).toHaveText('Step 2 of 15');

    // --- step 2: identity is mandatory, and so is the live face/voice check ---
    await expect(next).toBeDisabled();
    await page.getByRole('button', { name: 'Woman', exact: true }).click();
    // A gender alone is not enough: the step refuses to advance unverified.
    await expect(next).toBeDisabled();

    await verifyFaceAndVoice(page);
    await expect(next).toBeEnabled();
    await next.click();
    await expect(stepLabel).toHaveText('Step 3 of 15');

    // --- step 3: the age gate ---
    await expect(page.getByText('When is your birthday?')).toBeVisible();
    await expect(next).toBeDisabled();

    const dob = page.locator('input[type="date"]');
    await dob.fill('2015-01-01'); // 11 years old
    await expect(next).toBeDisabled();
    await expect(page.getByText(/for adults only/i)).toBeVisible();
    await expect(page.getByText('When is your birthday?')).toBeVisible();

    await dob.fill('1998-05-04'); // adult
    await next.click();
    await expect(page.getByText('Where are you based?')).toBeVisible();

    // --- step 4: country and city are mandatory, and the dropdown must not
    // auto-continue on its own ---
    await expect(next).toBeDisabled();
    await page.locator('select').first().selectOption('Nepal');
    await expect(next).toBeDisabled(); // city still missing
    await page.getByPlaceholder('e.g. Kathmandu, San Francisco').fill('Kathmandu');
    await next.click();
    await expect(stepLabel).toHaveText('Step 5 of 15');

    // --- steps 5..14: each one blocks until it has valid input ---
    for (let step = 5; step <= 14; step += 1) {
      await expect(stepLabel).toHaveText(`Step ${step} of 15`);
      // Every step must refuse to advance while it is blank. Step 5 is the one
      // exception in the contract: it has no blocking field beyond height.
      await expect(next).toBeDisabled();

      await completeStep(page, step);
      await next.click();
      await expect(stepLabel).toHaveText(`Step ${step + 1} of 15`);
    }

    // --- step 15: photos must be uploaded AND verified before submit --------
    await expect(page.getByText('Verify your photos & finish')).toBeVisible();
    const submit = page.getByRole('button', { name: /Complete & Launch/ });
    await expect(submit).toBeDisabled();

    // Profile picture: pick → crop → save. The cropper decodes the real PNG, so
    // this also proves the "Save picture" path produces a usable data URL.
    await page.locator('input[type="file"]').nth(0).setInputFiles({
      name: 'avatar.png',
      mimeType: 'image/png',
      buffer: PNG_PIXEL,
    });
    await page.getByRole('button', { name: 'Save picture' }).click();
    await expect(page.getByText('Verified ✓')).toBeVisible();

    // Gallery: exactly four DISTINCT photos, each forwarded to the verifier.
    await page
      .locator('input[type="file"]')
      .nth(1)
      .setInputFiles(
        GALLERY_PNGS.map((buffer, index) => ({
          name: `gallery-${index}.png`,
          mimeType: 'image/png',
          buffer,
        }))
      );
    await expect(page.getByText('All four verified ✓')).toBeVisible();
    await expect(submit).toBeEnabled();

    await submit.click();

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

    // The mandatory four photos travelled with the payload — the step guard
    // blocked on them, so they cannot be missing here.
    expect(Array.isArray(payload.photos)).toBe(true);
    expect(payload.photos).toHaveLength(4);

    // Government of the mandatory identity + location fields.
    expect(payload.gender).toBe('Woman');
    expect(payload.country).toBe('Nepal');
    expect(payload.city).toBe('Kathmandu');

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
