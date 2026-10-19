import { describe, expect, it } from 'vitest';
import { diagnoseError } from './diagnose';

describe('diagnoseError', () => {
  it('recognises a configuration problem', () => {
    const result = diagnoseError({ message: 'AI_MODERATION_API_KEY is not configured' });
    expect(result.category).toBe('configuration');
    expect(result.safeToAutoFix).toBe(false);
    expect(result.requiresHumanReview).toBe(true);
  });

  it('recognises a rejected credential', () => {
    expect(diagnoseError({ message: 'The AI provider returned HTTP 401.' }).category).toBe(
      'authentication'
    );
  });

  it('recognises a missing migration', () => {
    expect(diagnoseError({ message: 'function public.admin_report_queue does not exist' }).category).toBe(
      'missing_migration'
    );
  });

  it('recognises a timeout', () => {
    expect(diagnoseError({ message: 'Subbu did not answer in time (aborted).' }).category).toBe(
      'timeout'
    );
  });

  it('never claims a fix is safe to apply automatically', () => {
    for (const message of ['', 'boom', 'row-level security policy denied']) {
      const result = diagnoseError({ message });
      expect(result.safeToAutoFix).toBe(false);
      expect(result.requiresHumanReview).toBe(true);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('returns unknown for an unrecognised signature', () => {
    expect(diagnoseError({ message: 'something bizarre happened' }).category).toBe('unknown');
  });

  it('notes the route when one is supplied', () => {
    const result = diagnoseError({ message: 'boom', route: '/api/bot/chat' });
    expect(result.notes).toEqual(expect.arrayContaining([expect.stringContaining('/api/bot/chat')]));
  });
});
