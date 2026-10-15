/**
 * Vitest global setup.
 *
 * `src/lib/supabase.ts` builds a client at module scope and throws when the
 * environment variables are absent, which makes any module that imports it
 * un-loadable outside Next.js. Unit tests must not require real credentials, so
 * inert placeholders are supplied here.
 *
 * No test in this suite performs network I/O; the database tests run against an
 * in-memory PostgreSQL (PGlite).
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test.invalid.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key-not-a-real-secret';
