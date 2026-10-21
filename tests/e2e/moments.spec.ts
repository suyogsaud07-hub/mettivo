import { expect, test, type Page } from '@playwright/test';
import { E2E_USER_ID, signedIn, stubSupabase } from './fixtures';

/**
 * §3.3 — the Moments Posts / Reels surface.
 *
 * The DB suite proves the constraints and RLS; this proves the browser wiring:
 * the two content kinds are separate, a save reaches `moment_saves`, and a
 * paged feed appends rather than replacing.
 */

interface Row {
  id: string;
  author_id: string;
  caption: string | null;
  media: string[];
  media_type: string | null;
  content_kind: 'post' | 'reel';
  duration_seconds: number | null;
  allow_downloads: boolean;
  moderation_status: string;
  tags: string[];
  shares: number;
  views_count: number;
  unique_views: number;
  created_at: string;
  updated_at: string;
  like_count: number;
  comment_count: number;
  save_count: number;
  liked_by_me: boolean;
  saved_by_me: boolean;
  visibility: string;
}

function row(overrides: Partial<Row> = {}): Row {
  const id = overrides.id ?? 'm-1';
  return {
    id,
    author_id: E2E_USER_ID,
    caption: `caption ${id}`,
    media: ['https://cdn.test/a.jpg'],
    media_type: 'image',
    content_kind: 'post',
    duration_seconds: null,
    allow_downloads: false,
    moderation_status: 'approved',
    tags: [],
    shares: 0,
    views_count: 0,
    unique_views: 0,
    created_at: `2026-01-01T00:00:${String(Number(id.replace(/\D/g, '')) % 60).padStart(2, '0')}Z`,
    updated_at: '2026-01-01T00:00:00Z',
    like_count: 0,
    comment_count: 0,
    save_count: 0,
    liked_by_me: false,
    saved_by_me: false,
    visibility: 'public',
    ...overrides,
  };
}

function profileStub(url: URL): unknown {
  if (url.searchParams.has('id') && !url.searchParams.get('id')?.startsWith('in.')) {
    return { id: E2E_USER_ID, interests: [] };
  }
  return [{ id: E2E_USER_ID, display_name: 'Ada', avatar_url: null, gender: 'Woman', country: 'Nepal' }];
}

async function setup(page: Page, feed: (url: URL) => Row[]) {
  await signedIn(page);
  const stub = await stubSupabase(page, {
    tables: {
      profiles: profileStub,
      follows: [],
      moment_feed: (url: URL) => feed(url),
    },
    rpc: { record_moment_view: { views_count: 0, unique_views: 0 } },
  });
  return stub;
}

test.describe('§3.3 — Moments Posts and Reels', () => {
  test('shows both kinds and swaps the empty state', async ({ page }) => {
    await setup(page, () => []);
    await page.goto('/moments');

    await expect(page.getByText('Moments', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('moments-kind-post')).toBeVisible();
    await expect(page.getByTestId('moments-kind-reel')).toBeVisible();
    await expect(page.getByText(/No Posts yet/i)).toBeVisible();

    await page.getByTestId('moments-kind-reel').click();
    await expect(page.getByText(/No Reels yet/i)).toBeVisible();
  });

  test('renders a Post and records a save in moment_saves', async ({ page }) => {
    const stub = await setup(page, (url) =>
      url.searchParams.get('content_kind') === 'eq.post' ? [row({ id: 'p-1' })] : []
    );
    await page.goto('/moments');

    await expect(page.getByText('caption p-1')).toBeVisible();

    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeVisible();
    await save.click();

    await expect(page.getByRole('button', { name: 'Remove from saved' })).toBeVisible();

    // The save is optimistic, so poll for the write rather than racing it.
    await expect
      .poll(() => stub.writes.some((write) => write.table === 'moment_saves'))
      .toBe(true);
  });

  test('renders a Reel as a video card', async ({ page }) => {
    await setup(page, (url) =>
      url.searchParams.get('content_kind') === 'eq.reel'
        ? [row({ id: 'r-1', content_kind: 'reel', media: ['https://cdn.test/a.mp4'], media_type: 'video', duration_seconds: 30 })]
        : []
    );
    await page.goto('/moments');

    await page.getByTestId('moments-kind-reel').click();

    await expect(page.getByText('Reel', { exact: true })).toBeVisible();
    await expect(page.locator('video')).toBeVisible();
  });

  test('loads a second page in place of the first', async ({ page }) => {
    const firstPage = Array.from({ length: 24 }, (_, i) => row({ id: `p-${i + 1}` }));
    const secondPage = Array.from({ length: 5 }, (_, i) => row({ id: `p-${24 + i + 1}` }));

    await setup(page, (url) =>
      url.searchParams.get('content_kind') === 'eq.post'
        ? url.href.includes('created_at.lt.')
          ? secondPage
          : firstPage
        : []
    );
    await page.goto('/moments');

    const saves = page.getByRole('button', { name: 'Save', exact: true });
    await expect(saves).toHaveCount(24);

    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(saves).toHaveCount(29);
  });
});
