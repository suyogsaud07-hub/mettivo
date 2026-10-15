/**
 * M18 / R-08 — structured logging with redaction.
 *
 * WHY REDACTION IS NOT OPTIONAL HERE
 *   This is a dating product. The single most likely way to leak personal data is
 *   not an RLS mistake — it is a well-meaning `console.error(error)` that prints
 *   a Supabase row containing a bio, a phone number or a date of birth into a log
 *   aggregator that a third party can read and that nobody ever expires.
 *
 *   Every value that leaves this module passes through `redact()` first, so a
 *   caller cannot leak by accident. It is deliberately conservative: unknown
 *   shapes are summarised rather than serialised.
 *
 * WHAT A LOG LINE LOOKS LIKE
 *   {"level":"error","event":"rpc.failed","message":"...","context":{...},
 *    "timestamp":"2026-10-15T12:00:00.000Z"}
 *
 *   One JSON object per line, which is what every log pipeline can parse without
 *   a custom grammar.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  level: LogLevel;
  event: string;
  message?: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

/** Keys whose VALUES are never logged, whatever they contain. */
const SENSITIVE_KEY = new RegExp(
  [
    'pass(word|phrase)?',
    'token',
    'secret',
    'api[-_]?key',
    'apikey',
    'authorization',
    'cookie',
    'session',
    'jwt',
    'email',
    'phone',
    'birth',
    'dob',
    'bio',
    'answer',
    'content',
    'body',
    'message_?text',
    'otp',
    'code',
  ].join('|'),
  'i',
);

const REDACTED = '[redacted]';
const MAX_DEPTH = 4;
const MAX_ARRAY = 10;
const MAX_STRING = 200;
const MAX_KEYS = 30;

/**
 * True only for a genuine `{...}` bag.
 *
 * Checking the prototype matters: a class instance is `typeof 'object'` too, and
 * recursing into one would either log `{}` (losing the fact that something was
 * there) or walk an object graph we do not understand.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

/** Truncates a string so a single field cannot flood the log pipeline. */
function clampString(value: string): string {
  return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
}

/** Summarises a non-plain object (a Supabase error, a DOM node, …). */
function summarise(value: object): string {
  const name = value.constructor?.name ?? 'Object';
  return `[${name}]`;
}

/**
 * Makes a value safe to log.
 *
 * * keys matching a sensitive pattern become `[redacted]`
 * * strings are truncated
 * * arrays are capped
 * * objects deeper than `MAX_DEPTH` are collapsed
 * * `Error` instances become their name and message (never a stack in the body)
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return clampString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'function' || typeof value === 'symbol') return '[function]';

  if (value instanceof Error) {
    return {
      name: value.name,
      message: clampString(value.message),
      ...(value.cause === undefined ? {} : { cause: clampString(String(value.cause)) }),
    };
  }

  if (Array.isArray(value)) {
    const shown = value.slice(0, MAX_ARRAY).map((item) => redact(item, depth + 1));
    return value.length > MAX_ARRAY ? [...shown, `…${value.length - MAX_ARRAY} more`] : shown;
  }

  if (!isPlainObject(value)) return summarise(value);

  if (depth >= MAX_DEPTH) return '[depth limit]';

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_KEYS)) {
    result[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1);
  }
  return result;
}

/** Builds the record that will be emitted. Exported so it can be unit-tested. */
export function buildLogRecord(
  level: LogLevel,
  event: string,
  message?: string,
  context?: Record<string, unknown>,
  now: Date = new Date()
): LogRecord {
  return {
    level,
    event,
    ...(message ? { message: clampString(message) } : {}),
    ...(context ? { context: redact(context) as Record<string, unknown> } : {}),
    timestamp: now.toISOString(),
  };
}

function emit(record: LogRecord): void {
  const line = JSON.stringify(record);
  if (record.level === 'error') console.error(line);
  else if (record.level === 'warn') console.warn(line);
  else console.log(line);
}

/**
 * The application logger.
 *
 * `info`/`debug` are emitted in development only, so a production log stays
 * signal. `warn`/`error` always emit.
 */
export const logger = {
  debug(event: string, message?: string, context?: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'development') emit(buildLogRecord('debug', event, message, context));
  },
  info(event: string, message?: string, context?: Record<string, unknown>): void {
    if (process.env.NODE_ENV !== 'production') emit(buildLogRecord('info', event, message, context));
  },
  warn(event: string, message?: string, context?: Record<string, unknown>): void {
    emit(buildLogRecord('warn', event, message, context));
  },
  error(event: string, message?: string, context?: Record<string, unknown>): void {
    emit(buildLogRecord('error', event, message, context));
  },
};

/** Turns an unknown thrown value into a redacted, loggable context object. */
export function errorContext(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: clampString(error.message),
      // Deliberately NOT the stack: it contains absolute paths and sometimes
      // interpolated values. Server logs keep it; the client never sends it.
    };
  }
  return { errorValue: redact(error) };
}
