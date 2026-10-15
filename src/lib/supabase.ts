import { createBrowserClient } from '@supabase/ssr';

/**
 * The browser Supabase client.
 *
 * WHY `createBrowserClient` AND NOT `createClient`
 *   This is the client that participates in the OAuth redirect flow, so its
 *   storage must match the server's. It previously used
 *   `@supabase/supabase-js`'s `createClient`, which persists the session in
 *   **localStorage**, while `/auth/callback` used `@supabase/ssr`'s
 *   `createServerClient`, which writes to **cookies**.
 *
 *   The result was an infinite sign-in loop:
 *     1. Google redirects to /auth/callback?code=…
 *     2. the route handler exchanges the code and writes the session to COOKIES
 *     3. it redirects to /profile
 *     4. that page calls `supabase.auth.getUser()` on the BROWSER client, which
 *        reads LOCALSTORAGE, finds no session, and sends the user back to /auth
 *
 *   `createBrowserClient` stores the session in cookies, so the browser and the
 *   server now share one session. It also keeps the PKCE code verifier in the
 *   same place the callback looks for it, which the mismatched clients did not.
 *
 * Both values are public by design: the browser talks straight to Supabase, and
 * RLS — not this key — is the authorisation boundary.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env.local file.');
}

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
