'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import MobileNav from '@/app/components/layout/MobileNav';
import IntentionBadge from '@/app/components/profile/IntentionBadge';
import FollowButton from '@/app/components/profile/FollowButton';
import ProfileLink from '@/app/components/profile/ProfileLink';
import { recordLike, LikeError } from '@/lib/likes';
import { blockMember, BlockingError } from '@/lib/blocking';
import {
  EXPLORE_GOALS,
  EXPLORE_PAGE_SIZE,
  ExploreMoreError,
  exploreCategory,
  exploreGoal,
  fetchExploreAccess,
  fetchExploreCounts,
  fetchExploreFeed,
  isExploreCategoryId,
  isExploreGoalKey,
  type ExploreCandidate,
  type ExploreCategoryId,
  type ExploreCounts,
  type ExploreGoalKey,
} from '@/lib/explore-more';

/**
 * One Explore feed (or the Dating Goals chooser).
 *
 * The browser displays the server's eligible, already-ranked page. It never
 * filters gender/age/blocks locally, and it never invents a count. Like/pass
 * goes through `record_like`; block goes through `block_member`; both remove the
 * card because the server's eligible set has already changed.
 */
export default function ExploreCategoryPage() {
  return (
    <Suspense fallback={<ExploreLoadingScreen />}>
      <ExploreCategoryContent />
    </Suspense>
  );
}

function useCategoryParam(): string | null {
  const params = useParams<{ category: string | string[] }>();
  return Array.isArray(params.category) ? (params.category[0] ?? null) : (params.category ?? null);
}

