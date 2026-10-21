'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import MobileNav from '../components/layout/MobileNav';
import FollowButton from '../components/profile/FollowButton';
import ProfileLink from '../components/profile/ProfileLink';
import ProfilePhotoCarousel, {
  profilePhotos,
} from '../components/people/ProfilePhotoCarousel';
import { recordLike, LikeError } from '@/lib/likes';
import { fetchDiscoveryCandidates, rankDiscovery, type DiscoveryCandidate } from '@/lib/discovery';
import { gendersForLookingFor } from '@/lib/dating-preferences';
import type { MatchProfile } from '@/lib/matching';
import { useFollow } from '@/context/FollowContext';

/**
 * `/people` — swipeable discovery.
 *
 * Candidates come from the same `discover_profiles()` RPC as Discover, so
 * blocks, suspensions, private profiles, prior decisions and matches are all
 * enforced by PostgreSQL before the browser sees a row. Ordering uses the shared
 * ranking engine: online first, then saved gender-preference affinity, then the
 * explainable intention/interest/prompt score.
 *
 * The old mutual-match list moved to `/profile/stats/matches`; this page is
 * discovery, not a second inbox.
 */

type SwipeDirection = 'left' | 'right' | 'up';

interface DragState {
  x: number;
  y: number;
}

const DECISION_DELAY_MS = 170;

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const getCountryFlag = (country: string | null) => {
  const flags: Record<string, string> = {
    Nepal: '🇳🇵',
    'United States': '🇺🇸',
    'United Kingdom': '🇬🇧',
    India: '🇮🇳',
    Australia: '🇦🇺',
    Canada: '🇨🇦',
    Philippines: '🇵🇭',
    Indonesia: '🇮🇩',
    Singapore: '🇸🇬',
    Japan: '🇯🇵',
    'South Korea': '🇰🇷',
    Germany: '🇩🇪',
    France: '🇫🇷',
    Brazil: '🇧🇷',
  };
  return country ? (flags[country] ?? '🌐') : '🌐';
};

const intentionLabel = (intention: string | null) => {
  if (!intention) return null;
  if (intention === 'friendship') return 'Friendship';
  if (intention === 'dating') return 'Dating';
  if (intention === 'both') return 'Dating & friendship';
  return intention;
};

