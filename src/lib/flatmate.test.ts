import { describe, expect, it } from 'vitest';
import {
  computeFlatmateCompatibility,
  meetsHardConstraints,
  FLATMATE_COMPATIBILITY_WEIGHTS,
  FLATMATE_MIN_COMPLETION,
  type FlatmateProfile,
} from '@/lib/flatmate';

const baseProfile = (overrides: Partial<FlatmateProfile> = {}): FlatmateProfile => ({
  id: 'user-1',
  first_name: 'Alex',
  age: 28,
  occupation: 'Engineer',
  university_workplace: null,
  introduction: 'Looking for a flatmate.',
  general_interests: ['music'],
  preferred_language: 'en',
  current_city: 'Kathmandu',
  preferred_living_arrangement: 'roommate',
  looking_for_room: true,
  offering_room: false,
  preferred_city: 'Kathmandu',
  preferred_neighbourhood: 'Thamel',
  rent_budget_min: 500,
  rent_budget_max: 800,
  move_in_date: '2027-01-01',
  lease_duration_min: 6,
  lease_duration_max: 12,
  room_type: 'private',
  furnished: true,
  private_room: true,
  existing_occupants: 2,
  utilities_included: true,
  accommodation_description: 'Bright flat.',
  sleeping_schedule: 'early_sleeper',
  cleanliness: 'very_tidy',
  smoking: 'non_smoker',
  pets: 'no_pets',
  social_lifestyle: 'quiet_private',
  cooking: 'cooks_regularly',
  guests: 'occasional_guests',
  noise_tolerance: 'very_quiet',
  work_study_routine: 'works_from_home',
  household_responsibilities: 'shared_cleaning',
  rent_sharing_arrangement: 'equal',
  utilities_budget: 100,
  deposit_expectations: 'One month',
  payment_frequency: 'monthly',
  additional_expenses: null,
  is_active: true,
  completion_percentage: 100,
  photos: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('computeFlatmateCompatibility — documented weighting', () => {
  it('weights sum to 100', () => {
    const total = Object.values(FLATMATE_COMPATIBILITY_WEIGHTS).reduce(
      (a, b) => a + b,
      0
    );
    expect(total).toBe(100);
  });

  it('minimum completion threshold is 50', () => {
    expect(FLATMATE_MIN_COMPLETION).toBe(50);
  });

  it('a viewer with no profile earns zero compatibility (missing data is not compatibility)', () => {
    const result = computeFlatmateCompatibility(null, baseProfile());
    expect(result.total).toBe(0);
    expect(result.conflicts).toEqual([]);
    expect(result.matches).toEqual([]);
  });

  it('two identical profiles score 100 across every category', () => {
    const viewer = baseProfile({ id: 'viewer-1' });
    const candidate = baseProfile({ id: 'candidate-1' });
    const result = computeFlatmateCompatibility(viewer, candidate);
    expect(result.total).toBe(100);
    expect(result.budget_financial).toBe(25);
    expect(result.location_accommodation).toBe(20);
    expect(result.sleeping_schedule).toBe(15);
    expect(result.cleanliness).toBe(15);
    expect(result.smoking_pets).toBe(10);
    expect(result.social_guests).toBe(10);
    expect(result.cooking_household).toBe(5);
  });

  it('missing budget on either side earns no budget points', () => {
    const viewer = baseProfile({ id: 'v', rent_budget_max: null });
    const candidate = baseProfile({ id: 'c', rent_budget_max: 900 });
    const result = computeFlatmateCompatibility(viewer, candidate);
    expect(result.budget_financial).toBe(0);
    expect(result.total).toBeLessThan(100);
  });

  it('significantly different budgets register a conflict and low score', () => {
    const viewer = baseProfile({ id: 'v', rent_budget_max: 400 });
    const candidate = baseProfile({ id: 'c', rent_budget_max: 1000 });
    const result = computeFlatmateCompatibility(viewer, candidate);
    expect(result.conflicts).toContain('Significant rent budget difference');
    expect(result.budget_financial).toBeLessThan(25);
  });

  it('same preferred city earns location points', () => {
    const viewer = baseProfile({ id: 'v', preferred_city: 'Pokhara' });
    const candidate = baseProfile({ id: 'c', preferred_city: 'Pokhara' });
    const result = computeFlatmateCompatibility(viewer, candidate);
    expect(result.matches).toContain('Same preferred city');
    expect(result.location_accommodation).toBeGreaterThan(0);
  });

  it('different sleep schedules register a conflict for early_sleeper vs night_owl', () => {
    const viewer = baseProfile({ id: 'v', sleeping_schedule: 'early_sleeper' });
    const candidate = baseProfile({ id: 'c', sleeping_schedule: 'night_owl' });
    const result = computeFlatmateCompatibility(viewer, candidate);
    expect(result.conflicts).toContain('Different sleep schedules');
    expect(result.sleeping_schedule).toBe(0);
  });

  it('smoking prefers_smoke_free vs smoker registers a conflict', () => {
    const viewer = baseProfile({ id: 'v', smoking: 'prefers_smoke_free' });
    const candidate = baseProfile({ id: 'c', smoking: 'smoker' });
    const result = computeFlatmateCompatibility(viewer, candidate);
    expect(result.conflicts).toContain('Smoking preference conflict');
    expect(result.smoking_pets).toBeLessThan(10);
  });

  it('pets no_pets vs has_pets registers a conflict', () => {
    const viewer = baseProfile({ id: 'v', pets: 'no_pets' });
    const candidate = baseProfile({ id: 'c', pets: 'has_pets' });
    const result = computeFlatmateCompatibility(viewer, candidate);
    expect(result.conflicts).toContain('Pet preference conflict');
    expect(result.smoking_pets).toBeLessThan(10);
  });

  it('cleanliness very_tidy vs comfortable_mess registers a conflict', () => {
    const viewer = baseProfile({ id: 'v', cleanliness: 'very_tidy' });
    const candidate = baseProfile({ id: 'c', cleanliness: 'comfortable_mess' });
    const result = computeFlatmateCompatibility(viewer, candidate);
    expect(result.conflicts).toContain('Cleanliness mismatch');
    expect(result.cleanliness).toBe(0);
  });
});

describe('meetsHardConstraints — hard budget gate', () => {
  it('returns false when viewer max rent is below candidate min rent', () => {
    const viewer = baseProfile({ id: 'v', rent_budget_max: 500 });
    const candidate = baseProfile({ id: 'c', rent_budget_min: 900 });
    expect(meetsHardConstraints(viewer, candidate)).toBe(false);
  });

  it('returns true when viewer max rent covers candidate min rent', () => {
    const viewer = baseProfile({ id: 'v', rent_budget_max: 1200 });
    const candidate = baseProfile({ id: 'c', rent_budget_min: 900 });
    expect(meetsHardConstraints(viewer, candidate)).toBe(true);
  });

  it('returns true when viewer has no profile', () => {
    expect(meetsHardConstraints(null, baseProfile())).toBe(true);
  });
});
