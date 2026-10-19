/**
 * M30 — the moderation decision engine.
 *
 * DETERMINISTIC, PURE, AND THE AUTHORITY ON *SHAPE*
 *   This module turns a report (plus an optional AI advisory) into a structured
 *   assessment: an outcome, a severity, the policy sections implicated,
 *   confirmed facts vs allegations vs missing evidence, and a recommended
 *   action with an explicit "human approval required" flag.
 *
 *   The language model is only ever one *input* (`ReportSignal`). It can raise
 *   the severity and inform the recommendation, but it can never:
 *     • confirm a violation on its own — confidence is not proof;
 *     • treat multiple reports as proof — a coordinated pile-on is a signal to
 *       investigate, not a verdict;
 *     • be granted authority by text inside a report — report content is
 *       untrusted data and any imperative in it is ignored (`injectionSignals`).
 *
 *   Nothing here writes to the database. Enforcement stays in the existing,
 *   moderator-gated RPCs (`admin_resolve_report`, `admin_apply_moderation_action`).
 */

import {
  POLICY_VERSION,
  isUrgentCategory,
  policyRefsForCategory,
  severityForCategory,
  type PolicySeverity,
} from '@/lib/moderation/policy';

export type { PolicySeverity };

/** The possible verdicts. `confirmed_violation` is human-only; the engine never returns it. */
export type TriageOutcome =
  | 'no_violation'
  | 'insufficient_evidence'
  | 'possible_violation'
  | 'confirmed_violation'
  | 'urgent_safety_review';

export type RecommendedAction =
  | 'dismiss'
  | 'request_more_evidence'
  | 'warn'
  | 'suspend'
  | 'permanent_ban'
  | 'escalate';

/** One report as the engine sees it. Free text is untrusted. */
export interface ReportRecord {
  reportId: string;
  category: string;
  targetType: string | null;
  targetId: string | null;
  details: string | null;
  /** Whether the report carried an image snapshot. */
  hasEvidenceImage: boolean;
  reporterId: string;
  reportedId: string;
  status: string;
  createdAt: string | null;
}

/** The AI's advisory. Never authoritative. */
export interface ReportSignal {
  source: 'ai';
  /** One of `POLICY_SECTIONS` ids the model believes applies, or null. */
  suggestedSection: string | null;
  /** Whether the model believes the report shows a likely violation. */
  likelyViolation: boolean;
  /** Model confidence in [0,1]. Not a probability of guilt. */
  confidence: number;
  rationale: string | null;
  model: string;
}

export interface TriageInput {
  report: ReportRecord;
  /** Other reports against the same account, for duplicate/coordination detection. */
  relatedReports?: ReportRecord[];
  signal?: ReportSignal | null;
}

export interface TriageAssessment {
  caseId: string;
  reportId: string;
  policyVersion: string;
  policyRefs: string[];
  outcome: TriageOutcome;
  severity: PolicySeverity;
  /** 0 when there is no signal — confidence is never fabricated. */
  confidence: number;
  confirmedFacts: string[];
  allegations: string[];
  missingEvidence: string[];
  reasons: string[];
  recommendedAction: RecommendedAction | null;
  requiresHumanApproval: boolean;
  /** True only for a low-severity warning the policy permits without a human. */
  autoWarnEligible: boolean;
  duplicateReportCount: number;
  distinctReporterCount: number;
  coordinatedReporting: boolean;
  /** Instruction-like text found in the report body (treated as data, never obeyed). */
  injectionSignals: string[];
}

// ---------------------------------------------------------------------------
// Thresholds. Calibrated to be conservative: it is better to ask a human for
// more evidence than to recommend punishing on a weak signal.
// ---------------------------------------------------------------------------

/** A model this sure may raise severity, but still cannot confirm a violation. */
const AI_CONFIDENCE_HIGH = 0.75;
/** Below this, even a "violation" reading is treated as no usable signal. */
const AI_CONFIDENCE_LOW = 0.4;
/** Independent reporters within the window that suggest coordination. */
const COORDINATED_REPORTER_THRESHOLD = 3;
const COORDINATED_WINDOW_HOURS = 24;
const MAX_DETAILS_CHARS = 1_000;
const MAX_ALLEGATION_CHARS = 500;

