'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  MAX_BIO_LENGTH,
  MIN_AGE,
  calculateAge,
  saveProfile,
  validateProfileDraft,
  type ProfileDraft,
} from '@/lib/profile';
import { MAX_PROMPT_ANSWER_LENGTH, loadCatalogue, type Catalogue } from '@/lib/catalogue';
import { LOCALE_OPTIONS } from '@/lib/locales';
import {
  FIELD_TO_STEP,
  ONBOARDING_GENDERS,
  ONBOARDING_TOTAL_STEPS,
  validateOnboardingStep,
} from '@/lib/onboarding-steps';
import PhotoUploadStep from '@/app/components/profile/PhotoUploadStep';
import {
  PROFILE_DRINKING_OPTIONS,
  PROFILE_HOBBIES_OPTIONS as HOBBIES_LIST,
  PROFILE_INTENTION_OPTIONS as INTENTIONS,
  PROFILE_LOOKING_FOR_OPTIONS,
  PROFILE_PETS_OPTIONS as PETS_OPTIONS,
  PROFILE_SMOKING_OPTIONS,
} from '@/lib/profile-options';

const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan",
  "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia",
  "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Cambodia", "Cameroon", "Canada", "Chile", "China",
  "Colombia", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic", "Denmark", "Dominican Republic", "Ecuador", "Egypt",
  "El Salvador", "Estonia", "Ethiopia", "Fiji", "Finland", "France", "Georgia", "Germany", "Ghana", "Greece",
  "Guatemala", "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel",
  "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kuwait", "Latvia", "Lebanon", "Libya",
  "Lithuania", "Luxembourg", "Malaysia", "Maldives", "Malta", "Mexico", "Monaco", "Mongolia", "Montenegro", "Morocco",
  "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Nigeria", "North Korea", "Norway", "Oman", "Pakistan", "Panama",
  "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Saudi Arabia", "Serbia",
  "Singapore", "Slovakia", "Slovenia", "South Africa", "South Korea", "Spain", "Sri Lanka", "Sweden", "Switzerland", "Syria",
  "Taiwan", "Tanzania", "Thailand", "Tunisia", "Turkey", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States",
  "Uruguay", "Uzbekistan", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe"
];

const MBTI_TYPES = [
  "INTJ", "INTP", "ENTJ", "ENTP",
  "INFJ", "INFP", "ENFJ", "ENFP",
  "ISTJ", "ISFJ", "ESTJ", "ESFJ",
  "ISTP", "ISFP", "ESTP", "ESFP"
];

const LANGUAGES_LIST = LOCALE_OPTIONS.map((option) => option.englishName);

const PHYSICAL_ATTRS = [
  "Athletic", "Average", "Slim", "Muscular", "Curvy", "Tall", "Petite"
];

const WIZARD_PROFILE_COLUMNS =
  'id, display_name, avatar_url, photos, gender, pronouns, age, country, city, height, physical_attributes, intention, looking_for, sexual_orientation, mbti, personality, hobbies, pets, interests, prompts, smoking, drinking, exercise, education, profession, languages_spoken, bio, onboarding_completed' as const;

const MAX_PROMPT_SLOTS = 3;

interface FormState {
  displayName: string;
  avatarUrl: string;
  photos: string[];
  gender: string;
  pronouns: string;
  birthDate: string;
  age: number;
  country: string;
  city: string;
  height: string;
  physicalAttributes: string[];
  intention: string;
  lookingFor: string[];
  sexualOrientation: string;
  mbti: string;
  personalityTraits: string[];
  interests: string[];
  hobbies: string[];
  pets: string[];
  smoking: string;
  drinking: string;
  exercise: string;
  education: string;
  profession: string;
  languagesSpoken: string[];
  bio: string;
  prompts: Record<string, string>;
}

