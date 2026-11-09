'use client';

import { supabase } from '@/lib/supabase';
import { isMissingRelationError } from '@/lib/postgrest-errors';

/** Flatmate profile as stored in the database. */
export interface FlatmateProfile {
  id: string;
  first_name: string;
  age: number;
  occupation: string | null;
  university_workplace: string | null;
  introduction: string | null;
  general_interests: string[];
  preferred_language: string | null;
  current_city: string | null;
  preferred_living_arrangement: string | null;
  looking_for_room: boolean;
  offering_room: boolean;
  preferred_city: string | null;
  preferred_neighbourhood: string | null;
  rent_budget_min: number | null;
  rent_budget_max: number | null;
  move_in_date: string | null;
  lease_duration_min: number | null;
  lease_duration_max: number | null;
  room_type: string | null;
  furnished: boolean | null;
  private_room: boolean | null;
  existing_occupants: number | null;
  utilities_included: boolean | null;
  accommodation_description: string | null;
  sleeping_schedule: string | null;
  cleanliness: string | null;
  smoking: string | null;
  pets: string | null;
  social_lifestyle: string | null;
  cooking: string | null;
  guests: string | null;
  noise_tolerance: string | null;
  work_study_routine: string | null;
  household_responsibilities: string | null;
  rent_sharing_arrangement: string | null;
  utilities_budget: number | null;
  deposit_expectations: string | null;
  payment_frequency: string | null;
  additional_expenses: string | null;
  is_active: boolean;
  completion_percentage: number;
  photos: string[];
  created_at: string;
  updated_at: string;
}

/** A discovery candidate with compatibility breakdown. */
export interface FlatmateCandidate extends FlatmateProfile {
  compatibility_score: number;
  compatibility_breakdown: FlatmateCompatibilityBreakdown;
  already_interested: boolean;
  already_saved: boolean;
}

/** Compatibility breakdown by category (weights sum to 100). */
export interface FlatmateCompatibilityBreakdown {
  budget_financial: number;   // 25%
  location_accommodation: number; // 20%
  sleeping_schedule: number;   // 15%
  cleanliness: number;         // 15%
  smoking_pets: number;        // 10%
  social_guests: number;       // 10%
  cooking_household: number;   // 5%
  total: number;
  conflicts: string[];         // human-readable conflict descriptions
  matches: string[];           // human-readable match descriptions
}

/** Connection status between the viewer and a target profile. */
export interface FlatmateConnectionStatus {
  interested: boolean;
  saved: boolean;
  skipped: boolean;
}

/** Flatmate discovery filters. */
export interface FlatmateFilters {
  city: string;
  rentMin: number | null;
  rentMax: number | null;
  moveInAfter: string | null;
  sleepingSchedule: string | null;
  cleanliness: string | null;
  smoking: string | null;
  pets: string | null;
}

/** Error raised for flatmate operations. */
export class FlatmateError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'FlatmateError';
    this.code = code;
  }
}

/** Compatibility weights — exported so tests can assert them. */
export const FLATMATE_COMPATIBILITY_WEIGHTS = {
  budget_financial: 25,
  location_accommodation: 20,
  sleeping_schedule: 15,
  cleanliness: 15,
  smoking_pets: 10,
  social_guests: 10,
  cooking_household: 5,
} as const;

/** Minimum completion percentage required to be discoverable. */
export const FLATMATE_MIN_COMPLETION = 50;