const SEVERITY_RANK: Record<PolicySeverity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function maxSeverity(a: PolicySeverity, b: PolicySeverity): PolicySeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Phrases that suggest the report body is trying to instruct the system. */
const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore (all |the )?(previous|prior|above) instructions?/i,
  /disregard (the )?(system|policy|guidelines|rules)/i,
  /\b(bans?|suspend|delete|punish|terminate|remove) (this |the )?(user|account|member)/i,
  /you (must|should|will) (ban|suspend|delete|punish)/i,
  /\b(system|developer|assistant)\s*:/i,
  /as an ai,? you (must|will|should)/i,
  /grant me (admin|moderator|access)/i,
];

/**
 * Finds instruction-like text in untrusted report content.
 *
 * This does not change the outcome — it only records what it saw so a human is
 * warned that the content may be a prompt-injection attempt. The engine never
 * obeys it.
 */
export function detectInjectionSignals(text: string | null): string[] {
  if (!text) return [];
  const haystack = text.slice(0, MAX_DETAILS_CHARS);
  const found: string[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    const match = pattern.exec(haystack);
    if (match) found.push(match[0].slice(0, 80));
  }
  return found;
}

export interface DuplicateSummary {
  total: number;
  distinctReporters: number;
  withinWindow: number;
  coordinated: boolean;
}

/** Groups reports by reporter and counts how many landed in a recent window. */
export function detectDuplicateReports(reports: ReportRecord[], now = Date.now()): DuplicateSummary {
  const reporters = new Set<string>();
  const windowMs = COORDINATED_WINDOW_HOURS * 60 * 60 * 1000;
  let withinWindow = 0;

  for (const report of reports) {
    reporters.add(report.reporterId);
    if (!report.createdAt) {
      // A report with no timestamp still counts as a reporter, just not "recent".
      continue;
    }
    const at = new Date(report.createdAt).getTime();
    if (!Number.isNaN(at) && now - at <= windowMs) withinWindow += 1;
  }

  return {
    total: reports.length,
    distinctReporters: reporters.size,
    withinWindow,
    coordinated: reporters.size >= COORDINATED_REPORTER_THRESHOLD && withinWindow >= COORDINATED_REPORTER_THRESHOLD,
  };
}

function recommendationFor(
  outcome: TriageOutcome,
  severity: PolicySeverity,
  coordinated: boolean
): RecommendedAction | null {
  switch (outcome) {
    case 'no_violation':
      return 'dismiss';
    case 'insufficient_evidence':
      // A coordinated pile-on with no evidence is exactly when to slow down.
      return 'request_more_evidence';
    case 'urgent_safety_review':
      return 'escalate';
    case 'confirmed_violation':
      return severity === 'critical' ? 'permanent_ban' : 'suspend';
    case 'possible_violation':
      if (severity === 'critical') return 'escalate';
      if (severity === 'high') return 'suspend';
      if (severity === 'medium') return 'warn';
      return coordinated ? 'request_more_evidence' : 'warn';
  }
}

/**
 * Builds the structured assessment for one report.
 *
 * `caseId` is deterministic (`case_<reportId>`), so re-running triage for the
 * same report never creates a second, divergent case.
 */
