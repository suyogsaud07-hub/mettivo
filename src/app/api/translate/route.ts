import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  normaliseLanguageCode,
} from '@/lib/translation';

export const dynamic = 'force-dynamic';

const DEEPL_ENDPOINT = 'https://api-free.deepl.com/v2/translate';
const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';

// In-memory rate limiter: max 10 requests per minute per user.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

function getRateLimit(userId: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(userId, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 };
  }

  entry.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

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

function parseMyMemoryPayload(payload: unknown): { translatedText: string } | null {
  if (!isRecord(payload)) return null;

  const data = payload.responseData;
  if (!isRecord(data)) return null;

  const translatedText = data.translatedText;
  if (typeof translatedText !== 'string') return null;

  return { translatedText };
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

  // Rate limiting: max 10 requests per minute per user.
  const rateLimit = getRateLimit(user.id);
  if (!rateLimit.allowed) {
    return failure(
      'rate_limited',
      'Too many translation requests. Please try again shortly.',
      429
    );
  }

  const deepLKey = process.env.DEEPL_API_KEY;
  const googleKey = process.env.GOOGLE_TRANSLATE_API_KEY;

  // Try DeepL first if configured.
  if (deepLKey) {
    try {
      const form = new URLSearchParams();
      form.set('text', textValue);
      form.set('target_lang', targetLanguage.toUpperCase());
      form.set('preserve_formatting', '1');

      const response = await fetch(DEEPL_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${deepLKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });

      if (!response) {
        console.error('[translate] DeepL request returned no response');
      } else if (response.ok) {
        const parsed = (await response.json()) as unknown;
        const translation = parseDeeplPayload(parsed);
        if (translation && translation.text.trim().length > 0) {
          return NextResponse.json({
            translatedText: translation.text.trim(),
            provider: 'deepl',
            ...(translation.detected_source_language
              ? { detectedSourceLanguage: translation.detected_source_language }
              : {}),
          });
        }
      } else {
        console.error(`[translate] DeepL request failed with status ${response.status}`);
      }
    } catch (error) {
      console.error('[translate] DeepL error:', error);
    }
  }

  // Try Google Translate next if configured.
  if (googleKey) {
    try {
      const response = await fetch(
        `https://translation.googleapis.com/language/translate/v2?key=${googleKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            q: textValue,
            target: targetLanguage,
            format: 'text',
          }),
        }
      );

      if (!response) {
        console.error('[translate] Google Translate request returned no response');
      } else if (response.ok) {
        const parsed = (await response.json()) as unknown;
        const data = parsed && isRecord(parsed) ? parsed.data : null;
        if (data && isRecord(data)) {
          const translations = data.translations;
          if (Array.isArray(translations) && translations.length > 0) {
            const first = translations[0];
            if (isRecord(first) && typeof first.translatedText === 'string') {
              return NextResponse.json({
                translatedText: first.translatedText.trim(),
                provider: 'google',
              });
            }
          }
        }
      } else {
        console.error(`[translate] Google Translate request failed with status ${response.status}`);
      }
    } catch (error) {
      console.error('[translate] Google Translate error:', error);
    }
  }

  // Fallback: MyMemory (keyless, free). Used when no provider keys are configured
  // or when both configured providers have failed.
  try {
    const myMemoryUrl = `${MYMEMORY_ENDPOINT}?q=${encodeURIComponent(textValue)}&langpair=en|${targetLanguage}`;
    const response = await fetch(myMemoryUrl);

    if (!response) {
      console.error('[translate] MyMemory request returned no response');
    } else if (response.ok) {
      const parsed = (await response.json()) as unknown;
      const translation = parseMyMemoryPayload(parsed);
      if (translation && translation.translatedText.trim().length > 0) {
        return NextResponse.json({
          translatedText: translation.translatedText.trim(),
          provider: 'mymemory',
        });
      }
    } else {
      console.error(`[translate] MyMemory request failed with status ${response.status}`);
    }
  } catch (error) {
    console.error('[translate] MyMemory error:', error);
  }

  // All providers failed.
  return failure(
    'service_unavailable',
    'Translation service unavailable',
    503
  );
}
