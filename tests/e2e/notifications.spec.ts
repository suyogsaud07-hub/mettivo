import { expect, test } from '@playwright/test';
import { E2E_USER_ID, signedIn, stubSupabase } from './fixtures';

const unreadRows = [
  {
    id: 'notification-1',
    user_id: E2E_USER_ID,
    actor_id: null,
    type: 'like',
    entity_id: null,
    body: null,
    read_at: null,
    created_at: '2026-10-20T10:00:00.000Z',
  },
  {
    id: 'notification-2',
    user_id: E2E_USER_ID,
    actor_id: null,
    type: 'match',
    entity_id: null,
    body: null,
    read_at: null,
    created_at: '2026-10-20T09:00:00.000Z',
  },
];

test.describe('notifications read state', () => {
  test.beforeEach(async ({ page }) => {
    await signedIn(page);
  });

  test('opening the page bulk-marks unread rows and clears the badge', async ({ page }) => {
    const stub = await stubSupabase(page, {
      tables: { notifications: unreadRows },
    });

    await page.goto('/notifications');

    await expect(page.getByText('liked your profile.')).toBeVisible();
    await expect(page.getByText("it's a match! You liked each other.", { exact: false })).toBeVisible();

    // The page issues one owner-scoped bulk update rather than one request per
    // card. The fixture records the PATCH body so the timestamp is observable.
    await expect
      .poll(() =>
        stub.writes.some(
          (write) =>
            write.table === 'notifications' &&
            write.method === 'PATCH' &&
            typeof (write.body as { read_at?: unknown } | null)?.read_at === 'string'
        )
      )
      .toBe(true);

    // No unread pill remains in the page header or the shared bottom-nav badge.
    await expect(page.getByText('2 new')).toHaveCount(0);
    await expect(page.locator('.pf-nav-badge')).toHaveCount(0);
  });

  test('reports a failed bulk read and keeps a retry available', async ({ page }) => {
    await stubSupabase(page, {
      tables: { notifications: unreadRows },
    });

    // Registered after the catch-all stub so it takes precedence. Reads still
    // fall through to the fixture; only the bulk update fails.
    await page.route('**/rest/v1/notifications**', async (route) => {
      if (route.request().method() === 'PATCH') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'database unavailable' }),
        });
      }
      return route.fallback();
    });

    await page.goto('/notifications');

    await expect(
      page.getByText('We could not mark your notifications as read. Please try again.')
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();

    // The failure was not reported as success: the rows remain visibly unread.
    await expect(page.getByText('2 new')).toBeVisible();
  });
});
