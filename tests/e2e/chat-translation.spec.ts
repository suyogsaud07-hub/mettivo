import { expect, test } from '@playwright/test';
import { E2E_OTHER_USER_ID, E2E_USER_ID, signedIn, stubSupabase } from './fixtures';

/**
 * On-demand chat translation.
 *
 * The behaviour that matters, and that a unit test cannot prove:
 *
 *   1. NOTHING is translated until the member taps the control. This is the
 *      whole point of the feature — auto-translating a thread would spend the
 *      provider's quota on every message a member scrolls past, and would
 *      replace the sender's own words before the member chose to read them.
 *   2. A tap reveals the translation beneath the ORIGINAL text, in place, with
 *      no page reload.
 *   3. A second tap collapses it without a second upstream request.
 *   4. Only incoming messages offer it — translating your own words is noise.
 *   5. A provider failure surfaces an inline message, not a dead control.
 *
 * The `/api/translate` route is intercepted here. That endpoint talks to a paid
 * provider, and a browser journey must never make a real, billable call — the
 * same principle that keeps this suite off the production Supabase project.
 */

const MATCH_ID = 'match-translate-1';
const OTHER_MESSAGE = 'Hola, ¿cómo estás?';
const OWN_MESSAGE = 'I am well, thank you.';

const MESSAGES = [
  {
    id: 'msg-1',
    match_id: MATCH_ID,
    sender_id: E2E_OTHER_USER_ID,
    content: OTHER_MESSAGE,
    created_at: '2026-10-15T10:00:00.000Z',
  },
  {
    id: 'msg-2',
    match_id: MATCH_ID,
    sender_id: E2E_USER_ID,
    content: OWN_MESSAGE,
    created_at: '2026-10-15T10:01:00.000Z',
  },
];

interface TranslateCall {
  text: string;
  targetLanguage: string;
}

/**
 * Intercepts the translation endpoint and records every call, so a journey can
 * assert how many upstream requests the UI actually caused.
 */
async function stubTranslate(
  page: import('@playwright/test').Page,
  options: { translatedText?: string; status?: number; body?: unknown } = {}
): Promise<{ calls: TranslateCall[] }> {
  const calls: TranslateCall[] = [];

  await page.route('**/api/translate', async (route) => {
    try {
      const parsed = route.request().postDataJSON() as TranslateCall;
      calls.push(parsed);
    } catch {
      calls.push({ text: '', targetLanguage: '' });
    }

    if (options.status && options.status >= 400) {
      return route.fulfill({
        status: options.status,
        contentType: 'application/json',
        body: JSON.stringify(options.body ?? { error: 'upstream_error', message: 'Translation is unavailable right now.' }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        options.body ?? {
          translatedText: options.translatedText ?? 'Hello, how are you?',
          provider: 'deepl',
        }
      ),
    });
  });

  return { calls };
}

test.describe('§3.3 — on-demand chat translation', () => {
  test.beforeEach(async ({ page }) => {
    await signedIn(page);
  });

  test('translates nothing until the member asks', async ({ page }) => {
    await stubSupabase(page, { tables: { messages: MESSAGES, user_preferences: [] } });
    const { calls } = await stubTranslate(page);

    await page.goto(`/chat/${MATCH_ID}`);

    // Both messages are on screen…
    await expect(page.getByText(OTHER_MESSAGE)).toBeVisible();
    await expect(page.getByText(OWN_MESSAGE)).toBeVisible();

    // …and no translation has been requested. Give a stray effect time to fire.
    await page.waitForTimeout(1000);
    expect(calls, 'messages must not be translated until the member taps').toHaveLength(0);
    await expect(page.getByTestId('translated-content')).toHaveCount(0);
  });

  test('offers the control on incoming messages only', async ({ page }) => {
    await stubSupabase(page, { tables: { messages: MESSAGES, user_preferences: [] } });
    await stubTranslate(page);

    await page.goto(`/chat/${MATCH_ID}`);

    await expect(page.getByTestId('translate-button-other')).toHaveCount(1);
    // Translating your own words is noise.
    await expect(page.getByTestId('translate-button-own')).toHaveCount(0);
  });

  test('a tap reveals the translation below the original, in place', async ({ page }) => {
    await stubSupabase(page, { tables: { messages: MESSAGES, user_preferences: [] } });
    const { calls } = await stubTranslate(page, { translatedText: 'Hello, how are you?' });

    await page.goto(`/chat/${MATCH_ID}`);
    const pathBefore = new URL(page.url()).pathname;

    await page.getByTestId('translate-button-other').click();

    const translated = page.getByTestId('translated-content');
    await expect(translated).toBeVisible();
    await expect(translated).toContainText('Hello, how are you?');

    // The ORIGINAL is still there — the translation is an addition, not a swap.
    await expect(page.getByText(OTHER_MESSAGE)).toBeVisible();

    // It landed beneath the original, which is the layout the brief asks for.
    const originalBox = await page.getByText(OTHER_MESSAGE).boundingBox();
    const translatedBox = await translated.boundingBox();
    expect(translatedBox?.y ?? 0).toBeGreaterThan(originalBox?.y ?? 0);

    // Exactly one upstream request, and it carried the message + target.
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toBe(OTHER_MESSAGE);
    expect(calls[0].targetLanguage).toBe('en');

    // No navigation: the translation is React state, not a page load.
    expect(new URL(page.url()).pathname).toBe(pathBefore);
  });

  test('a second tap collapses it without another request', async ({ page }) => {
    await stubSupabase(page, { tables: { messages: MESSAGES, user_preferences: [] } });
    const { calls } = await stubTranslate(page);

    await page.goto(`/chat/${MATCH_ID}`);
    const button = page.getByTestId('translate-button-other');

    await button.click();
    await expect(page.getByTestId('translated-content')).toBeVisible();

    await button.click();
    await expect(page.getByTestId('translated-content')).toHaveCount(0);
    expect(calls, 'collapsing must not re-fetch').toHaveLength(1);

    // And the cached translation comes back without a third call.
    await button.click();
    await expect(page.getByTestId('translated-content')).toBeVisible();
    expect(calls).toHaveLength(1);
  });

  test('uses the member\'s stored preference as the target language', async ({ page }) => {
    await stubSupabase(page, {
      tables: {
        messages: MESSAGES,
        // The member reads chat in Spanish.
        user_preferences: { preferred_translation_language: 'es' },
      },
    });
    const { calls } = await stubTranslate(page, { translatedText: 'Hola, ¿cómo estás?' });

    await page.goto(`/chat/${MATCH_ID}`);
    await page.getByTestId('translate-button-other').click();

    await expect(page.getByTestId('translated-content')).toBeVisible();
    await expect(page.getByTestId('translated-content')).toHaveAttribute('data-target-language', 'es');
    expect(calls[0].targetLanguage).toBe('es');
  });

  test('a provider failure is reported inline and stays retryable', async ({ page }) => {
    await stubSupabase(page, { tables: { messages: MESSAGES, user_preferences: [] } });
    const { calls } = await stubTranslate(page, {
      status: 503,
      body: { error: 'upstream_quota', message: 'Translation is busy. Please try again in a moment.' },
    });

    await page.goto(`/chat/${MATCH_ID}`);
    const button = page.getByTestId('translate-button-other');

    await button.click();

    // The provider's own user-safe message, inline — not an alert().
    await expect(page.getByTestId('translate-error')).toHaveText(/translation is busy/i);
    await expect(page.getByTestId('translated-content')).toHaveCount(0);

    // Retryable: the control is enabled again after the failure.
    await expect(button).toBeEnabled();
    expect(calls).toHaveLength(1);
  });
});