export function assessReport(input: TriageInput, now = Date.now()): TriageAssessment {
  const { report, signal = null } = input;
  const related = input.relatedReports ?? [];
  const allReportsForTarget = [report, ...related.filter((r) => r.reportId !== report.reportId)];
  const duplicates = detectDuplicateReports(allReportsForTarget, now);

  const injectionSignals = detectInjectionSignals(report.details);

  const categorySeverity = severityForCategory(report.category);
  const signalSeverity =
    signal && signal.suggestedSection
      ? severityForCategory(signal.suggestedSection)
      : 'none';
  let severity = maxSeverity(categorySeverity, signalSeverity);

  const policyRefs = policyRefsForCategory(report.category);
  if (
    signal?.suggestedSection &&
    !policyRefs.includes(signal.suggestedSection) &&
    policyRefs.length < 4
  ) {
    policyRefs.push(signal.suggestedSection);
  }

  // --- Outcome -------------------------------------------------------------
  const urgent = isUrgentCategory(report.category);
  let outcome: TriageOutcome;
  const reasons: string[] = [];

  if (urgent) {
    outcome = 'urgent_safety_review';
    severity = 'critical';
    reasons.push('The category is a safety escalation and always requires a human.');
  } else if (!signal) {
    outcome = 'insufficient_evidence';
    reasons.push('No verified evidence and no AI signal: a report alone is not proof.');
  } else if (!signal.likelyViolation) {
    outcome = signal.confidence >= AI_CONFIDENCE_HIGH ? 'no_violation' : 'insufficient_evidence';
    reasons.push(
      signal.confidence >= AI_CONFIDENCE_HIGH
        ? 'The classifier found no violation with high confidence.'
        : 'The classifier found no violation, but with low confidence.'
    );
  } else if (signal.confidence >= AI_CONFIDENCE_LOW) {
    // Even a confident model cannot *confirm*; only a human can.
    outcome = 'possible_violation';
    reasons.push('The classifier suggests a violation; a human must confirm it.');
  } else {
    outcome = 'insufficient_evidence';
    reasons.push('The classifier flagged a violation only weakly; that is not enough to act.');
  }

  if (duplicates.coordinated) {
    reasons.push(
      `${duplicates.distinctReporters} independent reporters filed within ${COORDINATED_WINDOW_HOURS}h; investigate for coordinated reporting rather than treating volume as proof.`
    );
  }
  if (injectionSignals.length > 0) {
    reasons.push('The report body contained instruction-like text; it was treated as data, not obeyed.');
  }

  // --- Evidence bookkeeping ------------------------------------------------
  const confirmedFacts: string[] = [
    `A report (${report.category}) was filed against the reported account.`,
  ];
  if (duplicates.total > 1) {
    confirmedFacts.push(`${duplicates.total} reports reference this account in total.`);
  }

  const allegations: string[] = [];
  if (report.details && report.details.trim().length > 0) {
    allegations.push(report.details.trim().slice(0, MAX_ALLEGATION_CHARS));
  } else {
    allegations.push('No written detail was supplied with the report.');
  }

  const missingEvidence: string[] = [];
  const mediaCategories = new Set(['explicit_media', 'indecent_live', 'nudity']);
  if (mediaCategories.has(report.category) && !report.hasEvidenceImage) {
    missingEvidence.push('No image snapshot was attached for a report that needs visual evidence.');
  }
  if (!report.details || report.details.trim().length < 10) {
    missingEvidence.push('The written report is too short to establish context (e.g. quotation, sarcasm).');
  }
  if (report.targetType === 'user' && !report.targetId) {
    missingEvidence.push('No specific message/media id was referenced, so the exact content could not be located.');
  }

  const recommendation = recommendationFor(outcome, severity, duplicates.coordinated);

  // A warning is the only action the policy may allow without a human, and only
  // when the signal is strong and clean. Everything else needs approval.
  const autoWarnEligible =
    recommendation === 'warn' &&
    severity === 'low' &&
    !duplicates.coordinated &&
    injectionSignals.length === 0 &&
    signal !== null &&
    signal.likelyViolation &&
    signal.confidence >= AI_CONFIDENCE_HIGH;

  const requiresHumanApproval =
    recommendation === 'dismiss' || recommendation === 'request_more_evidence'
      ? false
      : !autoWarnEligible;

  return {
    caseId: `case_${report.reportId}`,
    reportId: report.reportId,
    policyVersion: POLICY_VERSION,
    policyRefs,
    outcome,
    severity,
    confidence: signal ? clampConfidence(signal.confidence) : 0,
    confirmedFacts,
    allegations,
    missingEvidence,
    reasons,
    recommendedAction: recommendation,
    requiresHumanApproval,
    autoWarnEligible,
    duplicateReportCount: duplicates.total,
    distinctReporterCount: duplicates.distinctReporters,
    coordinatedReporting: duplicates.coordinated,
    injectionSignals,
  };
}
