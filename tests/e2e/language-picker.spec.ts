import { expect, test } from '@playwright/test';
import { stubSupabase } from './fixtures';

/**
 * The global language picker must be FUNCTIONAL, not decorative.
 *
 * That is the whole risk with a 50-language dropdown: it can look global while
 * every selection silently renders English. These journeys therefore assert the
 * three things that distinguish a working picker from a screenshot of one:
 *
 *   1. a language outside the original five is selectable at all;
 *   2. choosing it CHANGES the rendered UI copy (not just the trigger label);
 *   3. the choice survives a reload, and search narrows the list.
 */

/** The landing page's English copy, used as the "before" state. */
const ENGLISH_SUBTITLE = 'Meet your kind of people.';

test.describe('§3.3 — the global language picker', () => {
  test.beforeEach(async ({ page }) => {
    await stubSupabase(page, { user: null });
    await page.goto('/');
  });

  test('offers far more than the original five languages', async ({ page }) => {
    await page.getByTestId('language-trigger').click();
    const list = page.getByTestId('language-list');
    await expect(list).toBeVisible();

    // The languages the brief names by hand must all be present.
    for (const code of ['ja', 'de', 'pt', 'ar', 'zh', 'ko', 'it', 'ru', 'ne', 'hi']) {
      await expect(page.getByTestId(`language-option-${code}`)).toHaveCount(1);
    }

    // And the list is genuinely large, not a token handful.
    const rows = await list.getByRole('option').count();
    expect(rows).toBeGreaterThan(30);
  });

  test('search narrows the list by English name, native name and alias', async ({ page }) => {
    await page.getByTestId('language-trigger').click();
    const search = page.getByTestId('language-search');

    await search.fill('japan');
    await expect(page.getByTestId('language-option-ja')).toBeVisible();
    await expect(page.getByTestId('language-option-de')).toHaveCount(0);

    // The native name is searchable too.
    await search.fill('日本語');
    await expect(page.getByTestId('language-option-ja')).toBeVisible();

    // …and the word the brief uses for Chinese.
    await search.fill('mandarin');
    await expect(page.getByTestId('language-option-zh')).toBeVisible();
  });

  test('reports when nothing matches instead of showing an empty box', async ({ page }) => {
    await page.getByTestId('language-trigger').click();
    await page.getByTestId('language-search').fill('zzzzz');
    await expect(page.getByTestId('language-empty')).toBeVisible();
    await expect(page.getByTestId('language-list').getByRole('option')).toHaveCount(0);
  });

  test('selecting a language actually changes the rendered UI', async ({ page }) => {
    // Before: English copy.
    await expect(page.getByText(ENGLISH_SUBTITLE)).toBeVisible();

    await page.getByTestId('language-trigger').click();
    await page.getByTestId('language-search').fill('japan');
    await page.getByTestId('language-option-ja').click();

    // The panel closed, the trigger shows the endonym…
    await expect(page.getByTestId('language-panel')).toHaveCount(0);
    await expect(page.getByTestId('language-trigger-label')).toHaveText('日本語');

    // …and the page copy itself is translated, not just the label. This is the
    // assertion that fails if the picker is a decoration backed by English.
    await expect(page.getByText(ENGLISH_SUBTITLE)).toHaveCount(0);
    await expect(page.getByText('あなたのような人に会いましょう。')).toBeVisible();
  });

  test('remembers the choice across a reload, and is keyboard operable', async ({ page }) => {
    // Keyboard: open with Enter on the trigger, then arrow + Enter.
    await page.getByTestId('language-trigger').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('language-list')).toBeVisible();

    await page.getByTestId('language-search').fill('deutsch');
    await expect(page.getByTestId('language-option-de')).toBeVisible();
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('language-trigger-label')).toHaveText('Deutsch');

    // The preference is persisted, so a reload keeps it.
    await page.reload();
    await expect(page.getByTestId('language-trigger-label')).toHaveText('Deutsch');
    await expect(page.getByText('Treffen Sie Ihre Art von Leuten.')).toBeVisible();
  });

  test('Escape closes the panel without changing the language', async ({ page }) => {
    const trigger = page.getByTestId('language-trigger');
    await trigger.click();
    await page.getByTestId('language-search').fill('french');
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('language-panel')).toHaveCount(0);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText(ENGLISH_SUBTITLE)).toBeVisible();
  });
});
