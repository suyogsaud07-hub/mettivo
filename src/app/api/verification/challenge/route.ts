import { NextResponse } from 'next/server';
import { buildChallengePhrase } from '@/lib/verification/phrase';
import { getUserIdFromRequest, readAuthEnv } from '@/lib/verification/server-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const userId = await getUserIdFromRequest(request, { env: readAuthEnv() });
  if (!userId) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  // Get the user's profile to construct the phrase
  const env = readAuthEnv();
  const profileRes = await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=display_name,gender`, {
    headers: {
      apikey: env.anonKey,
      Authorization: `Bearer ${env.anonKey}`,
    },
  });

  let displayName: string | null = null;
  let gender: 'Woman' | 'Man' | 'Nonbinary' = 'Nonbinary';

  if (profileRes.ok) {
    const data = await profileRes.json();
    if (Array.isArray(data) && data.length > 0) {
      displayName = data[0].display_name;
      const g = data[0].gender?.toLowerCase();
      if (g === 'woman' || g === 'female') gender = 'Woman';
      else if (g === 'man' || g === 'male') gender = 'Man';
    }
  }

  const phrase = buildChallengePhrase({ displayName, gender });
  return NextResponse.json({ phrase }, { status: 200 });
}