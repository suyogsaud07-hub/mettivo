import { expect, test } from '@playwright/test';
import { E2E_OTHER_USER_ID, candidate, signedIn, stubSupabase } from './fixtures';

const counts = [
  { category_id: 'dating-goals', goal_key: null, profile_count: 3 },
  { category_id: 'coffee-food', goal_key: null, profile_count: 1 },
  { category_id: 'nature-adventure', goal_key: null, profile_count: 0 },
  { category_id: 'gamers-entertainment', goal_key: null, profile_count: 0 },
  { category_id: 'pet-lovers', goal_key: null, profile_count: 0 },
  { category_id: 'travel-partners', goal_key: null, profile_count: 0 },
  { category_id: 'new-friends', goal_key: null, profile_count: 0 },
  { category_id: 'dating-goals', goal_key: 'friendship', profile_count: 1 },
  { category_id: 'dating-goals', goal_key: 'serious', profile_count: 1 },
  { category_id: 'dating-goals', goal_key: 'casual', profile_count: 1 },
];

const feedRow = {
  ...candidate({ id: E2E_OTHER_USER_ID, display_name: 'Bo Brown', interests: ['coffee'] }),
  match_score: 42,
  category_hits: 2,
};

test.describe('Explore More', () => {
  test.beforeEach(async ({ page }) => {
    await signedIn(page);
  });

  test('loads real counts and opens a working category feed', async ({ page }) => {
    const stub = await stubSupabase(page, {
      tables: { profiles: { onboarding_completed: true } },
      rpc: {
        explore_more_counts: counts,
        explore_more_feed: [feedRow],
      },
    });

    await page.goto('/explore-more');

    await expect(
      page.getByRole('heading', { name: 'Find people through what matters to them.' })
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /Coffee & Food Dates, 1 person/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Pet Lovers, 0 people/ })).toBeVisible();

    await page.getByRole('link', { name: /Coffee & Food Dates, 1 person/ }).click();

    await expect.poll(() => new URL(page.url()).pathname).toBe('/explore-more/coffee-food');
    await expect(page.getByText('Bo Brown')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Like Bo Brown' })).toBeVisible();

    expect(
      stub.writes.some(
        (write) =>
          write.table === 'rpc/explore_more_feed' &&
          (write.body as { p_category_id?: string } | null)?.p_category_id === 'coffee-food'
      )
    ).toBe(true);
  });

  test('a failed count request shows an error and the retry repeats it', async ({ page }) => {
    await stubSupabase(page, {
      tables: { profiles: { onboarding_completed: true } },
      rpc: { explore_more_counts: counts },
    });

    let attempts = 0;
    await page.route('**/rest/v1/rpc/explore_more_counts', async (route) => {
      attempts += 1;
      if (attempts === 1) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'database unavailable' }),
        });
      }
      return route.fallback();
    });

    await page.goto('/explore-more');

    await expect(page.getByRole('heading', { name: 'Explore More is unavailable' })).toBeVisible();
    await page.getByRole('button', { name: 'Try again' }).click();

    await expect(
      page.getByRole('heading', { name: 'Find people through what matters to them.' })
    ).toBeVisible();
    expect(attempts).toBeGreaterThanOrEqual(2);
  });
});
