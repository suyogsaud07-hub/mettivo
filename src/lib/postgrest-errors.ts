/**
 * PostgREST / PostgreSQL error classification.
 *
 * WHY THIS EXISTS
 *   The app talks straight to Supabase and the schema is applied by hand from
 *   `supabase/apply_all.sql`. When a deployment is only *partly* migrated — a
 *   bundle truncated mid-file, or a later migration never run — a `select` that
 *   names a not-yet-existing column fails with `42703`, and PostgREST wraps
 *   other drift as `PGRST2xx`. Those are not real outages: the data is there,
 *   only the newest columns are absent. Treating them like a hard failure turns
 *   a cosmetic upgrade into a page that will not load at all.
 *
 *   These predicates let a read distinguish "the schema is behind" (degrade to
 *   the columns that exist) from "something actually broke" (surface the error).
 *   They never swallow a failure: the caller still decides what to do, and a
 *   genuinely missing table is reported by `isMissingRelationError` so the page
 *   can fall back to onboarding rather than pretend the member has no data.
 *
 * Codes are checked first (they are stable); the message is only a backstop for
 * the cases where the code is not surfaced.
 */

/** The structural slice of a supabase-js error these predicates read. */
export interface PostgrestErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

function read(error: unknown): PostgrestErrorLike | null {
  if (!error || typeof error !== 'object') return null;
  return error as PostgrestErrorLike;
}

const MISSING_COLUMN_CODES = new Set([
  '42703', // undefined_column
  'PGRST204', // column not found in the schema cache
]);

const MISSING_RELATION_CODES = new Set([
  '42P01', // undefined_table
  'PGRST202', // function not found in the schema cache
  'PGRST205', // table not found in the schema cache
]);

/**
 * True when an error means a named column does not exist yet — the deployment
 * is behind, not broken. A caller should retry with the columns that do exist.
 */
export function isMissingColumnError(error: unknown): boolean {
  const info = read(error);
  if (!info) return false;

  if (info.code && MISSING_COLUMN_CODES.has(info.code)) return true;

  const message = info.message ?? '';
  return (
    /column\s+.*\s+does not exist/i.test(message) ||
    /could not find the '[^']+' column/i.test(message) ||
    /column .* of relation .* does not exist/i.test(message)
  );
}

/**
 * True when an error means the table, view or function itself is absent — the
 * deployment is older than the feature. Distinct from a missing column so a
 * caller can route to onboarding instead of rendering an empty profile.
 */
export function isMissingRelationError(error: unknown): boolean {
  const info = read(error);
  if (!info) return false;

  if (info.code && MISSING_RELATION_CODES.has(info.code)) return true;

  const message = info.message ?? '';
  return (
    /relation\s+.*\s+does not exist/i.test(message) ||
    /could not find the table/i.test(message) ||
    /could not find the function/i.test(message)
  );
}

/** True when the error is specifically about schema drift of any kind. */
export function isSchemaDriftError(error: unknown): boolean {
  return isMissingColumnError(error) || isMissingRelationError(error);
}
