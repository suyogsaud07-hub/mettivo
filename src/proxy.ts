import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Session refresh proxy & Ban enforcement.
 *
 * ⛔ THIS PROXY MUST NEVER REDIRECT PAGES.
 *   It refreshes a session and blocks API access for banned users.
 *   Authorisation redirects for pages belong in the page-level guards.
 */

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
  // If the user is logged in, check if Subbu has banned them.
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('banned_until, ban_reason')
      .eq('id', user.id)
      .single();

    const isBanned = profile?.banned_until && new Date(profile.banned_until) > new Date();

    if (isBanned) {
      // Block them from posting Moments, Chatting, or going Live via API
      if (
        request.nextUrl.pathname.startsWith('/api/moments') ||
        request.nextUrl.pathname.startsWith('/api/chat') ||
        request.nextUrl.pathname.startsWith('/api/live')
      ) {
        return NextResponse.json(
          { 
            error: 'banned', 
            message: `Action blocked. You are banned until ${new Date(profile.banned_until).toLocaleDateString()}. Reason: ${profile.ban_reason}` 
          },
          { status: 403 }
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