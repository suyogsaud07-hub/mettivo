import { expect, test } from '@playwright/test';
import { stubSupabase } from './fixtures';

/**
 * `/auth` and `/signup` are one surface.
 *
 * They used to be two near-identical copies, which had already drifted: `/auth`
 * had the inline email form while `/signup` still called `prompt()` and
 * `alert()`. Both routes now render `AuthPanel`, and these journeys pin the
 * three things the refactor must not lose on EITHER route:
 *
 *   1. the inline email form (below the toggle, above the social buttons),
 *   2. no browser dialog anywhere in the flow,
 *   3. the Midnight Romance palette, asserted as computed colour so a token that
 *      silently fails to resolve — leaving `transparent` — fails the suite.
 *
 * `Midnight Romance` is the palette named in `src/app/globals.css`.
 */

const ROUTES = ['/auth', '/signup'] as const;

for (const route of ROUTES) {
  test.describe(`§3.3 — ${route} (Midnight Romance)`, () => {
    test.beforeEach(async ({ page }) => {
      await stubSupabase(page, { user: null });
      await page.goto(route);
    });

    test('renders the inline email form, below the toggle and above the providers', async ({
      page,
    }) => {
      await expect(page.getByLabel('Email')).toBeVisible();
      await expect(page.getByLabel('Password')).toBeVisible();
      await expect(page.getByRole('button', { name: /sign up with email/i })).toBeVisible();

      const toggleTop =
        (await page.getByRole('button', { name: 'Sign Up', exact: true }).boundingBox())?.y ?? 0;
      const emailTop = (await page.getByLabel('Email').boundingBox())?.y ?? 0;
      const discordTop =
        (await page.getByRole('button', { name: /Discord/ }).boundingBox())?.y ?? 0;

      expect(toggleTop).toBeLessThan(emailTop);
      expect(emailTop).toBeLessThan(discordTop);
    });

    test('opens no browser dialog, even when the form is submitted unconfirmed', async ({
      page,
    }) => {
      const dialogs: string[] = [];
      page.on('dialog', (dialog) => {
        dialogs.push(dialog.message());
        void dialog.dismiss();
      });

      await page.getByLabel('Email').fill('sujata@example.com');
      await page.getByLabel('Password').fill('correct-horse');
      await page.getByRole('button', { name: /sign up with email/i }).click();

      // The 18+ refusal is inline, not a popup.
      await expect(page.getByTestId('auth-error')).toHaveText(/18 or older/i);

      await page.getByTestId('age-gate').click();
      await page.getByRole('button', { name: /sign up with email/i }).click();

      // With a valid address and password the request leaves the page, but the
      // stub has no session to hand back, so we stay put — still no dialog.
      expect(dialogs, `dialogs opened: ${dialogs.join(' | ')}`).toHaveLength(0);
    });

    test('applies the Midnight Romance palette as real computed colours', async ({ page }) => {
      const rgb = (hex: string): string => {
        const value = hex.replace('#', '');
        const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
        return `rgb(${channels.join(', ')})`;
      };

      const panel = page.getByTestId('age-gate');

      // Deep dark plum page, dark eggplant panel, warm sandy gold action,
      // soft lavender text — every one via a `--mr-*` token.
      await expect
        .poll(async () => panel.evaluate((el) => getComputedStyle(el).backgroundColor))
        .toBe(rgb('#211a28'));

      const submit = page.getByRole('button', { name: /sign up with email/i });
      await expect
        .poll(async () => submit.evaluate((el) => getComputedStyle(el).backgroundColor))
        .toBe(rgb('#d8b38a'));
      await expect
        .poll(async () => submit.evaluate((el) => getComputedStyle(el).color))
        .toBe(rgb('#1a130c'));

      const activeTab = page.getByRole('button', { name: 'Sign Up', exact: true });
      await expect
        .poll(async () => activeTab.evaluate((el) => getComputedStyle(el).backgroundColor))
        .toBe(rgb('#d8b38a'));

      const emailInput = page.getByLabel('Email');
      await expect
        .poll(async () => emailInput.evaluate((el) => getComputedStyle(el).backgroundColor))
        .toBe(rgb('#251d2d'));
      await expect
        .poll(async () => emailInput.evaluate((el) => getComputedStyle(el).borderTopColor))
        .toBe(rgb('#3e314b'));

      const heading = page.getByRole('heading', { name: 'Create account' });
      await expect
        .poll(async () => heading.evaluate((el) => getComputedStyle(el).color))
        .toBe(rgb('#eae2f0'));
    });

    test('offers Discord in brand blurple, wired to the discord provider', async ({ page }) => {
      const discord = page.getByRole('button', { name: /Discord/ });
      await expect(discord).toBeVisible();

      await page.getByTestId('age-gate').click();

      const background = async (): Promise<string> =>
        discord.evaluate((el) => getComputedStyle(el).backgroundColor);

      // Rest state: Discord blurple, #5865F2.
      await page.mouse.move(0, 0);
      await expect.poll(background).toBe('rgb(88, 101, 242)');

      // Hover keeps the brand hue and deepens it, #4752C4.
      await discord.hover();
      await expect.poll(background).toBe('rgb(71, 82, 196)');

      // …and releasing the pointer returns the button to rest.
      await page.mouse.move(0, 0);
      await expect.poll(background).toBe('rgb(88, 101, 242)');

      await discord.click();
      await expect.poll(() => page.url()).toContain('provider=discord');
    });
  });
}

test.describe('§3.3 — /auth and /signup are the same component', () => {
  test('both routes render identical DOM for the shared panel', async ({ page }) => {
    await stubSupabase(page, { user: null });

    const markers = async (route: string): Promise<string> => {
      await page.goto(route);
      return (
        await page
          .locator('form, [data-testid="age-gate"], h1')
          .evaluateAll((nodes) => nodes.map((node) => node.outerHTML).join('\n'))
      );
    };

    const auth = await markers('/auth');
    const signup = await markers('/signup');

    expect(signup).toBe(auth);
  });
});
