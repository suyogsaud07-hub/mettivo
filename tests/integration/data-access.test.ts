import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * §3.2 — data-access modules against a mocked Supabase client.
 *
 * The property under test is the one `CONSTITUTION.md` Article 2.7 names
 * explicitly: **errors are handled, never swallowed.** An empty list and a
 * failed load look identical to a member, and only one of them is true, so
 * every module must turn `{ error }` into a user-visible throw rather than
 * returning a plausible-looking default.
 *
 * The mock models the two shapes `supabase-js` actually produces:
 *   * a chain that resolves directly (`.select().eq().order()`), and
 *   * a terminal call that resolves to `{ data, error }` (`.single()`).
 */

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown };

  const state = {
    table: { data: null, error: null } as Result,
    /** Consumed in order for modules that issue several queries at once. */
    tableQueue: [] as Result[],
    rpc: { data: null, error: null } as Result,
    user: { id: 'user-1' } as unknown,
    reset() {
      state.table = { data: null, error: null };
      state.tableQueue = [];
      state.rpc = { data: null, error: null };
      state.user = { id: 'user-1' };
    },
  };

  const makeChain = (result: Result) => {
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    for (const method of [
      'select', 'insert', 'update', 'upsert', 'eq', 'neq', 'in',
      'order', 'limit', 'gte', 'lte', 'or', 'delete',
    ]) {
      chain[method] = passthrough;
    }
    chain.single = async () => result;
    chain.maybeSingle = async () => result;
    // Makes `await supabase.from(...).select().eq()` resolve, as supabase-js does.
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    return chain;
  };

  const supabase = {
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    rpc: async () => state.rpc,
    from: () =>
      makeChain(state.tableQueue.length > 0 ? state.tableQueue.shift()! : state.table),
  };

  return { state, supabase };
});

vi.mock('@/lib/supabase', () => ({ supabase: h.supabase }));

import { LikeError, recordLike } from '@/lib/likes';
import {
  BlockingError,
  blockMember,
  listBlockedMembers,
  unblockMember,
  unmatchMember,
} from '@/lib/blocking';
import {
  MessageError,
  fetchMessages,
  fetchUnreadCounts,
  sendMessage,
} from '@/lib/messages';
import { DiscoveryError, fetchDiscoveryCandidates } from '@/lib/discovery';
import { CatalogueError, loadCatalogue } from '@/lib/catalogue';
import { saveProfile } from '@/lib/profile';import { ModerationError, fetchReportQueue, resolveReport } from '@/lib/admin';
import {
  MomentError,
  archiveMoment,
  deleteMoment,
  fetchArchiveCounts,
  fetchArchivedMoments,
  fetchMomentFeed,
  fetchUserMoments,
  restoreMoment,
  setMomentVisibility,
  updateMomentCaption,
} from '@/lib/moments';
import { fetchPublicProfile } from '@/lib/public-profiles';
import { isMissingColumnError, isMissingRelationError } from '@/lib/postgrest-errors';

beforeEach(() => {
  h.state.reset();
});

describe('§3.2 — likes.recordLike', () => {
  it('refuses an empty target before any network call', async () => {
    await expect(recordLike('')).rejects.toBeInstanceOf(LikeError);
  });

  it('refuses a self-like', async () => {
    await expect(recordLike('user-1')).rejects.toThrow(/cannot like yourself/i);
  });

  it('surfaces a database error instead of reporting success', async () => {
    h.state.rpc = { data: null, error: { message: 'rate limit exceeded', code: '53400' } };
    await expect(recordLike('user-2')).rejects.toThrow(/rate limit exceeded/i);
  });

  it('rejects a malformed payload rather than letting undefined reach the UI', async () => {
    h.state.rpc = { data: { liked: 'yes' }, error: null };
    await expect(recordLike('user-2')).rejects.toThrow(/unexpected response/i);
  });

  it('parses a valid payload', async () => {
    h.state.rpc = {
      data: { liked: true, matched: true, match_id: 'm1', matched_user_id: 'user-2' },
      error: null,
    };
    await expect(recordLike('user-2')).resolves.toEqual({
      liked: true,
      matched: true,
      match_id: 'm1',
      matched_user_id: 'user-2',
    });
  });
});

