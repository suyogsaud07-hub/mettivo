import { NextResponse } from 'next/server';
import { buildChallengePhrase } from '@/lib/verification/phrase';
import { bearerToken, getUserIdFromRequest, readAuthEnv } from '@/lib/verification/server-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const env = readAuthEnv();
  const userId = await getUserIdFromRequest(request, { env });
  if (!userId) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const token = bearerToken(request);

  let displayName: string | null = null;
  let gender: 'Woman' | 'Man' | 'Nonbinary' = 'Nonbinary';

  try {
    // Fetch using the USER'S TOKEN, not the anon key
    const res = await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=display_name,gender`, {
      headers: {
        apikey: env.anonKey,
        Authorization: `Bearer ${token}`, // This is the fix
      },
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        displayName = data[0].display_name || null;
        const g = data[0].gender?.toLowerCase();
        if (g === 'woman' || g === 'female') gender = 'Woman';
        else if (g === 'man' || g === 'male') gender = 'Man';
      }
    }
  } catch (e) {
    console.error('Failed to fetch profile for phrase', e);
  }

  const phrase = buildChallengePhrase({ displayName, gender });
  return NextResponse.json({ phrase }, { status: 200 });
}
