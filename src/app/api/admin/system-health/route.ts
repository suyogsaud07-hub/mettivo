/**
 * M32 — operator environment readiness.
 *
 * SERVER ONLY. Returns *presence* booleans for configuration, never a value.
 * Authorisation is checked in PostgreSQL (`has_permission('system.view')`) for
 * the signed-in caller; this route cannot be used by an anonymous probe.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VARIABLES = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'MODERATION_EMAIL_FROM',
] as const;

function present(source: Record<string, string | undefined>): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const key of VARIABLES) {
    result[key] = (source[key] ?? '').trim().length > 0;
  }
  return result;
}

export async function GET(): Promise<NextResponse> {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '',
      process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '',
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
            } catch {
              // Read-only route: cookie refresh is optional here.
            }
          },
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const { data: allowed, error } = await supabase.rpc('has_permission', {
      p_permission: 'system.view',
    });
    if (error || allowed !== true) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    return NextResponse.json(
      {
        checkedAt: new Date().toISOString(),
        environment: process.env['VERCEL_ENV'] ?? process.env['NODE_ENV'] ?? 'unknown',
        variables: present(process.env),
        database: {
          urlConfigured: Boolean((process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '').trim()),
          anonKeyConfigured: Boolean((process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '').trim()),
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json({ error: 'health_check_failed' }, { status: 500 });
  }
}