describe('§3.2 — blocking', () => {
  it('refuses to block yourself without calling the database', async () => {
    await expect(blockMember('user-1')).rejects.toBeInstanceOf(BlockingError);
  });

  it('surfaces a block failure', async () => {
    h.state.rpc = { data: null, error: { message: 'permission denied', code: '42501' } };
    await expect(blockMember('user-2')).rejects.toThrow(/permission denied/i);
  });

  it('parses a block result', async () => {
    h.state.rpc = { data: { blocked: true, other_user_id: 'user-2', matches_removed: 1 }, error: null };
    await expect(blockMember('user-2')).resolves.toEqual({
      blocked: true,
      otherUserId: 'user-2',
      matchesRemoved: 1,
    });
  });

  it('treats an unblock of a block you do not own as a normal outcome', async () => {
    // The blocked member calling unblock gets `unblocked: false`, not an error:
    // it must not be possible for them to force contact.
    h.state.rpc = { data: { unblocked: false, other_user_id: 'user-2' }, error: null };
    await expect(unblockMember('user-2')).resolves.toEqual({
      unblocked: false,
      otherUserId: 'user-2',
    });
  });

  it('reports an idempotent unmatch as `unmatched: false`', async () => {
    h.state.rpc = { data: { unmatched: false, other_user_id: 'user-2' }, error: null };
    await expect(unmatchMember('user-2')).resolves.toEqual({
      unmatched: false,
      otherUserId: 'user-2',
    });
  });

  it('drops unparseable rows from the blocked list instead of throwing', async () => {
    h.state.table = {
      data: [
        { id: 'b1', blocker_id: 'user-1', blocked_user_id: 'user-2', created_at: '2026-01-01' },
        { nonsense: true },
        null,
      ],
      error: null,
    };
    const rows = await listBlockedMembers();
    expect(rows).toHaveLength(1);
    expect(rows[0].blockedUserId).toBe('user-2');
  });

  it('never returns a silent empty list when the block list fails to load', async () => {
    h.state.table = { data: null, error: { message: 'network unreachable', code: '' } };
    await expect(listBlockedMembers()).rejects.toThrow(/could not load your blocked list/i);
  });
});

describe('§3.2 — messages', () => {
  it('refuses to send an empty message', async () => {
    await expect(sendMessage('match-1', '   ')).rejects.toThrow(/type a message/i);
  });

  it('refuses an over-long message', async () => {
    await expect(sendMessage('match-1', 'x'.repeat(2001))).rejects.toBeInstanceOf(MessageError);
  });

  it('surfaces a blocked-delivery refusal verbatim', async () => {
    // The database raises 42501 with a member-facing message; replacing it with
    // a generic error would hide why the send failed.
    h.state.table = {
      data: null,
      error: { message: 'You cannot message this member.', code: '42501' },
    };
    await expect(sendMessage('match-1', 'hello')).rejects.toThrow(/cannot message this member/i);
  });

  it('surfaces a generic send failure', async () => {
    h.state.table = { data: null, error: { message: 'boom', code: 'XX000' } };
    await expect(sendMessage('match-1', 'hello')).rejects.toThrow(/could not be sent/i);
  });

  it('never returns an empty thread when the load failed', async () => {
    h.state.table = { data: null, error: { message: 'timeout', code: '' } };
    await expect(fetchMessages('match-1')).rejects.toThrow(/could not load this conversation/i);
  });

  it('returns messages oldest-first', async () => {
    // The query is newest-first; the module reverses it for direct rendering.
    h.state.table = {
      data: [
        { id: '2', match_id: 'm', sender_id: 'user-2', content: 'second', created_at: '2026-01-02' },
        { id: '1', match_id: 'm', sender_id: 'user-1', content: 'first', created_at: '2026-01-01' },
      ],
      error: null,
    };
    const messages = await fetchMessages('m');
    expect(messages.map((message) => message.content)).toEqual(['first', 'second']);
  });

  it('degrades to no badge rather than breaking the chat list', async () => {
    // Documented trade-off: a missing badge beats an unusable conversation list.
    h.state.rpc = { data: null, error: { message: 'rpc missing', code: 'PGRST202' } };
    await expect(fetchUnreadCounts()).resolves.toEqual({});
  });

  it('parses unread counts into a lookup keyed by conversation', async () => {
    h.state.rpc = {
      data: [
        { match_id: 'm1', unread: 2 },
        { match_id: 'm2', unread: 0 },
        { match_id: 'm3', unread: 'lots' },
        null,
      ],
      error: null,
    };
    await expect(fetchUnreadCounts()).resolves.toEqual({ m1: 2, m2: 0 });
  });
});

