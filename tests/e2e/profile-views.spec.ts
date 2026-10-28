import { expect, test } from '@playwright/test';
import { E2E_OTHER_USER_ID, E2E_USER_ID, signedIn, stubSupabase } from './fixtures';

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

  test('records a genuine visit on another profile without exposing its viewer analytics', async ({
    page,
  }) => {
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
    // The visit is still recorded, but the owner-only analytics control must
    // never appear on somebody else's profile.
    await expect(page.locator('.pf-views-pill')).toHaveCount(0);
    await expect(page.locator('.pf-views-meta')).toHaveCount(0);
    await expect(page.locator('a[href="/profile/stats/views"]')).toHaveCount(0);
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

  test('shows the owner one eye pill, their bio and inline stats with Edit Profile', async ({
    page,
  }) => {
    await stubSupabase(page, {
      tables: {
        profiles: {
          id: E2E_USER_ID,
          first_name: 'Ada',
          last_name: 'Lovelace',
          has_last_name: true,
          username: 'ada',
          display_name: 'Ada Lovelace',
          age: 31,
          gender: 'Woman',
          city: 'Kathmandu',
          country: 'Nepal',
          avatar_url: null,
          bio: 'Line one\nLine two',
          intention: 'dating',
          looking_for: ['Men'],
          hobbies: [],
          pets: [],
          prompts: {},
          interests: [],
          photos: [],
          onboarding_completed: true,
          is_online: true,
          followers_count: 3,
          following_count: 2,
          matches_count: 1,
          profile_likes_count: 5,
          status: null,
        },
        moment_feed: [],
        notifications: [],
      },
      rpc: { profile_view_count: 7 },
    });

    await page.goto('/profile/dashboard');

    const eye = page.locator('.pf-hero-top .pf-views-pill');
    await expect(eye).toHaveText('7');
    await expect(page.locator('.pf-views-pill')).toHaveCount(1);
    await expect(page.locator('.pf-hero-bio')).toHaveText(/Line one\s+Line two/);
    await expect(page.getByTestId('bio-edit-button')).toBeVisible();
    await expect(page.locator('.pf-hero .pf-stat')).toHaveCount(4);
    const ownerActions = page.locator('.pf-actions');
    await expect(ownerActions.getByRole('button')).toHaveCount(1);
    await expect(ownerActions.getByRole('button', { name: 'Edit profile' })).toBeVisible();
    await expect(ownerActions.getByRole('button', { name: 'Like Profile' })).toHaveCount(0);
    await expect(ownerActions.getByRole('button', { name: 'Message' })).toHaveCount(0);

    await eye.click();
    await expect(page).toHaveURL(/\/profile\/stats\/views$/);
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

  test('opens the owner analytics from their own public profile', async ({ page }) => {
    const selfProfile = {
      ...otherProfile,
      id: E2E_USER_ID,
      first_name: 'Ada',
      last_name: 'Lovelace',
      username: 'ada',
      display_name: 'Ada Lovelace',
      bio: 'Mine',
    };

    await stubSupabase(page, {
      tables: {
        public_profiles: selfProfile,
        follows: [],
        likes: [],
        matches: [],
        moment_feed: [],
      },
      rpc: {
        profile_view_count: 5,
        profile_view_summary: summary,
        list_profile_viewers: [viewer],
      },
    });

    await page.goto(`/profile/${E2E_USER_ID}`);

    const eye = page.locator('.pf-hero-top .pf-views-pill');
    await expect(eye).toBeVisible();
    await expect(eye).toHaveText('5');
    await expect(eye).toHaveAttribute('aria-label', '5 profile viewers. View visitors.');
    await expect(eye).toHaveAttribute('title', 'Profile views');

    // One control only: the old text count below the bio is gone.
    await expect(page.locator('.pf-views-pill')).toHaveCount(1);
    await expect(page.locator('.pf-views-meta')).toHaveCount(0);

    // The bio is part of the header, not a separate card.
    const bio = page.locator('.pf-hero .pf-hero-bio');
    await expect(bio).toHaveText('Mine');
    await expect(page.getByRole('heading', { name: 'Bio', exact: true })).toHaveCount(0);

    // Four counters in one inline row.
    await expect(page.locator('.pf-hero .pf-stat')).toHaveCount(4);

    await eye.click();

    await expect(page).toHaveURL(/\/profile\/stats\/views$/);
    await expect(
      page.getByRole('heading', { name: 'Who is looking at your profile' })
    ).toBeVisible();
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
