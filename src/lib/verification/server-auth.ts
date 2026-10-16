/**
 * M24 — identifies the caller from the request, server-side.
 *
 * SERVER ONLY. A route handler cannot trust a member id from the body, and the
 * browser holds no server secret. The only trustworthy identity is the Supabase
 * access token the browser already carries: this module presents it to the Auth
 * server (`GET /auth/v1/user`) with the public anon key and reads back the
 * validated user id. An invalid or expired token yields `null`, and every caller
 * refuses.
 */

export interface AuthEnv {
  supabaseUrl: string;
  anonKey: string;
}

/**
 * Reads the Supabase URL and anon key through the injected-source pattern.
 * Both values are public (`NEXT_PUBLIC_*`) by design; the pattern is used for
 * consistency with the rest of the server-only verification modules.
 */
export function readAuthEnv(
  source: Record<string, string | undefined> = process.env
): AuthEnv {
  return {
    supabaseUrl: (source['NEXT_PUBLIC_SUPABASE_URL'] ?? '').trim().replace(/\/+$/, ''),
    anonKey: (source['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '').trim(),
  };
}

export interface AuthDeps {
  env?: AuthEnv;
  fetchImpl?: typeof fetch;
}

/** Extracts the bearer token from an `Authorization` header, or null. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

/**
 * Validates the caller's access token and returns their user id, or null.
 *
 * This makes one network call to the Auth server; a non-200 reply, a malformed
 * body, or a missing id all collapse to `null` — the request is simply not
 * authenticated.
 */
export async function getUserIdFromRequest(
  request: Request,
  deps: AuthDeps = {}
): Promise<string | null> {
  const env = deps.env ?? readAuthEnv();
  if (!env.supabaseUrl || !env.anonKey) return null;

  const token = bearerToken(request);
  if (!token) return null;

  const fetchImpl = deps.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(`${env.supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: env.anonKey,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const id = (payload as Record<string, unknown>).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}
