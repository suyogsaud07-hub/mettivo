'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import MobileNav from '@/app/components/layout/MobileNav';
import {
  EXPLORE_CATEGORIES,
  ExploreMoreError,
  fetchExploreAccess,
  fetchExploreCounts,
  type ExploreCounts,
} from '@/lib/explore-more';

/**
 * `/explore-more` — the seven category entry points.
 *
 * The counts are real and come from the same eligible set as every feed. A
 * category with no cards says so honestly rather than opening a dead end.
 */
export default function ExploreMorePage() {
  const router = useRouter();
  const [counts, setCounts] = useState<ExploreCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

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

      setCounts(await fetchExploreCounts());
    } catch (err) {
      setError(
        err instanceof ExploreMoreError
          ? err.message
          : 'We could not load Explore More right now. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }, [router]);

  // The fetch begins with an await; state is never set synchronously here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load, reloadKey]);

  return (
    <div className="explore-page">
      <header className="explore-topbar">
        <div className="explore-topbar-inner">
          <button
            type="button"
            className="explore-back"
            onClick={() => router.push('/discover')}
            aria-label="Back to Discover"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <div className="explore-topbar-copy">
            <span className="explore-kicker">DISCOVER</span>
            <h1 className="explore-topbar-title">Explore More</h1>
          </div>
        </div>
      </header>

      <main className="explore-shell">
        <section className="explore-hero">
          <p className="explore-eyebrow">Seven paths into the same community</p>
          <h2 className="explore-title">Find people through what matters to them.</h2>
          <p className="explore-subtitle">
            Every category uses the same live eligibility rules as Discover. Counts
            are real members you can actually see.
          </p>
        </section>

        {loading ? (
          <div className="explore-grid" aria-label="Loading Explore More categories" aria-busy="true">
            {EXPLORE_CATEGORIES.map((category) => (
              <div key={category.id} className="explore-card explore-skeleton" aria-hidden="true">
                <span className="explore-skeleton-icon" />
                <span className="explore-skeleton-lines">
                  <span />
                  <span />
                </span>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="explore-error" role="alert">
            <h2>Explore More is unavailable</h2>
            <p>{error}</p>
            <button type="button" className="explore-retry" onClick={() => setReloadKey((key) => key + 1)}>
              Try again
            </button>
          </div>
        ) : (
          <div className="explore-grid">
            {EXPLORE_CATEGORIES.map((category) => {
              const count = counts?.categories[category.id] ?? 0;
              return (
                <Link
                  key={category.id}
                  href={category.requiresGoal ? '/explore-more/dating-goals' : `/explore-more/${category.id}`}
                  className="explore-card"
                  aria-label={`${category.title}, ${count} ${count === 1 ? 'person' : 'people'}`}
                >
                  <span className="explore-card-icon" aria-hidden="true">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d={category.icon} />
                    </svg>
                  </span>
                  <span className="explore-card-body">
                    <span className="explore-card-heading">
                      <span className="explore-card-title">{category.title}</span>
                      <span className={`explore-count${count === 0 ? ' is-empty' : ''}`}>
                        {count === 0 ? 'No one yet' : `${count} ${count === 1 ? 'person' : 'people'}`}
                      </span>
                    </span>
                    <span className="explore-card-desc">{category.description}</span>
                    {category.requiresGoal ? (
                      <span className="explore-card-hint">Choose from 3 dating goals</span>
                    ) : null}
                  </span>
                  <span className="explore-card-arrow" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        <p className="explore-footnote">
          Explore More respects your gender and age preferences. Distance is not
          used because Mettivo does not collect precise location.
        </p>
      </main>

      <MobileNav />
    </div>
  );
}
