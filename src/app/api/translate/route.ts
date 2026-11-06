import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  normaliseLanguageCode,
} from '@/lib/translation';

export const dynamic = 'force-dynamic';

const DEEPL_ENDPOINT = 'https://api-free.deepl.com/v2/translate';

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

interface DeeplTranslation {
  text: string;
  detected_source_language?: string;
}

function parseDeeplPayload(payload: unknown): DeeplTranslation | null {
  if (!isRecord(payload)) return null;

  const translations = payload.translations;
  if (!Array.isArray(translations) || translations.length === 0) return null;

  const first = translations[0];
  if (!isRecord(first)) return null;

  const text = first.text;
  if (typeof text !== 'string') return null;

  return {
    text,
    detected_source_language:
      typeof first.detected_source_language === 'string'
        ? first.detected_source_language
        : undefined,
  };
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

  const targetLanguageRaw =
    typeof raw.targetLanguage === 'string' ? raw.targetLanguage : 'en';
  const targetLanguage = normaliseLanguageCode(targetLanguageRaw);
  if (!targetLanguage) {
    return failure(
      'unsupported_language',
      `Target language '${targetLanguageRaw}' is not supported.`,
      400
    );
  }

  // Cap total input size so we never attempt an unbounded translation.
  if (textValue.length > 50000) {
    return failure(
      'payload_too_large',
      'That message is too long to translate.',
      413
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return failure('unauthenticated', 'Sign in to translate messages.', 401);
  }

  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) {
    return failure('unconfigured', 'Translation is not configured on this server.', 500);
  }

  try {
    // Send the entire message as a single string so line breaks, bullet points,
    // and numbering survive; preserve_formatting keeps them intact upstream.
    const form = new URLSearchParams();
    form.set('text', textValue);
    form.set('target_lang', targetLanguage.toUpperCase());
    form.set('preserve_formatting', '1');

    const response = await fetch(DEEPL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });

    if (!response.ok) {
      return failure(
        'upstream_error',
        `DeepL request failed with status ${response.status}.`,
        502
      );
    }

    const parsed = (await response.json()) as unknown;
    const translation = parseDeeplPayload(parsed);
    if (!translation || translation.text.trim().length === 0) {
      return failure('empty_result', 'Translation returned empty output.', 502);
    }

    return NextResponse.json({
      translatedText: translation.text.trim(),
      provider: 'deepl',
      ...(translation.detected_source_language
        ? { detectedSourceLanguage: translation.detected_source_language }
        : {}),
    });
  } catch (error) {
    console.error('[translate] error:', error);
    return failure('upstream_error', 'Translation failed', 502);
  }
}