describe('§3.2 — discovery', () => {
  it('refuses to browse without a session', async () => {
    h.state.user = null;
    await expect(fetchDiscoveryCandidates()).rejects.toBeInstanceOf(DiscoveryError);
  });

  it('never returns an empty feed when discovery failed', async () => {
    // An empty array would render as "nobody is online", which is a lie and
    // hides an outage.
    h.state.rpc = { data: null, error: { message: 'connection refused', code: '' } };
    await expect(fetchDiscoveryCandidates()).rejects.toThrow(/could not load members/i);
  });

  it('maps database rows and narrows every field', async () => {
    h.state.rpc = {
      data: [
        {
          id: 'p1',
          display_name: 'Sujata',
          age: 26,
          gender: 'Woman',
          city: 'Kathmandu',
          country: 'Nepal',
          avatar_url: 'https://cdn/a.png',
          photos: ['a', 'b', 7],
          bio: 'hi',
          intention: 'dating',
          looking_for: ['Men'],
          hobbies: null,
          pets: [],
          personality: null,
          interests: ['coffee'],
          prompts: { 'simple-pleasures': 'coffee', bad: 3 },
          is_online: true,
          is_verified: false,
        },
        { id: null },
        'nonsense',
      ],
      error: null,
    };

    const candidates = await fetchDiscoveryCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: 'p1',
      displayName: 'Sujata',
      photos: ['a', 'b'],
      hobbies: [],
      promptAnswers: { 'simple-pleasures': 'coffee' },
      online: true,
    });
  });
});

describe('§3.2 — catalogue', () => {
  it('surfaces a load failure instead of pretending the catalogue is empty', async () => {
    h.state.tableQueue = [
      { data: null, error: { message: 'relation missing', code: '42P01' } },
      { data: [], error: null },
      { data: [], error: null },
    ];
    await expect(loadCatalogue()).rejects.toBeInstanceOf(CatalogueError);
  });

  it('drops malformed rows and orders by sort_order', async () => {
    h.state.tableQueue = [
      { data: [{ id: 'outdoors', label: 'Outdoors', icon: 'x', sort_order: 1 }, { id: null }], error: null },
      { data: [{ id: 'hiking', category_id: 'outdoors', label: 'Hiking', sort_order: 1 }, {}], error: null },
      { data: [{ id: 'q1', category: 'about-me', question: 'Q?', sort_order: 1 }, {}], error: null },
    ];

    const catalogue = await loadCatalogue();
    expect(catalogue.categories).toHaveLength(1);
    expect(catalogue.interests).toHaveLength(1);
    expect(catalogue.prompts).toHaveLength(1);
  });
});

describe('§3.2 — profile', () => {
  it('refuses to save an underage draft without touching the database', async () => {
    await expect(
      saveProfile({ id: 'user-1', displayName: 'Sujata', birthDate: '2015-01-01' })
    ).rejects.toThrow(/adults only/i);
  });

  it('surfaces a save failure', async () => {
    h.state.table = { data: null, error: { message: 'column does not exist', code: '42703' } };
    await expect(
      saveProfile({ id: 'user-1', displayName: 'Sujata', birthDate: '1998-05-04' })
    ).rejects.toThrow(/could not save your profile/i);
  });

  it('resolves on a successful save', async () => {
    h.state.table = { data: null, error: null };
    await expect(
      saveProfile({ id: 'user-1', displayName: 'Sujata', birthDate: '1998-05-04' })
    ).resolves.toBeUndefined();
  });
});

