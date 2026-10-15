'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { MAX_BIO_LENGTH, MIN_AGE } from '@/lib/profile';
import { ONBOARDING_GENDERS } from '@/lib/onboarding-steps';
import {
  PROFILE_DRINKING_OPTIONS,
  PROFILE_HOBBIES_OPTIONS,
  PROFILE_INTENTION_OPTIONS,
  PROFILE_LOOKING_FOR_OPTIONS,
  PROFILE_PETS_OPTIONS,
  PROFILE_SMOKING_OPTIONS,
} from '@/lib/profile-options';
import { MomentError, fetchUserMoments, likeMoment, unlikeMoment } from '@/lib/moments';
import type { MomentAuthor, MomentFeedRow } from '@/lib/types';
import MobileNav from '../../components/layout/MobileNav';
import ProfileHeader from '../../components/profile/ProfileHeader';
import ProfileTabs, { type ProfileTab } from '../../components/profile/ProfileTabs';
import ProfileDetails from '../../components/profile/ProfileDetails';
import ProfileMoments from '../../components/profile/ProfileMoments';

/** The oldest age the dashboard will accept when a member edits their age. */
const MAX_AGE = 120;

interface Profile {
  id: string;
  display_name: string;
  age: number;
  gender: string;
  city: string;
  country: string;
  avatar_url: string;
  photos: string[];
  bio: string;
  intention: string;
  looking_for: string[];
  hobbies: string[];
  pets: string[];
  personality: string[];
  religion: string;
  politics: string;
  drinking: string;
  smoking: string;
  followers_count: number;
  following_count: number;
  matches_count: number;
  profile_likes_count: number;
}

/**
 * The subset of `Profile` a member can edit from the Details tab.
 *
 * Email and phone are deliberately absent: they live on the auth user, not the
 * `profiles` row, and are saved through `supabase.auth.updateUser`.
 */
type EditableKey =
  | 'bio'
  | 'age'
  | 'gender'
  | 'looking_for'
  | 'intention'
  | 'drinking'
  | 'smoking'
  | 'religion'
  | 'politics'
  | 'pets'
  | 'personality'
  | 'hobbies'
  | 'email'
  | 'phone';

/** An update payload made only of editable columns. */
type ProfilePatch = Partial<
  Pick<
    Profile,
    | 'bio'
    | 'age'
    | 'gender'
    | 'looking_for'
    | 'intention'
    | 'drinking'
    | 'smoking'
    | 'religion'
    | 'politics'
    | 'pets'
    | 'personality'
    | 'hobbies'
  >
>;

type FieldKind = 'textarea' | 'number' | 'text' | 'tags' | 'select' | 'multi' | 'email' | 'phone';

interface FieldConfig {
  title: string;
  hint: string;
  kind: FieldKind;
}

/** How each editable field is presented in the editor sheet. */
const EDITOR_FIELDS: Record<EditableKey, FieldConfig> = {
  bio: { title: 'Bio', hint: 'Tell people a little about yourself.', kind: 'textarea' },
  age: { title: 'Age', hint: `Between ${MIN_AGE} and ${MAX_AGE}.`, kind: 'number' },
  gender: { title: 'Gender', hint: 'How you identify.', kind: 'select' },
  looking_for: { title: 'Looking for', hint: 'Who you would like to meet.', kind: 'multi' },
  intention: { title: 'Intention', hint: 'What you are here for.', kind: 'select' },
  drinking: { title: 'Drinking', hint: 'Your drinking habit.', kind: 'select' },
  smoking: { title: 'Smoking', hint: 'Your smoking habit.', kind: 'select' },
  religion: { title: 'Religion', hint: 'Optional — leave blank to hide.', kind: 'text' },
  politics: { title: 'Politics', hint: 'Optional — leave blank to hide.', kind: 'text' },
  pets: { title: 'Pets', hint: 'How you feel about animals.', kind: 'multi' },
  personality: { title: 'Personality', hint: 'Separate traits with commas.', kind: 'tags' },
  hobbies: { title: 'Interests/Hobbies', hint: 'Pick everything you enjoy.', kind: 'multi' },
  email: { title: 'Email', hint: 'We will email you a link to confirm.', kind: 'email' },
  phone: { title: 'Phone', hint: 'We will text you a code to verify.', kind: 'phone' },
};

