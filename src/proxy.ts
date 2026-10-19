import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { parseBanStatus } from '@/lib/bot/moderation';

/**
 * Session refresh proxy & ban enforcement.
 *
 * ⛔ THIS PROXY MUST NEVER REDIRECT PAGES.
 *   It refreshes a session and blocks API access for banned users.
 *   Authorisation redirects for pages belong in the page-level guards.
 *
 * The ban itself is enforced authoritatively in the API routes (and in the
 * database); this is an early, cheap rejection. The caller's state is read via
 * `my_ban_status()`, which can only ever return the caller's own row.
 */

const BANNED_API_PREFIXES = ['/api/bot', '/api/moments', '/api/live'] as const;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();

  // ✅ BAN ENFORCEMENT
  // If the user is logged in, check whether Subbu has banned them. The RPC
  // derives identity from auth.uid() and takes no arguments, so this cannot be
  // pointed at another member.
  if (user) {
    const { data } = await supabase.rpc('my_ban_status');
    const ban = parseBanStatus(data);

    if (ban.banned && ban.until) {
      const isBlockedApi = BANNED_API_PREFIXES.some((prefix) =>
        request.nextUrl.pathname.startsWith(prefix),
      );

      if (isBlockedApi) {
        return NextResponse.json(
          {
            error: 'banned',
            banned_until: ban.until,
            reason: ban.reason,
            message: `Action blocked. You are banned until ${new Date(ban.until).toLocaleString()}.`,
          },
          { status: 403 },
        );
      }
    }
  }

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