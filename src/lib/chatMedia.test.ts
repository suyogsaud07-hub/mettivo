import { describe, expect, it, vi } from 'vitest';
import {
  CHAT_MEDIA_VIEW_LIMIT,
  isExhausted,
  isGone,
  viewsRemaining,
} from '@/lib/chatMedia';
import type { ChatMediaRow } from '@/lib/types';

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn(), storage: { from: vi.fn() } },
}));

function row(overrides: Partial<ChatMediaRow> = {}): ChatMediaRow {
  return {
    id: 'm1',
    message_id: 'msg1',
    match_id: 'match1',
    sender_id: 'user-a',
    storage_path: 'match1/user-a/x.jpg',
    media_type: 'image',
    view_once: false,
    view_limit: CHAT_MEDIA_VIEW_LIMIT,
    view_count: 0,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    viewed_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('chat media two-view helpers (M26)', () => {
  it('reports views remaining against the limit', () => {
    expect(viewsRemaining(row())).toBe(2);
    expect(viewsRemaining(row({ view_count: 1 }))).toBe(1);
    expect(viewsRemaining(row({ view_count: 2 }))).toBe(0);
  });

  it('treats an item as exhausted at the limit, never before', () => {
    expect(isExhausted(row({ view_count: 1 }))).toBe(false);
    expect(isExhausted(row({ view_count: 2 }))).toBe(true);
  });

  it('hides an item once exhausted or expired', () => {
    expect(isGone(row({ view_count: 2 }))).toBe(true);
    expect(
      isGone(row({ expires_at: new Date(Date.now() - 1000).toISOString() }))
    ).toBe(true);
    expect(isGone(row({ view_count: 1 }))).toBe(false);
  });
});
