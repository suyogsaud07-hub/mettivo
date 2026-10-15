import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Session refresh middleware.
 *
 * WHY THIS IS REQUIRED
 *   Access tokens are short-lived (one hour by default). Without something that
 *   refreshes them, the session silently expires mid-session and every guard
 *   bounces the member back to `/auth` — indistinguishable from the OAuth loop
 *   this repo already had once.
 *
 *   The Supabase session lives in cookies, and only a server-side client can
 *   rotate a refresh token and write the new cookies back. That is this file.
 *
 * `getUser()` — NOT `getSession()`
 *   `getSession()` merely reads the cookie. `getUser()` calls the Auth server,
 *   which is what actually triggers the refresh and, importantly, validates the
 *   token rather than trusting it.
 *
 * The response object is rebuilt inside `setAll` because Next.js caches the
 * headers of the original response; mutating cookies on a stale response is the
 * classic reason a refreshed session "does not stick".
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!supabaseUrl || !supabaseAnonKey) {
    // Never hard-fail the request over configuration; /api/health reports it.
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Write onto the request so downstream handlers see the fresh values…
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        // …and rebuild the response so the browser receives them too.
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();

  return response;
}

export const config = {
  /*
   * Everything except static assets. Running on `_next/static` would be pure
   * overhead, and running on images would break Next's optimiser.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