export default function EditProfileWizardPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [userId, setUserId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const [alreadyOnboarded, setAlreadyOnboarded] = useState(false);
  const [photosReady, setPhotosReady] = useState(false);

  const [formData, setFormData] = useState<FormState>({
    displayName: '',
    avatarUrl: '',
    photos: [],
    gender: '',
    pronouns: '',
    birthDate: '',
    age: 18,
    country: '',
    city: '',
    height: '',
    physicalAttributes: [],
    intention: '',
    lookingFor: [],
    sexualOrientation: '',
    mbti: '',
    personalityTraits: [],
    interests: [],
    hobbies: [],
    pets: [],
    smoking: '',
    drinking: '',
    exercise: '',
    education: '',
    profession: '',
    languagesSpoken: [],
    bio: '',
    prompts: {},
  });

  const totalSteps = ONBOARDING_TOTAL_STEPS;
  const stepValidation = validateOnboardingStep(currentStep, formData);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [promptSlots, setPromptSlots] = useState<{ id: string; answer: string }[]>([]);

  const updatePromptSlots = (next: { id: string; answer: string }[]) => {
    setPromptSlots(next);
    const flattened: Record<string, string> = {};
    for (const slot of next) {
      if (slot.id) flattened[slot.id] = slot.answer;
    }
    setFormData((prev) => ({ ...prev, prompts: flattened }));
  };

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      try {
        const { data: { user } } = await supabase.auth.getUser();

        if (!isMounted) return;

        if (!user) {
          router.replace('/auth');
          return;
        }

        setUserId(user.id);

        const [profileResult, birthDateResult] = await Promise.all([
          supabase
            .from('profiles')
            .select(WIZARD_PROFILE_COLUMNS)
            .eq('id', user.id)
            .maybeSingle(),
          supabase.rpc('my_birth_date'),
        ]);

        const { data, error: loadError } = profileResult;
        const ownBirthDate =
          typeof birthDateResult.data === 'string' ? birthDateResult.data : '';

        if (!isMounted) return;

        if (loadError) {
          console.error('Failed to load profile:', loadError.message);
          setError('We could not load your saved profile. Please try again.');
        } else if (data) {
          setFormData((prev) => ({
            ...prev,
            displayName: data.display_name ?? '',
            avatarUrl: data.avatar_url ?? '',
            photos: Array.isArray(data.photos) ? data.photos : [],
            gender: data.gender ?? '',
            pronouns: data.pronouns ?? '',
            birthDate: ownBirthDate,
            age: data.age ?? 18,
            country: data.country ?? '',
            city: data.city ?? '',
            height: data.height ?? '',
            physicalAttributes: Array.isArray(data.physical_attributes) ? data.physical_attributes : [],
            intention: data.intention ?? '',
            lookingFor: Array.isArray(data.looking_for) ? data.looking_for : [],
            sexualOrientation: data.sexual_orientation ?? '',
            mbti: data.mbti ?? '',
            personalityTraits: Array.isArray(data.personality) ? data.personality : [],
            hobbies: Array.isArray(data.hobbies) ? data.hobbies : [],
            pets: Array.isArray(data.pets) ? data.pets : [],
            smoking: data.smoking ?? '',
            drinking: data.drinking ?? '',
            exercise: data.exercise ?? '',
            education: data.education ?? '',
            profession: data.profession ?? '',
            languagesSpoken: Array.isArray(data.languages_spoken) ? data.languages_spoken : [],
            bio: data.bio ?? '',
            interests: Array.isArray(data.interests) ? data.interests : [],
            prompts:
              typeof data.prompts === 'object' && data.prompts !== null
                ? (data.prompts as Record<string, string>)
                : {},
          }));

          setAlreadyOnboarded(data.onboarding_completed === true);

          const savedPrompts: Record<string, string> =
            typeof data.prompts === 'object' && data.prompts !== null
              ? (data.prompts as Record<string, string>)
              : {};
          setPromptSlots(
            Object.entries(savedPrompts)
              .slice(0, MAX_PROMPT_SLOTS)
              .map(([id, answer]) => ({ id, answer }))
          );
        }
      } catch (err) {
        if (isMounted) {
          console.error('Error loading profile:', err);
          setError('We could not load your saved profile. Please try again.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    void loadProfile();

    return () => {
      isMounted = false;
    };
  }, [router]);

  useEffect(() => {
    let isMounted = true;

    loadCatalogue()
      .then((loaded) => {
        if (isMounted) setCatalogue(loaded);
      })
      .catch((err: unknown) => {
        console.error('[onboarding] catalogue unavailable, using fallback list:', err);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const toggleArrayItem = (key: keyof FormState, item: string) => {
    setFormData((prev) => {
      const arr = (prev[key] as string[]) || [];
      const updated = arr.includes(item)
        ? arr.filter((x) => x !== item)
        : [...arr, item];
      return { ...prev, [key]: updated };
    });
  };

  const ageFromDob = (dob: string): number => calculateAge(dob) ?? 0;

  const handleNext = () => {
    setError(null);

    if (currentStep >= totalSteps) return;

    const validation = validateOnboardingStep(currentStep, formData);
    if (!validation.ok) {
      setError(validation.problems[0]?.message ?? 'Please complete this step to continue.');
      return;
    }

    setCurrentStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setError(null);
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleSubmit = async () => {
    if (saving) return;
    if (!userId) {
      setError('User session not found. Please re-authenticate.');
      return;
    }

    const draft: ProfileDraft = {
      id: userId,
      displayName: formData.displayName,
      avatarUrl: formData.avatarUrl,
      photos: formData.photos,
      gender: formData.gender,
      pronouns: formData.pronouns,
      birthDate: formData.birthDate,
      country: formData.country,
      city: formData.city,
      height: formData.height,
      physicalAttributes: formData.physicalAttributes,
      intention: formData.intention,
      lookingFor: formData.lookingFor,
      sexualOrientation: formData.sexualOrientation,
      mbti: formData.mbti,
      personality: formData.personalityTraits,
      interests: formData.interests,
      hobbies: formData.hobbies,
      pets: formData.pets,
      prompts: formData.prompts,
      smoking: formData.smoking,
      drinking: formData.drinking,
      exercise: formData.exercise,
      education: formData.education,
      profession: formData.profession,
      languagesSpoken: formData.languagesSpoken,
      bio: formData.bio,
    };

    if (!alreadyOnboarded && !photosReady) {
      setError('Please add one profile picture and four gallery photos before finishing.');
      setCurrentStep(ONBOARDING_TOTAL_STEPS);
      return;
    }

    const validation = validateProfileDraft(draft);
    if (!validation.ok) {
      const problem = validation.problems[0];
      setError(problem.message);
      const step = FIELD_TO_STEP[problem.field];
      if (step) setCurrentStep(step);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await saveProfile(draft);
      router.replace('/discover');
    } catch (err) {
      console.error('[onboarding] save failed:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async (): Promise<void> => {
    setSigningOut(true);
    setError(null);
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      if (signOutError) throw signOutError;
      router.replace('/');
    } catch (err) {
      console.error('[onboarding] sign-out failed:', err);
      setError(
        err instanceof Error ? err.message : 'Could not sign you out. Please try again.'
      );
    } finally {
      setSigningOut(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#0D0A10', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#D4B18A' }}>
        Loading Onboarding Wizard...
      </div>
    );
  }

  const progressPercent = Math.round((currentStep / totalSteps) * 100);

  const primaryProblem =
    stepValidation.problems.length > 0 ? stepValidation.problems[0].message : null;
  const showStepError = primaryProblem !== null && currentStep < totalSteps;
  const showRecommended =
    currentStep < totalSteps && stepValidation.missingRecommended.length > 0;

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', fontFamily: 'system-ui', padding: '20px', display: 'flex', flexDirection: 'column' as const, justifyContent: 'space-between', boxSizing: 'border-box' as const },
    header: { marginBottom: '20px' },
    topNav: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
    stepCounter: { fontSize: '13px', color: '#D4B18A', fontWeight: '700', textTransform: 'uppercase' as const, letterSpacing: '1px' },
    progressBarBg: { height: '6px', backgroundColor: '#29202D', borderRadius: '3px', overflow: 'hidden' as const },
    progressBarFill: { height: '100%', backgroundColor: '#D4B18A', transition: 'width 0.3s ease-in-out' },
    contentCard: { backgroundColor: '#1C1822', borderRadius: '24px', padding: '24px', border: '1px solid #29202D', flex: 1, display: 'flex', flexDirection: 'column' as const, justifyContent: 'center', gap: '16px', marginBottom: '20px' },
    title: { fontSize: '22px', fontWeight: '800', color: '#F2E9E4', marginBottom: '4px' },
    subtitle: { fontSize: '14px', color: '#B58A83', marginBottom: '16px', lineHeight: '1.4' },
    label: { fontSize: '12px', fontWeight: '700', color: '#D4B18A', textTransform: 'uppercase' as const, letterSpacing: '0.5px', display: 'block', marginBottom: '6px' },
    input: { width: '100%', padding: '16px', borderRadius: '16px', border: '1px solid #4A1828', backgroundColor: '#0D0A10', color: '#F2E9E4', fontSize: '15px', outline: 'none', boxSizing: 'border-box' as const },
    select: { width: '100%', padding: '16px', borderRadius: '16px', border: '1px solid #4A1828', backgroundColor: '#0D0A10', color: '#F2E9E4', fontSize: '15px', outline: 'none', boxSizing: 'border-box' as const },
    textarea: { width: '100%', padding: '16px', borderRadius: '16px', border: '1px solid #4A1828', backgroundColor: '#0D0A10', color: '#F2E9E4', fontSize: '15px', outline: 'none', minHeight: '120px', resize: 'vertical' as const, boxSizing: 'border-box' as const },
    pillContainer: { display: 'flex', flexWrap: 'wrap' as const, gap: '10px' },
    pill: { padding: '10px 18px', borderRadius: '20px', border: '1px solid #4A1828', backgroundColor: '#0D0A10', color: '#B58A83', cursor: 'pointer', fontSize: '13px', fontWeight: '600' },
    pillActive: { backgroundColor: '#D4B18A', color: '#17121C', border: '1px solid #D4B18A' },
    footerNav: { display: 'flex', gap: '12px' },
    backBtn: { flex: 1, padding: '16px', borderRadius: '30px', backgroundColor: '#29202D', color: '#B58A83', border: 'none', fontWeight: '700', cursor: 'pointer' },
    nextBtn: { flex: 2, padding: '16px', borderRadius: '30px', backgroundColor: '#D4B18A', color: '#17121C', border: 'none', fontWeight: '700', cursor: 'pointer' },
    submitBtn: { flex: 2, padding: '16px', borderRadius: '30px', backgroundColor: '#34D399', color: '#0D0A10', border: 'none', fontWeight: '800', cursor: 'pointer' },
    errorBox: { backgroundColor: '#3B1220', border: '1px solid #7F1D2E', color: '#FCA5B5', padding: '12px 16px', borderRadius: '12px', fontSize: '13px' },
    recommendedBox: { backgroundColor: '#1C1822', border: '1px dashed #4A1828', color: '#B58A83', padding: '10px 14px', borderRadius: '12px', fontSize: '12px', marginTop: '8px' },
    summaryRow: { display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #29202D', padding: '10px 0', fontSize: '13px' },
    escapeRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginTop: '16px' },
    escapeLink: { color: '#B58A83', fontSize: '13px', textDecoration: 'underline' },
    escapeButton: { background: 'none', border: '1px solid #4A1828', borderRadius: '20px', padding: '8px 16px', color: '#D4B18A', fontSize: '13px', fontWeight: 600, cursor: 'pointer' },
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.topNav}>
          <button style={{ background: 'none', border: 'none', color: '#B58A83', fontSize: '14px', cursor: 'pointer' }} onClick={() => router.back()}>✕ Cancel</button>
          <span style={styles.stepCounter}>Step {currentStep} of {totalSteps}</span>
        </div>
        <div style={styles.progressBarBg}>
          <div style={{ ...styles.progressBarFill, width: `${progressPercent}%` }} />
        </div>
      </div>

      {showStepError && (
        <div role="alert" data-testid="step-error" style={styles.errorBox}>
          {primaryProblem}
        </div>
      )}

      {showRecommended && (
        <div data-testid="step-recommended" style={styles.recommendedBox}>
          Optional: {stepValidation.missingRecommended.join(', ')} — you can continue without{' '}
          {stepValidation.missingRecommended.length === 1 ? 'it' : 'them'}.
        </div>
      )}

      {error && !showStepError && (
        <div role="alert" style={styles.errorBox}>
          {error}
        </div>
      )}

      <div style={styles.contentCard}>
        {currentStep === 1 && (
          <div>
            <div style={styles.title}>Let&apos;s start with the basics</div>
            <div style={styles.subtitle}>Start with your display name. You can add your photos at the end.</div>

            <div style={{ marginBottom: '16px' }}>
              <label style={styles.label}>Display Name *</label>
              <input
                style={styles.input}
                placeholder="Your name or nickname"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              />
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div>
            <div style={styles.title}>How do you identify?</div>
            <div style={styles.subtitle}>Select your gender identity.</div>

            <div style={{ marginBottom: '16px' }}>
              <label style={styles.label}>Gender</label>
              <div style={styles.pillContainer}>
                {ONBOARDING_GENDERS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    style={{ ...styles.pill, ...(formData.gender === g ? styles.pillActive : {}) }}
                    onClick={() => setFormData({ ...formData, gender: g })}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={styles.label}>Pronouns</label>
              <input
                style={styles.input}
                placeholder="e.g. she/her, he/him, they/them"
                value={formData.pronouns}
                onChange={(e) => setFormData({ ...formData, pronouns: e.target.value })}
              />
            </div>
          </div>
        )}

        {currentStep === 3 && (
          <div>
            <div style={styles.title}>When is your birthday?</div>
            <div style={styles.subtitle}>Your age will be displayed on your profile. You must be at least 18.</div>

            <div>
              <label style={styles.label}>Date of Birth</label>
              <input
                type="date"
                style={styles.input}
                value={formData.birthDate}
                onChange={(e) => {
                  const dob = e.target.value;
                  setFormData({ ...formData, birthDate: dob, age: ageFromDob(dob) });
                }}
              />
              <p style={{ fontSize: '13px', color: formData.age > 0 && formData.age < MIN_AGE ? '#FCA5B5' : '#D4B18A', marginTop: '10px' }}>
                Calculated Age: {formData.age > 0 ? `${formData.age} years old` : '—'}
              </p>
              {formData.age > 0 && formData.age < MIN_AGE && (
                <p style={{ fontSize: '13px', color: '#FCA5B5', marginTop: '6px' }}>
                  You must be at least {MIN_AGE} to use Mettivo.
                </p>
              )}
            </div>
          </div>
        )}

        {currentStep === 4 && (
          <div>
            <div style={styles.title}>Where are you based?</div>
            <div style={styles.subtitle}>Help potential matches near you find your profile.</div>

            <div style={{ marginBottom: '16px' }}>
              <label style={styles.label}>Country</label>
              <select style={styles.select} value={formData.country} onChange={(e) => setFormData({ ...formData, country: e.target.value })}>
                <option value="">-- Select Country --</option>
                {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label style={styles.label}>City / District</label>
              <input
                style={styles.input}
                placeholder="e.g. Kathmandu, San Francisco"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              />
            </div>
          </div>
        )}

        {currentStep === 5 && (
          <div>
            <div style={styles.title}>Height & Physical Specs</div>
            <div style={styles.subtitle}>Optional details about your physical appearance.</div>

            <div style={{ marginBottom: '16px' }}>
              <label style={styles.label}>Height (cm)</label>
              <input
                style={styles.input}
                placeholder="e.g. 175 cm"
                value={formData.height}
                onChange={(e) => setFormData({ ...formData, height: e.target.value })}
              />
            </div>

            <div>
              <label style={styles.label}>Physical Attributes / Build</label>
              <div style={styles.pillContainer}>
                {PHYSICAL_ATTRS.map((attr) => (
                  <button key={attr} type="button" style={{ ...styles.pill, ...(formData.physicalAttributes.includes(attr) ? styles.pillActive : {}) }} onClick={() => toggleArrayItem('physicalAttributes', attr)}>
                    {attr}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {currentStep === 6 && (
          <div>
            <div style={styles.title}>What are your intentions?</div>
            <div style={styles.subtitle}>Be clear about what you are looking to find here.</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {INTENTIONS.map((item) => (
                <button key={item.value} type="button" style={{ ...styles.pill, textAlign: 'left', padding: '14px 20px', ...(formData.intention === item.value ? styles.pillActive : {}) }} onClick={() => setFormData({ ...formData, intention: item.value })}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {currentStep === 7 && (
          <div>
            <div style={styles.title}>Preferences & Orientation</div>
            <div style={styles.subtitle}>Who do you want to see and connect with?</div>

            <div style={{ marginBottom: '16px' }}>
              <label style={styles.label}>Sexual Orientation</label>
              <input
                style={styles.input}
                placeholder="e.g. Straight, Gay, Lesbian, Bisexual, Pansexual"
                value={formData.sexualOrientation}
                onChange={(e) => setFormData({ ...formData, sexualOrientation: e.target.value })}
              />
            </div>

            <div>
              <label style={styles.label}>Looking to date</label>
              <div style={styles.pillContainer}>
                {PROFILE_LOOKING_FOR_OPTIONS.map((opt) => (
                  <button key={opt} type="button" style={{ ...styles.pill, ...(formData.lookingFor.includes(opt) ? styles.pillActive : {}) }} onClick={() => toggleArrayItem('lookingFor', opt)}>
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {currentStep === 8 && (
          <div>
            <div style={styles.title}>Personality & Vibe</div>
            <div style={styles.subtitle}>
              Pick your MBTI, then answer up to {MAX_PROMPT_SLOTS} prompts — these are what
              people actually start conversations about.
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={styles.label}>MBTI Personality Type</label>
              <div style={styles.pillContainer}>
                {MBTI_TYPES.map((type) => (
                  <button key={type} type="button" style={{ ...styles.pill, ...(formData.mbti === type ? styles.pillActive : {}) }} onClick={() => setFormData({ ...formData, mbti: type })}>
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {catalogue && catalogue.prompts.length > 0 && (
              <div>
                <label style={styles.label}>Prompts</label>

                {promptSlots.map((slot, index) => {
                  const chosen = new Set(promptSlots.map((entry) => entry.id).filter(Boolean));
                  const options = catalogue.prompts.filter(
                    (prompt) => !chosen.has(prompt.id) || prompt.id === slot.id
                  );

                  return (
                    <div key={index} style={{ marginBottom: '12px' }}>
                      <select
                        style={styles.select}
                        value={slot.id}
                        onChange={(e) => {
                          const next = [...promptSlots];
                          next[index] = { id: e.target.value, answer: '' };
                          updatePromptSlots(next);
                        }}
                      >
                        <option value="">-- Choose a prompt --</option>
                        {options.map((prompt) => (
                          <option key={prompt.id} value={prompt.id}>
                            {prompt.question}
                          </option>
                        ))}
                      </select>

                      {slot.id && (
                        <textarea
                          style={{ ...styles.textarea, minHeight: '80px', marginTop: '8px' }}
                          placeholder={catalogue.prompts.find((p) => p.id === slot.id)?.hint ?? 'Your answer'}
                          value={slot.answer}
                          maxLength={MAX_PROMPT_ANSWER_LENGTH}
                          onChange={(e) => {
                            const next = [...promptSlots];
                            next[index] = { ...next[index], answer: e.target.value };
                            updatePromptSlots(next);
                          }}
                        />
                      )}

                      <button
                        type="button"
                        style={{ background: 'none', border: 'none', color: '#B58A83', fontSize: '12px', cursor: 'pointer', padding: '8px 0' }}
                        onClick={() =>
                          updatePromptSlots(promptSlots.filter((_, i) => i !== index))
                        }
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}

                {promptSlots.length < MAX_PROMPT_SLOTS && (
                  <button
                    type="button"
                    style={{ ...styles.pill, padding: '10px 18px' }}
                    onClick={() => updatePromptSlots([...promptSlots, { id: '', answer: '' }])}
                  >
                    + Add a prompt
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {currentStep === 9 && (
          <div>
            <div style={styles.title}>Hobbies & Interests</div>
            <div style={styles.subtitle}>Pick the things you enjoy doing in your free time.</div>

            {catalogue && catalogue.interests.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <label style={styles.label}>Interests</label>
                <div style={styles.pillContainer}>
                  {catalogue.interests.map((interest) => (
                    <button
                      key={interest.id}
                      type="button"
                      style={{ ...styles.pill, ...(formData.interests.includes(interest.id) ? styles.pillActive : {}) }}
                      onClick={() => toggleArrayItem('interests', interest.id)}
                    >
                      {interest.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label style={styles.label}>Other hobbies</label>
            <div style={styles.pillContainer}>
              {HOBBIES_LIST.map((hobby) => (
                <button key={hobby} type="button" style={{ ...styles.pill, ...(formData.hobbies.includes(hobby) ? styles.pillActive : {}) }} onClick={() => toggleArrayItem('hobbies', hobby)}>
                  {hobby}
                </button>
              ))}
            </div>
          </div>
        )}

        {currentStep === 10 && (
          <div>
            <div style={styles.title}>Pets & Animals</div>
            <div style={styles.subtitle}>How do you feel about furry friends?</div>

            <div style={styles.pillContainer}>
              {PETS_OPTIONS.map((pet) => (
                <button key={pet} type="button" style={{ ...styles.pill, ...(formData.pets.includes(pet) ? styles.pillActive : {}) }} onClick={() => toggleArrayItem('pets', pet)}>
                  {pet}
                </button>
              ))}
            </div>
          </div>
        )}

        {currentStep === 11 && (
          <div>
            <div style={styles.title}>Lifestyle Habits</div>
            <div style={styles.subtitle}>Your daily choices and wellness routine.</div>

            <div style={{ marginBottom: '12px' }}>
              <label style={styles.label}>Smoking</label>
              <select style={styles.select} value={formData.smoking} onChange={(e) => setFormData({ ...formData, smoking: e.target.value })}>
                <option value="">-- Select --</option>
                {PROFILE_SMOKING_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={styles.label}>Drinking</label>
              <select style={styles.select} value={formData.drinking} onChange={(e) => setFormData({ ...formData, drinking: e.target.value })}>
                <option value="">-- Select --</option>
                {PROFILE_DRINKING_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={styles.label}>Exercise</label>
              <select style={styles.select} value={formData.exercise} onChange={(e) => setFormData({ ...formData, exercise: e.target.value })}>
                <option value="">-- Select --</option>
                <option value="Active daily">Active daily</option>
                <option value="A few times a week">A few times a week</option>
                <option value="Occasionally">Occasionally</option>
                <option value="Rarely">Rarely</option>
              </select>
            </div>
          </div>
        )}

        {currentStep === 12 && (
          <div>
            <div style={styles.title}>Education & Career</div>
            <div style={styles.subtitle}>What do you do for work and study?</div>

            <div style={{ marginBottom: '16px' }}>
              <label style={styles.label}>Education Level</label>
              <input
                style={styles.input}
                placeholder="e.g. Bachelor's Degree, Master's, High School"
                value={formData.education}
                onChange={(e) => setFormData({ ...formData, education: e.target.value })}
              />
            </div>

            <div>
              <label style={styles.label}>Profession / Job Title</label>
              <input
                style={styles.input}
                placeholder="e.g. Software Engineer, Designer, Student"
                value={formData.profession}
                onChange={(e) => setFormData({ ...formData, profession: e.target.value })}
              />
            </div>
          </div>
        )}

        {currentStep === 13 && (
          <div>
            <div style={styles.title}>Languages Spoken</div>
            <div style={styles.subtitle}>Select languages you can comfortably communicate in.</div>

            <div style={styles.pillContainer}>
              {LANGUAGES_LIST.map((lang) => (
                <button key={lang} type="button" style={{ ...styles.pill, ...(formData.languagesSpoken.includes(lang) ? styles.pillActive : {}) }} onClick={() => toggleArrayItem('languagesSpoken', lang)}>
                  {lang}
                </button>
              ))}
            </div>
          </div>
        )}

        {currentStep === 14 && (
          <div>
            <div style={styles.title}>Personal Bio</div>
            <div style={styles.subtitle}>Write a short intro to highlight your vibe.</div>

            <textarea
              style={styles.textarea}
              placeholder="Tell others what makes you unique, what you love, or a fun fact..."
              value={formData.bio}
              maxLength={MAX_BIO_LENGTH}
              onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
            />
            <p style={{ fontSize: '12px', color: '#B58A83', marginTop: '8px' }}>
              {formData.bio.length}/{MAX_BIO_LENGTH}
            </p>
          </div>
        )}

        {currentStep === 15 && (
          <div>
            <div style={styles.title}>Add your photos &amp; finish</div>
            <div style={styles.subtitle}>
              Choose one profile picture and four gallery photos for your profile.
            </div>

            {!alreadyOnboarded && (
              <div style={{ marginBottom: '24px' }}>
                <PhotoUploadStep
                  initialAvatarUrl={formData.avatarUrl}
                  initialPhotos={formData.photos}
                  onProgress={({ avatarUrl, photos, ready }) => {
                    setFormData((prev) => ({ ...prev, avatarUrl, photos }));
                    setPhotosReady(ready);
                  }}
                />
              </div>
            )}

            <div style={styles.subtitle}>Double check your details before saving your profile.</div>

            <div style={{ maxHeight: '220px', overflowY: 'auto', paddingRight: '6px' }}>
              <div style={styles.summaryRow}><span>Name</span><span style={{ color: '#D4B18A' }}>{formData.displayName || 'Not set'}</span></div>
              <div style={styles.summaryRow}><span>Gender</span><span style={{ color: '#D4B18A' }}>{formData.gender || 'Not set'}</span></div>
              <div style={styles.summaryRow}><span>Age</span><span style={{ color: '#D4B18A' }}>{formData.age} years old</span></div>
              <div style={styles.summaryRow}><span>Location</span><span style={{ color: '#D4B18A' }}>{formData.city}, {formData.country}</span></div>
              <div style={styles.summaryRow}><span>Intention</span><span style={{ color: '#D4B18A' }}>{formData.intention || 'Not set'}</span></div>
              <div style={styles.summaryRow}><span>MBTI</span><span style={{ color: '#D4B18A' }}>{formData.mbti || 'Not set'}</span></div>
              <div style={styles.summaryRow}><span>Hobbies</span><span style={{ color: '#D4B18A' }}>{formData.hobbies.join(', ') || 'None selected'}</span></div>
              <div style={styles.summaryRow}><span>Languages</span><span style={{ color: '#D4B18A' }}>{formData.languagesSpoken.join(', ') || 'None selected'}</span></div>
              <div style={styles.summaryRow}><span>Photos</span><span style={{ color: '#D4B18A' }}>{formData.photos.length} added</span></div>
            </div>
          </div>
        )}
      </div>

      <div style={styles.footerNav}>
        {currentStep > 1 && (
          <button type="button" style={styles.backBtn} onClick={handleBack} disabled={saving}>
            ← Back
          </button>
        )}

        {currentStep < totalSteps ? (
          <button
            type="button"
            style={styles.nextBtn}
            onClick={handleNext}
            disabled={!stepValidation.ok}
          >
            Next →
          </button>
        ) : (
          <button
            type="button"
            style={styles.submitBtn}
            onClick={handleSubmit}
            disabled={saving || (!alreadyOnboarded && !photosReady)}
          >
            {saving ? 'Saving Profile...' : 'Complete & Launch 🚀'}
          </button>
        )}
      </div>

      <div style={styles.escapeRow}>
        <Link href="/" style={styles.escapeLink} data-testid="back-to-landing">
          ← Back to landing page
        </Link>
        <button
          type="button"
          style={{ ...styles.escapeButton, opacity: signingOut ? 0.6 : 1 }}
          onClick={() => void handleSignOut()}
          disabled={signingOut || saving}
          data-testid="wizard-sign-out"
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </div>
  );
}