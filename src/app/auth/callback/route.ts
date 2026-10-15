import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    // If no code is present, redirect back to the auth page
    return NextResponse.redirect(`${origin}/auth`);
  }

  try {
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
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      console.error('Error exchanging code for session:', exchangeError.message);
      return NextResponse.redirect(`${origin}/auth`);
    }

    // Get the authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      return NextResponse.redirect(`${origin}/auth`);
    }
    
    // Check if the user has a profile and completed onboarding
    // .maybeSingle() prevents errors when a new user has no profile row yet
    const { data: profile } = await supabase
      .from('profiles')
      .select('onboarding_completed')
      .eq('id', user.id)
      .maybeSingle();

    // If no profile exists OR onboarding is false, force them to profile setup / interview
    if (!profile || profile.onboarding_completed === false) {
      return NextResponse.redirect(`${origin}/profile`); 
    }

    // If onboarding is already completed, let them into the app
    return NextResponse.redirect(`${origin}/discover`);

  } catch (err) {
    console.error('Unexpected auth callback error:', err);
    return NextResponse.redirect(`${origin}/auth`);
  }
}