import { NextResponse } from 'next/server';
import { buildChallengePhrase } from '@/lib/verification/phrase';
import { bearerToken, getUserIdFromRequest, readAuthEnv } from '@/lib/verification/server-auth';

export const dynamic = 'force-dynamic';

type PhraseGender = 'Woman' | 'Man' | 'Nonbinary';

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

  const params = new URL(request.url).searchParams;
  const nameParam = params.get('name')?.trim() || null;
  const suppliedGender = normaliseGender(params.get('gender'));

  // ✅ BEACON 3: What did the server extract from the URL?
  console.log('[BEACON 3 - Server] Parsed Params:', { nameParam, suppliedGender });

  let displayName: string | null = nameParam;
  let gender: PhraseGender = suppliedGender ?? 'Nonbinary';

  if (!nameParam || !suppliedGender) {
    const token = bearerToken(request);
    try {
      const res = await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=display_name,gender`, {
        headers: {
          apikey: env.anonKey,
          Authorization: `Bearer ${token}`,
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

  // ✅ BEACON 4: What are the final values used to build the phrase?
  console.log('[BEACON 4 - Server] Final generation values:', { displayName, gender });

  const phrase = buildChallengePhrase({ displayName, gender });
  return NextResponse.json({ phrase }, { status: 200 });
}