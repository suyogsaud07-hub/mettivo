import { isMissingRelationError } from '@/lib/postgrest-errors';
import { supabase } from '@/lib/supabase';

/**
 * Relationship-aware conversation entry points.
 *
 * The browser never decides whether a pair may chat. `start_conversation()`
 * creates a romantic match, a mutual-follow chat, or a pending request, and
 * `respond_to_conversation_request()` is the recipient-only accept/reject gate.
 * Both run as SECURITY DEFINER functions and derive the caller from `auth.uid()`.
 */

export type RelationshipState =
  | 'MATCHED'
  | 'MUTUAL_FOLLOW_CHAT'
  | 'MESSAGE_REQUEST_PENDING'
  | 'MESSAGE_REQUEST_ACCEPTED'
  | 'BLOCKED'
  | 'UNAVAILABLE';

export type RequestStatus = 'not_applicable' | 'pending' | 'accepted' | 'rejected';

export interface ConversationConnection {
  conversationId: string;
  relationshipState: RelationshipState;
  requestStatus: RequestStatus;
  requestedByMe: boolean;
}

export class ConversationError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ConversationError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseRelationshipState(value: unknown): RelationshipState {
  switch (value) {
    case 'MATCHED':
    case 'MUTUAL_FOLLOW_CHAT':
    case 'MESSAGE_REQUEST_PENDING':
    case 'MESSAGE_REQUEST_ACCEPTED':
    case 'BLOCKED':
    case 'UNAVAILABLE':
      return value;
    default:
      return 'UNAVAILABLE';
  }
}

export function parseRequestStatus(value: unknown): RequestStatus {
  switch (value) {
    case 'pending':
    case 'accepted':
    case 'rejected':
    case 'not_applicable':
      return value;
    default:
      return 'not_applicable';
  }
}

function parseConnection(value: unknown): ConversationConnection | null {
  if (!isRecord(value)) return null;
  const conversationId = value.conversation_id;
  if (typeof conversationId !== 'string' || !conversationId) return null;

  // Both state fields are part of the documented contract. A response missing
  // them is a deployment mismatch, not a conversation with unknown state.
  if (
    typeof value.relationship_state !== 'string' ||
    typeof value.request_status !== 'string'
  ) {
    return null;
  }

  return {
    conversationId,
    relationshipState: parseRelationshipState(value.relationship_state),
    requestStatus: parseRequestStatus(value.request_status),
    requestedByMe: value.requested_by_me === true,
  };
}

/**
 * Opens, or returns, the connection row for the signed-in member and a target.
 *
 * This is deliberately idempotent: tapping Message twice, or reconnecting to an
 * existing match, never creates a second conversation. A one-way follow creates
 * a pending request; with no follow the database refuses with a user-safe 42501.
 */
export async function startConversation(targetUserId: string): Promise<ConversationConnection> {
  if (!targetUserId) throw new ConversationError('Choose a member to message.');

  const { data, error } = await supabase.rpc('start_conversation', {
    p_target: targetUserId,
  });

  if (error) {
    console.error('[conversations] start_conversation failed:', error.message);
    if (isMissingRelationError(error)) {
      // PGRST202 means the deployed function is missing or its argument names
      // differ. That is an operator problem, not something this member can fix,
      // so never echo the schema-cache detail into the UI.
      throw new ConversationError(
        'Messaging is temporarily unavailable. Please try again shortly.',
        error.code
      );
    }
    throw new ConversationError(
      error.code === '42501' || error.code === '22023'
        ? error.message
        : 'This conversation could not be started.',
      error.code
    );
  }

  const parsed = parseConnection(data);
  if (!parsed) {
    throw new ConversationError('The conversation could not be opened.');
  }
  return parsed;
}

/** Recipient-only accept/reject for a pending message request. */
export async function respondToConversationRequest(
  conversationId: string,
  accept: boolean
): Promise<ConversationConnection> {
  if (!conversationId) throw new ConversationError('A conversation is required.');

  const { data, error } = await supabase.rpc('respond_to_conversation_request', {
    p_match_id: conversationId,
    p_accept: accept,
  });

  if (error) {
    console.error('[conversations] respond_to_conversation_request failed:', error.message);
    if (isMissingRelationError(error)) {
      throw new ConversationError(
        'Messaging is temporarily unavailable. Please try again shortly.',
        error.code
      );
    }
    throw new ConversationError(
      error.code === '42501' || error.code === '22023'
        ? error.message
        : 'That request could not be updated.',
      error.code
    );
  }

  const parsed = parseConnection(data);
  if (!parsed) {
    throw new ConversationError('The request could not be updated.');
  }
  return parsed;
}
