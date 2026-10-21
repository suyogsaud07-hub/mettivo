import { expect, test, type Page } from '@playwright/test';
import {
  E2E_OTHER_USER_ID,
  signedIn,
  stubSupabase,
  type SupabaseStub,
} from './fixtures';

/**
 * People discovery — relationship state, profile navigation, photo carousel,
 * swipe persistence and preference-aware candidate loading.
 *
 * These run against the real page with Supabase intercepted, so they exercise
 * the client state machine rather than a mocked component tree.
 */


const PHOTO = (label: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="100%" height="100%" fill="#3A2530"/><text x="50%" y="50%" fill="#D8B38A" font-size="36" text-anchor="middle">${label}</text></svg>`
  )}`;

const candidate = (overrides: Record<string, unknown> = {}) => ({
  id: E2E_OTHER_USER_ID,
  first_name: 'Bo',
  last_name: '',
  has_last_name: false,
  username: 'bo',
  display_name: 'Bo',
  age: 30,
  gender: 'Man',
  city: 'Pokhara',
  country: 'Nepal',
  avatar_url: PHOTO('Bo'),
  photos: [PHOTO('Bo 2'), PHOTO('Bo 3'), PHOTO('Bo 4'), PHOTO('Bo 5')],
  bio: 'Coffee, long walks and a good book.',
  intention: 'dating',
  looking_for: ['Women'],
  hobbies: ['Hiking'],
  pets: ['Dogs'],
  mbti: 'INFJ',
  interests: ['Coffee', 'Travel'],
  prompts: { 'simple-pleasures': 'Coffee at sunrise.' },
  is_online: true,
  is_verified: false,
  ...overrides,
});

const founderProfile = {
  onboarding_completed: true,
  gender: 'Woman',
  intention: 'dating',
  interests: ['Coffee'],
  prompts: {},
  looking_for: ['Men'],
};

async function openPeople(
  page: Page,
  candidates: ReturnType<typeof candidate>[],
  options: { following?: string[]; preferences?: Record<string, unknown> } = {}
): Promise<SupabaseStub> {
  await signedIn(page);
  return stubSupabase(page, {
    tables: {
      profiles: { ...founderProfile, ...(options.preferences ?? {}) },
      follows: (options.following ?? []).map((id) => ({ following_id: id })),
    },
    rpc: {
      discover_profiles: candidates,
      record_like: { liked: true, matched: false, match_id: null, matched_user_id: null },
      touch_presence: null,
    },
  });
}

async function swipe(page: Page, direction: 'left' | 'right') {
  const details = page.locator('.people-details');
  const box = await details.boundingBox();
  if (!box) throw new Error('people card details not visible');

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const endX = startX + (direction === 'right' ? 180 : -180);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, startY, { steps: 8 });
  await page.mouse.up();
}

