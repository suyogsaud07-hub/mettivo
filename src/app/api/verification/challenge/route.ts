import { NextResponse } from 'next/server';
import { buildChallengePhrase } from '@/lib/verification/phrase';
import { bearerToken, getUserIdFromRequest, readAuthEnv } from '@/lib/verification/server-auth';

export const dynamic = 'force-dynamic';

type PhraseGender = 'Woman' | 'Man' | 'Nonbinary';

/** Accepts the wizard's gender value (or a loose synonym) as a phrase gender. */
function normaliseGender(value: string | null): PhraseGender | null {
  if (!value) return null;
  const g = value.trim().toLowerCase();
  if (g === 'woman' || g === 'female') return 'Woman';
  if (g === 'man' || g === 'male') return 'Man';
  if (g === 'nonbinary' || g === 'non-binary' || g === 'enby') return 'Nonbinary';
  return null;
}

export async function GET(request: Request): Promise<NextResponse> {
  const env = readAuthEnv();
  const userId = await getUserIdFromRequest(request, { env });
  if (!userId) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  // The wizard sends the name and gender it already holds, because onboarding
  // runs this step BEFORE the profile row is saved: a database read would be
  // empty and the phrase would fall back to "friend"/"nonbinary".
  const params = new URL(request.url).searchParams;
  const nameParam = params.get('name')?.trim() || null;
  const suppliedGender = normaliseGender(params.get('gender'));

  let displayName: string | null = nameParam;
  let gender: PhraseGender = suppliedGender ?? 'Nonbinary';

  // Only ask the database for whichever value the query string did not supply.
  if (!nameParam || !suppliedGender) {
    const token = bearerToken(request);

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
          if (!nameParam) displayName = data[0].display_name || null;
          if (!suppliedGender) {
            const g = data[0].gender?.toLowerCase();
            if (g === 'woman' || g === 'female') gender = 'Woman';
            else if (g === 'man' || g === 'male') gender = 'Man';
          }
        }
      }
    } catch (e) {
      console.error('Failed to fetch profile for phrase', e);
    }
  }

  const phrase = buildChallengePhrase({ displayName, gender });
  return NextResponse.json({ phrase }, { status: 200 });
}
