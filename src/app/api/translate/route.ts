import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import translate from 'google-translate-api-x';
import {
  normaliseLanguageCode,
} from '@/lib/translation';

export const dynamic = 'force-dynamic';

const MAX_CHUNK_CHARS = 4000;

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

/**
 * Splits text into chunks at paragraph boundaries, keeping each chunk under
 * `maxChars`. Never splits a word or a Unicode grapheme cluster. Preserves
 * the original ordering of chunks so they can be reassembled after translation.
 */
function splitIntoChunks(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);

  let current = '';
  for (const para of paragraphs) {
    // If this paragraph alone exceeds the limit, split it by sentences.
    if (para.length > maxChars) {
      // Flush any pending current chunk first.
      if (current) {
        chunks.push(current);
        current = '';
      }
      const sentences = para.split(/(?<=[.!?])\s+/);
      let sentenceBuf = '';
      for (const sentence of sentences) {
        const joined = sentenceBuf
          ? `${sentenceBuf} ${sentence}`
          : sentence;
        if (joined.length > maxChars) {
          if (sentenceBuf) {
            chunks.push(sentenceBuf);
            sentenceBuf = sentence;
          } else {
            // Single sentence too long — split by whitespace, never mid-word.
            const words = sentence.split(/\s+/);
            let wordBuf = '';
            for (const word of words) {
              const joinedWord = wordBuf ? `${wordBuf} ${word}` : word;
              if (joinedWord.length > maxChars) {
                if (wordBuf) chunks.push(wordBuf);
                wordBuf = word;
              } else {
                wordBuf = joinedWord;
              }
            }
            if (wordBuf) chunks.push(wordBuf);
          }
        } else {
          sentenceBuf = joined;
        }
      }
      if (sentenceBuf) chunks.push(sentenceBuf);
    } else {
      const joined = current ? `${current}\n\n${para}` : para;
      if (joined.length > maxChars) {
        chunks.push(current);
        current = para;
      } else {
        current = joined;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
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

  try {
  // Short messages: translate directly without chunking.
  if (textValue.length <= MAX_CHUNK_CHARS) {
    const result = await translate(textValue, { to: targetLanguage });
    if (!result.text || result.text.trim().length === 0) {
      return failure('empty_result', 'Translation returned empty output.', 502);
    }
    return NextResponse.json({
      translatedText: result.text,
      provider: 'google',
      detectedSourceLanguage: result.from?.language?.iso,
    });
  }

    // Long messages: chunk by paragraph boundaries, translate each chunk,
    // and reassemble in order.
    const chunks = splitIntoChunks(textValue, MAX_CHUNK_CHARS);
    const translatedChunks: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        const result = await translate(chunk, { to: targetLanguage });
        if (!result.text || result.text.trim().length === 0) {
          return failure(
            'empty_result',
            `Translation returned empty output for chunk ${i + 1}.`,
            502
          );
        }
        translatedChunks.push(result.text);
      } catch (err) {
        console.error(`[translate] chunk ${i + 1} failed:`, err);
        return failure(
          'upstream_error',
          `Translation failed on chunk ${i + 1} of ${chunks.length}.`,
          502
        );
      }
    }

    return NextResponse.json({
      translatedText: translatedChunks.join('\n\n'),
      provider: 'google',
      chunked: true,
      chunkCount: chunks.length,
    });
  } catch (error) {
    console.error('[translate] error:', error);
    return failure('upstream_error', 'Translation failed', 502);
  }
}
