import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

// Force dynamic rendering in Next.js 15 to prevent build errors


export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    // In Next.js 15, cookies() is async and MUST be awaited
    const cookieStore = await cookies(); 
    
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Can be ignored if middleware is refreshing sessions
            }
          },
        },
      }
    );

    // Exchange the code for a session
    await supabase.auth.exchangeCodeForSession(code);

    // Check if the user has completed onboarding
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('onboarding_completed')
        .eq('id', user.id)
        .single();

      // If no profile exists OR onboarding is false, force them to the interview
      if (!profile || profile.onboarding_completed === false) {
        return NextResponse.redirect(`${origin}/profile`);
      }
    }
  }

  // If they finished onboarding, let them into the app
  return NextResponse.redirect(`${origin}/discover`);
}