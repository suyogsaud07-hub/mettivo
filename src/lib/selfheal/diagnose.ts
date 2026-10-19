/**
 * M30 — error diagnosis (Phase 4.A), deliberately *advisory only*.
 *
 * WHAT THIS IS
 *   A deterministic classifier that turns a sanitized application error into a
 *   likely category, a plain-language cause, and the area of the codebase to
 *   inspect. It has no filesystem, shell, database or deployment access, and it
 *   never edits code.
 *
 * WHAT THIS IS NOT — AND WHY
 *   There is no automated patch/apply/test/rollback workflow, because this
 *   project has no isolated execution sandbox (no container runner, no scoped
 *   git worktree service, no resource-limited build worker). Claiming "Subbu
 *   fixed a bug" from inside a shared serverless function would be unsafe and
 *   unverifiable. Accordingly:
 *
 *     • every result sets `safeToAutoFix: false` and `requiresHumanReview: true`;
 *     • the classifier is a *recommendation*, never an action.
 *
 *   See the final report's "Self-healing capabilities" section for the exact
 *   infrastructure that would be required to make patching operational.
 */

/** Broad families a sanitized error signature falls into. */
export type DiagnosisCategory =
  | 'configuration'
  | 'authentication'
  | 'authorization'
  | 'timeout'
  | 'network'
  | 'schema_mismatch'
  | 'missing_migration'
  | 'validation'
  | 'null_reference'
  | 'rate_limit'
  | 'provider_outage'
  | 'unknown';

export interface DiagnosisInput {
  /** A sanitized error message (never raw secrets or full stack traces). */
  message: string;
  /** The error's `name`, when available. */
  name?: string | null;
  /** The route or module where it surfaced, for orientation. */
  route?: string | null;
}

export interface Diagnosis {
  category: DiagnosisCategory;
  likelyCause: string;
  /** Where to look next. A hint, not a fix. */
  inspectArea: string;
  /** 0..1 confidence in the *classification*, not in any fix. */
  confidence: number;
  notes: string[];
  /** Always false here: diagnosis never mutates anything. */
  safeToAutoFix: false;
  requiresHumanReview: true;
}

interface Rule {
  category: DiagnosisCategory;
  patterns: RegExp[];
  likelyCause: string;
  inspectArea: string;
  confidence: number;
}

const RULES: readonly Rule[] = [
  {
    category: 'configuration',
    patterns: [
      /is not configured/i,
      /missing .*(key|config|secret|env)/i,
      /api[_ ]?key is not set/i,
      /ai_moderation_api_key/i,
    ],
    likelyCause: 'A required environment variable or credential is absent.',
    inspectArea: '.env.local / Vercel project environment variables',
    confidence: 0.9,
  },
  {
    category: 'authentication',
    patterns: [
      /invalid[_ ]api[_ ]key/i,
      /invalid api key/i,
      /\bHTTP 401\b/,
      /\bHTTP 403\b/,
      /unauthori[sz]ed/i,
    ],
    likelyCause: 'The upstream provider rejected the configured credential.',
    inspectArea: 'AI provider key / service credentials',
    confidence: 0.85,
  },
  {
    category: 'authorization',
    patterns: [
      /permission denied/i,
      /row-level security/i,
      /new row violates row-level security/i,
      /is not a moderator/i,
      /forbidden/i,
    ],
    likelyCause: 'A database policy or role gate denied the operation.',
    inspectArea: 'RLS policies / `is_moderator()` and SECURITY DEFINER functions',
    confidence: 0.8,
  },
  {
    category: 'timeout',
    patterns: [/timed out/i, /timeout/i, /\babort/i, /did not answer in time/i],
    likelyCause: 'The operation exceeded its time budget or was aborted.',
    inspectArea: 'route `maxDuration` and upstream AbortController budget',
    confidence: 0.8,
  },
  {
    category: 'network',
    patterns: [/econnrefused/i, /enotfound/i, /socket hang up/i, /fetch failed/i, /network/i],
    likelyCause: 'A network call could not reach its host.',
    inspectArea: 'provider base URL / connect-src CSP / DNS',
    confidence: 0.7,
  },
  {
    category: 'schema_mismatch',
    patterns: [
      /column .* does not exist/i,
      /operator does not exist/i,
      /cannot cast/i,
    ],
    likelyCause: 'Code expects a column type the database does not have.',
    inspectArea: 'the migration that defines the affected table/column',
    confidence: 0.85,
  },
  {
    category: 'missing_migration',
    patterns: [/relation .* does not exist/i, /function .* does not exist/i, /could not find the function/i],
    likelyCause: 'A migration has not been applied to this database.',
    inspectArea: 'supabase/migrations/ (and supabase/apply_all.sql)',
    confidence: 0.85,
  },
  {
    category: 'validation',
    patterns: [/invalid input (syntax|value)/i, /invalid .*body/i, /payload_too_large/i, /too large/i],
    likelyCause: 'A request failed a shape or size check.',
    inspectArea: 'the route body validation for the failing endpoint',
    confidence: 0.7,
  },
  {
    category: 'null_reference',
    patterns: [/cannot read propert(y|ies) of (undefined|null)/i, /undefined is not/i, /is not a function/i],
    likelyCause: 'A value was assumed present but was null/undefined.',
    inspectArea: 'the function named in the sanitized stack',
    confidence: 0.6,
  },
  {
    category: 'rate_limit',
    patterns: [/rate[_ ]?limit/i, /\bHTTP 429\b/, /too many requests/i],
    likelyCause: 'A rate limit was hit (ours or the provider’s).',
    inspectArea: 'route rate limiter and provider quota',
    confidence: 0.8,
  },
  {
    category: 'provider_outage',
    patterns: [/\bHTTP 5\d\d\b/, /service unavailable/i, /upstream_error/i, /bad gateway/i],
    likelyCause: 'An upstream provider is failing or unreachable.',
    inspectArea: 'provider status / retry-and-backoff budget',
    confidence: 0.7,
  },
];

/**
 * Classifies a sanitized error. Deterministic and side-effect free.
 *
 * The confidence attached is confidence in the *category match*, and is capped
 * well below 1: a diagnosis is a starting point for a human, not a conclusion.
 */
export function diagnoseError(input: DiagnosisInput): Diagnosis {
  const haystack = `${input.name ?? ''} ${input.message}`.trim();

  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      return {
        category: rule.category,
        likelyCause: rule.likelyCause,
        inspectArea: rule.inspectArea,
        confidence: rule.confidence,
        notes: input.route ? [`Surfaced in ${input.route}.`] : [],
        safeToAutoFix: false,
        requiresHumanReview: true,
      };
    }
  }

  return {
    category: 'unknown',
    likelyCause: 'The error did not match a known signature.',
    inspectArea: input.route ?? 'the sanitized stack and recent deploy diff',
    confidence: 0.2,
    notes: [
      'Needs a human to read the sanitized stack and correlate with a recent change.',
      ...(input.route ? [`Surfaced in ${input.route}.`] : []),
    ],
    safeToAutoFix: false,
    requiresHumanReview: true,
  };
}