function ExploreCategoryContent() {
  const router = useRouter();
  const rawCategory = useCategoryParam();
  const searchParams = useSearchParams();
  const rawGoal = searchParams.get('goal');

  const categoryId: ExploreCategoryId | null = isExploreCategoryId(rawCategory) ? rawCategory : null;
  const isDatingGoals = categoryId === 'dating-goals';
  const goal: ExploreGoalKey | null = isDatingGoals && isExploreGoalKey(rawGoal) ? rawGoal : null;
  const showGoalChooser = isDatingGoals && goal === null;
  const invalidGoal = isDatingGoals && rawGoal !== null && !isExploreGoalKey(rawGoal);
  const invalidCategory = categoryId === null;

  const [candidates, setCandidates] = useState<ExploreCandidate[]>([]);
  const [counts, setCounts] = useState<ExploreCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [decisionPending, setDecisionPending] = useState<string | null>(null);
  const [matchNotice, setMatchNotice] = useState<{ name: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const seenIds = useRef<Set<string>>(new Set());

  const loadFirstPage = useCallback(async () => {
    if (invalidCategory) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setLoadMoreError(null);
    setCandidates([]);
    setCursor(null);
    setHasMore(false);
    setMenuOpen(null);
    seenIds.current = new Set();

    try {
      const access = await fetchExploreAccess();
      if (!access) {
        router.replace('/auth');
        return;
      }
      if (!access.onboardingComplete) {
        router.replace('/profile');
        return;
      }

      const overview = await fetchExploreCounts();
      setCounts(overview);

      if (showGoalChooser || invalidGoal) return;

      const page = await fetchExploreFeed({
        category: categoryId,
        goal,
        limit: EXPLORE_PAGE_SIZE,
      });

      seenIds.current = new Set(page.candidates.map((candidate) => candidate.id));
      setCandidates(page.candidates);
      setCursor(page.nextCursor);
      setHasMore(page.nextCursor !== null);
    } catch (err) {
      setError(
        err instanceof ExploreMoreError
          ? err.message
          : 'We could not load this category right now. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }, [categoryId, goal, invalidCategory, invalidGoal, router, showGoalChooser]);

  // Every setState happens after an await inside `loadFirstPage`.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadFirstPage(); }, [loadFirstPage, reloadKey]);

  const loadMore = async () => {
    if (!categoryId || !cursor || loadingMore || showGoalChooser) return;

    setLoadingMore(true);
    setLoadMoreError(null);

    try {
      const page = await fetchExploreFeed({
        category: categoryId,
        goal,
        cursor,
        limit: EXPLORE_PAGE_SIZE,
        excludeIds: [...seenIds.current],
      });

      const fresh = page.candidates.filter((candidate) => !seenIds.current.has(candidate.id));
      for (const candidate of fresh) seenIds.current.add(candidate.id);

      setCandidates((previous) => [...previous, ...fresh]);
      setCursor(page.nextCursor);
      setHasMore(page.nextCursor !== null);
    } catch (err) {
      setLoadMoreError(
        err instanceof ExploreMoreError
          ? err.message
          : 'We could not load more people. Please try again.'
      );
    } finally {
      setLoadingMore(false);
    }
  };

  const removeCandidate = (candidateId: string) => {
    seenIds.current.add(candidateId);
    setCandidates((previous) => previous.filter((candidate) => candidate.id !== candidateId));
    setMenuOpen(null);
  };

  const handleDecision = async (candidate: ExploreCandidate, isLike: boolean) => {
    if (decisionPending) return;

    setDecisionPending(candidate.id);
    setError(null);

    try {
      const result = await recordLike(candidate.id, isLike);
      removeCandidate(candidate.id);
      if (result.matched) setMatchNotice({ name: candidate.displayName });
    } catch (err) {
      setError(
        err instanceof LikeError
          ? err.message
          : 'Something went wrong. Please try again.'
      );
    } finally {
      setDecisionPending(null);
    }
  };

  const handleBlock = async (candidate: ExploreCandidate) => {
    if (decisionPending) return;

    setDecisionPending(candidate.id);
    setError(null);

    try {
      await blockMember(candidate.id);
      removeCandidate(candidate.id);
    } catch (err) {
      setError(
        err instanceof BlockingError ? err.message : 'We could not block this member.'
      );
    } finally {
      setDecisionPending(null);
    }
  };

  if (invalidCategory) {
    return (
      <ExploreShell title="Explore More" onBack={() => router.push('/explore-more')}>
        <div className="explore-error" role="alert">
          <h2>Category not found</h2>
          <p>This Explore category does not exist. Choose one of the seven available paths.</p>
          <Link href="/explore-more" className="explore-retry">Back to Explore More</Link>
        </div>
      </ExploreShell>
    );
  }

  if (invalidGoal) {
    return (
      <ExploreShell title="Dating Goals" onBack={() => router.push('/explore-more/dating-goals')}>
        <div className="explore-error" role="alert">
          <h2>Dating goal not found</h2>
          <p>Choose Friendship and Networking, Serious Relationship, or Casual &amp; Open to Options.</p>
          <Link href="/explore-more/dating-goals" className="explore-retry">Choose a goal</Link>
        </div>
      </ExploreShell>
    );
  }

  const category = categoryId ? exploreCategory(categoryId) : null;
  const selectedGoal = goal ? exploreGoal(goal) : null;
  const headerTitle = selectedGoal?.title ?? category?.title ?? 'Explore More';
  const backTarget = selectedGoal ? '/explore-more/dating-goals' : '/explore-more';
  const categoryCount = selectedGoal && goal
    ? (counts?.goals[goal] ?? 0)
    : categoryId
      ? (counts?.categories[categoryId] ?? 0)
      : 0;

  return (
    <ExploreShell title={headerTitle} onBack={() => router.push(backTarget)}>
      <section className="explore-hero explore-hero-compact">
        <p className="explore-eyebrow">
          {selectedGoal ? 'DATING GOAL' : showGoalChooser ? 'DATING GOALS' : 'EXPLORE MORE'}
        </p>
        <h2 className="explore-title">
          {selectedGoal
            ? selectedGoal.description
            : showGoalChooser
              ? 'What are you looking for?'
              : category?.description}
        </h2>
        {!showGoalChooser && !loading && !error ? (
          <p className="explore-subtitle">
            {categoryCount === 0
              ? 'No eligible members in this category right now.'
              : `${categoryCount} ${categoryCount === 1 ? 'person' : 'people'} can appear here. Ranked for you.`}
          </p>
        ) : null}
        {showGoalChooser ? (
          <p className="explore-subtitle">
            Pick a goal to browse people who explicitly chose it. This does not
            change your own profile.
          </p>
        ) : null}
      </section>

      {loading ? (
        <ExploreFeedSkeleton />
      ) : error ? (
        <div className="explore-error" role="alert">
          <h2>This category could not load</h2>
          <p>{error}</p>
          <button type="button" className="explore-retry" onClick={() => setReloadKey((key) => key + 1)}>
            Try again
          </button>
        </div>
      ) : showGoalChooser ? (
        <div className="explore-goals">
          {EXPLORE_GOALS.map((item) => {
            const count = counts?.goals[item.key] ?? 0;
            return (
              <Link
                key={item.key}
                href={`/explore-more/dating-goals?goal=${item.key}`}
                className="explore-goal-card"
                aria-label={`${item.title}, ${count} ${count === 1 ? 'person' : 'people'}`}
              >
                <span className="explore-goal-copy">
                  <span className="explore-goal-title">{item.title}</span>
                  <span className="explore-goal-desc">{item.description}</span>
                </span>
                <span className="explore-goal-side">
                  <span className={`explore-count${count === 0 ? ' is-empty' : ''}`}>
                    {count === 0 ? 'No one yet' : `${count} ${count === 1 ? 'person' : 'people'}`}
                  </span>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </span>
              </Link>
            );
          })}
        </div>
      ) : candidates.length === 0 ? (
        <div className="explore-empty">
          <h2>No one here yet</h2>
          <p>
            {selectedGoal
              ? 'No eligible member has chosen this dating goal right now. Try another goal or check back later.'
              : 'No eligible member matches this category right now. Check back after more people join or update their interests.'}
          </p>
          <div className="explore-empty-actions">
            {selectedGoal ? (
              <Link href="/explore-more/dating-goals" className="explore-retry">Try another goal</Link>
            ) : null}
            <Link href="/explore-more" className="explore-retry explore-retry-quiet">All categories</Link>
          </div>
        </div>
      ) : (
        <>
          <div className="explore-feed" aria-live="polite">
            {candidates.map((candidate) => (
              <ExplorePersonCard
                key={candidate.id}
                candidate={candidate}
                pending={decisionPending === candidate.id}
                menuOpen={menuOpen === candidate.id}
                onToggleMenu={() => setMenuOpen(menuOpen === candidate.id ? null : candidate.id)}
                onLike={() => { void handleDecision(candidate, true); }}
                onPass={() => { void handleDecision(candidate, false); }}
                onBlock={() => { void handleBlock(candidate); }}
              />
            ))}
          </div>

          {loadMoreError ? (
            <div className="explore-inline-error" role="alert">
              <span>{loadMoreError}</span>
              <button type="button" onClick={() => { void loadMore(); }}>Retry</button>
            </div>
          ) : null}

          {hasMore ? (
            <button
              type="button"
              className="explore-load-more"
              onClick={() => { void loadMore(); }}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading more…' : 'Load more people'}
            </button>
          ) : (
            <p className="explore-end">You have reached the end of this category.</p>
          )}
        </>
      )}

      {matchNotice ? (
        <div className="explore-match-backdrop">
          <div className="explore-match" role="dialog" aria-modal="true" aria-labelledby="explore-match-title">
            <h2 id="explore-match-title">It is a match</h2>
            <p>You and {matchNotice.name} liked each other.</p>
            <button type="button" className="explore-retry" onClick={() => setMatchNotice(null)}>
              Keep exploring
            </button>
          </div>
        </div>
      ) : null}

      <p className="explore-footnote">
        Categories use live profile signals, shared eligibility and the same
        deterministic ranking. Distance is not used because precise location is
        not collected.
      </p>
    </ExploreShell>
  );
}

interface ExploreShellProps {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}

function ExploreShell({ title, onBack, children }: ExploreShellProps) {
  return (
    <div className="explore-page">
      <header className="explore-topbar">
        <div className="explore-topbar-inner">
          <button
            type="button"
            className="explore-back"
            onClick={onBack}
            aria-label="Go back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <div className="explore-topbar-copy">
            <span className="explore-kicker">EXPLORE MORE</span>
            <h1 className="explore-topbar-title">{title}</h1>
          </div>
        </div>
      </header>
      <main className="explore-shell">{children}</main>
      <MobileNav />
    </div>
  );
}

interface ExplorePersonCardProps {
  candidate: ExploreCandidate;
  pending: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onLike: () => void;
  onPass: () => void;
  onBlock: () => void;
}

function ExplorePersonCard({
  candidate,
  pending,
  menuOpen,
  onToggleMenu,
  onLike,
  onPass,
  onBlock,
}: ExplorePersonCardProps) {
  const photo = candidate.avatarUrl ?? candidate.photos[0] ?? null;
  const prompt = Object.values(candidate.promptAnswers)[0] ?? null;
  const tags = [...new Set([...candidate.hobbies, ...candidate.interests])].slice(0, 5);
  const location = [candidate.city, candidate.country].filter(Boolean).join(', ');

  return (
    <article className="explore-person">
      <div className="explore-person-photo-wrap">
        <ProfileLink
          userId={candidate.id}
          label={`View ${candidate.displayName}'s profile`}
          className="explore-person-photo-link"
        >
          {photo ? (
            <img
              src={photo}
              alt=""
              className="explore-person-photo"
              loading="lazy"
            />
          ) : (
            <span className="explore-person-photo explore-person-initial" aria-hidden="true">
              {candidate.displayName.slice(0, 1).toUpperCase()}
            </span>
          )}
        </ProfileLink>
        {candidate.online ? <span className="explore-online" aria-label="Online" title="Online" /> : null}
      </div>

      <div className="explore-person-body">
        <div className="explore-person-heading">
          <ProfileLink
            userId={candidate.id}
            label={`View ${candidate.displayName}'s profile`}
            className="explore-person-name-link"
          >
            <h2 className="explore-person-name">
              {candidate.displayName}
              {candidate.age ? <span>, {candidate.age}</span> : null}
            </h2>
          </ProfileLink>
          <div className="explore-person-tools">
            <FollowButton targetUserId={candidate.id} />
            <div className="explore-menu-wrap">
              <button
                type="button"
                className="explore-menu-button"
                onClick={onToggleMenu}
                aria-label={`More options for ${candidate.displayName}`}
                aria-expanded={menuOpen}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </button>
              {menuOpen ? (
                <div className="explore-menu">
                  <Link href={`/report?report=${encodeURIComponent(candidate.id)}`} className="explore-menu-item">
                    Report
                  </Link>
                  <button
                    type="button"
                    className="explore-menu-item"
                    onClick={onBlock}
                    disabled={pending}
                  >
                    {pending ? 'Blocking…' : 'Block'}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="explore-person-meta">
          <span>{location || 'Global'}</span>
          {candidate.isVerified ? <span className="explore-verified">Verified</span> : null}
          {candidate.intention ? <IntentionBadge intention={candidate.intention} /> : null}
        </div>

        {candidate.bio ? <p className="explore-person-bio">{candidate.bio}</p> : null}
        {prompt ? <p className="explore-person-prompt">“{prompt}”</p> : null}

        {tags.length > 0 ? (
          <div className="explore-tags" aria-label="Interests">
            {tags.map((tag) => <span key={tag}>{tag.replace(/-/g, ' ')}</span>)}
          </div>
        ) : null}

        <div className="explore-person-actions">
          <button
            type="button"
            className="explore-action explore-action-pass"
            onClick={onPass}
            disabled={pending}
            aria-label={`Pass on ${candidate.displayName}`}
          >
            {pending ? '…' : 'Pass'}
          </button>
          <button
            type="button"
            className="explore-action explore-action-like"
            onClick={onLike}
            disabled={pending}
            aria-label={`Like ${candidate.displayName}`}
          >
            {pending ? '…' : 'Like'}
          </button>
          <ProfileLink
            userId={candidate.id}
            label={`View ${candidate.displayName}'s profile`}
            className="explore-view-profile"
          >
            View profile
          </ProfileLink>
        </div>
      </div>
    </article>
  );
}

function ExploreFeedSkeleton() {
  return (
    <div className="explore-feed" aria-label="Loading people" aria-busy="true">
      {[0, 1, 2].map((index) => (
        <div key={index} className="explore-person explore-person-skeleton" aria-hidden="true">
          <span className="explore-person-photo explore-skeleton-photo" />
          <div className="explore-person-body">
            <span className="explore-skeleton-bar is-title" />
            <span className="explore-skeleton-bar" />
            <span className="explore-skeleton-bar is-short" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ExploreLoadingScreen() {
  return (
    <div className="explore-page">
      <main className="explore-shell">
        <ExploreFeedSkeleton />
      </main>
      <MobileNav />
    </div>
  );
}
