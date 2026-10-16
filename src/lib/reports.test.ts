import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EVIDENCE_IMAGE_MAX_CHARS,
  NO_RESTRICTIONS,
  ReportError,
  categoryLabel,
  describeRestriction,
  fetchMyRestrictions,
  fileReport,
} from '@/lib/reports';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}));

const rpc = vi.mocked(supabase.rpc);

type RpcResult = { data: unknown; error: unknown };

function ok(data: unknown): RpcResult {
  return { data, error: null };
}

function fail(message: string, code?: string): RpcResult {
  return { data: null, error: { message, code } };
}

beforeEach(() => {
  rpc.mockReset();
});

describe('categoryLabel', () => {
  it('maps a stored category to its human label', () => {
    expect(categoryLabel('harassment')).toBe('Harassment or hate speech');
    expect(categoryLabel('spam')).toBe('Spam or scam');
  });

  it('passes through an unknown legacy value instead of blanking it', () => {
    expect(categoryLabel('fake_profile')).toBe('fake_profile');
  });
});

describe('describeRestriction', () => {
  it('says nothing when the member is unrestricted', () => {
    expect(describeRestriction(NO_RESTRICTIONS)).toBeNull();
  });

  it('reports a suspension ahead of a scoped ban', () => {
    const message = describeRestriction({
      ...NO_RESTRICTIONS,
      suspended: true,
      suspendedUntil: '2030-01-01T00:00:00.000Z',
      suspendedReason: 'underage_suspension',
    });
    expect(message).toContain('suspended');
    expect(message).toContain('underage suspension');
  });

  it('reports a chat ban with its end date', () => {
    const message = describeRestriction({
      ...NO_RESTRICTIONS,
      chatBanned: true,
      chatUntil: '2030-01-01T00:00:00.000Z',
    });
    expect(message).toContain('Messaging is paused');
    // The exact rendering is locale-dependent; only the word matters here.
    expect(message).toContain('until');
  });

  it('reports a video ban', () => {
    const message = describeRestriction({
      ...NO_RESTRICTIONS,
      videoBanned: true,
      videoUntil: '2030-01-01T00:00:00.000Z',
    });
    expect(message).toContain('Mettivo Live');
  });
});

describe('fileReport', () => {
  it('refuses a blank target before any network call', async () => {
    await expect(fileReport({ targetUserId: '   ', category: 'other' })).rejects.toBeInstanceOf(
      ReportError
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a category the schema would reject', async () => {
    await expect(
      // Deliberately wrong at the type level via a cast: the guard must also
      // catch a value that slipped past the UI.
      fileReport({ targetUserId: 'u2', category: 'sneaky' as never })
    ).rejects.toBeInstanceOf(ReportError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses an oversize evidence image', async () => {
    await expect(
      fileReport({
        targetUserId: 'u2',
        category: 'explicit_media',
        targetType: 'live',
        evidenceImage: 'x'.repeat(EVIDENCE_IMAGE_MAX_CHARS + 1),
      })
    ).rejects.toBeInstanceOf(ReportError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls file_report with the mapped parameters', async () => {
    rpc.mockResolvedValue(ok({ report_id: 'r1', category: 'abuse_text', status: 'pending' }) as never);

    const result = await fileReport({
      targetUserId: 'u2',
      category: 'abuse_text',
      targetType: 'message',
      targetId: 'm1',
      details: '  mean  ',
      evidenceImage: null,
    });

    expect(rpc).toHaveBeenCalledWith('file_report', {
      p_target_user: 'u2',
      p_category: 'abuse_text',
      p_target_type: 'message',
      p_target_id: 'm1',
      p_details: 'mean',
      p_evidence_image: null,
    });
    expect(result).toEqual({ reportId: 'r1', category: 'abuse_text', status: 'pending' });
  });

  it('normalises an empty detail and defaults the target type', async () => {
    rpc.mockResolvedValue(ok({ report_id: 'r2', category: 'other', status: 'actioned' }) as never);

    const result = await fileReport({ targetUserId: 'u3', category: 'other', details: '   ' });

    expect(rpc).toHaveBeenCalledWith(
      'file_report',
      expect.objectContaining({ p_target_type: 'user', p_target_id: null, p_details: null })
    );
    expect(result.status).toBe('actioned');
  });

  it('surfaces a database failure as a ReportError', async () => {
    rpc.mockResolvedValue(fail('You cannot report yourself', '22023') as never);

    await expect(fileReport({ targetUserId: 'me', category: 'other' })).rejects.toMatchObject({
      name: 'ReportError',
      message: 'You cannot report yourself',
      code: '22023',
    });
  });

  it('rejects a non-object response', async () => {
    rpc.mockResolvedValue(ok('nope') as never);
    await expect(fileReport({ targetUserId: 'u2', category: 'other' })).rejects.toBeInstanceOf(
      ReportError
    );
  });
});

describe('fetchMyRestrictions', () => {
  it('parses the jsonb payload', async () => {
    rpc.mockResolvedValue(
      ok({
        chat_banned: true,
        chat_until: '2030-01-01T00:00:00.000Z',
        video_banned: false,
        video_until: null,
        suspended: false,
        suspended_until: null,
        suspended_reason: null,
      }) as never
    );

    const restrictions = await fetchMyRestrictions();
    expect(restrictions.chatBanned).toBe(true);
    expect(restrictions.chatUntil).toBe('2030-01-01T00:00:00.000Z');
    expect(restrictions.videoBanned).toBe(false);
  });

  it('falls back to no restrictions when the RPC is missing', async () => {
    rpc.mockResolvedValue(fail('function does not exist', '42883') as never);
    await expect(fetchMyRestrictions()).resolves.toEqual(NO_RESTRICTIONS);
  });

  it('falls back when the payload is not an object', async () => {
    rpc.mockResolvedValue(ok(null) as never);
    await expect(fetchMyRestrictions()).resolves.toEqual(NO_RESTRICTIONS);
  });
});