/** Parse a raw database row into a FlatmateProfile. */
function parseFlatmateProfile(row: unknown): FlatmateProfile | null {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;

  const photos = Array.isArray(r.photos) ? r.photos.filter((p): p is string => typeof p === 'string') : [];

  return {
    id: typeof r.id === 'string' ? r.id : '',
    first_name: typeof r.first_name === 'string' ? r.first_name : '',
    age: typeof r.age === 'number' ? r.age : 0,
    occupation: typeof r.occupation === 'string' ? r.occupation : null,
    university_workplace: typeof r.university_workplace === 'string' ? r.university_workplace : null,
    introduction: typeof r.introduction === 'string' ? r.introduction : null,
    general_interests: Array.isArray(r.general_interests) ? r.general_interests.filter((i): i is string => typeof i === 'string') : [],
    preferred_language: typeof r.preferred_language === 'string' ? r.preferred_language : null,
    current_city: typeof r.current_city === 'string' ? r.current_city : null,
    preferred_living_arrangement: typeof r.preferred_living_arrangement === 'string' ? r.preferred_living_arrangement : null,
    looking_for_room: typeof r.looking_for_room === 'boolean' ? r.looking_for_room : false,
    offering_room: typeof r.offering_room === 'boolean' ? r.offering_room : false,
    preferred_city: typeof r.preferred_city === 'string' ? r.preferred_city : null,
    preferred_neighbourhood: typeof r.preferred_neighbourhood === 'string' ? r.preferred_neighbourhood : null,
    rent_budget_min: typeof r.rent_budget_min === 'number' ? r.rent_budget_min : null,
    rent_budget_max: typeof r.rent_budget_max === 'number' ? r.rent_budget_max : null,
    move_in_date: typeof r.move_in_date === 'string' ? r.move_in_date : null,
    lease_duration_min: typeof r.lease_duration_min === 'number' ? r.lease_duration_min : null,
    lease_duration_max: typeof r.lease_duration_max === 'number' ? r.lease_duration_max : null,
    room_type: typeof r.room_type === 'string' ? r.room_type : null,
    furnished: typeof r.furnished === 'boolean' ? r.furnished : null,
    private_room: typeof r.private_room === 'boolean' ? r.private_room : null,
    existing_occupants: typeof r.existing_occupants === 'number' ? r.existing_occupants : null,
    utilities_included: typeof r.utilities_included === 'boolean' ? r.utilities_included : null,
    accommodation_description: typeof r.accommodation_description === 'string' ? r.accommodation_description : null,
    sleeping_schedule: typeof r.sleeping_schedule === 'string' ? r.sleeping_schedule : null,
    cleanliness: typeof r.cleanliness === 'string' ? r.cleanliness : null,
    smoking: typeof r.smoking === 'string' ? r.smoking : null,
    pets: typeof r.pets === 'string' ? r.pets : null,
    social_lifestyle: typeof r.social_lifestyle === 'string' ? r.social_lifestyle : null,
    cooking: typeof r.cooking === 'string' ? r.cooking : null,
    guests: typeof r.guests === 'string' ? r.guests : null,
    noise_tolerance: typeof r.noise_tolerance === 'string' ? r.noise_tolerance : null,
    work_study_routine: typeof r.work_study_routine === 'string' ? r.work_study_routine : null,
    household_responsibilities: typeof r.household_responsibilities === 'string' ? r.household_responsibilities : null,
    rent_sharing_arrangement: typeof r.rent_sharing_arrangement === 'string' ? r.rent_sharing_arrangement : null,
    utilities_budget: typeof r.utilities_budget === 'number' ? r.utilities_budget : null,
    deposit_expectations: typeof r.deposit_expectations === 'string' ? r.deposit_expectations : null,
    payment_frequency: typeof r.payment_frequency === 'string' ? r.payment_frequency : null,
    additional_expenses: typeof r.additional_expenses === 'string' ? r.additional_expenses : null,
    is_active: typeof r.is_active === 'boolean' ? r.is_active : false,
    completion_percentage: typeof r.completion_percentage === 'number' ? r.completion_percentage : 0,
    photos,
    created_at: typeof r.created_at === 'string' ? r.created_at : '',
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : '',
  };
}

/** Similarity score for two categorical values: 0 (different/unknown) to 1 (same). */
function categorySimilarity(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  return a.toLowerCase() === b.toLowerCase() ? 1 : 0;
}

/** Similarity for array overlap (interests): 0 to 1. */
function arraySimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0.5; // neutral when both empty
  const setA = new Set(a.map((s) => s.toLowerCase().trim()));
  const setB = new Set(b.map((s) => s.toLowerCase().trim()));
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = Math.max(setA.size, setB.size);
  if (union === 0) return 0.5;
  return intersection / union;
}

/** Numeric range overlap: returns 0-1 based on how much the ranges overlap. */
function rangeOverlap(aMin: number | null, aMax: number | null, bMin: number | null, bMax: number | null): number {
  if (aMin === null || aMax === null || bMin === null || bMax === null) return 0.5; // neutral when missing
  const overlapStart = Math.max(aMin, bMin);
  const overlapEnd = Math.min(aMax, bMax);
  if (overlapStart > overlapEnd) return 0; // no overlap
  const overlap = overlapEnd - overlapStart;
  const span = Math.max(aMax, bMax) - Math.min(aMin, bMin);
  return span === 0 ? 1 : overlap / span;
}

