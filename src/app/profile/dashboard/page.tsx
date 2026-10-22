'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { MAX_BIO_LENGTH, MIN_AGE } from '@/lib/profile';
import { PERSONALITY_OPTIONS } from '@/lib/personality';
import { ONBOARDING_GENDERS } from '@/lib/onboarding-steps';
import {
  PROFILE_DRINKING_OPTIONS,
  PROFILE_HOBBIES_OPTIONS,
  PROFILE_INTENTION_OPTIONS,
  PROFILE_LOOKING_FOR_OPTIONS,
  PROFILE_PETS_OPTIONS,
  PROFILE_RELIGION_OPTIONS,
  PROFILE_SMOKING_OPTIONS,
} from '@/lib/profile-options';
import {
  MomentError,
  deleteMoment,
  archiveMoment,
  fetchUserMoments,
  likeMoment,
  setMomentVisibility,
  unlikeMoment,
  updateMomentCaption,
} from '@/lib/moments';
import { isMissingColumnError } from '@/lib/postgrest-errors';
import { fetchProfileViewCount } from '@/lib/profile-views';
import type { MomentAuthor, MomentFeedRow, MomentVisibility } from '@/lib/types';
import MobileNav from '../../components/layout/MobileNav';
import ProfileHeader from '../../components/profile/ProfileHeader';
import ProfileTabs, { type ProfileTab } from '../../components/profile/ProfileTabs';
import ProfileDetails from '../../components/profile/ProfileDetails';
import ProfileMoments from '../../components/profile/ProfileMoments';
import ProfileActionMenu from '../../components/profile/ProfileActionMenu';
import ProfileViewAsBanner from '../../components/profile/ProfileViewAsBanner';
import ArchivePanel from '../../components/profile/ArchivePanel';
import PostOptionsMenu from '../../components/profile/PostOptionsMenu';

/** The oldest age the dashboard will accept when a member edits their age. */
const MAX_AGE = 120;

interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  has_last_name: boolean;
  username: string | null;
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
  mbti: string;
  religion: string;
  drinking: string;
  smoking: string;
  /** M22 short headline, shown under the name. Optional. */
  status: string | null;
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
  | 'pets'
  | 'mbti'
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
    | 'pets'
    | 'mbti'
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
  religion: { title: 'Religion', hint: 'Optional — leave blank to hide.', kind: 'select' },
  pets: { title: 'Pets', hint: 'How you feel about animals.', kind: 'multi' },
  mbti: { title: 'Personality', hint: 'Your MBTI type.', kind: 'select' },
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
 * Written as single string literals on purpose: supabase-js parses the column
 * list at the TYPE level, and a value built with `.join()` is just `string`, so
 * inference collapses to an error type.
 *
 * THE COUNTERS ARE OPT-IN
 *   The four social counters were added by M18 and are maintained by triggers.
 *   On a deployment where that migration has not run, naming them in the select
 *   fails with `42703` and — before this was split out — blanked the whole page.
 *   So they are requested separately: `PROFILE_COUNT_COLUMNS` is tried first and
 *   dropped to zero when the schema is behind, leaving the profile itself
 *   readable on a partially migrated database.
 */
const PROFILE_CORE_COLUMNS =
  'id, first_name, last_name, has_last_name, username, display_name, age, gender, city, country, avatar_url, photos, bio, intention, looking_for, hobbies, pets, mbti, religion, drinking, smoking' as const;

/**
 * The M18 counters and the M22 status headline. Both are opt-in for the same
 * reason: on a deployment behind these migrations, naming them fails with
 * `42703`, so they are dropped together and the profile still renders.
 */
const PROFILE_OPTIONAL_COLUMNS =
  'followers_count, following_count, matches_count, profile_likes_count, status' as const;

const PROFILE_COLUMNS = `${PROFILE_CORE_COLUMNS}, ${PROFILE_OPTIONAL_COLUMNS}` as const;

/** The row shape when the optional counter/status columns are not available. */
type ProfileCoreRow = Omit<
  Profile,
  'followers_count' | 'following_count' | 'matches_count' | 'profile_likes_count' | 'status'
>;

/** Fills the counters and status so a partially migrated row still renders. */
function withDefaultCounts(row: ProfileCoreRow): Profile {
  return {
    ...row,
    followers_count: 0,
    following_count: 0,
    matches_count: 0,
    profile_likes_count: 0,
    status: null,
  };
}