describe('§3.2 — admin', () => {
  it('surfaces a queue failure rather than showing an empty worklist', async () => {
    // An empty list would read as "no reports", which is exactly the wrong
    // conclusion during an abuse spike.
    h.state.rpc = { data: null, error: { message: 'moderator access required', code: '42501' } };
    await expect(fetchReportQueue()).rejects.toBeInstanceOf(ModerationError);
  });

  it('parses the queue including the evidence snapshot', async () => {
    h.state.rpc = {
      data: [
        {
          report_id: 'r1',
          report_status: 'pending',
          reason: 'harassment',
          details: 'threats',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          reporter_id: 'user-1',
          reporter_name: 'Ada',
          reported_id: 'user-2',
          reported_name: 'Bo',
          reported_avatar: null,
          evidence: {
            captured_at: '2026-01-01T00:00:00Z',
            reason: 'harassment',
            reported_profile: { display_name: 'Bo', age: 30, city: 'Pokhara' },
          },
        },
        { report_id: null },
      ],
      error: null,
    };

    const queue = await fetchReportQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].evidence?.reportedProfile?.displayName).toBe('Bo');
    expect(queue[0].evidence?.reportedProfile?.age).toBe(30);
  });

  it('treats an unknown status as pending rather than trusting the payload', async () => {
    h.state.rpc = {
      data: [
        {
          report_id: 'r1',
          report_status: 'banana',
          reason: 'x',
          created_at: '',
          updated_at: '',
          reporter_id: 'user-1',
          reported_id: 'user-2',
        },
      ],
      error: null,
    };
    const queue = await fetchReportQueue();
    expect(queue[0].status).toBe('pending');
  });

  it('validates the status before calling the resolve RPC', async () => {
    await expect(
      resolveReport('r1', 'banana' as never)
    ).rejects.toThrow(/invalid status/i);
  });

  it('surfaces a resolve failure', async () => {
    h.state.rpc = { data: null, error: { message: 'report not found', code: 'P0002' } };
    await expect(resolveReport('r1', 'dismissed')).rejects.toThrow(/report not found/i);
  });
});