/**
 * Compute compatibility between two flatmate profiles using the documented
 * weighting. Pure and deterministic — same inputs always produce same output.
 */
export function computeFlatmateCompatibility(
  viewer: FlatmateProfile | null,
  candidate: FlatmateProfile
): FlatmateCompatibilityBreakdown {
  const conflicts: string[] = [];
  const matches: string[] = [];

  if (!viewer) {
    const neutralScore = Math.round(
      (Object.values(FLATMATE_COMPATIBILITY_WEIGHTS).reduce((a, b) => a + b, 0)) * 0.5
    );
    return {
      budget_financial: neutralScore,
      location_accommodation: neutralScore,
      sleeping_schedule: neutralScore,
      cleanliness: neutralScore,
      smoking_pets: neutralScore,
      social_guests: neutralScore,
      cooking_household: neutralScore,
      total: neutralScore,
      conflicts: [],
      matches: [],
    };
  }

  // Budget & financial (25%)
  let budgetScore = 0;
  if (viewer?.rent_budget_max !== null && candidate.rent_budget_max !== null) {
    // Compare max budgets: within 20% is good
    const viewerMax = viewer.rent_budget_max;
    const candidateMax = candidate.rent_budget_max;
    const ratio = Math.min(viewerMax, candidateMax) / Math.max(viewerMax, candidateMax);
    budgetScore = Math.round(ratio * FLATMATE_COMPATIBILITY_WEIGHTS.budget_financial);
    if (ratio >= 0.8) matches.push('Similar rent budget');
    else if (ratio < 0.6) conflicts.push('Significant rent budget difference');
  } else if (viewer?.rent_budget_max === null || candidate.rent_budget_max === null) {
    // missing budget info — neutral
    budgetScore = Math.round(FLATMATE_COMPATIBILITY_WEIGHTS.budget_financial * 0.5);
  }

  // Location & accommodation (20%)
  let locationScore = 0;
  if (viewer?.preferred_city && candidate.preferred_city) {
    const sameCity = viewer.preferred_city.toLowerCase().trim() === candidate.preferred_city!.toLowerCase().trim();
    if (sameCity) {
      locationScore += Math.round(FLATMATE_COMPATIBILITY_WEIGHTS.location_accommodation * 0.6);
      matches.push('Same preferred city');
    }
  }
  if (viewer?.room_type && candidate.room_type && viewer.room_type === candidate.room_type) {
    locationScore += Math.round(FLATMATE_COMPATIBILITY_WEIGHTS.location_accommodation * 0.4);
    matches.push('Same room type preference');
  }
  if ((!viewer?.preferred_city || !candidate.preferred_city) && (!viewer?.room_type || !candidate.room_type)) {
    locationScore = Math.round(FLATMATE_COMPATIBILITY_WEIGHTS.location_accommodation * 0.5);
  }

  // Sleeping schedule (15%)
  const sleepScore = categorySimilarity(viewer?.sleeping_schedule, candidate.sleeping_schedule) *
    FLATMATE_COMPATIBILITY_WEIGHTS.sleeping_schedule;
  if (viewer?.sleeping_schedule && candidate.sleeping_schedule && viewer.sleeping_schedule === candidate.sleeping_schedule) {
    matches.push('Compatible sleep schedule');
  } else if (viewer?.sleeping_schedule && candidate.sleeping_schedule && viewer.sleeping_schedule !== candidate.sleeping_schedule) {
    if ((viewer.sleeping_schedule === 'early_sleeper' && candidate.sleeping_schedule === 'night_owl') ||
        (viewer.sleeping_schedule === 'night_owl' && candidate.sleeping_schedule === 'early_sleeper')) {
      conflicts.push('Different sleep schedules');
    }
  }

  // Cleanliness (15%)
  const cleanScore = categorySimilarity(viewer?.cleanliness, candidate.cleanliness) *
    FLATMATE_COMPATIBILITY_WEIGHTS.cleanliness;
  if (viewer?.cleanliness && candidate.cleanliness && viewer.cleanliness === candidate.cleanliness) {
    matches.push('Similar cleanliness standards');
  } else if (viewer?.cleanliness === 'very_tidy' && candidate.cleanliness === 'comfortable_mess') {
    conflicts.push('Cleanliness mismatch');
  }

  // Smoking & pets (10%)
  let smokePetScore = 0;
  const smokeMatch = categorySimilarity(viewer?.smoking, candidate.smoking);
  const petMatch = categorySimilarity(viewer?.pets, candidate.pets);
  smokePetScore = Math.round((smokeMatch + petMatch) / 2 * FLATMATE_COMPATIBILITY_WEIGHTS.smoking_pets);
  if (viewer?.smoking === 'prefers_smoke_free' && candidate.smoking === 'smoker') {
    conflicts.push('Smoking preference conflict');
  }
  if (viewer?.pets === 'no_pets' && candidate.pets === 'has_pets') {
    conflicts.push('Pet preference conflict');
  }

  // Social lifestyle & guests (10%)
  let socialScore = categorySimilarity(viewer?.social_lifestyle, candidate.social_lifestyle) *
    0.5 * FLATMATE_COMPATIBILITY_WEIGHTS.social_guests;
  socialScore += categorySimilarity(viewer?.guests, candidate.guests) *
    0.5 * FLATMATE_COMPATIBILITY_WEIGHTS.social_guests;
  if (viewer?.social_lifestyle && candidate.social_lifestyle && viewer.social_lifestyle === candidate.social_lifestyle) {
    matches.push('Similar social lifestyle');
  }

  // Cooking & household (5%)
  let householdScore = 0;
  if (viewer?.cooking && candidate.cooking && viewer.cooking === candidate.cooking) {
    householdScore += Math.round(FLATMATE_COMPATIBILITY_WEIGHTS.cooking_household * 0.5);
    matches.push('Similar cooking habits');
  }
  if (viewer?.household_responsibilities && candidate.household_responsibilities &&
      viewer.household_responsibilities === candidate.household_responsibilities) {
    householdScore += Math.round(FLATMATE_COMPATIBILITY_WEIGHTS.cooking_household * 0.5);
    matches.push('Similar household responsibilities');
  }

  const total = Math.min(budgetScore + locationScore + sleepScore + cleanScore + smokePetScore + socialScore + householdScore, 100);

  return {
    budget_financial: budgetScore,
    location_accommodation: locationScore,
    sleeping_schedule: sleepScore,
    cleanliness: cleanScore,
    smoking_pets: smokePetScore,
    social_guests: socialScore,
    cooking_household: householdScore,
    total,
    conflicts,
    matches,
  };
}

