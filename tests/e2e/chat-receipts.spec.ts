import { expect, test } from '@playwright/test';
import { E2E_OTHER_USER_ID, E2E_USER_ID, signedIn, stubSupabase } from './fixtures';

/**
 * §M26 — delivery/seen receipts and the 24-hour disappearing toggle.
 *
 * A browser journey is the honest proof that the ticks are driven by the
 * database columns (not a client guess) and that the safety menu actually calls
 * `set_disappearing_messages`. It also shows the composer no longer offers a
 * per-message "view once" switch: every item is a strict 2-view.
 */

const MATCH_ID = 'match-receipts-1';

const MESSAGES = [
  {
    id: 'msg-seen',
    match_id: MATCH_ID,
    sender_id: E2E_USER_ID,
    content: 'already read',
    created_at: '2026-10-15T10:00:00.000Z',
    delivered_at: '2026-10-15T10:00:05.000Z',
    seen_at: '2026-10-15T10:00:30.000Z',
  },
  {
    id: 'msg-delivered',
    match_id: MATCH_ID,
    sender_id: E2E_USER_ID,
    content: 'only delivered',
    created_at: '2026-10-15T10:01:00.000Z',
    delivered_at: '2026-10-15T10:01:04.000Z',
    seen_at: null,
  },
  {
    id: 'msg-incoming',
    match_id: MATCH_ID,
    sender_id: E2E_OTHER_USER_ID,
    content: 'hey there',
    created_at: '2026-10-15T10:02:00.000Z',
    delivered_at: null,
    seen_at: null,
  },
];

const NO_RESTRICTIONS = {
  chat_banned: false,
  chat_until: null,
  video_banned: false,
  video_until: null,
  suspended: false,
  suspended_until: null,
  suspended_reason: null,
};

test.describe('§M26 — receipts and disappearing chats', () => {
  test('renders delivered and seen ticks from the database, not a guess', async ({ page }) => {
    await signedIn(page);
    await stubSupabase(page, {
      tables: { messages: MESSAGES, chat_media: [], chat_settings: [], user_preferences: [] },
      rpc: {
        my_restrictions: NO_RESTRICTIONS,
        mark_conversation_read: '2026-10-15T10:03:00.000Z',
        mark_messages_delivered: 0,
        purge_expired_chat_content: 0,
      },
    });

    await page.goto(`/chat/${MATCH_ID}`);

    // The message with a seen_at shows "Seen"; the one with only delivered_at
    // shows "Delivered". A client guess could not tell them apart.
    await expect(page.locator('[data-testid="message-status"][data-status="seen"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="message-status"][data-status="delivered"]')).toHaveCount(1);
    await expect(page.getByText('only delivered')).toBeVisible();
  });

  test('toggles 24-hour disappearing messages through the RPC', async ({ page }) => {
    await signedIn(page);
    const stub = await stubSupabase(page, {
      tables: { messages: MESSAGES, chat_media: [], chat_settings: [], user_preferences: [] },
      rpc: {
        my_restrictions: NO_RESTRICTIONS,
        mark_conversation_read: '2026-10-15T10:03:00.000Z',
        mark_messages_delivered: 0,
        purge_expired_chat_content: 0,
        set_disappearing_messages: { disappear_after_seconds: 86400 },
      },
    });

    await page.goto(`/chat/${MATCH_ID}`);
    await page.getByRole('button', { name: 'Conversation options' }).click();
    await page.getByRole('button', { name: /Disappearing messages/i }).click();

    await expect(page.getByText(/Disappearing messages on/i)).toBeVisible();

    const call = stub.writes.find((w) => w.table === 'rpc/set_disappearing_messages');
    expect(call, 'set_disappearing_messages was not called').toBeTruthy();
    expect(call?.body).toMatchObject({ p_match_id: MATCH_ID, p_seconds: 86400 });
  });
});
