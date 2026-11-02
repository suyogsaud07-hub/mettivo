import { supabase } from '@/lib/supabase';

export async function signOutCompletely() {
  try {
    // End all presence sessions for this user
    const sessionId = typeof window !== 'undefined' ? sessionStorage.getItem('mettivo_presence_session_id') : null;
    if (sessionId) {
      try {
        await supabase.rpc('end_presence_session', { p_session_id: sessionId });
      } catch (err) {
        // Best effort
      }
    }
  } catch (err) {
    // Best effort
  }

  // Sign out from Supabase
  const { error } = await supabase.auth.signOut();
  return { error };
}