/**
 * Check whether the viewer meets the candidate's hard constraints (budget,
 * location, move-in timing). Returns false if definitely incompatible.
 */
export function meetsHardConstraints(viewer: FlatmateProfile | null, candidate: FlatmateProfile): boolean {
  if (!viewer) return true;
  // Budget: viewer's max must be >= candidate's min
  if (viewer?.rent_budget_max !== null && candidate.rent_budget_min !== null &&
      viewer.rent_budget_max < candidate.rent_budget_min) return false;
  // Location: if both specified and different, soft conflict (not hard)
  return true;
}

/** Fetch the signed-in member's flatmate profile, or null if none exists. */
export async function fetchFlatmateProfile(): Promise<FlatmateProfile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('flatmate_profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) return null;
    throw new FlatmateError('We could not load your flatmate profile.', error.code);
  }
  if (!data) return null;
  return parseFlatmateProfile(data);
}

/**
 * Save (create or update) the signed-in member's flatmate profile.
 */
export async function saveFlatmateProfile(profile: Partial<FlatmateProfile>): Promise<FlatmateProfile> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new FlatmateError('You must be signed in to do that.', '28000');

  const { data, error } = await supabase.rpc('save_flatmate_profile', {
    p_first_name: profile.first_name ?? '',
    p_age: profile.age ?? 0,
    p_occupation: profile.occupation ?? null,
    p_university_workplace: profile.university_workplace ?? null,
    p_introduction: profile.introduction ?? null,
    p_general_interests: profile.general_interests ?? [],
    p_preferred_language: profile.preferred_language ?? 'en',
    p_current_city: profile.current_city ?? null,
    p_preferred_living_arrangement: profile.preferred_living_arrangement ?? null,
    p_looking_for_room: profile.looking_for_room ?? false,
    p_offering_room: profile.offering_room ?? false,
    p_preferred_city: profile.preferred_city ?? null,
    p_preferred_neighbourhood: profile.preferred_neighbourhood ?? null,
    p_rent_budget_min: profile.rent_budget_min ?? null,
    p_rent_budget_max: profile.rent_budget_max ?? null,
    p_move_in_date: profile.move_in_date ?? null,
    p_lease_duration_min: profile.lease_duration_min ?? null,
    p_lease_duration_max: profile.lease_duration_max ?? null,
    p_room_type: profile.room_type ?? null,
    p_furnished: profile.furnished ?? null,
    p_private_room: profile.private_room ?? null,
    p_existing_occupants: profile.existing_occupants ?? null,
    p_utilities_included: profile.utilities_included ?? null,
    p_accommodation_description: profile.accommodation_description ?? null,
    p_sleeping_schedule: profile.sleeping_schedule ?? null,
    p_cleanliness: profile.cleanliness ?? null,
    p_smoking: profile.smoking ?? null,
    p_pets: profile.pets ?? null,
    p_social_lifestyle: profile.social_lifestyle ?? null,
    p_cooking: profile.cooking ?? null,
    p_guests: profile.guests ?? null,
    p_noise_tolerance: profile.noise_tolerance ?? null,
    p_work_study_routine: profile.work_study_routine ?? null,
    p_household_responsibilities: profile.household_responsibilities ?? null,
    p_rent_sharing_arrangement: profile.rent_sharing_arrangement ?? null,
    p_utilities_budget: profile.utilities_budget ?? null,
    p_deposit_expectations: profile.deposit_expectations ?? null,
    p_payment_frequency: profile.payment_frequency ?? null,
    p_additional_expenses: profile.additional_expenses ?? null,
    p_is_active: profile.is_active ?? true,
    p_photos: profile.photos ?? [],
  });

  if (error) throw new FlatmateError('We could not save your flatmate profile.', error.code);
  if (!data || typeof data !== 'object') throw new FlatmateError('Unexpected response saving profile.');

  const saved = data as Record<string, unknown>;
  return parseFlatmateProfile({
    ...(await fetchFlatmateProfile()),
  }) ?? ({
    id: user.id,
    first_name: profile.first_name ?? '',
    age: profile.age ?? 0,
    is_active: true,
    completion_percentage: typeof saved.completion_percentage === 'number' ? saved.completion_percentage : 0,
    photos: profile.photos ?? [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as FlatmateProfile);
}

/**
 * Fetch eligible flatmate profiles for discovery. Excludes the viewer, blocked
 * pairs, inactive profiles, and profiles below 50% completion.
 */
export async function fetchFlatmateCandidates(opts: {
  city?: string | null;
  rentMin?: number | null;
  rentMax?: number | null;
  moveInAfter?: string | null;
  sleepingSchedule?: string | null;
  cleanliness?: string | null;
  smoking?: string | null;
  pets?: string | null;
  limit?: number;
  excludeIds?: readonly string[];
}): Promise<FlatmateCandidate[]> {
  const {
    city = null,
    rentMin = null,
    rentMax = null,
    moveInAfter = null,
    sleepingSchedule = null,
    cleanliness = null,
    smoking = null,
    pets = null,
    limit = 20,
    excludeIds = [],
  } = opts;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new FlatmateError('You must be signed in to browse flatmates.', '28000');

  let query = supabase
    .from('flatmate_profiles')
    .select('*')
    .eq('is_active', true)
    .gte('completion_percentage', FLATMATE_MIN_COMPLETION)
    .neq('id', user.id)
    .order('completion_percentage', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 50)));

  if (city) query = query.ilike('preferred_city', `%${city}%`);
  if (rentMin !== null) query = query.gte('rent_budget_max', rentMin);
  if (rentMax !== null) query = query.lte('rent_budget_min', rentMax);
  if (moveInAfter) query = query.gte('move_in_date', moveInAfter);
  if (sleepingSchedule) query = query.eq('sleeping_schedule', sleepingSchedule);
  if (cleanliness) query = query.eq('cleanliness', cleanliness);
  if (smoking) query = query.eq('smoking', smoking);
  if (pets) query = query.eq('pets', pets);

  // Exclude blocked pairs (dating blocks carry over)
  const { data: blocked } = await supabase
    .from('blocked_users')
    .select('blocker_id, blocked_user_id')
    .or(`blocker_id.eq.${user.id},blocked_user_id.eq.${user.id}`);
  const blockedIds = new Set<string>();
  (blocked ?? []).forEach((b) => {
    blockedIds.add(b.blocker_id);
    blockedIds.add(b.blocked_user_id);
  });

  // Exclude already-connected (interest/save/skip)
  const { data: connections } = await supabase
    .from('flatmate_connections')
    .select('to_user_id, connection_type')
    .eq('from_user_id', user.id);
  const connectedIds = new Set((connections ?? []).map((c) => c.to_user_id));

  const { data: rows, error } = await query;
  if (error) {
    if (isMissingRelationError(error)) return [];
    throw new FlatmateError('We could not load flatmate profiles.', error.code);
  }

  const viewer = await fetchFlatmateProfile();
  const candidates: FlatmateCandidate[] = [];

  for (const row of rows ?? []) {
    const profile = parseFlatmateProfile(row);
    if (!profile) continue;
    if (blockedIds.has(profile.id)) continue;
    if (connectedIds.has(profile.id)) continue;

    const breakdown = computeFlatmateCompatibility(viewer, profile);
    if (!meetsHardConstraints(viewer, profile)) continue;

    candidates.push({
      ...profile,
      compatibility_score: breakdown.total,
      compatibility_breakdown: breakdown,
      already_interested: false, // populated below
      already_saved: false,      // populated below
    });
  }

  // Mark already-interested / saved
  const { data: interests } = await supabase
    .from('flatmate_connections')
    .select('to_user_id, connection_type')
    .eq('from_user_id', user.id);
  (interests ?? []).forEach((c) => {
    const idx = candidates.findIndex((cand) => cand.id === c.to_user_id);
    if (idx !== -1) {
      if (c.connection_type === 'interest') candidates[idx].already_interested = true;
      if (c.connection_type === 'save') candidates[idx].already_saved = true;
    }
  });

  // Sort by compatibility score desc, then completion desc
  candidates.sort((a, b) => {
    if (b.compatibility_score !== a.compatibility_score) return b.compatibility_score - a.compatibility_score;
    return b.completion_percentage - a.completion_percentage;
  });

  return candidates.slice(0, limit);
}