describe('§3.2 — schema-drift classification', () => {
  it('recognises a missing column by SQLSTATE', () => {
    expect(isMissingColumnError({ code: '42703', message: 'whatever' })).toBe(true);
    expect(isMissingColumnError({ code: 'PGRST204', message: 'whatever' })).toBe(true);
  });

  it('recognises a missing column from the message alone', () => {
    expect(
      isMissingColumnError({ message: 'column profiles.profile_likes_count does not exist' })
    ).toBe(true);
    expect(
      isMissingColumnError({
        message: "Could not find the 'matches_count' column of 'profiles' in the schema cache",
      })
    ).toBe(true);
  });

  it('recognises a missing relation or function', () => {
    expect(isMissingRelationError({ code: '42P01' })).toBe(true);
    expect(isMissingRelationError({ code: 'PGRST205', message: 'Could not find the table' })).toBe(true);
    expect(isMissingRelationError({ code: 'PGRST202' })).toBe(true);
  });

  it('does not treat a genuine failure as schema drift', () => {
    // A permission denial or a network error must be surfaced, not degraded.
    expect(isMissingColumnError({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingRelationError({ message: 'network unreachable', code: '' })).toBe(false);
    expect(isMissingColumnError(undefined)).toBe(false);
  });
});

describe('§3.2 — schema drift does not blank a profile surface', () => {
  const coreMoment = {
    id: 'mo1',
    author_id: 'user-1',
    caption: 'hello',
    media: [],
    tags: [],
    shares: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    like_count: 2,
    comment_count: 1,
    liked_by_me: false,
  };

  it('falls back to the base moment_feed columns for the profile Posts tab', async () => {
    h.state.tableQueue = [
      { data: null, error: { message: 'column moment_feed.media_type does not exist', code: '42703' } },
      { data: [coreMoment], error: null },
    ];

    const rows = await fetchUserMoments('user-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'mo1', media_type: null, views_count: 0, unique_views: 0 });
  });

  it('falls back to the base moment_feed columns for the feed', async () => {
    h.state.tableQueue = [
      { data: null, error: { message: 'column moment_feed.views_count does not exist', code: '42703' } },
      { data: [coreMoment], error: null },
    ];

    const rows = await fetchMomentFeed({ tab: 'Latest' });
    expect(rows[0]).toMatchObject({ media_type: null, views_count: 0, unique_views: 0 });
  });

  it('still surfaces a real moments failure rather than an empty feed', async () => {
    h.state.table = { data: null, error: { message: 'connection refused', code: '' } };
    await expect(fetchUserMoments('user-1')).rejects.toThrow(/connection refused/i);
  });

  it('zeros the social counters when the public_profiles view is behind', async () => {
    h.state.tableQueue = [
      {
        data: null,
        error: { message: 'column public_profiles.followers_count does not exist', code: '42703' },
      },
      {
        data: {
          id: 'user-2',
          display_name: 'Bo',
          age: 30,
          gender: 'Man',
          city: 'Pokhara',
          country: 'Nepal',
          avatar_url: null,
          bio: null,
          intention: null,
          looking_for: null,
          hobbies: null,
          pets: null,
          personality: null,
          religion: null,
          politics: null,
          drinking: null,
          smoking: null,
          is_online: false,
          is_verified: false,
        },
        error: null,
      },
    ];

    const profile = await fetchPublicProfile('user-2');
    expect(profile).toMatchObject({
      id: 'user-2',
      followers_count: 0,
      following_count: 0,
      matches_count: 0,
      profile_likes_count: 0,
    });
  });
});

describe('§3.2 — M22 profile management', () => {
  it('reports a successful archive', async () => {
    h.state.rpc = { data: true, error: null };
    await expect(archiveMoment('mo1')).resolves.toBe(true);
  });

  it('reports a refused archive rather than claiming success', async () => {
    h.state.rpc = { data: false, error: null };
    await expect(archiveMoment('mo1')).resolves.toBe(false);
  });

  it('turns the photo capacity refusal into a friendly sentence', async () => {
    h.state.rpc = {
      data: null,
      error: { message: 'archive_limit:photo', code: 'P0001' },
    };
    await expect(archiveMoment('mo1')).rejects.toThrow(/photo posts/i);
  });

  it('turns the video capacity refusal into a friendly sentence', async () => {
    h.state.rpc = {
      data: null,
      error: { message: 'archive_limit:video', code: 'P0001' },
    };
    await expect(archiveMoment('mo1')).rejects.toThrow(/video posts/i);
  });

  it('passes an unrelated archive failure through untouched', async () => {
    h.state.rpc = { data: null, error: { message: 'permission denied', code: '42501' } };
    await expect(archiveMoment('mo1')).rejects.toThrow(/permission denied/i);
  });

  it('surfaces a restore failure', async () => {
    h.state.rpc = { data: null, error: { message: 'boom', code: 'XX000' } };
    await expect(restoreMoment('mo1')).rejects.toBeInstanceOf(MomentError);
  });

  it('maps the archive counts payload to camelCase', async () => {
    h.state.rpc = {
      data: [{ photo_count: 3, video_count: 1, photo_limit: 5, video_limit: 2 }],
      error: null,
    };
    await expect(fetchArchiveCounts()).resolves.toEqual({
      photoCount: 3,
      videoCount: 1,
      photoLimit: 5,
      videoLimit: 2,
    });
  });

  it('falls back to the built-in caps when counts are unavailable', async () => {
    h.state.rpc = { data: null, error: { message: 'not found', code: 'PGRST202' } };
    await expect(fetchArchiveCounts()).resolves.toBeNull();
  });

  it('returns archived rows', async () => {
    h.state.table = { data: [{ id: 'mo1', archived_at: '2026-01-01T00:00:00Z' }], error: null };
    const rows = await fetchArchivedMoments();
    expect(rows).toHaveLength(1);
  });

  it('throws when an edit changes zero rows (a denied write looks like success otherwise)', async () => {
    h.state.table = { data: [], error: null };
    await expect(updateMomentCaption('mo1', 'hi')).rejects.toThrow(/could not be updated/i);
  });

  it('throws when a visibility change changes zero rows', async () => {
    h.state.table = { data: [], error: null };
    await expect(setMomentVisibility('mo1', 'only_me')).rejects.toThrow(/could not be updated/i);
  });

  it('throws when a delete affects zero rows', async () => {
    h.state.table = { data: [], error: null };
    await expect(deleteMoment('mo1')).rejects.toThrow(/could not be deleted/i);
  });
});