/**
 * Columns this page may read.
 *
 * An explicit allow-list, not `select *`: `birth_date` carries a column-level
 * revoke (`20261015260000_m15_revoke_birth_date.sql`), so `select *` would fail
 * outright — and the page must render the derived `age` in any case
 * (`CONSTITUTION.md` Article 1.4).
 *
 * Written as a single string literal on purpose: supabase-js parses the column
 * list at the TYPE level, and a value built with `.join()` is just `string`, so
 * inference collapses to an error type.
 */
const PROFILE_COLUMNS =
  'id, display_name, age, gender, city, country, avatar_url, photos, bio, intention, looking_for, hobbies, pets, personality, religion, politics, drinking, smoking, followers_count, following_count, matches_count, profile_likes_count' as const;

export default function ProfileDashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>('feed');

  // The member's own Moments, shown on the Posts tab.
  const [posts, setPosts] = useState<MomentFeedRow[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsError, setPostsError] = useState<string | null>(null);

  // Inline editor state. `editor` is the field being edited, or null when the
  // sheet is closed. `textDraft` backs the single-value inputs, `listDraft` the
  // multi-select pills, and `tagDraft` the comma-separated text field.
  const [editor, setEditor] = useState<EditableKey | null>(null);
  const [textDraft, setTextDraft] = useState('');
  const [listDraft, setListDraft] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  // Phone verification is a two-step flow (request a code, then confirm it), so
  // the number being verified is held here while the OTP screen is shown.
  const [phoneStage, setPhoneStage] = useState<'enter' | 'verify'>('enter');
  const [pendingPhone, setPendingPhone] = useState('');

  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const profileId = profile?.id;

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
        setUserEmail(user.email || 'Not set');
        setPhone(user.phone || '');

        // maybeSingle(): "zero rows" is a normal outcome for a user who has not
        // onboarded yet, not a failed load.
        const { data, error } = await supabase
          .from('profiles')
          .select(PROFILE_COLUMNS)
          .eq('id', user.id)
          .maybeSingle();

        if (!isMounted) return;

        if (error) {
          console.error("Error fetching profile:", error.message);
          setLoadError('We could not load your profile.');
          return;
        }

        setProfile(data);
      } catch (err) {
        if (isMounted) {
          console.error('Unexpected error fetching profile:', err);
          setLoadError('We could not load your profile.');
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

  // GATEKEEPER: redirect to onboarding only when we know for certain that no
  // profile row exists. Bouncing whenever `profile` was null also bounced on
  // transient fetch failures, which caused an infinite
  // edit -> dashboard -> profile -> edit loop.
  useEffect(() => {
    if (!loading && !loadError && !profile) {
      router.replace('/profile');
    }
  }, [loading, loadError, profile, router]);

  // Load the member's own Moments once the profile (and therefore the user id)
  // is known. Keyed on the id, not the whole profile object, so an inline edit
  // does not trigger a needless re-fetch.
  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;

    const load = async () => {
      try {
        const rows = await fetchUserMoments(profileId);
        if (!cancelled) {
          setPosts(rows);
          setPostsError(null);
        }
      } catch (err) {
        console.error('Failed to load your posts:', err);
        if (!cancelled) {
          setPostsError(err instanceof MomentError ? err.message : 'Could not load your posts.');
        }
      } finally {
        if (!cancelled) setPostsLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [profileId]);

  // Clear the toast timer if the page unmounts mid-countdown, so a dismissed
  // toast cannot set state on an unmounted component.
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // Escape closes the editor sheet, but never mid-save.
  useEffect(() => {
    if (!editor) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        setEditor(null);
        setEditorError(null);
        setPhoneStage('enter');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, saving]);

  const showToast = (message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const openEditor = (key: EditableKey) => {
    if (!profile) return;
    setEditorError(null);
    setSaving(false);
    setEditor(key);

    switch (key) {
      case 'bio': setTextDraft(profile.bio ?? ''); break;
      case 'age': setTextDraft(profile.age ? String(profile.age) : ''); break;
      case 'gender': setTextDraft(profile.gender ?? ''); break;
      case 'intention': setTextDraft(profile.intention ?? ''); break;
      case 'drinking': setTextDraft(profile.drinking ?? ''); break;
      case 'smoking': setTextDraft(profile.smoking ?? ''); break;
      case 'religion': setTextDraft(profile.religion ?? ''); break;
      case 'politics': setTextDraft(profile.politics ?? ''); break;
      case 'looking_for': setListDraft([...(profile.looking_for ?? [])]); break;
      case 'pets': setListDraft([...(profile.pets ?? [])]); break;
      case 'hobbies': setListDraft([...(profile.hobbies ?? [])]); break;
      case 'personality': setTagDraft((profile.personality ?? []).join(', ')); break;
      case 'email': setTextDraft(userEmail); break;
      case 'phone': setTextDraft(''); setPhoneStage('enter'); break;
    }
  };

  const closeEditor = () => {
    setEditor(null);
    setEditorError(null);
    setPhoneStage('enter');
  };

  const toggleListDraft = (value: string) => {
    setListDraft((prev) =>
      prev.includes(value) ? prev.filter((entry) => entry !== value) : [...prev, value]
    );
  };

  /**
   * Persists a profile patch and mirrors it into local state.
   *
   * `.select('id')` is appended on purpose: with RLS, a denied UPDATE returns
   * no error but affects zero rows, so without the echoed row a silent failure
   * would look like success. A zero-row result is treated as a failure.
   */
  const persistProfile = async (patch: ProfilePatch): Promise<string | null> => {
    if (!profile) return 'Your profile is not loaded yet.';

    const { data, error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', profile.id)
      .select('id');

    if (error) {
      console.error('[profile] update failed:', error.message);
      return `We could not save that: ${error.message}`;
    }

    if (!data || data.length === 0) {
      return 'We could not save that change. Please try again.';
    }

    setProfile((prev) => (prev ? { ...prev, ...patch } : prev));
    return null;
  };

  const handleSave = async () => {
    if (!profile || !editor) return;
    setEditorError(null);
    setSaving(true);

    try {
      switch (editor) {
        case 'bio': {
          const value = textDraft.trim();
          if (value.length > MAX_BIO_LENGTH) {
            setEditorError(`Your bio must be ${MAX_BIO_LENGTH} characters or fewer.`);
            return;
          }
          const failure = await persistProfile({ bio: value });
          if (failure) { setEditorError(failure); return; }
          showToast('Bio updated');
          closeEditor();
          break;
        }

        case 'age': {
          const value = Number.parseInt(textDraft, 10);
          if (!Number.isFinite(value) || value < MIN_AGE || value > MAX_AGE) {
            setEditorError(`Enter an age between ${MIN_AGE} and ${MAX_AGE}.`);
            return;
          }
          const failure = await persistProfile({ age: value });
          if (failure) { setEditorError(failure); return; }
          showToast('Age updated');
          closeEditor();
          break;
        }

        case 'gender': {
          const failure = await persistProfile({ gender: textDraft.trim() });
          if (failure) { setEditorError(failure); return; }
          showToast('Gender updated');
          closeEditor();
          break;
        }

        case 'intention': {
          const failure = await persistProfile({ intention: textDraft.trim() });
          if (failure) { setEditorError(failure); return; }
          showToast('Intention updated');
          closeEditor();
          break;
        }

        case 'drinking': {
          const failure = await persistProfile({ drinking: textDraft.trim() });
          if (failure) { setEditorError(failure); return; }
          showToast('Drinking updated');
          closeEditor();
          break;
        }

        case 'smoking': {
          const failure = await persistProfile({ smoking: textDraft.trim() });
          if (failure) { setEditorError(failure); return; }
          showToast('Smoking updated');
          closeEditor();
          break;
        }

        case 'religion': {
          const failure = await persistProfile({ religion: textDraft.trim() });
          if (failure) { setEditorError(failure); return; }
          showToast('Religion updated');
          closeEditor();
          break;
        }

        case 'politics': {
          const failure = await persistProfile({ politics: textDraft.trim() });
          if (failure) { setEditorError(failure); return; }
          showToast('Politics updated');
          closeEditor();
          break;
        }

        case 'looking_for': {
          const failure = await persistProfile({ looking_for: [...listDraft] });
          if (failure) { setEditorError(failure); return; }
          showToast('Preferences updated');
          closeEditor();
          break;
        }

        case 'pets': {
          const failure = await persistProfile({ pets: [...listDraft] });
          if (failure) { setEditorError(failure); return; }
          showToast('Pets updated');
          closeEditor();
          break;
        }

        case 'hobbies': {
          const failure = await persistProfile({ hobbies: [...listDraft] });
          if (failure) { setEditorError(failure); return; }
          showToast('Interests updated');
          closeEditor();
          break;
        }

        case 'personality': {
          const value = tagDraft
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
          const failure = await persistProfile({ personality: value });
          if (failure) { setEditorError(failure); return; }
          showToast('Personality updated');
          closeEditor();
          break;
        }

        case 'email': {
          const value = textDraft.trim();
          if (!value) { setEditorError('Enter an email address.'); return; }
          const { error } = await supabase.auth.updateUser({ email: value });
          if (error) { setEditorError(error.message); return; }
          showToast(`Confirmation link sent to ${value}.`);
          closeEditor();
          break;
        }

        case 'phone': {
          if (phoneStage === 'enter') {
            const value = textDraft.trim();
            if (!value) { setEditorError('Enter a phone number with country code.'); return; }
            const { error } = await supabase.auth.updateUser({ phone: value });
            if (error) { setEditorError(error.message); return; }
            setPendingPhone(value);
            setPhoneStage('verify');
            setTextDraft('');
            showToast(`We sent a code to ${value}.`);
          } else {
            const token = textDraft.trim();
            if (!token) { setEditorError('Enter the code we sent you.'); return; }
            const { error } = await supabase.auth.verifyOtp({
              phone: pendingPhone,
              token,
              type: 'phone_change',
            });
            if (error) { setEditorError(error.message); return; }
            setPhone(pendingPhone);
            showToast('Phone number verified');
            closeEditor();
          }
          break;
        }
      }
    } finally {
      setSaving(false);
    }
  };

  // --- Posts tab: like / comment / share, mirroring the /moments feed ------ //

  const handleLikePost = async (post: MomentFeedRow) => {
    const wasLiked = post.liked_by_me;
    setPostsError(null);

    // Optimistic flip; reverted if the write fails.
    setPosts((prev) =>
      prev.map((item) =>
        item.id === post.id
          ? {
              ...item,
              liked_by_me: !wasLiked,
              like_count: Math.max(0, item.like_count + (wasLiked ? -1 : 1)),
            }
          : item
      )
    );

    try {
      if (wasLiked) await unlikeMoment(post.id);
      else await likeMoment(post.id);
    } catch (err) {
      console.error('Like failed:', err);
      setPosts((prev) =>
        prev.map((item) =>
          item.id === post.id
            ? {
                ...item,
                liked_by_me: wasLiked,
                like_count: Math.max(0, item.like_count + (wasLiked ? 1 : -1)),
              }
            : item
        )
      );
      showToast('Could not update your like.', 'error');
    }
  };

  // Comments and shares are owned by MomentCard itself; the dashboard only owns
  // the optimistic like state shared across the list.

  const calculateCompletion = () => {
    if (!profile) return 0;
    const fields = [
      profile.display_name, profile.age, profile.gender, profile.city,
      profile.country, profile.avatar_url, profile.bio, profile.intention,
      profile.looking_for?.length, profile.hobbies?.length,
      profile.pets?.length, profile.personality?.length,
      profile.religion, profile.politics, profile.drinking, profile.smoking
    ];
    const filledFields = fields.filter(field => field !== null && field !== undefined && field !== '' && field !== 0).length;
    return Math.round((filledFields / fields.length) * 100);
  };

  const completionPercentage = calculateCompletion();

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#131017', color: '#D8B38A' }}>Loading Profile...</div>;

  // A failed load gets a retry affordance instead of an endless "Redirecting"
  // message, since we deliberately do not bounce to onboarding on error.
  if (loadError) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: '16px', justifyContent: 'center', alignItems: 'center', backgroundColor: '#131017', color: '#D8B38A', padding: '24px', textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: '14px' }}>{loadError}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ backgroundColor: '#D8B38A', color: '#131017', padding: '12px 28px', borderRadius: '30px', fontSize: '14px', fontWeight: 700, border: 'none', cursor: 'pointer' }}
        >
          Try again
        </button>
      </div>
    );
  }

  // If profile is null, we are already redirecting, just show a loading state
  if (!profile) {
    return <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#131017', color: '#D8B38A' }}>Redirecting to onboarding...</div>;
  }

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#131017', color: '#EAE2F0', fontFamily: 'system-ui', paddingBottom: '100px' },
    topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px', borderBottom: '1px solid #34283F' },
    iconButton: { width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#211A28', border: '1px solid #34283F', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', color: '#EAE2F0' },
    title: { fontSize: '18px', fontWeight: 700, color: '#EAE2F0', letterSpacing: '0.5px' },
    heroSection: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', padding: '30px 20px' },
    avatarContainer: { position: 'relative' as const, marginBottom: '16px' },
    avatar: { width: '120px', height: '120px', borderRadius: '50%', objectFit: 'cover' as const, border: '3px solid #D8B38A', backgroundColor: '#34283F' },
    onlineBadge: { position: 'absolute' as const, bottom: '5px', right: '10px', width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#34D399', border: '3px solid #131017' },
    nameRow: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' },
    name: { fontSize: '26px', fontWeight: 800, color: '#EAE2F0' },
    ageBadge: { backgroundColor: '#4A1828', color: '#D8B38A', padding: '4px 12px', borderRadius: '20px', fontSize: '14px', fontWeight: 700 },
    location: { fontSize: '14px', color: '#B58A83', marginBottom: '16px' },
    intentionTag: { backgroundColor: '#241C2C', color: '#D8B38A', border: '1px solid #4A1828', padding: '6px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: 600 },
    statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', padding: '0 20px', marginBottom: '24px' },
    statCard: { backgroundColor: '#211A28', borderRadius: '16px', padding: '20px 10px', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', border: '1px solid #34283F', cursor: 'pointer', transition: 'transform 0.1s' },
    statIcon: { fontSize: '24px', marginBottom: '8px' },
    statValue: { fontSize: '20px', fontWeight: 800, color: '#EAE2F0', marginBottom: '4px' },
    statLabel: { fontSize: '10px', color: '#B58A83', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.5px', textAlign: 'center' as const },
    progressCard: { margin: '0 20px 24px 20px', backgroundColor: '#211A28', borderRadius: '16px', padding: '20px', display: 'flex', alignItems: 'center', gap: '16px', border: '1px solid #34283F' },
    progressCircle: { width: '50px', height: '50px' },
    progressText: { flex: 1 },
    progressTitle: { fontSize: '15px', fontWeight: 700, color: '#EAE2F0', marginBottom: '4px' },
    progressSubtitle: { fontSize: '12px', color: '#B58A83' },
    completeBtn: { backgroundColor: '#D8B38A', color: '#131017', padding: '10px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, border: 'none', cursor: 'pointer' },
    segment: { position: 'relative' as const, display: 'flex', margin: '0 20px 24px 20px', backgroundColor: '#211A28', borderRadius: '999px', padding: '4px', border: '1px solid #34283F' },
    segmentIndicator: { position: 'absolute' as const, top: '4px', bottom: '4px', left: '4px', width: 'calc(50% - 4px)', backgroundColor: '#D8B38A', borderRadius: '999px', transition: 'transform 0.25s ease' },
    segmentBtn: { position: 'relative' as const, flex: 1, zIndex: 1, padding: '12px', borderRadius: '999px', border: 'none', background: 'none', fontSize: '14px', fontWeight: 700, cursor: 'pointer', transition: 'color 0.25s ease' },
    section: { margin: '0 20px 24px 20px', backgroundColor: '#211A28', borderRadius: '20px', padding: '20px', border: '1px solid #34283F' },
    sectionHeader: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' },
    sectionIcon: { width: '32px', height: '32px', borderRadius: '10px', background: 'linear-gradient(135deg, #4A1828, #D8B38A)', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '16px' },
    sectionTitle: { fontSize: '16px', fontWeight: 700, color: '#EAE2F0' },
    sectionEditBtn: { marginLeft: 'auto', background: 'none', border: '1px solid #D8B38A', color: '#D8B38A', borderRadius: '20px', padding: '6px 16px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' },
    infoRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #34283F' },
    infoLabel: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: '#B58A83', fontWeight: 500 },
    infoValueButton: { display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', padding: '4px', margin: 0, cursor: 'pointer', font: 'inherit', textAlign: 'right' as const, maxWidth: '64%' },
    infoValue: { fontSize: '14px', color: '#EAE2F0', fontWeight: 600, textAlign: 'right' as const, wordBreak: 'break-word' as const },
    editIcon: { fontSize: '12px', opacity: 0.6, flexShrink: 0 },
    editHint: { fontSize: '12px', color: '#B58A83', marginTop: '-8px', marginBottom: '16px' },
    chipWrap: { display: 'flex', flexWrap: 'wrap' as const, gap: '8px' },
    chip: { backgroundColor: '#241C2C', color: '#D8B38A', border: '1px solid #4A1828', borderRadius: '20px', padding: '8px 14px', fontSize: '13px', fontWeight: 600 },
    emptyText: { fontSize: '13px', color: '#B58A83' },
    bioText: { fontSize: '14px', color: '#EAE2F0', lineHeight: 1.6, margin: 0 },
    postsHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 20px 16px 20px' },
    postsHeaderTitle: { fontSize: '15px', fontWeight: 700, color: '#EAE2F0' },
    newPostBtn: { background: 'linear-gradient(135deg, #D8B38A, #C78C8D)', color: '#131017', border: 'none', borderRadius: '20px', padding: '10px 18px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' },
    postsEmpty: { margin: '0 20px', backgroundColor: '#211A28', border: '1px dashed #4A1828', borderRadius: '20px', padding: '40px 24px', textAlign: 'center' as const, color: '#B58A83', fontSize: '14px' },
    postsEmptyTitle: { fontSize: '16px', fontWeight: 700, color: '#EAE2F0', marginBottom: '8px' },
    postsError: { margin: '0 20px 16px 20px', backgroundColor: '#3B1220', border: '1px solid #7F1D2E', color: '#FCA5B5', borderRadius: '14px', padding: '12px 16px', fontSize: '13px' },
    overlay: { position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(8, 6, 10, 0.72)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100, padding: '16px' },
    modal: { width: '100%', maxWidth: '440px', backgroundColor: '#211A28', borderRadius: '24px', padding: '24px', border: '1px solid #34283F', marginBottom: '16px', maxHeight: '80vh', overflowY: 'auto' as const },
    modalTitle: { fontSize: '18px', fontWeight: 700, color: '#EAE2F0', marginBottom: '4px' },
    modalSubtitle: { fontSize: '13px', color: '#B58A83', marginBottom: '18px' },
    modalInput: { width: '100%', backgroundColor: '#131017', border: '1px solid #34283F', borderRadius: '14px', padding: '14px', color: '#EAE2F0', fontSize: '15px', outline: 'none', boxSizing: 'border-box' as const },
    modalTextarea: { width: '100%', backgroundColor: '#131017', border: '1px solid #34283F', borderRadius: '14px', padding: '14px', color: '#EAE2F0', fontSize: '15px', outline: 'none', boxSizing: 'border-box' as const, minHeight: '120px', resize: 'vertical' as const, fontFamily: 'inherit' },
    optionWrap: { display: 'flex', flexWrap: 'wrap' as const, gap: '10px' },
    optionPill: { padding: '10px 16px', borderRadius: '20px', border: '1px solid #34283F', backgroundColor: '#131017', color: '#D8B38A', fontSize: '13px', fontWeight: 600, cursor: 'pointer' },
    optionPillActive: { backgroundColor: '#D8B38A', color: '#131017', border: '1px solid #D8B38A' },
    modalActions: { display: 'flex', gap: '12px', marginTop: '20px' },
    modalCancel: { flex: 1, padding: '14px', borderRadius: '16px', border: '1px solid #34283F', backgroundColor: 'transparent', color: '#B58A83', fontWeight: 700, fontSize: '14px', cursor: 'pointer' },
    modalSave: { flex: 1, padding: '14px', borderRadius: '16px', border: 'none', background: 'linear-gradient(135deg, #D8B38A, #C78C8D)', color: '#131017', fontWeight: 700, fontSize: '14px', cursor: 'pointer' },
    modalError: { marginTop: '12px', color: '#F0A6A6', fontSize: '13px' },
    toast: { position: 'fixed' as const, left: '50%', bottom: '96px', transform: 'translateX(-50%)', zIndex: 110, padding: '12px 20px', borderRadius: '999px', fontSize: '13px', fontWeight: 600, boxShadow: '0 10px 30px rgba(0,0,0,0.4)', maxWidth: '90%', textAlign: 'center' as const },
    toastSuccess: { backgroundColor: '#D8B38A', color: '#131017' },
    toastError: { backgroundColor: '#4A1828', color: '#F2CFCF' }
  };

  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (completionPercentage / 100) * circumference;

  const author: MomentAuthor = {
    id: profile.id,
    displayName: profile.display_name,
    avatarUrl: profile.avatar_url,
    gender: profile.gender,
    country: profile.country,
  };

  const editorConfig = editor ? EDITOR_FIELDS[editor] : null;
  const editorTitle = editor === 'phone' && phoneStage === 'verify' ? 'Verify phone' : editorConfig?.title ?? '';
  const editorHint = editor === 'phone' && phoneStage === 'verify'
    ? `Enter the code sent to ${pendingPhone}.`
    : editorConfig?.hint ?? '';

  const renderEditorInput = () => {
    if (!editor) return null;

    switch (editor) {
      case 'bio':
        return (
          <>
            <textarea
              style={styles.modalTextarea}
              value={textDraft}
              maxLength={MAX_BIO_LENGTH}
              onChange={(e) => setTextDraft(e.target.value)}
              placeholder="Tell others what makes you unique..."
            />
            <p style={{ ...styles.editHint, marginTop: '8px', marginBottom: 0 }}>{textDraft.length}/{MAX_BIO_LENGTH}</p>
          </>
        );

      case 'personality':
        return (
          <input
            style={styles.modalInput}
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            placeholder="e.g. Adventurous, Kind, Funny"
          />
        );

      case 'email':
        return (
          <input
            type="email"
            autoComplete="email"
            style={styles.modalInput}
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            placeholder="you@example.com"
          />
        );

      case 'phone':
        return phoneStage === 'verify' ? (
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            style={styles.modalInput}
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            placeholder="6-digit code"
          />
        ) : (
          <input
            type="tel"
            autoComplete="tel"
            style={styles.modalInput}
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            placeholder="+977 98XXXXXXXX"
          />
        );

      case 'age':
        return (
          <input
            type="number"
            min={MIN_AGE}
            max={MAX_AGE}
            inputMode="numeric"
            style={styles.modalInput}
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            placeholder="e.g. 28"
          />
        );

      case 'gender':
        return (
          <div style={styles.optionWrap}>
            {ONBOARDING_GENDERS.map((option) => (
              <button
                key={option}
                type="button"
                style={{ ...styles.optionPill, ...(textDraft === option ? styles.optionPillActive : {}) }}
                onClick={() => setTextDraft((prev) => (prev === option ? '' : option))}
              >
                {option}
              </button>
            ))}
          </div>
        );

      case 'intention':
        return (
          <div style={styles.optionWrap}>
            {PROFILE_INTENTION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                style={{ ...styles.optionPill, ...(textDraft === option.value ? styles.optionPillActive : {}) }}
                onClick={() => setTextDraft((prev) => (prev === option.value ? '' : option.value))}
              >
                {option.label}
              </button>
            ))}
          </div>
        );

      case 'drinking':
        return (
          <div style={styles.optionWrap}>
            {PROFILE_DRINKING_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                style={{ ...styles.optionPill, ...(textDraft === option ? styles.optionPillActive : {}) }}
                onClick={() => setTextDraft((prev) => (prev === option ? '' : option))}
              >
                {option}
              </button>
            ))}
          </div>
        );

      case 'smoking':
        return (
          <div style={styles.optionWrap}>
            {PROFILE_SMOKING_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                style={{ ...styles.optionPill, ...(textDraft === option ? styles.optionPillActive : {}) }}
                onClick={() => setTextDraft((prev) => (prev === option ? '' : option))}
              >
                {option}
              </button>
            ))}
          </div>
        );

      case 'looking_for':
        return (
          <div style={styles.optionWrap}>
            {PROFILE_LOOKING_FOR_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                style={{ ...styles.optionPill, ...(listDraft.includes(option) ? styles.optionPillActive : {}) }}
                onClick={() => toggleListDraft(option)}
              >
                {option}
              </button>
            ))}
          </div>
        );

      case 'pets':
        return (
          <div style={styles.optionWrap}>
            {PROFILE_PETS_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                style={{ ...styles.optionPill, ...(listDraft.includes(option) ? styles.optionPillActive : {}) }}
                onClick={() => toggleListDraft(option)}
              >
                {option}
              </button>
            ))}
          </div>
        );

      case 'hobbies':
        return (
          <div style={styles.optionWrap}>
            {PROFILE_HOBBIES_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                style={{ ...styles.optionPill, ...(listDraft.includes(option) ? styles.optionPillActive : {}) }}
                onClick={() => toggleListDraft(option)}
              >
                {option}
              </button>
            ))}
          </div>
        );

      case 'religion':
        return (
          <input
            style={styles.modalInput}
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            placeholder="e.g. Hindu, Buddhist, Prefer not to say"
          />
        );

      case 'politics':
        return (
          <input
            style={styles.modalInput}
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            placeholder="e.g. Moderate, Liberal, Prefer not to say"
          />
        );

      default:
        return null;
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.topBar}>
        <button style={styles.iconButton} onClick={() => router.back()} aria-label="Back"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg></button>
        <div style={styles.title}>My Profile</div>
        <button style={styles.iconButton} onClick={() => router.push('/profile/settings')} aria-label="Settings"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></button>
      </div>

      <ProfileHeader
        displayName={profile.display_name}
        age={profile.age ?? null}
        gender={profile.gender}
        city={profile.city}
        country={profile.country}
        avatarUrl={profile.avatar_url}
        isOnline
        intention={profile.intention}
        matches={profile.matches_count}
        following={profile.following_count}
        followers={profile.followers_count}
        likes={profile.profile_likes_count}
        onStatNavigate={(key) => router.push(`/profile/stats/${key}`)}
      />

      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <div style={styles.sectionIcon}>📝</div>
          <div style={styles.sectionTitle}>Bio</div>
        </div>
        {profile.bio?.trim() ? (
          <p style={styles.bioText}>{profile.bio}</p>
        ) : (
          <div style={styles.emptyText}>No bio added yet.</div>
        )}
      </div>

      <div style={styles.progressCard}>
        <svg style={styles.progressCircle} viewBox="0 0 50 50"><circle cx="25" cy="25" r={radius} fill="none" stroke="#34283F" strokeWidth="4" /><circle cx="25" cy="25" r={radius} fill="none" stroke="#D8B38A" strokeWidth="4" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} strokeLinecap="round" transform="rotate(-90 25 25)" /><text x="25" y="28" textAnchor="middle" fill="#EAE2F0" fontSize="10" fontWeight="bold">{completionPercentage}%</text></svg>
        <div style={styles.progressText}><div style={styles.progressTitle}>Complete your profile</div><div style={styles.progressSubtitle}>Add more info to attract matches</div></div>
        <button style={styles.completeBtn} onClick={() => router.push('/profile/edit')}>Complete</button>
      </div>

      <ProfileTabs active={activeTab} onChange={setActiveTab} />

      {activeTab === 'feed' && (
        <ProfileMoments
          posts={posts}
          author={author}
          isOwn
          currentUserId={profile.id}
          loading={postsLoading}
          error={postsError}
          title="Your Posts"
          action={
            <button type="button" style={styles.newPostBtn} onClick={() => router.push('/moments')}>
              + New Post
            </button>
          }
          emptyTitle="No posts yet"
          emptyBody="Share photos, videos and updates in Moments and they will appear here."
          onLike={(item) => void handleLikePost(item)}
        />
      )}

      {activeTab === 'details' && (
        <ProfileDetails
          data={{
            bio: profile.bio,
            age: profile.age ?? null,
            gender: profile.gender,
            looking_for: profile.looking_for,
            intention: profile.intention,
            drinking: profile.drinking,
            smoking: profile.smoking,
            religion: profile.religion,
            politics: profile.politics,
            pets: profile.pets,
            personality: profile.personality,
            hobbies: profile.hobbies,
          }}
          onEdit={openEditor}
          contact={{ email: userEmail, phone }}
        />
      )}

      {editor && editorConfig && (
        <div
          style={styles.overlay}
          onClick={() => { if (!saving) closeEditor(); }}
        >
          <div
            style={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label={editorTitle}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={styles.modalTitle}>{editorTitle}</div>
            <div style={styles.modalSubtitle}>{editorHint}</div>
            {renderEditorInput()}
            {editorError && <div style={styles.modalError}>{editorError}</div>}
            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.modalCancel}
                onClick={closeEditor}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                style={{ ...styles.modalSave, opacity: saving ? 0.7 : 1 }}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ ...styles.toast, ...(toast.tone === 'success' ? styles.toastSuccess : styles.toastError) }}>
          {toast.message}
        </div>
      )}

      <MobileNav />
    </div>
  );
}
