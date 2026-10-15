import { supabase } from '@/lib/supabase';

/**
 * M12 — blocking and unmatching, client side.
 *
 * Every operation here is a single SECURITY DEFINER call in PostgreSQL
 * (`supabase/migrations/20261015210000_m12_blocking_enforcement.sql`). The
 * browser never writes `blocked_users` directly, because the interesting part of
 * a block — severing the match and both like decisions — has to happen in the
 * same transaction. A client-side two-step block could half-apply and leave a
 * live conversation with someone the member just blocked.
 */

/** Raised for an expected failure while blocking, unblocking or unmatching. */
export class BlockingError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'BlockingError';
    this.code = code;
  }
}

export interface BlockResult {
  blocked: boolean;
  otherUserId: string;
  matchesRemoved: number;
}

export interface UnblockResult {
  unblocked: boolean;
  otherUserId: string;
}

export interface UnmatchResult {
  unmatched: boolean;
  otherUserId: string;
}

/** A row from `blocked_users` as the signed-in member is allowed to see it. */
export interface BlockedMemberRow {
  id: string;
  blockerId: string;
  blockedUserId: string;
  createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Throws `BlockingError` when a required uuid is missing, before any network call. */
function requireTarget(targetUserId: string): string {
  if (!targetUserId) {
    throw new BlockingError('A member is required to do that.');
  }
  return targetUserId;
}

async function requireUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new BlockingError('You must be signed in to do that.', '28000');
  }
  return user.id;
}

/**
 * Blocks a member: records the block, removes the match and clears both like
 * decisions, atomically.
 */
export async function blockMember(targetUserId: string): Promise<BlockResult> {
  const target = requireTarget(targetUserId);
  const me = await requireUserId();

  if (me === target) {
    throw new BlockingError('You cannot block yourself.');
  }

  const { data, error } = await supabase.rpc('block_member', { p_target: target });

  if (error) {
    console.error('[blocking] block_member failed:', error.message);
    throw new BlockingError(error.message, error.code);
  }
  if (!isRecord(data)) {
    throw new BlockingError('Unexpected response from the blocking service.');
  }

  return {
    blocked: readBoolean(data, 'blocked'),
    otherUserId: readString(data, 'other_user_id'),
    matchesRemoved: readNumber(data, 'matches_removed'),
  };
}

/**
 * Removes a block the signed-in member placed. The blocked member cannot use
 * this to force contact — the database only deletes rows where the caller is
 * the blocker — so `unblocked: false` is a normal, expected outcome.
 */
export async function unblockMember(targetUserId: string): Promise<UnblockResult> {
  const target = requireTarget(targetUserId);
  await requireUserId();

  const { data, error } = await supabase.rpc('unblock_member', { p_target: target });

  if (error) {
    console.error('[blocking] unblock_member failed:', error.message);
    throw new BlockingError(error.message, error.code);
  }
  if (!isRecord(data)) {
    throw new BlockingError('Unexpected response from the blocking service.');
  }

  return {
    unblocked: readBoolean(data, 'unblocked'),
    otherUserId: readString(data, 'other_user_id'),
  };
}

/**
 * Ends a match and clears both like decisions so it cannot silently re-form.
 * Idempotent: `unmatched: false` when there was nothing to end.
 */
export async function unmatchMember(targetUserId: string): Promise<UnmatchResult> {
  const target = requireTarget(targetUserId);
  const me = await requireUserId();

  if (me === target) {
    throw new BlockingError('You cannot unmatch yourself.');
  }

  const { data, error } = await supabase.rpc('unmatch_member', { p_target: target });

  if (error) {
    console.error('[blocking] unmatch_member failed:', error.message);
    throw new BlockingError(error.message, error.code);
  }
  if (!isRecord(data)) {
    throw new BlockingError('Unexpected response from the matching service.');
  }

  return {
    unmatched: readBoolean(data, 'unmatched'),
    otherUserId: readString(data, 'other_user_id'),
  };
}

/**
 * Every member the signed-in member has blocked.
 *
 * RLS scopes this to rows the caller is involved in, so this deliberately does
 * NOT filter by `blocker_id` in the query — if the policy ever loosened, the
 * database would be the thing that leaked, and hiding it here would hide that.
 */
export async function listBlockedMembers(): Promise<BlockedMemberRow[]> {
  const me = await requireUserId();

  const { data, error } = await supabase
    .from('blocked_users')
    .select('id, blocker_id, blocked_user_id, created_at')
    .eq('blocker_id', me)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[blocking] listBlockedMembers failed:', error.message);
    throw new BlockingError('We could not load your blocked list.', error.code);
  }

  return (data ?? []).flatMap((row: unknown) => {
    if (!isRecord(row)) return [];
    const id = readString(row, 'id');
    const blockerId = readString(row, 'blocker_id');
    const blockedUserId = readString(row, 'blocked_user_id');
    if (!id || !blockerId || !blockedUserId) return [];
    return [
      {
        id,
        blockerId,
        blockedUserId,
        createdAt: readString(row, 'created_at'),
      },
    ];
  });
}
