/**
 * Chat-specific types shared across the messaging UI.
 */

import type { MessageRow } from '@/lib/types';

/** A message with its rendered media and user-facing metadata. */
export interface ChatMessage {
  id: string;
  matchId: string;
  senderId: string;
  content: string;
  messageType: 'text' | 'video_call' | 'audio_call' | 'call';
  createdAt: string;
  deliveredAt: string | null;
  seenAt: string | null;
  /** The sender's avatar, only shown on received messages. */
  senderAvatar?: string | null;
  /** The sender's display name, shown when grouping changes. */
  senderName?: string | null;
  /** Whether this is the first message from this sender in a group. */
  isGroupStart: boolean;
  /** Whether the previous message is from the same sender. */
  isGrouped: boolean;
  /** Optional reply context. */
  replyTo?: {
    id: string;
    senderId: string;
    senderName: string;
    content: string;
    mediaType?: 'image' | 'video' | 'audio' | null;
  } | null;
  /** Optimistic ID for locally-created messages awaiting server confirmation. */
  optimisticId?: string;
  /** Sending state for optimistic messages. */
  status: 'sending' | 'sent' | 'delivered' | 'seen' | 'failed';
}

/** A date separator between message groups. */
export interface DateSeparator {
  type: 'date';
  label: string;
}

/** A typing indicator entry. */
export interface TypingUser {
  userId: string;
  userName: string;
  updatedAt: number;
}

/** Call state machine. */
export type CallState =
  | 'idle'
  | 'initiating'
  | 'ringing'
  | 'accepting'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'rejected'
  | 'missed'
  | 'cancelled'
  | 'ended'
  | 'failed';

/** Call type. */
export type CallType = 'voice' | 'video';

/** A call log message rendered in the thread. */
export interface CallLogMessage extends ChatMessage {
  messageType: 'call';
  callType: CallType;
  callState: 'missed' | 'rejected' | 'cancelled' | 'ended';
  duration?: number;
}

/** The union of renderable items in the message list. */
export type ChatListItem = ChatMessage | DateSeparator;
