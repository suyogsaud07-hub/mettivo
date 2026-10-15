import { supabase } from '@/lib/supabase';

/**
 * M8 — interest & prompt catalogue.
 *
 * The catalogue is reference data owned by the database
 * (`supabase/migrations/20261015220000_m8_interest_prompt_catalogue.sql`).
 * Nothing here hard-codes the options: a curator adds an interest with SQL and
 * the wizard picks it up. What this module *does* own is the boundary —
 * narrowing the untrusted response and validating user input before it is
 * written, so a client cannot store an interest id that no other member can
 * ever share (which would silently zero that profile's match score).
 */

/** Maximum selectable interests per profile. Mirrored in the wizard UI. */
export const MAX_INTERESTS = 12;
/** Maximum selectable hobbies per profile. */
export const MAX_HOBBIES = 18;
/** Maximum length of a single prompt answer. */
export const MAX_PROMPT_ANSWER_LENGTH = 500;

export interface InterestCategory {
  id: string;
  label: string;
  icon: string | null;
  sortOrder: number;
}

export interface InterestOption {
  id: string;
  categoryId: string;
  label: string;
  sortOrder: number;
}

export interface PromptOption {
  id: string;
  category: string;
  question: string;
  hint: string | null;
  sortOrder: number;
}

export interface Catalogue {
  categories: InterestCategory[];
  interests: InterestOption[];
  prompts: PromptOption[];
}

/** Raised for an expected failure while loading or validating the catalogue. */
export class CatalogueError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'CatalogueError';
    this.code = code;
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Narrows one catalogue row. Returns `null` rather than casting, so schema
 * drift surfaces as a dropped row instead of `undefined` reaching the UI.
 */
function parseCategory(row: Record<string, unknown>): InterestCategory | null {
  const id = asString(row.id);
  const label = asString(row.label);
  if (!id || !label) return null;
  return { id, label, icon: asString(row.icon), sortOrder: asNumber(row.sort_order) };
}

function parseInterest(row: Record<string, unknown>): InterestOption | null {
  const id = asString(row.id);
  const label = asString(row.label);
  const categoryId = asString(row.category_id);
  if (!id || !label || !categoryId) return null;
  return { id, categoryId, label, sortOrder: asNumber(row.sort_order) };
}

function parsePrompt(row: Record<string, unknown>): PromptOption | null {
  const id = asString(row.id);
  const question = asString(row.question);
  const category = asString(row.category);
  if (!id || !question || !category) return null;
  return {
    id,
    category,
    question,
    hint: asString(row.hint),
    sortOrder: asNumber(row.sort_order),
  };
}

function notNull<T>(value: T | null): value is T {
  return value !== null;
}

/**
 * Loads the whole catalogue in one round trip per table.
 *
 * Throws `CatalogueError` with a user-safe message on failure — a silent empty
 * catalogue would look like "there are no interests", which is a lie.
 */
export async function loadCatalogue(): Promise<Catalogue> {
  const [categoriesResult, interestsResult, promptsResult] = await Promise.all([
    supabase
      .from('interest_categories')
      .select('id, label, icon, sort_order')
      .order('sort_order', { ascending: true }),
    supabase
      .from('interests')
      .select('id, category_id, label, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from('prompt_catalogue')
      .select('id, category, question, hint, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
  ]);

  const failure = categoriesResult.error ?? interestsResult.error ?? promptsResult.error;
  if (failure) {
    console.error('[catalogue] load failed:', failure.message);
    throw new CatalogueError('We could not load the interests list. Please try again.', failure.code);
  }

  const categories = (categoriesResult.data ?? [])
    .map((row) => parseCategory(row as Record<string, unknown>))
    .filter(notNull);
  const interests = (interestsResult.data ?? [])
    .map((row) => parseInterest(row as Record<string, unknown>))
    .filter(notNull);
  const prompts = (promptsResult.data ?? [])
    .map((row) => parsePrompt(row as Record<string, unknown>))
    .filter(notNull);

  return { categories, interests, prompts };
}

/** Groups interests under their category, preserving the database order. */
export function groupInterestsByCategory(
  catalogue: Catalogue
): { category: InterestCategory; interests: InterestOption[] }[] {
  return catalogue.categories
    .map((category) => ({
      category,
      interests: catalogue.interests.filter((interest) => interest.categoryId === category.id),
    }))
    .filter((group) => group.interests.length > 0);
}

/** Keeps only ids the catalogue actually knows about, de-duplicated and capped. */
export function normalizeInterestIds(ids: readonly string[], catalogue: Catalogue): string[] {
  const known = new Set(catalogue.interests.map((interest) => interest.id));
  const seen = new Set<string>();
  const result: string[] = [];

  for (const id of ids) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= MAX_INTERESTS) break;
  }

  return result;
}

/** Trims, de-duplicates and caps a free-text multi-select (hobbies, pets, …). */
export function normalizeLabels(
  values: readonly string[],
  max: number,
  maxLength = 60
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of values) {
    const value = raw.trim().slice(0, maxLength);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= max) break;
  }

  return result;
}

/**
 * Validates prompt answers before they are written to `profiles.prompts`.
 *
 * Returns the cleaned map plus the list of problems, so the caller can surface
 * a per-field message rather than a generic failure. Unknown prompt ids are
 * dropped rather than rejected: removing a prompt from the catalogue must never
 * make an existing profile unsavable.
 */
export function validatePromptAnswers(
  answers: Record<string, string>,
  catalogue: Catalogue
): { answers: Record<string, string>; problems: string[] } {
  const known = new Set(catalogue.prompts.map((prompt) => prompt.id));
  const problems: string[] = [];
  const cleaned: Record<string, string> = {};

  for (const [id, raw] of Object.entries(answers)) {
    if (!known.has(id)) continue;
    const value = raw.trim();
    if (!value) continue;
    if (value.length > MAX_PROMPT_ANSWER_LENGTH) {
      problems.push(`Answer to “${id}” must be ${MAX_PROMPT_ANSWER_LENGTH} characters or fewer.`);
      continue;
    }
    cleaned[id] = value;
  }

  return { answers: cleaned, problems };
}

/**
 * A validation failure the wizard can render directly.
 * `field` mirrors the wizard's `FormState` keys where one exists.
 */
export interface ValidationProblem {
  field: string;
  message: string;
}

/** Validates everything the wizard collects. Pure, so it is unit-tested. */
export function validateInterestsAndPrompts(
  input: { interests: readonly string[]; hobbies: readonly string[]; prompts: Record<string, string> },
  catalogue: Catalogue
): { cleaned: { interests: string[]; hobbies: string[]; prompts: Record<string, string> }; problems: ValidationProblem[] } {
  const problems: ValidationProblem[] = [];

  const interests = normalizeInterestIds(input.interests, catalogue);
  if (input.interests.length > 0 && interests.length === 0) {
    problems.push({
      field: 'interests',
      message: 'None of the selected interests are recognised. Please pick from the list.',
    });
  }
  if (interests.length > MAX_INTERESTS) {
    problems.push({ field: 'interests', message: `Pick at most ${MAX_INTERESTS} interests.` });
  }

  const hobbies = normalizeLabels(input.hobbies, MAX_HOBBIES);
  const { answers: prompts, problems: promptProblems } = validatePromptAnswers(
    input.prompts,
    catalogue
  );
  problems.push(...promptProblems.map((message) => ({ field: 'prompts', message })));

  return { cleaned: { interests, hobbies, prompts }, problems };
}