/** Get connection status for a specific profile. */
export async function getFlatmateConnectionStatus(targetUserId: string): Promise<FlatmateConnectionStatus> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { interested: false, saved: false, skipped: false };

  const { data } = await supabase
    .from('flatmate_connections')
    .select('connection_type')
    .eq('from_user_id', user.id)
    .eq('to_user_id', targetUserId);

  const types = new Set((data ?? []).map((c) => c.connection_type));
  return {
    interested: types.has('interest'),
    saved: types.has('save'),
    skipped: types.has('skip'),
  };
}

/** Express interest in another flatmate profile. Returns mutual status. */
export async function expressFlatmateInterest(targetUserId: string): Promise<{ mutual: boolean }> {
  const { data, error } = await supabase.rpc('express_flatmate_interest', {
    p_target_user_id: targetUserId,
  });
  if (error) throw new FlatmateError('Could not express interest.', error.code);
  return { mutual: typeof data === 'object' && data !== null && (data as Record<string, unknown>).mutual === true };
}

/** Save or unsave a flatmate profile. */
export async function saveFlatmateProfileConnection(targetUserId: string, save: boolean): Promise<void> {
  const { error } = await supabase.rpc('save_flatmate_profile_connection', {
    p_target_user_id: targetUserId,
    p_save: save,
  });
  if (error) throw new FlatmateError('Could not update saved profile.', error.code);
}

/** Report a flatmate profile for abuse. */
export async function reportFlatmateProfile(targetUserId: string, reason: string, details?: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new FlatmateError('You must be signed in to do that.', '28000');

  const { error } = await supabase.from('flatmate_reports').insert({
    reporter_id: user.id,
    reported_user_id: targetUserId,
    reason,
    details: details ?? null,
  });
  if (error) throw new FlatmateError('We could not submit the report.', error.code);
}
