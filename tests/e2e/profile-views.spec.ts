import { expect, test } from '@playwright/test';
import { E2E_OTHER_USER_ID, signedIn, stubSupabase } from './fixtures';

const otherProfile = {
  id: E2E_OTHER_USER_ID,
  first_name: 'Bo',
  last_name: 'Brown',
  has_last_name: true,
  username: 'bo_brown',
  display_name: 'Bo Brown',
  age: 30,
  gender: 'Man',
  city: 'Pokhara',
  country: 'Nepal',
  avatar_url: null,
  photos: [],
  bio: 'Hello',
  intention: 'dating',
  looking_for: ['Women'],
  hobbies: [],
  pets: [],
  mbti: 'ENFP',
  religion: null,
  drinking: null,
  smoking: null,
  interests: [],
  prompts: {},
  is_online: false,
  is_verified: false,
  onboarding_completed: true,
  followers_count: 0,
  following_count: 0,
  matches_count: 0,
  profile_likes_count: 2,
};

const summary = {
  unique_viewers: 3,
  returning_viewers: 1,
  total_visits: 7,
  most_recent_at: '2026-10-20T10:00:00.000Z',
};

const viewer = {
  viewer_id: E2E_OTHER_USER_ID,
  first_name: 'Bo',
  last_name: 'Brown',
  has_last_name: true,
  username: 'bo_brown',
  display_name: 'Bo Brown',
  avatar_url: null,
  is_online: false,
  first_viewed_at: '2026-10-01T09:00:00.000Z',
  last_viewed_at: '2026-10-20T09:00:00.000Z',
  view_count: 3,
  is_followed_by_me: false,
};

test.describe('profile view analytics', () => {
  test.beforeEach(async ({ page }) => {
    await signedIn(page);
  });

  test('shows unique, returning and repeat-visit stats with the viewer list', async ({
    page,
  }) => {
    await stubSupabase(page, {
      rpc: {
        profile_view_summary: summary,
        list_profile_viewers: [viewer],
      },
    });

    await page.goto('/profile/stats/views');

    await expect(
      page.getByRole('heading', { name: 'Who is looking at your profile' })
    ).toBeVisible();
    await expect(page.getByText('Unique viewers', { exact: true })).toBeVisible();
    await expect(page.getByText('Returning', { exact: true })).toBeVisible();
    await expect(page.getByText('Total visits', { exact: true })).toBeVisible();
    await expect(page.getByText('Bo Brown')).toBeVisible();
    await expect(page.getByText('@bo_brown')).toBeVisible();
    await expect(page.getByText('Returning · 3 visits')).toBeVisible();
    await expect(page.locator('.pf-views-online')).toHaveCount(0);
    await expect(page.getByRole('link', { name: "Open Bo Brown's profile" })).toBeVisible();
  });

  test('renders the empty state without inventing viewers', async ({ page }) => {
    await stubSupabase(page, {
      rpc: {
        profile_view_summary: {
          unique_viewers: 0,
          returning_viewers: 0,
          total_visits: 0,
          most_recent_at: null,
        },
        list_profile_viewers: [],
      },
    });

    await page.goto('/profile/stats/views');

    await expect(page.getByText('No profile views yet')).toBeVisible();
    await expect(page.getByText(/visits never count/)).toBeVisible();
    await expect(page.locator('.pf-views-row')).toHaveCount(0);
  });

  test('debounces and sends the trimmed search term to the RPC', async ({ page }) => {
    const stub = await stubSupabase(page, {
      rpc: {
        profile_view_summary: summary,
        list_profile_viewers: [viewer],
      },
    });

    await page.goto('/profile/stats/views');
    await expect(page.getByText('Bo Brown')).toBeVisible();

    await page.getByLabel('Search profile viewers').fill('  bo  ');

    await expect
      .poll(() =>
        stub.writes.some(
          (write) =>
            write.table === 'rpc/list_profile_viewers' &&
            (write.body as { p_search?: string } | null)?.p_search === 'bo'
        )
      )
      .toBe(true);
  });

  test('records a genuine visit on another profile and shows its count', async ({ page }) => {
    const stub = await stubSupabase(page, {
      tables: {
        public_profiles: otherProfile,
        follows: [],
        likes: [],
        matches: [],
        moment_feed: [],
      },
      rpc: {
        record_profile_view: {
          recorded: true,
          is_new_viewer: true,
          unique_viewers: 4,
          total_visits: 9,
          viewer_visits: 1,
        },
        profile_view_count: 4,
      },
    });

    await page.goto(`/profile/${E2E_OTHER_USER_ID}`);

    await expect(page.getByRole('button', { name: 'Like Profile' })).toBeVisible();
    await expect(page.locator('.pf-views-meta[aria-label="4 profile views"]')).toBeVisible();
    await expect
      .poll(() =>
        stub.writes.some(
          (write) =>
            write.table === 'rpc/record_profile_view' &&
            (write.body as { p_viewed_id?: string } | null)?.p_viewed_id === E2E_OTHER_USER_ID
        )
      )
      .toBe(true);
  });

  test('likes another profile through the existing like RPC', async ({ page }) => {
    const stub = await stubSupabase(page, {
      tables: {
        public_profiles: otherProfile,
        follows: [],
        likes: [],
        matches: [],
        moment_feed: [],
      },
      rpc: {
        record_profile_view: {
          recorded: true,
          is_new_viewer: true,
          unique_viewers: 4,
          total_visits: 9,
          viewer_visits: 1,
        },
        profile_view_count: 4,
        record_like: { liked: true, matched: false, match_id: null, matched_user_id: null },
      },
    });

    await page.goto(`/profile/${E2E_OTHER_USER_ID}`);
    await page.getByRole('button', { name: 'Like Profile' }).click();

    await expect(page.getByRole('button', { name: 'Liked' })).toBeVisible();
    expect(
      stub.writes.some(
        (write) =>
          write.table === 'rpc/record_like' &&
          (write.body as { target_user?: string; is_like_value?: boolean } | null)
            ?.target_user === E2E_OTHER_USER_ID &&
          (write.body as { is_like_value?: boolean } | null)?.is_like_value === true
      )
    ).toBe(true);
  });

  test('surfaces a load failure with a retry instead of a blank page', async ({ page }) => {
    await stubSupabase(page, {
      rpc: { list_profile_viewers: [] },
    });
    // Registered last so it takes precedence over the catch-all stub.
    await page.route('**/rest/v1/rpc/profile_view_summary', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'database unavailable' }),
      })
    );

    await page.goto('/profile/stats/views');

    await expect(page.getByText('Could not load profile views')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});
