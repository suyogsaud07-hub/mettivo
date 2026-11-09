'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import MobileNav from '@/app/components/layout/MobileNav';
import {
  saveFlatmateProfile,
  fetchFlatmateProfile,
  FlatmateError,
  type FlatmateProfile,
} from '@/lib/flatmate';

const SLEEP_OPTIONS = [
  { value: 'early_sleeper', label: 'Early sleeper' },
  { value: 'night_owl', label: 'Night owl' },
  { value: 'flexible', label: 'Flexible schedule' },
  { value: 'irregular', label: 'Irregular schedule' },
];
const CLEANLINESS_OPTIONS = [
  { value: 'very_tidy', label: 'Very tidy' },
  { value: 'generally_tidy', label: 'Generally tidy' },
  { value: 'relaxed', label: 'Relaxed' },
  { value: 'comfortable_mess', label: 'Comfortable with mess' },
];
const SMOKING_OPTIONS = [
  { value: 'non_smoker', label: 'Non-smoker' },
  { value: 'smoker', label: 'Smoker' },
  { value: 'comfortable_smokers', label: 'Comfortable living with smokers' },
  { value: 'prefers_smoke_free', label: 'Prefers smoke-free' },
];
const PETS_OPTIONS = [
  { value: 'has_pets', label: 'Has pets' },
  { value: 'likes_pets', label: 'Likes pets' },
  { value: 'comfortable_pets', label: 'Comfortable living with pets' },
  { value: 'no_pets', label: 'No pets' },
];
const SOCIAL_OPTIONS = [
  { value: 'quiet_private', label: 'Quiet & private' },
  { value: 'occasionally_social', label: 'Occasionally social' },
  { value: 'frequently_social', label: 'Frequently social' },
  { value: 'enjoys_hosting', label: 'Enjoys hosting friends' },
];
const COOKING_OPTIONS = [
  { value: 'cooks_regularly', label: 'Cooks regularly' },
  { value: 'occasionally_cooks', label: 'Occasionally cooks' },
  { value: 'orders_food', label: 'Mostly orders food' },
  { value: 'shared_cooking', label: 'Prefers shared cooking' },
];
const GUESTS_OPTIONS = [
  { value: 'occasional_guests', label: 'Comfortable with occasional guests' },
  { value: 'frequently_hosts', label: 'Frequently hosts guests' },
  { value: 'limited_visitors', label: 'Prefers limited visitors' },
  { value: 'no_visitors', label: 'Prefers no visitors' },
];
const NOISE_OPTIONS = [
  { value: 'very_quiet', label: 'Very quiet environment' },
  { value: 'moderate_noise', label: 'Moderate noise acceptable' },
  { value: 'flexible', label: 'Flexible' },
];
const WORK_STUDY_OPTIONS = [
  { value: 'works_from_home', label: 'Works from home' },
  { value: 'studies_from_home', label: 'Studies from home' },
  { value: 'works_outside', label: 'Works outside' },
  { value: 'university_schedule', label: 'University schedule' },
  { value: 'mixed_schedule', label: 'Mixed schedule' },
];
const HOUSEHOLD_OPTIONS = [
  { value: 'shared_cleaning', label: 'Shared cleaning' },
  { value: 'rotating_cleaning', label: 'Rotating cleaning' },
  { value: 'individual_responsibilities', label: 'Individual responsibilities' },
  { value: 'other_arrangements', label: 'Other arrangement' },
];
const RENT_SHARING_OPTIONS = [
  { value: 'equal', label: 'Equal split' },
  { value: 'proportional', label: 'Proportional split' },
  { value: 'room_based', label: 'Room-based split' },
  { value: 'negotiated', label: 'Negotiated' },
];
const PAYMENT_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
];