export default function ProfileDashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>('feed');

  // Unique profile viewers. Null until the aggregate loads; a failed load leaves
  // the count at zero rather than blocking the dashboard.
  const [viewCount, setViewCount] = useState<number | null>(null);

  // The member's own Moments, shown on the Posts tab.
  const [posts, setPosts] = useState<MomentFeedRow[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsError, setPostsError] = useState<string | null>(null);

  // M22 profile management: a visitor preview, post search, the status headline
  // editor and the archive sheet.
  const [viewAs, setViewAs] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusDraft, setStatusDraft] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  // Inline editor state. `editor` is the field being edited, or null when the
  // sheet is closed. `textDraft` backs the single-value inputs, `listDraft` the
  // and multi-select pills.
  const [editor, setEditor] = useState<EditableKey | null>(null);
  const [textDraft, setTextDraft] = useState('');
  const [listDraft, setListDraft] = useState<string[]>([]);
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
          // A schema that is behind (the M18 counters absent) is not a failed
          // load: re-read the core columns and render the profile with zeroed
          // counters, rather than blanking the page over a missing column.
          if (isMissingColumnError(error)) {
            const fallback = await supabase
              .from('profiles')
              .select(PROFILE_CORE_COLUMNS)
              .eq('id', user.id)
              .maybeSingle();

            if (!isMounted) return;

            if (fallback.error) {
              console.error('Error fetching profile (core fallback):', fallback.error.message);
              setLoadError('We could not load your profile.');
              return;
            }

            setProfile(
              fallback.data ? withDefaultCounts(fallback.data as ProfileCoreRow) : null
            );
            return;
          }

          console.error("Error fetching profile:", error.message);
          setLoadError('We could not load your profile.');
          return;
        }

        setProfile((data ?? null) as Profile | null);
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

  // Aggregate unique viewers for the visible Profile Views button. Keyed on the
  // id so an inline edit does not re-fetch it.
  useEffect(() => {
    if (!profileId) return;

    let cancelled = false;
    void (async () => {
      try {
        const count = await fetchProfileViewCount(profileId);
        if (!cancelled) setViewCount(count);
      } catch (err) {
        console.error('[dashboard] profile view count failed:', err);
        if (!cancelled) setViewCount(0);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profileId]);

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

  // Same for the profile-status sheet.
  useEffect(() => {
    if (!statusOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !statusSaving) setStatusOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [statusOpen, statusSaving]);

  const showToast = (message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const openEditor = (key: EditableKey) => {
    // The visitor preview is strictly read-only: never open an editor sheet
    // from it, even if a stray handler fires.
    if (viewAs) return;
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
      case 'mbti': setTextDraft(profile.mbti ?? ''); break;
      case 'looking_for': setListDraft([...(profile.looking_for ?? [])]); break;
      case 'pets': setListDraft([...(profile.pets ?? [])]); break;
      case 'hobbies': setListDraft([...(profile.hobbies ?? [])]); break;
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

        case 'mbti': {
          const value = textDraft.trim().toUpperCase();
          if (!PERSONALITY_OPTIONS.some((option) => option.code === value)) {
            setEditorError('Please choose a valid personality type.');
            return;
          }
          const failure = await persistProfile({ mbti: value });
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

  // --- M22 profile management ---------------------------------------------- //

  const refreshPosts = async () => {
    if (!profileId) return;
    try {
      const rows = await fetchUserMoments(profileId);
      setPosts(rows);
      setPostsError(null);
    } catch (err) {
      console.error('Failed to refresh your posts:', err);
      showToast('Could not refresh your posts.', 'error');
    }
  };

  // These four are passed to `PostOptionsMenu`, which surfaces any thrown error
  // in its own sheet. They update local state only after the write is confirmed.
  const handleArchivePost = async (post: MomentFeedRow) => {
    const moved = await archiveMoment(post.id);
    if (!moved) throw new MomentError('That post could not be archived.');
    setPosts((prev) => prev.filter((item) => item.id !== post.id));
    showToast('Moved to archive');
  };

  const handleDeletePost = async (post: MomentFeedRow) => {
    await deleteMoment(post.id);
    setPosts((prev) => prev.filter((item) => item.id !== post.id));
    showToast('Post deleted');
  };

  const handleEditCaption = async (post: MomentFeedRow, caption: string) => {
    await updateMomentCaption(post.id, caption);
    setPosts((prev) =>
      prev.map((item) => (item.id === post.id ? { ...item, caption: caption.trim() || null } : item))
    );
    showToast('Caption updated');
  };

  const handleChangeVisibility = async (post: MomentFeedRow, visibility: MomentVisibility) => {
    await setMomentVisibility(post.id, visibility);
    setPosts((prev) => prev.map((item) => (item.id === post.id ? { ...item, visibility } : item)));
    showToast('Privacy updated');
  };

  const openStatus = () => {
    setStatusDraft(profile?.status ?? '');
    setStatusError(null);
    setStatusOpen(true);
  };

  const handleSaveStatus = async () => {
    if (!profile) return;
    const value = statusDraft.trim();
    setStatusSaving(true);
    setStatusError(null);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({ status: value || null })
        .eq('id', profile.id)
        .select('id');

      if (error) {
        setStatusError(`We could not save that: ${error.message}`);
        return;
      }
      if (!data || data.length === 0) {
        setStatusError('We could not save that change. Please try again.');
        return;
      }
      setProfile((prev) => (prev ? { ...prev, status: value || null } : prev));
      showToast('Status updated');
      setStatusOpen(false);
    } finally {
      setStatusSaving(false);
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const displayedPosts = posts
    .filter((post) => (viewAs ? post.visibility === 'public' : true))
    .filter((post) =>
      normalizedQuery ? (post.caption ?? '').toLowerCase().includes(normalizedQuery) : true
    );

  const calculateCompletion = () => {
    if (!profile) return 0;

    // Count the actual profile fields, not an assumed "verified" state. Empty
    // arrays and whitespace-only text are not progress; the optional fields
    // still count because they are part of profile strength, not onboarding.
    const checks = [
      profile.first_name?.trim(),
      profile.last_name?.trim(),
      profile.username?.trim(),
      profile.age,
      profile.gender?.trim(),
      profile.city?.trim(),
      profile.country?.trim(),
      profile.avatar_url?.trim(),
      profile.bio?.trim(),
      profile.intention?.trim(),
      profile.looking_for?.length,
      profile.hobbies?.length,
      profile.pets?.length,
      profile.mbti?.trim(),
      profile.religion?.trim(),
      profile.drinking?.trim(),
      profile.smoking?.trim(),
    ];
    const filled = checks.filter((value) =>
      typeof value === 'number' ? value > 0 : Boolean(value)
    ).length;

    return Math.round((filled / checks.length) * 100);
  };

  const completionPercentage = calculateCompletion();

  if (loading) {
    return (
      <div className="pf-page pf-skeleton" role="status" aria-live="polite">
        <span className="pf-spinner" aria-hidden="true" />
        <span>Loading your profile…</span>
      </div>
    );
  }

  // A failed load gets a retry affordance instead of an endless "Redirecting"
  // message, since we deliberately do not bounce to onboarding on error.
  if (loadError) {
    return (
      <div className="pf-page pf-load-error">
        <p style={{ margin: 0 }}>{loadError}</p>
        <button
          type="button"
          className="pf-btn pf-btn-primary"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    );
  }

  // If profile is null, we are already redirecting, just show a loading state.
  if (!profile) {
    return (
      <div className="pf-page pf-skeleton" role="status" aria-live="polite">
        <span className="pf-spinner" aria-hidden="true" />
        <span>Redirecting to onboarding…</span>
      </div>
    );
  }

  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (completionPercentage / 100) * circumference;
  const isComplete = completionPercentage >= 100;

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
              className="pf-textarea"
              value={textDraft}
              maxLength={MAX_BIO_LENGTH}
              onChange={(e) => setTextDraft(e.target.value)}
              placeholder="Tell others what makes you unique..."
            />
            <p className="pf-detail-hint" style={{ marginTop: 8, marginBottom: 0 }}>
              {textDraft.length}/{MAX_BIO_LENGTH}
            </p>
          </>
        );

      case 'mbti':
        return (
          <div className="pf-options">
            {PERSONALITY_OPTIONS.map((option) => (
              <button
                key={option.code}
                type="button"
                className="pf-option"
                aria-pressed={textDraft === option.code}
                onClick={() => setTextDraft(option.code)}
              >
                <span style={{ display: 'block', fontWeight: 700 }}>
                  {option.name} ({option.code})
                </span>
                <span
                  style={{
                    display: 'block',
                    marginTop: 3,
                    fontSize: 12,
                    lineHeight: 1.4,
                    opacity: 0.78,
                  }}
                >
                  {option.description}
                </span>
              </button>
            ))}
          </div>
        );

      case 'email':
        return (
          <input
            type="email"
            autoComplete="email"
            className="pf-input"
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
            className="pf-input"
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            placeholder="6-digit code"
          />
        ) : (
          <input
            type="tel"
            autoComplete="tel"
            className="pf-input"
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
            className="pf-input"
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            placeholder="e.g. 28"
          />
        );

      case 'gender':
        return (
          <div className="pf-options">
            {ONBOARDING_GENDERS.map((option) => (
              <button
                key={option}
                type="button"
                className="pf-option"
                aria-pressed={textDraft === option}
                onClick={() => setTextDraft((prev) => (prev === option ? '' : option))}
              >
                {option}
              </button>
            ))}
          </div>
        );

      case 'intention':
        return (
          <div className="pf-options">
            {PROFILE_INTENTION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="pf-option"
                aria-pressed={textDraft === option.value}
                onClick={() => setTextDraft((prev) => (prev === option.value ? '' : option.value))}
              >
                {option.label}
              </button>
            ))}
          </div>
        );

      case 'drinking':
        return (
          <div className="pf-options">
            {PROFILE_DRINKING_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className="pf-option"
                aria-pressed={textDraft === option}
                onClick={() => setTextDraft((prev) => (prev === option ? '' : option))}
              >
                {option}
              </button>
            ))}
          </div>
        );

      case 'smoking':
        return (
          <div className="pf-options">
            {PROFILE_SMOKING_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className="pf-option"
                aria-pressed={textDraft === option}
                onClick={() => setTextDraft((prev) => (prev === option ? '' : option))}
              >
                {option}
              </button>
            ))}
          </div>
        );

      case 'looking_for':
        return (
          <div className="pf-options">
            {PROFILE_LOOKING_FOR_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className="pf-option"
                aria-pressed={listDraft.includes(option)}
                onClick={() => toggleListDraft(option)}
              >
                {option}
              </button>
            ))}
          </div>
        );

      case 'pets':
        return (
          <div className="pf-options">
            {PROFILE_PETS_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className="pf-option"
                aria-pressed={listDraft.includes(option)}
                onClick={() => toggleListDraft(option)}
              >
                {option}
              </button>
            ))}
          </div>
        );

      case 'hobbies':
        return (
          <div className="pf-options">
            {PROFILE_HOBBIES_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className="pf-option"
                aria-pressed={listDraft.includes(option)}
                onClick={() => toggleListDraft(option)}
              >
                {option}
              </button>
            ))}
          </div>
        );

      case 'religion':
        return (
          <div className="pf-options">
            {PROFILE_RELIGION_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className="pf-option"
                aria-pressed={textDraft === option}
                onClick={() => setTextDraft((prev) => (prev === option ? '' : option))}
              >
                {option}
              </button>
            ))}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="pf-page">
      <header className="pf-topbar">
        <div className="pf-topbar-inner">
          <button
            type="button"
            className="pf-icon-btn"
            onClick={() => router.back()}
            aria-label="Back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>

          <div className="pf-title">My Profile</div>

          <div className="pf-toolbar">
            {!viewAs && (
              <ProfileActionMenu
                onViewAs={() => {
                  // Entering the preview must not leave an owner editor open.
                  closeEditor();
                  setStatusOpen(false);
                  setArchiveOpen(false);
                  setSearchOpen(false);
                  setViewAs(true);
                }}
                onSearch={() => setSearchOpen(true)}
                onProfileStatus={openStatus}
                onArchive={() => setArchiveOpen(true)}
              />
            )}
            {!viewAs && (
              <button
                type="button"
                className="pf-icon-btn"
                onClick={() => router.push('/profile/settings')}
                aria-label="Settings"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                </svg>
              </button>
            )}
            {viewAs && <span className="pf-toolbar-spacer" aria-hidden="true" />}
          </div>
        </div>
      </header>

      <main className="pf-content">
        <ProfileHeader
          displayName={profile.display_name}
          username={profile.username}
          age={profile.age ?? null}
          gender={profile.gender}
          city={profile.city}
          country={profile.country}
          avatarUrl={profile.avatar_url}
          intention={profile.intention}
          matches={profile.matches_count}
          following={profile.following_count}
          followers={profile.followers_count}
          likes={profile.profile_likes_count}
          onStatNavigate={(key) => router.push(`/profile/stats/${key}`)}
          actions={
            !viewAs ? (
              <>
                <button
                  type="button"
                  className="pf-btn pf-btn-quiet pf-views-cta"
                  data-testid="profile-views-button"
                  onClick={() => router.push('/profile/stats/views')}
                  aria-label={`Profile views: ${viewCount ?? 0}. Open viewer analytics.`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <span>Profile Views</span>
                  <span className="pf-views-cta-count">{viewCount ?? 0}</span>
                </button>
                <button
                  type="button"
                  className="pf-btn pf-btn-primary"
                  onClick={() => router.push('/profile/edit')}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                  Edit profile
                </button>
              </>
            ) : undefined
          }
        />

        {viewAs && <ProfileViewAsBanner onExit={() => setViewAs(false)} />}

        {!viewAs && profile.status?.trim() ? (
          <div className="pf-status" data-testid="profile-status-pill">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />
            </svg>
            <span>{profile.status}</span>
          </div>
        ) : null}

        {!viewAs && searchOpen && (
          <div className="pf-search">
            <svg className="pf-search-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
            <input
              className="pf-input"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search your posts by caption…"
              aria-label="Search your posts"
              data-testid="profile-search-input"
              autoFocus
            />
            <button
              type="button"
              className="pf-search-clear"
              onClick={() => {
                setSearchQuery('');
                setSearchOpen(false);
              }}
              aria-label="Close search"
            >
              ×
            </button>
          </div>
        )}

        <div className={`pf-overview${isComplete ? ' pf-overview-single' : ''}`}>
          <section className="pf-card" aria-labelledby="profile-about-title">
            <div className="pf-section-head">
              <h2 className="pf-section-title" id="profile-about-title">
                About
              </h2>
              {!viewAs && (
                <button
                  type="button"
                  className="pf-link-btn"
                  onClick={() => openEditor('bio')}
                  aria-label="Edit Bio"
                  data-testid="bio-edit-button"
                >
                  Edit
                </button>
              )}
            </div>
            {profile.bio?.trim() ? (
              <p className="pf-bio">{profile.bio}</p>
            ) : (
              <p className="pf-muted">
                {viewAs
                  ? 'No bio added yet.'
                  : 'Add a short bio so people have something to start a conversation about.'}
              </p>
            )}
            {!viewAs && !profile.bio?.trim() && (
              <div className="pf-about-actions">
                <button
                  type="button"
                  className="pf-btn pf-btn-small pf-btn-quiet"
                  onClick={() => openEditor('bio')}
                >
                  Add bio
                </button>
              </div>
            )}
          </section>

          {!viewAs && !isComplete && (
            <section className="pf-card pf-completion" aria-labelledby="profile-strength-title">
              <svg
                className="pf-ring"
                viewBox="0 0 50 50"
                role="img"
                aria-label={`Profile ${completionPercentage}% complete`}
              >
                <circle cx="25" cy="25" r={radius} fill="none" stroke="#34283F" strokeWidth="4" />
                <circle
                  cx="25"
                  cy="25"
                  r={radius}
                  fill="none"
                  stroke="#D8B38A"
                  strokeWidth="4"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  transform="rotate(-90 25 25)"
                />
                <text x="25" y="28" textAnchor="middle" fill="#EAE2F0" fontSize="10" fontWeight="bold">
                  {completionPercentage}%
                </text>
              </svg>
              <div className="pf-completion-copy">
                <h2 className="pf-completion-title" id="profile-strength-title">
                  Profile strength
                </h2>
                <p className="pf-completion-text">
                  {completionPercentage}% complete. Add a few details to help people find you.
                </p>
              </div>
              <button
                type="button"
                className="pf-btn pf-btn-small pf-btn-primary"
                onClick={() => router.push('/profile/edit')}
              >
                Finish
              </button>
            </section>
          )}
        </div>

        <ProfileTabs active={activeTab} onChange={setActiveTab} />

        {activeTab === 'feed' && (
          <div
            role="tabpanel"
            id="profile-panel-feed"
            aria-labelledby="profile-tab-feed"
          >
            <ProfileMoments
              posts={displayedPosts}
              author={author}
              isOwn
              currentUserId={profile.id}
              loading={postsLoading}
              error={postsError}
              title={viewAs ? 'Posts' : 'Your Posts'}
              action={
                !viewAs ? (
                  <button
                    type="button"
                    className="pf-btn pf-btn-small pf-btn-primary"
                    onClick={() => router.push('/moments')}
                  >
                    New post
                  </button>
                ) : undefined
              }
              emptyTitle={
                normalizedQuery ? 'No matching posts' : viewAs ? 'No public posts' : 'No posts yet'
              }
              emptyBody={
                normalizedQuery
                  ? 'Try a different search.'
                  : viewAs
                    ? 'Nothing you have shared is public yet.'
                    : 'Share photos, videos and updates in Moments and they will appear here.'
              }
              onLike={(item) => void handleLikePost(item)}
              headerAction={
                viewAs
                  ? undefined
                  : (post) => (
                      <PostOptionsMenu
                        post={post}
                        onEditCaption={(caption) => handleEditCaption(post, caption)}
                        onChangeVisibility={(visibility) => handleChangeVisibility(post, visibility)}
                        onArchive={() => handleArchivePost(post)}
                        onDelete={() => handleDeletePost(post)}
                      />
                    )
              }
            />
          </div>
        )}

        {activeTab === 'details' && (
          <div
            role="tabpanel"
            id="profile-panel-details"
            aria-labelledby="profile-tab-details"
          >
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
                pets: profile.pets,
                mbti: profile.mbti,
                hobbies: profile.hobbies,
              }}
              onEdit={viewAs ? undefined : openEditor}
              contact={{ email: userEmail, phone }}
            />
          </div>
        )}
      </main>

      {!viewAs && editor && editorConfig && (
        <div
          className="pf-sheet-overlay"
          onClick={() => { if (!saving) closeEditor(); }}
        >
          <div
            className="pf-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-editor-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="pf-sheet-title" id="profile-editor-title">{editorTitle}</h2>
            <p className="pf-sheet-subtitle">{editorHint}</p>
            {renderEditorInput()}
            {editorError && (
              <p className="pf-form-error" role="alert">{editorError}</p>
            )}
            <div className="pf-sheet-actions">
              <button
                type="button"
                className="pf-sheet-cancel"
                onClick={closeEditor}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pf-sheet-save"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {!viewAs && statusOpen && (
        <div
          className="pf-sheet-overlay"
          onClick={() => { if (!statusSaving) setStatusOpen(false); }}
        >
          <div
            className="pf-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-status-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="pf-sheet-title" id="profile-status-title">Profile status</h2>
            <p className="pf-sheet-subtitle">A short headline shown under your name.</p>
            <input
              className="pf-input"
              value={statusDraft}
              maxLength={100}
              onChange={(event) => setStatusDraft(event.target.value)}
              placeholder="e.g. Chasing sunsets 🌅"
              autoFocus
            />
            <p className="pf-detail-hint" style={{ marginTop: 8, marginBottom: 0 }}>
              {statusDraft.length}/100
            </p>
            {statusError && (
              <p className="pf-form-error" role="alert">{statusError}</p>
            )}
            <div className="pf-sheet-actions">
              <button
                type="button"
                className="pf-sheet-cancel"
                onClick={() => setStatusOpen(false)}
                disabled={statusSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pf-sheet-save"
                onClick={() => void handleSaveStatus()}
                disabled={statusSaving}
              >
                {statusSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {!viewAs && archiveOpen && (
        <ArchivePanel
          onClose={() => setArchiveOpen(false)}
          onChanged={() => { void refreshPosts(); }}
        />
      )}

      {toast && (
        <div
          className={`pf-toast ${toast.tone === 'success' ? 'pf-toast-success' : 'pf-toast-error'}`}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      )}

      <MobileNav />
    </div>
  );
}
