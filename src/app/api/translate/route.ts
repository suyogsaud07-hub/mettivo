import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import translate from 'google-translate-api-x';

export const dynamic = 'force-dynamic';

function failure(error: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error, message }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
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
            // ignore
          }
        },
      },
    }
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return failure('invalid_request', 'Send a JSON body with the text to translate.', 400);
  }

  if (!isRecord(raw)) {
    return failure('invalid_request', 'Send a JSON body with the text to translate.', 400);
  }

  const textValue = raw.text;
  if (typeof textValue !== 'string' || textValue.trim().length === 0) {
    return failure('empty_text', 'Enter text to translate.', 400);
  }

  if (textValue.length > 5000) {
    return failure('payload_too_large', 'That message is too long to translate.', 413);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return failure('unauthenticated', 'Sign in to translate messages.', 401);
  }

  try {
    const targetLanguage = typeof raw.targetLanguage === 'string' ? raw.targetLanguage : 'en';
    const result = await translate(textValue, { to: targetLanguage });
    
    return NextResponse.json({
      translatedText: result.text,
      provider: 'google',
      detectedSourceLanguage: result.from?.language?.iso,
    });
  } catch (error) {
    console.error('[translate] error:', error);
    return failure('upstream_error', 'Translation failed', 502);
  }
}