test.describe('People discovery', () => {
  test('loads preference-filtered candidates and shows reliable presence', async ({ page }) => {
    const stub = await openPeople(page, [candidate()]);
    await page.goto('/people');

    await expect(page.getByTestId('people-swipe-card')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Bo/ })).toBeVisible();
    await expect(page.getByText('Online now')).toBeVisible();
    await expect(page.getByText('Coffee at sunrise.')).toBeVisible();

    const discoverCall = stub.writes.find((write) => write.table === 'rpc/discover_profiles');
    expect(discoverCall?.body).toMatchObject({
      p_genders: ['Man'],
      p_online_only: false,
    });
  });

  test('navigates photos without recording a like or pass', async ({ page }) => {
    const stub = await openPeople(page, [candidate()]);
    await page.goto('/people');

    await expect(page.getByAltText('Bo, photo 1 of 5')).toBeVisible();
    await page.getByRole('button', { name: 'Next photo' }).click();
    await expect(page.getByAltText('Bo, photo 2 of 5')).toBeVisible();

    expect(stub.writes.some((write) => write.table === 'rpc/record_like')).toBe(false);
    await expect(page.getByTestId('people-swipe-card')).toBeVisible();
  });

  test('swiping right records a Like and removes the card', async ({ page }) => {
    const stub = await openPeople(page, [candidate()]);
    await page.goto('/people');

    await swipe(page, 'right');

    await expect(page.getByText('Like sent')).toBeVisible();
    await expect(page.getByTestId('people-swipe-card')).toHaveCount(0);
    const decision = stub.writes.find((write) => write.table === 'rpc/record_like');
    expect(decision?.body).toMatchObject({ target_user: E2E_OTHER_USER_ID, is_like_value: true });
  });

  test('swiping left records a Pass and removes the card', async ({ page }) => {
    const stub = await openPeople(page, [candidate()]);
    await page.goto('/people');

    await swipe(page, 'left');

    await expect(page.getByText('Passed')).toBeVisible();
    await expect(page.getByTestId('people-swipe-card')).toHaveCount(0);
    const decision = stub.writes.find((write) => write.table === 'rpc/record_like');
    expect(decision?.body).toMatchObject({ target_user: E2E_OTHER_USER_ID, is_like_value: false });
  });

  test('follow state is shared across client navigation', async ({ page }) => {
    const stub = await openPeople(page, [candidate()]);
    await page.goto('/people');

    await page.getByRole('button', { name: 'Follow', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Following' })).toBeVisible();
    // The action must not navigate to the profile.
    await expect(page).toHaveURL(/\/people$/);

    await page.locator('a[href="/discover"]').first().click();
    await expect(page).toHaveURL(/\/discover$/);
    await expect(page.getByRole('button', { name: 'Following' })).toBeVisible();
    expect(stub.writes.some((write) => write.table === 'follows' && write.method === 'POST')).toBe(
      true
    );
  });

  test('unfollow restores the Follow action', async ({ page }) => {
    const stub = await openPeople(page, [candidate()], { following: [E2E_OTHER_USER_ID] });
    await page.goto('/people');

    await expect(page.getByRole('button', { name: 'Following' })).toBeVisible();
    await page.getByRole('button', { name: 'Following' }).click();
    await expect(page.getByRole('button', { name: 'Follow', exact: true })).toBeVisible();
    expect(stub.writes.some((write) => write.table === 'follows' && write.method === 'DELETE')).toBe(
      true
    );
  });

  test('failed follow rolls back the optimistic label and shows an error', async ({ page }) => {
    await openPeople(page, [candidate()]);
    await page.route('**/rest/v1/follows*', async (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'XX000', message: 'write failed' }),
        });
      }
      return route.fallback();
    });

    await page.goto('/people');
    await page.getByRole('button', { name: 'Follow', exact: true }).click();

    await expect(page.getByRole('button', { name: 'Follow', exact: true })).toBeVisible();
    await expect(page.getByText('Could not update follow. Please try again.')).toBeVisible();
  });

  test('an avatar opens the canonical public profile', async ({ page }) => {
    await openPeople(page, [candidate()]);
    await page.goto('/discover');

    await page.getByRole('link', { name: "View Bo's profile" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/profile/${E2E_OTHER_USER_ID}$`));
  });

  test('load-more requests exclude already shown ids and never duplicate the card', async ({
    page,
  }) => {
    await signedIn(page);
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      candidate({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        display_name: index === 0 ? 'Bo' : `Member ${index}`,
        username: `member_${index}`,
      })
    );
    const stub = await stubSupabase(page, {
      tables: {
        profiles: founderProfile,
        follows: [],
      },
      rpc: {
        discover_profiles: firstPage,
        touch_presence: null,
      },
    });

    await page.goto('/people');
    await expect(page.getByTestId('people-swipe-card')).toBeVisible();
    await page.getByRole('button', { name: 'Find more people' }).click();

    await expect(page.getByText('No more people right now')).toBeVisible();
    const discoverCalls = stub.writes.filter(
      (write) => write.table === 'rpc/discover_profiles'
    );
    const initialCalls = discoverCalls.filter(
      (call) => (call.body as { p_exclude_ids?: unknown[] }).p_exclude_ids?.length === 0
    );
    const moreCalls = discoverCalls.filter(
      (call) => (call.body as { p_exclude_ids?: unknown[] }).p_exclude_ids?.length === 50
    );
    expect(initialCalls.length).toBeGreaterThanOrEqual(1);
    expect(moreCalls).toHaveLength(1);
    expect(moreCalls[0]?.body).toMatchObject({
      p_exclude_ids: expect.arrayContaining([firstPage[0]?.id, firstPage[49]?.id]),
    });
  });
});
