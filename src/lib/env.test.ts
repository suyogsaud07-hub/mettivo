import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EnvError, assertPublicEnv, describeEnvHealth, readPublicEnv } from '@/lib/env';

/**
 * M18 — environment configuration.
 *
 * The important property is not "it reads the variables". It is that a
 * misconfiguration is caught with a useful message, and that nothing this
 * module can produce ever carries a value that could leak.
 */

const VALID = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a'.repeat(64),
};

describe('M18 — environment configuration', () => {
  it('reads the two public values', () => {
    const env = readPublicEnv(VALID);
    expect(env.supabaseUrl).toBe('https://example.supabase.co');
    expect(env.supabaseAnonKey).toBe('a'.repeat(64));
  });

  it('trims whitespace, which is the most common copy-paste defect', () => {
    const env = readPublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: '  https://example.supabase.co  ',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: `  ${'b'.repeat(64)}  `,
    });
    expect(env.supabaseUrl).toBe('https://example.supabase.co');
    expect(env.supabaseAnonKey).toBe('b'.repeat(64));
  });

  it('reports every missing variable by name', () => {
    const health = describeEnvHealth({});
    expect(health.configured).toBe(false);
    expect(health.missing).toEqual([
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ]);
  });

  it('flags a non-https Supabase URL', () => {
    const health = describeEnvHealth({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: 'http://example.supabase.co' });
    expect(health.configured).toBe(false);
    expect(health.problems.join(' ')).toMatch(/https/i);
  });

  it('flags a malformed URL and a truncated key', () => {
    expect(describeEnvHealth({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: 'not a url' }).problems.join(' ')).toMatch(
      /valid URL/i
    );
    expect(
      describeEnvHealth({ ...VALID, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'short' }).problems.join(' ')
    ).toMatch(/truncated/i);
  });

  it('is healthy when both values are present and well-formed', () => {
    expect(describeEnvHealth(VALID)).toEqual({ configured: true, missing: [], problems: [] });
  });

  it('throws an EnvError naming every missing variable and where to find it', () => {
    try {
      assertPublicEnv({});
      throw new Error('expected assertPublicEnv to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvError);
      const envError = err as EnvError;
      expect(envError.missing).toEqual([
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      ]);
      expect(envError.message).toMatch(/Project Settings/);
      expect(envError.message).toMatch(/\.env\.local/);
    }
  });

  it('returns the values when configuration is complete', () => {
    expect(assertPublicEnv(VALID).supabaseUrl).toBe('https://example.supabase.co');
  });

  it('never returns a configured value from the health report', () => {
    // The health endpoint is often unauthenticated and its body often lands in
    // logs. It must be impossible for a value to appear in it.
    const health = describeEnvHealth(VALID);
    const serialised = JSON.stringify(health);
    expect(serialised).not.toContain('example.supabase.co');
    expect(serialised).not.toContain('a'.repeat(64));
  });

  it('leaks no key material through the health route source', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/health/route.ts'),
      'utf8'
    );
    // Only presence is reported, so the handler must not read a value into the
    // response, and it must never mention a privileged key.
    expect(source).not.toMatch(/service_role/i);
    expect(source).not.toMatch(/process\.env\.(?!NODE_ENV)[A-Z0-9_]+/);
  });
});
