import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { parseBanStatus } from '@/lib/bot/moderation';

/**
 * Session refresh proxy & ban enforcement.
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

  // 1. Always refresh the session (Required for Supabase SSR)
  const { data: { user } } = await supabase.auth.getUser();

  // ⚡ PERFORMANCE FIX: Only run heavy database checks on API routes.
  const isApiRoute = request.nextUrl.pathname.startsWith('/api');

  if (user && isApiRoute) {
    // Skip checks for health/auth endpoints
    if (request.nextUrl.pathname.startsWith('/api/health') || request.nextUrl.pathname.startsWith('/api/auth')) {
      return response;
    }

    // ✅ BAN ENFORCEMENT
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

    // Seven-day inactivity enforcement for API routes
    try {
      const { data: isValid } = await supabase.rpc('check_activity_validity');
      if (isValid === false) {
        return NextResponse.json(
          { error: 'session_expired', message: 'Session expired due to inactivity' },
          { status: 401 },
        );
      }
    } catch {
      // Don't block if check fails
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};