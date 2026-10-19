/**
 * M24 — browser-side verification client.
 *
 * Talks only to the `/api/verification/*` routes, presenting the member's
 * Supabase access token. It never talks to the AI provider and never sees a
 * server secret. Every failure returns a typed error the UI can act on; the
 * caller must treat "not passed" and "could not verify" as distinct, because
 * only the latter is retryable infrastructure trouble.
 */

import { supabase } from '@/lib/supabase';

export type VerificationGender = 'Woman' | 'Man' | 'Nonbinary';
export type PhotoRole = 'gallery' | 'avatar';

/** Raised for an expected verification failure (network, refusal, AI outage). */
export class VerificationError extends Error {
  readonly code: string;
  constructor(message: string, code = 'verification_failed') {
    super(message);
    this.name = 'VerificationError';
    this.code = code;
  }
}

export interface FaceResult {
  passed: boolean;
  complete: boolean;
  reason: string | null;
  apparentGender: string;
}

export interface PhotoResult {
  passed: boolean;
  complete: boolean;
  gallery: number;
  avatar: number;
  reasons: string[];
}

export interface VoiceResult {
  passed: boolean;
  complete: boolean;
  reason: string | null;
  transcript?: string;
}

export interface MyVerification {
  gender: string | null;
  face_verified: boolean;
  voice_verified: boolean;
  photo_verified: boolean;
  complete: boolean;
  verified_at: string | null;
}

async function accessToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new VerificationError('Please sign in again to verify.', 'unauthorised');
  return token;
}

async function postJson<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const token = await accessToken();

  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new VerificationError('Could not reach the verification service.', 'network');
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through: an empty/unparseable body is treated as a failure below.
  }

  if (!response.ok) {
    const code = typeof body.error === 'string' ? body.error : `http_${response.status}`;
    throw new VerificationError(messageForCode(code), code);
  }

  return body as T;
}

function messageForCode(code: string): string {
  switch (code) {
    case 'ai_unavailable':
      return 'Verification is temporarily unavailable. Please try again shortly.';
    case 'ai_misconfigured':
      return 'Verification is temporarily unavailable. Please try again later.';
    case 'image_too_large':
      return 'That image is too large to verify. Try again with a smaller photo.';
    case 'audio_too_large':
      return 'That recording is too long. Please keep it under a few seconds.';
    case 'unauthorised':
      return 'Please sign in again to continue.';
    case 'invalid_body':
      return 'Something was missing from that request. Please retry.';
    default:
      return 'We could not verify that. Please try again.';
  }
}

/** The identity the wizard already holds, so the phrase need not wait for a save. */
export interface ChallengeIdentity {
  displayName: string | null;
  gender: VerificationGender;
}

/**
 * Fetches a fresh phrase for the voice liveness check.
 *
 * The name and gender are sent as query parameters because onboarding shows this
 * step BEFORE the profile row is saved: without them the route has nothing to
 * read and the phrase would fall back to "friend" / "nonbinary".
 */
export async function fetchChallenge(identity?: ChallengeIdentity): Promise<string> {
  const token = await accessToken();

  // ✅ BEACON 1: What did the modal pass in?
  console.log('[BEACON 1 - Client] fetchChallenge received identity:', identity);

  const params = new URLSearchParams();
  if (identity?.displayName) params.set('name', identity.displayName);
  if (identity?.gender) params.set('gender', identity.gender);
  
  const query = params.toString();
  const path = query
    ? `/api/verification/challenge?${query}`
    : '/api/verification/challenge';

  // ✅ BEACON 2: What is the exact URL being fetched?
  console.log('[BEACON 2 - Client] Fetching URL:', path);

  let response: Response;
  try {
    response = await fetch(path, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new VerificationError('Could not reach the verification service.', 'network');
  }
  if (!response.ok) throw new VerificationError('Could not start the voice check.', 'challenge');
  const body = (await response.json()) as { phrase?: string };
  if (!body.phrase) throw new VerificationError('Could not start the voice check.', 'challenge');
  return body.phrase;
}

export function submitFace(selfieUrl: string, gender: VerificationGender): Promise<FaceResult> {
  return postJson<FaceResult>('/api/verification/face', { selfieUrl, gender });
}

export function submitPhoto(
  photoUrl: string,
  selfieUrl: string,
  role: PhotoRole,
  gender: VerificationGender
): Promise<PhotoResult> {
  return postJson<PhotoResult>('/api/verification/photo', {
    photoUrl,
    selfieUrl,
    role,
    gender,
  });
}

export function submitVoice(
  audioUrl: string,
  phrase: string,
  pitchHz: number
): Promise<VoiceResult> {
  return postJson<VoiceResult>('/api/verification/voice', { audioUrl, phrase, pitchHz });
}

/** Reads the member's own verification status (owner-scoped RPC). */
export async function getMyVerification(): Promise<MyVerification> {
  const { data, error } = await supabase.rpc('get_my_verification');
  if (error) {
    throw new VerificationError(error.message, error.code);
  }
  const value = (data ?? {}) as Partial<MyVerification>;
  return {
    gender: value.gender ?? null,
    face_verified: value.face_verified === true,
    voice_verified: value.voice_verified === true,
    photo_verified: value.photo_verified === true,
    complete: value.complete === true,
    verified_at: value.verified_at ?? null,
  };
}