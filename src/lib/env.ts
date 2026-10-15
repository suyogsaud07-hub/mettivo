/**
 * M18 — environment configuration.
 *
 * WHY THIS EXISTS
 *   `src/lib/supabase.ts` used to throw a bare "Missing Supabase environment
 *   variables" at module scope, and `src/app/auth/callback/route.ts` used `!`
 *   non-null assertions on `process.env`. Both fail at the worst possible
 *   moment — mid-request in production — with a message that does not say which
 *   variable is missing or where to put it.
 *
 * PUBLIC BY CONSTRUCTION
 *   This product has no application server, so the browser needs the Supabase
 *   URL and the anon key. Those are the ONLY configuration values it may ever
 *   read, and both are `NEXT_PUBLIC_*`. Nothing in this file may reference a
 *   non-public variable: a `service_role` key in a client bundle would be a
 *   total compromise (`CONSTITUTION.md` Article 1.5), and a test enforces it.
 */

export interface PublicEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

/** Raised when the build or runtime is missing required public configuration. */
export class EnvError extends Error {
  readonly missing: string[];

  constructor(message: string, missing: string[]) {
    super(message);
    this.name = 'EnvError';
    this.missing = missing;
  }
}

/**
 * Where each variable is expected to come from, keyed by the variable name
 * itself — the same key the `missing` list uses, so an operator message can
 * never print `undefined`.
 */
export const ENV_HELP: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL:
    'NEXT_PUBLIC_SUPABASE_URL (Supabase dashboard → Project Settings → API → Project URL)',
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    'NEXT_PUBLIC_SUPABASE_ANON_KEY (Supabase dashboard → Project Settings → API → anon public key)',
};

function readValue(source: Record<string, string | undefined>, key: string): string {
  return (source[key] ?? '').trim();
}

/**
 * Reads the public configuration from any source (defaults to `process.env`).
 *
 * Passing the source explicitly is what makes this testable without mutating
 * the real environment.
 */
export function readPublicEnv(
  source: Record<string, string | undefined> = process.env
): PublicEnv {
  return {
    supabaseUrl: readValue(source, 'NEXT_PUBLIC_SUPABASE_URL'),
    supabaseAnonKey: readValue(source, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  };
}

/**
 * Non-throwing configuration report, suitable for a health endpoint.
 *
 * Deliberately reports only *presence* and *shape*. It never returns a value,
 * so an operator can confirm the deployment is configured without the response
 * body becoming a place a key could leak from.
 */
export function describeEnvHealth(source: Record<string, string | undefined> = process.env): {
  configured: boolean;
  missing: string[];
  problems: string[];
} {
  const env = readPublicEnv(source);
  const missing: string[] = [];
  const problems: string[] = [];

  if (!env.supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!env.supabaseAnonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');

  if (env.supabaseUrl) {
    try {
      const parsed = new URL(env.supabaseUrl);
      if (parsed.protocol !== 'https:') {
        // An http:// URL means the session cookie and the anon key travel in
        // clear text. On a dating product that is not an acceptable default.
        problems.push('NEXT_PUBLIC_SUPABASE_URL must use https://');
      }
    } catch {
      problems.push('NEXT_PUBLIC_SUPABASE_URL is not a valid URL');
    }
  }

  if (env.supabaseAnonKey && env.supabaseAnonKey.length < 40) {
    problems.push('NEXT_PUBLIC_SUPABASE_ANON_KEY looks truncated');
  }

  return {
    configured: missing.length === 0 && problems.length === 0,
    missing,
    problems,
  };
}

/**
 * Reads the public configuration, throwing a `EnvError` that names every
 * missing variable and where to find it.
 */
export function assertPublicEnv(
  source: Record<string, string | undefined> = process.env
): PublicEnv {
  const env = readPublicEnv(source);

  const missing: string[] = [];
  if (!env.supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!env.supabaseAnonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');

  if (missing.length > 0) {
    const detail = missing.map((key) => `  - ${ENV_HELP[key] ?? key}`).join('\n');
    throw new EnvError(
      `Missing required environment configuration:\n${detail}\n` +
        'Locally: add them to .env.local. On Vercel: Project → Settings → Environment Variables.',
      missing
    );
  }

  return env;
}
