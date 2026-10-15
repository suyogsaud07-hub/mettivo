import { describe, expect, it } from 'vitest';
import { buildLogRecord, errorContext, redact } from '@/lib/logger';

/**
 * R-08 — log redaction.
 *
 * This is a security control, not a formatting nicety: a log line is a copy of
 * personal data that lives outside the database, outside RLS, and outside every
 * deletion path the product has. The tests below are the boundary.
 */

describe('R-08 — redaction', () => {
  it('redacts every sensitive key whatever it holds', () => {
    const result = redact({
      email: 'sujata@example.com',
      phone: '+9779800000000',
      birth_date: '1998-05-04',
      access_token: 'eyJhbGciOi',
      password: 'hunter2',
      authorization: 'Bearer abc',
      bio: 'I live in Kathmandu',
      answer: 'Coffee at sunrise',
      safe: 'this is fine',
    }) as Record<string, unknown>;

    for (const key of [
      'email',
      'phone',
      'birth_date',
      'access_token',
      'password',
      'authorization',
      'bio',
      'answer',
    ]) {
      expect(result[key], `${key} must be redacted`).toBe('[redacted]');
    }
    expect(result.safe).toBe('this is fine');
  });

  it('redacts inside nested objects and arrays', () => {
    const result = redact({
      profile: { display_name: 'Sujata', email: 'a@b.c' },
      rows: [{ token: 'abc' }, { city: 'Kathmandu' }],
    }) as Record<string, unknown>;

    expect((result.profile as Record<string, unknown>).email).toBe('[redacted]');
    expect((result.profile as Record<string, unknown>).display_name).toBe('Sujata');
    expect((result.rows as Record<string, unknown>[])[0].token).toBe('[redacted]');
  });

  it('caps arrays so one field cannot flood the pipeline', () => {
    const result = redact({ items: Array.from({ length: 50 }, (_, i) => i) }) as {
      items: unknown[];
    };
    expect(result.items).toHaveLength(11); // 10 values + a "…40 more" marker
    expect(String(result.items[10])).toContain('40 more');
  });

  it('truncates long strings', () => {
    const result = redact({ note: 'x'.repeat(5_000) }) as { note: string };
    expect(result.note.length).toBeLessThan(300);
    expect(result.note).toContain('truncated');
  });

  it('collapses beyond the depth limit instead of walking forever', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'too deep' } } } } } };
    expect(JSON.stringify(redact(deep))).toContain('depth limit');
  });

  it('never serialises a stack trace', () => {
    const error = new Error('boom');
    const result = redact({ failure: error }) as { failure: Record<string, unknown> };
    expect(result.failure).toEqual({ name: 'Error', message: 'boom' });
    expect(JSON.stringify(result)).not.toContain('at ');
  });

  it('summarises objects it does not understand', () => {
    expect(redact({ node: new (class Widget {})() })).toEqual({ node: '[Widget]' });
  });

  it('passes primitives through', () => {
    expect(redact(1)).toBe(1);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });
});

describe('R-08 — log records', () => {
  it('produces one JSON object per line with an ISO timestamp', () => {
    const record = buildLogRecord(
      'error',
      'rpc.failed',
      'record_like failed',
      { userId: 'u1' },
      new Date('2026-10-15T12:00:00Z')
    );

    expect(record).toMatchObject({
      level: 'error',
      event: 'rpc.failed',
      message: 'record_like failed',
      timestamp: '2026-10-15T12:00:00.000Z',
    });
    expect(record.context).toEqual({ userId: 'u1' });
  });

  it('redacts the context before it is attached to a record', () => {
    const record = buildLogRecord('warn', 'e', undefined, { email: 'a@b.c' });
    expect(record.context?.email).toBe('[redacted]');
    expect(JSON.stringify(record)).not.toContain('a@b.c');
  });

  it('turns an unknown throw into a safe context object', () => {
    expect(errorContext(new Error('nope'))).toEqual({
      errorName: 'Error',
      errorMessage: 'nope',
    });
    expect(errorContext('a string')).toEqual({ errorValue: 'a string' });
  });
});