export default function PeoplePage() {
  const router = useRouter();
  const { setFollowing } = useFollow();

  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exit, setExit] = useState<SwipeDirection | null>(null);
  const [drag, setDrag] = useState<DragState>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const preferredGenders = useRef<string[]>([]);
  const rankingProfile = useRef<MatchProfile | null>(null);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2200);
  }, []);

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace('/auth');
        return;
      }

      const { data: profileCheck, error: gateError } = await supabase
        .from('profiles')
        .select('onboarding_completed, gender, intention, interests, prompts, looking_for')
        .eq('id', user.id)
        .maybeSingle();

      if (gateError) {
        console.error('[people] gatekeeper failed:', gateError.message);
        setError('We could not load your preferences. Please try again.');
        return;
      }

      if (!profileCheck || profileCheck.onboarding_completed === false) {
        router.replace('/profile');
        return;
      }

      const genders = gendersForLookingFor(
        Array.isArray(profileCheck.looking_for) ? profileCheck.looking_for : []
      );

      const discovered = await fetchDiscoveryCandidates({
        minAge: 18,
        maxAge: 99,
        genders,
        limit: 50,
      });

      const promptAnswers =
        typeof profileCheck.prompts === 'object' && profileCheck.prompts !== null
          ? (profileCheck.prompts as Record<string, string>)
          : {};

      const me: MatchProfile = {
        id: user.id,
        gender: typeof profileCheck.gender === 'string' ? profileCheck.gender : null,
        intention:
          typeof profileCheck.intention === 'string' ? profileCheck.intention : null,
        interests: Array.isArray(profileCheck.interests) ? profileCheck.interests : [],
        promptAnswers,
        lookingFor: genders.length === 3 ? ['Everyone'] : lookingForLabels(genders),
      };

      const ranked = rankDiscovery(me, discovered, { limit: 50 });
      const nextCandidates = ranked.map((entry) => entry.profile);

      preferredGenders.current = genders;
      rankingProfile.current = me;
      seenIds.current = new Set(nextCandidates.map((candidate) => candidate.id));
      setHasMore(discovered.length >= 50);
      setCandidates(nextCandidates);
    } catch (err) {
      console.error('[people] discovery failed:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'We could not load members right now. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // The loader only updates state after an await, so this is a one-shot
    // mount fetch rather than a synchronous cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCandidates();
  }, [loadCandidates]);

  useEffect(
    () => () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    },
    []
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;

    const me = rankingProfile.current;
    if (!me) return;

    setLoadingMore(true);
    setError(null);

    try {
      const discovered = await fetchDiscoveryCandidates({
        minAge: 18,
        maxAge: 99,
        genders: preferredGenders.current,
        limit: 50,
        excludeIds: [...seenIds.current],
      });

      const ranked = rankDiscovery(me, discovered, { limit: 50 });
      const fresh = ranked
        .map((entry) => entry.profile)
        .filter((candidate) => !seenIds.current.has(candidate.id));

      for (const candidate of fresh) seenIds.current.add(candidate.id);

      setCandidates((current) => {
        const existing = new Set(current.map((candidate) => candidate.id));
        return [...current, ...fresh.filter((candidate) => !existing.has(candidate.id))];
      });
      setHasMore(discovered.length >= 50);

      if (fresh.length === 0) showNotice('No more people right now');
    } catch (err) {
      console.error('[people] load more failed:', err);
      setError('We could not load more members. Please try again.');
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, showNotice]);

  // Prefetch the next page before the last card so the stack rarely runs dry.
  useEffect(() => {
    if (!loading && !loadingMore && hasMore && candidates.length <= 1) {
      void loadMore();
    }
  }, [candidates.length, hasMore, loading, loadMore, loadingMore]);

  const active = candidates[0] ?? null;
  const next = candidates[1] ?? null;

  const removeActive = useCallback((id: string) => {
    setCandidates((current) => current.filter((candidate) => candidate.id !== id));
    setExit(null);
    setDrag({ x: 0, y: 0 });
  }, []);

  const decide = async (candidate: DiscoveryCandidate, isLike: boolean) => {
    if (busy || !candidate) return;

    setBusy(true);
    setError(null);
    setExit(isLike ? 'right' : 'left');

    try {
      const result = await recordLike(candidate.id, isLike);
      await wait(DECISION_DELAY_MS);
      removeActive(candidate.id);
      showNotice(result.matched ? "It's a match" : isLike ? 'Like sent' : 'Passed');
    } catch (err) {
      console.error('[people] decision failed:', err);
      setExit(null);
      setDrag({ x: 0, y: 0 });
      setError(
        err instanceof LikeError ? err.message : 'That action did not save. Please try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  const followActive = async (candidate: DiscoveryCandidate) => {
    if (busy || !candidate) return;

    setBusy(true);
    setError(null);
    setExit('up');

    const followed = await setFollowing(candidate.id, true);
    if (!followed) {
      setExit(null);
      setDrag({ x: 0, y: 0 });
      setError('Could not follow this member. Please try again.');
      setBusy(false);
      return;
    }

    await wait(DECISION_DELAY_MS);
    removeActive(candidate.id);
    showNotice(`Following ${candidate.displayName}`);
    setBusy(false);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (busy || exit) return;
    if ((event.target as HTMLElement).closest('a, button, [data-photo-nav]')) return;

    dragOrigin.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOrigin.current) return;
    setDrag({
      x: event.clientX - dragOrigin.current.x,
      y: event.clientY - dragOrigin.current.y,
    });
  };

  const finishDrag = () => {
    if (!dragOrigin.current || !active) return;

    const { x, y } = drag;
    dragOrigin.current = null;
    setDragging(false);

    if (x > 90) void decide(active, true);
    else if (x < -90) void decide(active, false);
    else if (y < -90) void followActive(active);
    else setDrag({ x: 0, y: 0 });
  };

  const cancelDrag = () => {
    dragOrigin.current = null;
    setDragging(false);
    setDrag({ x: 0, y: 0 });
  };

  const dragIntent: SwipeDirection | null =
    exit ??
    (drag.x > 55 ? 'right' : drag.x < -55 ? 'left' : drag.y < -70 ? 'up' : null);

  const cardTransform = exit
    ? exit === 'left'
      ? 'translate(-130%, 10px) rotate(-12deg)'
      : exit === 'right'
        ? 'translate(130%, 10px) rotate(12deg)'
        : 'translateY(-130%)'
    : `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x / 26}deg)`;

  return (
    <div className="people-page">
      <header className="people-header">
        <div>
          <p className="people-eyebrow">Discover</p>
          <h1 className="people-title">People</h1>
          <p className="people-subtitle">
            Swipe right to like, left to pass, up to follow.
          </p>
        </div>
        <Link href="/profile/stats/matches" className="people-matches-link">
          Matches
        </Link>
      </header>

      {loading || (loadingMore && !active) ? (
        <div className="people-state" role="status">
          <span className="people-spinner" aria-hidden="true" />
          <p>Finding people for you…</p>
        </div>
      ) : error && candidates.length === 0 ? (
        <div className="people-state" role="alert">
          <h2>We could not load People</h2>
          <p>{error}</p>
          <button type="button" className="people-primary" onClick={() => void loadCandidates()}>
            Try again
          </button>
        </div>
      ) : !active ? (
        <div className="people-state">
          <h2>You&apos;re all caught up</h2>
          <p>
            You have seen everyone who matches your preferences right now. Check your matches,
            or come back when more people join.
          </p>
          <div className="people-state-actions">
            <button type="button" className="people-primary" onClick={() => void loadCandidates()}>
              Refresh
            </button>
            <Link href="/profile/stats/matches" className="people-secondary">
              View matches
            </Link>
          </div>
        </div>
      ) : (
        <main
          className="people-stage"
          aria-label="Discovery cards"
          onKeyDown={(event) => {
            if (busy || exit) return;
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              void decide(active, true);
            } else if (event.key === 'ArrowLeft') {
              event.preventDefault();
              void decide(active, false);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              void followActive(active);
            }
          }}
          tabIndex={0}
        >
          <div className="people-stack">
            {next && (
              <div className="people-next-card" aria-hidden="true">
                {profilePhotos(next.avatarUrl, next.photos)[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profilePhotos(next.avatarUrl, next.photos)[0]}
                    alt=""
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div className="people-next-fallback" />
                )}
              </div>
            )}

            <article
              key={active.id}
              data-testid="people-swipe-card"
              className={`people-card${dragging ? ' is-dragging' : ''}`}
              style={{ transform: cardTransform }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={finishDrag}
              onPointerCancel={cancelDrag}
            >
              <div className="people-photo">
                <ProfilePhotoCarousel
                  key={active.id}
                  name={active.displayName}
                  avatarUrl={active.avatarUrl}
                  photos={active.photos}
                  online={active.online}
                />
                <div className="people-photo-actions">
                  <ProfileLink
                    userId={active.id}
                    label={`View ${active.displayName}'s profile`}
                    className="people-open-profile"
                  >
                    View profile
                  </ProfileLink>
                  <FollowButton targetUserId={active.id} />
                </div>

                {dragIntent && (
                  <div className={`people-intent is-${dragIntent}`} aria-hidden="true">
                    {dragIntent === 'right' ? 'LIKE' : dragIntent === 'left' ? 'PASS' : 'FOLLOW'}
                  </div>
                )}
              </div>

              <div className="people-details">
                <div className="people-name-row">
                  <ProfileLink
                    userId={active.id}
                    label={`View ${active.displayName}'s profile`}
                    className="people-name-link"
                  >
                    <h2>
                      {active.displayName}
                      {active.age ? <span>, {active.age}</span> : null}
                    </h2>
                  </ProfileLink>
                  {active.username ? <p className="people-handle">@{active.username}</p> : null}
                </div>

                <div className="people-meta">
                  <span>
                    {getCountryFlag(active.country)}{' '}
                    {[active.city, active.country].filter(Boolean).join(', ') || 'Global'}
                  </span>
                  {intentionLabel(active.intention) ? (
                    <span className="people-intention">{intentionLabel(active.intention)}</span>
                  ) : null}
                  {active.mbti ? <span className="people-mbti">{active.mbti}</span> : null}
                </div>

                {active.bio ? <p className="people-bio">{active.bio}</p> : null}

                {(active.interests.length > 0 || active.hobbies.length > 0) && (
                  <div className="people-tags" aria-label="Interests">
                    {[...new Set([...active.interests, ...active.hobbies])]
                      .slice(0, 6)
                      .map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                  </div>
                )}

                {firstPrompt(active.promptAnswers) ? (
                  <p className="people-prompt">{firstPrompt(active.promptAnswers)}</p>
                ) : null}
              </div>
            </article>
          </div>

          <div className="people-actions" aria-label="Profile actions">
            <button
              type="button"
              className="people-action people-pass"
              aria-label={`Pass on ${active.displayName}`}
              data-testid="people-pass"
              disabled={busy}
              onClick={() => void decide(active, false)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
            <button
              type="button"
              className="people-action people-follow"
              aria-label={`Follow ${active.displayName}`}
              data-testid="people-follow"
              disabled={busy}
              onClick={() => void followActive(active)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <button
              type="button"
              className="people-action people-like"
              aria-label={`Like ${active.displayName}`}
              data-testid="people-like"
              disabled={busy}
              onClick={() => void decide(active, true)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
              </svg>
            </button>
          </div>

          <p className="people-keyboard-hint">
            Keyboard: left pass, right like, up follow
          </p>
          {hasMore && (
            <div className="people-more">
              <button type="button" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? 'Finding more…' : 'Find more people'}
              </button>
            </div>
          )}
        </main>
      )}

      {error && candidates.length > 0 && (
        <div className="people-alert" role="alert">
          {error}
        </div>
      )}
      {notice && <div className="people-notice">{notice}</div>}

      <MobileNav />
    </div>
  );
}

/** The first answered prompt, trimmed for the card. */
function firstPrompt(prompts: Record<string, string>): string | null {
  for (const answer of Object.values(prompts)) {
    if (typeof answer === 'string' && answer.trim().length > 0) {
      return answer.trim().length > 130 ? `${answer.trim().slice(0, 130)}…` : answer.trim();
    }
  }
  return null;
}

function lookingForLabels(genders: readonly string[]): string[] {
  const labels: string[] = [];
  if (genders.includes('Man')) labels.push('Men');
  if (genders.includes('Woman')) labels.push('Women');
  return labels;
}