export default function FlatmateSettings() {
  const router = useRouter();
  const [profile, setProfile] = useState<FlatmateProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  // Form state derived from profile
  const [form, setForm] = useState<{
    firstName: string;
    age: number;
    occupation: string;
    universityWorkplace: string;
    introduction: string;
    generalInterests: string[];
    preferredLanguage: string;
    currentCity: string;
    preferredLivingArrangement: string;
    lookingForRoom: boolean;
    offeringRoom: boolean;
    preferredCity: string;
    preferredNeighbourhood: string;
    rentBudgetMin: number | null;
    rentBudgetMax: number | null;
    moveInDate: string;
    leaseDurationMin: number | null;
    leaseDurationMax: number | null;
    roomType: string;
    furnished: boolean;
    privateRoom: boolean;
    existingOccupants: number | null;
    utilitiesIncluded: boolean;
    accommodationDescription: string;
    sleepingSchedule: string;
    cleanliness: string;
    smoking: string;
    pets: string;
    socialLifestyle: string;
    cooking: string;
    guests: string;
    noiseTolerance: string;
    workStudyRoutine: string;
    householdResponsibilities: string;
    rentSharingArrangement: string;
    utilitiesBudget: number | null;
    depositExpectations: string;
    paymentFrequency: string;
    additionalExpenses: string;
    isActive: boolean;
    photos: string[];
  }>({
    firstName: '',
    age: 18,
    occupation: '',
    universityWorkplace: '',
    introduction: '',
    generalInterests: [],
    preferredLanguage: 'en',
    currentCity: '',
    preferredLivingArrangement: '',
    lookingForRoom: false,
    offeringRoom: false,
    preferredCity: '',
    preferredNeighbourhood: '',
    rentBudgetMin: null,
    rentBudgetMax: null,
    moveInDate: '',
    leaseDurationMin: null,
    leaseDurationMax: null,
    roomType: '',
    furnished: false,
    privateRoom: false,
    existingOccupants: null,
    utilitiesIncluded: false,
    accommodationDescription: '',
    sleepingSchedule: '',
    cleanliness: '',
    smoking: '',
    pets: '',
    socialLifestyle: '',
    cooking: '',
    guests: '',
    noiseTolerance: '',
    workStudyRoutine: '',
    householdResponsibilities: '',
    rentSharingArrangement: '',
    utilitiesBudget: null,
    depositExpectations: '',
    paymentFrequency: '',
    additionalExpenses: '',
    isActive: true,
    photos: [],
  });

  // Load profile on mount
  useEffect(() => {
    cancelledRef.current = false;
    (async () => {
      setLoading(true);
      try {
        const p = await fetchFlatmateProfile();
        if (!cancelledRef.current) {
          if (p) {
            setProfile(p);
            setForm({
              firstName: p.first_name,
              age: p.age,
              occupation: p.occupation ?? '',
              universityWorkplace: p.university_workplace ?? '',
              introduction: p.introduction ?? '',
              generalInterests: p.general_interests,
              preferredLanguage: p.preferred_language ?? 'en',
              currentCity: p.current_city ?? '',
              preferredLivingArrangement: p.preferred_living_arrangement ?? '',
              lookingForRoom: p.looking_for_room,
              offeringRoom: p.offering_room,
              preferredCity: p.preferred_city ?? '',
              preferredNeighbourhood: p.preferred_neighbourhood ?? '',
              rentBudgetMin: p.rent_budget_min,
              rentBudgetMax: p.rent_budget_max,
              moveInDate: p.move_in_date ?? '',
              leaseDurationMin: p.lease_duration_min,
              leaseDurationMax: p.lease_duration_max,
              roomType: p.room_type ?? '',
              furnished: p.furnished ?? false,
              privateRoom: p.private_room ?? false,
              existingOccupants: p.existing_occupants,
              utilitiesIncluded: p.utilities_included ?? false,
              accommodationDescription: p.accommodation_description ?? '',
              sleepingSchedule: p.sleeping_schedule ?? '',
              cleanliness: p.cleanliness ?? '',
              smoking: p.smoking ?? '',
              pets: p.pets ?? '',
              socialLifestyle: p.social_lifestyle ?? '',
              cooking: p.cooking ?? '',
              guests: p.guests ?? '',
              noiseTolerance: p.noise_tolerance ?? '',
              workStudyRoutine: p.work_study_routine ?? '',
              householdResponsibilities: p.household_responsibilities ?? '',
              rentSharingArrangement: p.rent_sharing_arrangement ?? '',
              utilitiesBudget: p.utilities_budget,
              depositExpectations: p.deposit_expectations ?? '',
              paymentFrequency: p.payment_frequency ?? '',
              additionalExpenses: p.additional_expenses ?? '',
              isActive: p.is_active,
              photos: p.photos,
            });
          }
        }
      } catch {
        // ignore - profile may not exist yet
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    })();
    return () => { cancelledRef.current = true; };
  }, []);

  const handleInput = useCallback((key: keyof typeof form, value: string | number | boolean | string[] | null | undefined) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleToggle = useCallback((key: keyof typeof form) => {
    setForm((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleMultiSelect = useCallback((key: keyof typeof form, value: string) => {
    setForm((prev) => {
      const arr = [...(prev[key] as string[])];
      const idx = arr.indexOf(value);
      if (idx >= 0) arr.splice(idx, 1);
      else arr.push(value);
      return { ...prev, [key]: arr };
    });
  }, []);

  const handleSave = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved = await saveFlatmateProfile({
        first_name: form.firstName,
        age: form.age,
        occupation: form.occupation,
        university_workplace: form.universityWorkplace,
        introduction: form.introduction,
        general_interests: form.generalInterests,
        preferred_language: form.preferredLanguage,
        current_city: form.currentCity,
        preferred_living_arrangement: form.preferredLivingArrangement,
        looking_for_room: form.lookingForRoom,
        offering_room: form.offeringRoom,
        preferred_city: form.preferredCity,
        preferred_neighbourhood: form.preferredNeighbourhood,
        rent_budget_min: form.rentBudgetMin,
        rent_budget_max: form.rentBudgetMax,
        move_in_date: form.moveInDate || undefined,
        lease_duration_min: form.leaseDurationMin,
        lease_duration_max: form.leaseDurationMax,
        room_type: form.roomType,
        furnished: form.furnished,
        private_room: form.privateRoom,
        existing_occupants: form.existingOccupants,
        utilities_included: form.utilitiesIncluded,
        accommodation_description: form.accommodationDescription,
        sleeping_schedule: form.sleepingSchedule,
        cleanliness: form.cleanliness,
        smoking: form.smoking,
        pets: form.pets,
        social_lifestyle: form.socialLifestyle,
        cooking: form.cooking,
        guests: form.guests,
        noise_tolerance: form.noiseTolerance,
        work_study_routine: form.workStudyRoutine,
        household_responsibilities: form.householdResponsibilities,
        rent_sharing_arrangement: form.rentSharingArrangement,
        utilities_budget: form.utilitiesBudget,
        deposit_expectations: form.depositExpectations,
        payment_frequency: form.paymentFrequency,
        additional_expenses: form.additionalExpenses,
        is_active: form.isActive,
        photos: form.photos,
      });
      if (!cancelledRef.current) {
        setProfile(saved);
        router.push('/flatmate');
      }
    } catch (err) {
      if (!cancelledRef.current) setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      if (!cancelledRef.current) setSaving(false);
    }
  }, [form, router]);

  if (loading) {
    return (
      <div className="h-screen dvh:h-[100dvh] bg-[#17121A] text-[#F2E9E4] flex flex-col items-center justify-center p-6">
        <div className="w-8 h-8 rounded-full border-4 border-[#D9B38C]/40 border-t-[#D9B38C] animate-spin" />
        <p className="mt-4 text-[#B58A83] text-sm">Loading profile…</p>
        <MobileNav />
      </div>
    );
  }

  const completion = profile?.completion_percentage ?? 0;

  return (
    <div className="h-screen dvh:h-[100dvh] bg-[#17121A] text-[#F2E9E4] overflow-y-auto">
      <header className="px-6 pt-8 pb-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="w-10 h-10 rounded-full bg-[#211A28] border border-[#34283F]/40 flex items-center justify-center text-[#F2E9E4] hover:bg-[#211A28]/60"
        >
          <XIcon size={18} strokeWidth={2} />
        </button>
        <h1 className="text-2xl font-bold text-[#F2E9E4] mt-4">Flatmate profile</h1>
        <p className="text-[#B58A83] text-sm">Complete your flatmate profile to be discoverable.</p>
      </header>

      <form onSubmit={handleSave} className="px-6 pb-20">
        <div className="max-w-xl mx-auto space-y-8">
          {/* Completion banner */}
          <div className="rounded-xl bg-[#211A28] border border-[#34283F]/40 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider">Profile completion</span>
              <span className="text-xs text-[#F2E9E4] font-bold">{completion}%</span>
            </div>
            <div className="w-full h-2 bg-[#34283F]/40 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#D9B38C] rounded-full transition-all duration-500"
                style={{ width: Math.min(100, completion) + '%' }}
              />
            </div>
            {completion < 50 && (
              <p className="text-xs text-[#F3A7AD] mt-1">Complete at least 50% to appear in discovery.</p>
            )}
            {completion >= 50 && (
              <p className="text-xs text-[#10B981] mt-1">You&rsquo;re discoverable!</p>
            )}
          </div>

          {/* Personal information */}
          <section className="space-y-4">
            <h2 className="text-xs font-bold text-[#B58A83] uppercase tracking-wider mb-3">Personal information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs text-[#B58A83] block">First name</label>
                <input
                  type="text"
                  value={form.firstName}
                  onChange={(e) => handleInput('firstName', e.target.value)}
                  placeholder="First name"
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-[#B58A83] block">Age</label>
                <input
                  type="number"
                  min="18"
                  max="99"
                  value={form.age}
                  onChange={(e) => handleInput('age', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-[#B58A83] block">Occupation / study</label>
              <input
                type="text"
                value={form.occupation}
                onChange={(e) => handleInput('occupation', e.target.value)}
                placeholder="e.g. Graphic designer, Nursing student"
                className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-[#B58A83] block">University / workplace</label>
              <input
                type="text"
                value={form.universityWorkplace}
                onChange={(e) => handleInput('universityWorkplace', e.target.value)}
                placeholder="e.g. University of Copenhagen"
                className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-[#B58A83] block">Introduction</label>
              <textarea
                value={form.introduction}
                onChange={(e) => handleInput('introduction', e.target.value)}
                rows={3}
                placeholder="Tell us a bit about yourself…"
                className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-[#B58A83] block">General interests</label>
              <div className="flex flex-wrap gap-2">
                {['Coffee', 'Hiking', 'Music', 'Cooking', 'Movies', 'Travel', 'Gaming', 'Books', 'Yoga', 'Art'].map((interest) => (
                  <button
                    key={interest}
                    type="button"
                    onClick={() => handleMultiSelect('generalInterests', interest)}
                    className={`px-3 py-1.5 rounded-full text-xs transition-colors ${
                      form.generalInterests.includes(interest)
                        ? 'bg-[#D9B38C] text-[#17121A] font-semibold'
                        : 'bg-[#211A28] border border-[#34283F]/40 text-[#B58A83] hover:bg-[#34283F]/40'
                    }`}
                  >
                    {interest}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Accommodation */}
          <section className="space-y-4">
            <h2 className="text-xs font-bold text-[#B58A83] uppercase tracking-wider mb-3">Accommodation</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs text-[#B58A83] block">Current city</label>
                <input
                  type="text"
                  value={form.currentCity}
                  onChange={(e) => handleInput('currentCity', e.target.value)}
                  placeholder="e.g. Copenhagen"
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-[#B58A83] block">Preferred neighbourhood</label>
                <input
                  type="text"
                  value={form.preferredNeighbourhood}
                  onChange={(e) => handleInput('preferredNeighbourhood', e.target.value)}
                  placeholder="e.g. Vesterbro"
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-[#B58A83] block">Preferred city</label>
              <input
                type="text"
                value={form.preferredCity}
                onChange={(e) => handleInput('preferredCity', e.target.value)}
                placeholder="e.g. Copenhagen"
                className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-xs text-[#B58A83] block">Min rent (kr./mo)</label>
                <input
                  type="number"
                  value={form.rentBudgetMin ?? ''}
                  onChange={(e) => handleInput('rentBudgetMin', e.target.value ? Number(e.target.value) : null)}
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-[#B58A83] block">Max rent (kr./mo)</label>
                <input
                  type="number"
                  value={form.rentBudgetMax ?? ''}
                  onChange={(e) => handleInput('rentBudgetMax', e.target.value ? Number(e.target.value) : null)}
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-[#B58A83] block">Move-in date</label>
              <input
                type="date"
                value={form.moveInDate}
                onChange={(e) => handleInput('moveInDate', e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-[#B58A83] block">Lease duration (min months)</label>
              <input
                type="number"
                value={form.leaseDurationMin ?? ''}
                onChange={(e) => handleInput('leaseDurationMin', e.target.value ? Number(e.target.value) : null)}
                placeholder="e.g. 6"
                className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-[#B58A83] block">Lease duration (max months)</label>
              <input
                type="number"
                value={form.leaseDurationMax ?? ''}
                onChange={(e) => handleInput('leaseDurationMax', e.target.value ? Number(e.target.value) : null)}
                placeholder="e.g. 24"
                className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
              />
            </div>
          </section>

          {/* Lifestyle */}
          <section className="space-y-4">
            <h2 className="text-xs font-bold text-[#B58A83] uppercase tracking-wider mb-3">Lifestyle</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs text-[#B58A83] block">Sleeping schedule</label>
                <select
                  value={form.sleepingSchedule}
                  onChange={(e) => handleInput('sleepingSchedule', e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                >
                  <option value="">Any</option>
                  {SLEEP_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-[#B58A83] block">Cleanliness</label>
                <select
                  value={form.cleanliness}
                  onChange={(e) => handleInput('cleanliness', e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                >
                  <option value="">Any</option>
                  {CLEANLINESS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-[#B58A83] block">Smoking</label>
                <select
                  value={form.smoking}
                  onChange={(e) => handleInput('smoking', e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                >
                  <option value="">Any</option>
                  {SMOKING_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-[#B58A83] block">Pets</label>
                <select
                  value={form.pets}
                  onChange={(e) => handleInput('pets', e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                >
                  <option value="">Any</option>
                  {PETS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs text-[#B58A83] block">Social lifestyle</label>
                <select
                  value={form.socialLifestyle}
                  onChange={(e) => handleInput('socialLifestyle', e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                >
                  <option value="">Any</option>
                  {SOCIAL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-[#B58A83] block">Cooking</label>
                <select
                  value={form.cooking}
                  onChange={(e) => handleInput('cooking', e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                >
                  <option value="">Any</option>
                  {COOKING_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-[#B58A83] block">Guests</label>
                <select
                  value={form.guests}
                  onChange={(e) => handleInput('guests', e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                >
                  <option value="">Any</option>
                  {GUESTS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-[#B58A83] block">Noise tolerance</label>
                <select
                  value={form.noiseTolerance}
                  onChange={(e) => handleInput('noiseTolerance', e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                >
                  <option value="">Any</option>
                  {NOISE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-[#B58A83] block">Work/study routine</label>
                <select
                  value={form.workStudyRoutine}
                  onChange={(e) => handleInput('workStudyRoutine', e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                >
                  <option value="">Any</option>
                  {WORK_STUDY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-[#B58A83] block">Household responsibilities</label>
                <select
                  value={form.householdResponsibilities}
                  onChange={(e) => handleInput('householdResponsibilities', e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                >
                  <option value="">Any</option>
                  {HOUSEHOLD_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Financial */}
          <section className="space-y-4">
            <h2 className="text-xs font-bold text-[#B58A83] uppercase tracking-wider mb-3">Financial</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs text-[#B58A83] block">Rent sharing arrangement</label>
                <select
                  value={form.rentSharingArrangement}
                  onChange={(e) => handleInput('rentSharingArrangement', e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                >
                  <option value="">Any</option>
                  {RENT_SHARING_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-[#B58A83] block">Utilities budget (kr./mo)</label>
                <input
                  type="number"
                  value={form.utilitiesBudget ?? ''}
                  onChange={(e) => handleInput('utilitiesBudget', e.target.value ? Number(e.target.value) : null)}
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-[#B58A83] block">Payment frequency</label>
                <select
                  value={form.paymentFrequency}
                  onChange={(e) => handleInput('paymentFrequency', e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                >
                  <option value="">Any</option>
                  {PAYMENT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-[#B58A83] block">Deposit expectations</label>
              <input
                type="text"
                value={form.depositExpectations}
                onChange={(e) => handleInput('depositExpectations', e.target.value)}
                placeholder="e.g. 3 months rent"
                className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-[#B58A83] block">Additional expenses</label>
              <input
                type="text"
                value={form.additionalExpenses}
                onChange={(e) => handleInput('additionalExpenses', e.target.value)}
                placeholder="e.g. Parking, storage"
                className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
              />
            </div>
          </section>

          <button
            type="submit"
            disabled={saving}
            className="w-full px-6 py-3.5 rounded-xl bg-[#D9B38C] text-[#17121A] font-semibold text-sm shadow-lg hover:bg-[#cfab83] active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>
      <MobileNav />
    </div>
  );
}

function XIcon({
  size = 18,
  strokeWidth = 2,
}: {
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
