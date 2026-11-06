'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  fetchProfileViewers,
  fetchProfileViewSummary,
  ProfileViewError,
} from '@/lib/profile-views';
import type { ProfileViewerRow, ProfileViewSummary } from '@/lib/types';
import MobileNav from '../../../components/layout/MobileNav';
import ProfileLink from '../../../components/profile/ProfileLink';
import FollowButton from '../../../components/profile/FollowButton';

const PAGE_SIZE = 30;

type ViewerTab = 'all' | 'new' | 'repeated';

const TABS: { key: ViewerTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New Visitors' },
  { key: 'repeated', label: 'Repeated' },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** The name to render, respecting an explicit "no last name" choice. */
function displayNameFor(row: ProfileViewerRow): string {
  const full = [row.first_name, row.has_last_name ? row.last_name : null]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' ');
  return full || row.display_name?.trim() || 'Member';
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'No activity yet';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Unknown';

  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

function visitCountLabel(viewCount: number): string {
  if (viewCount === 1) return 'Visited 1 time';
  return `Visited ${viewCount} times`;
}

/**
 * The signed-in member's own profile-view analytics.
 *
 * Both RPCs derive the owner from `auth.uid()` and accept no owner id, so this
 * page cannot be pointed at another member's analytics by editing the URL. The
 * viewer rows are a public allow-list (name, username, avatar, online) plus the
 * visit counters; no email, phone or private field is projected.
 */
export default function ProfileViewsPage() {
  const router = useRouter();

  const [authReady, setAuthReady] = useState(false);
  const [summary, setSummary] = useState<ProfileViewSummary | null>(null);
  const [viewers, setViewers] = useState<ProfileViewerRow[]>([]);
  const [activeTab, setActiveTab] = useState<ViewerTab>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Monotonic id so a slow response from a previous tab/search can never
  // overwrite the current one.
  const requestRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace('/auth');
        return;
      }
      if (!cancelled) setAuthReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  // Debounce the search box; the RPC is the thing doing the filtering.
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async (term: string) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    setLoadMoreError(null);

    try {
      const [nextSummary, rows] = await Promise.all([
        fetchProfileViewSummary(),
        fetchProfileViewers({
          limit: PAGE_SIZE,
          offset: 0,
          search: term,
          filter: activeTab,
        }),
      ]);

      if (requestRef.current !== requestId) return;
      setSummary(nextSummary);
      setViewers(rows);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (err) {
      if (requestRef.current !== requestId) return;
      console.error('[profile-views-page] load failed:', err);
      setError(
        err instanceof ProfileViewError
          ? err.message
          : 'We could not load your profile views. Please try again.'
      );
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!authReady) return;
    const timer = setTimeout(() => void load(searchTerm), 0);
    return () => clearTimeout(timer);
  }, [authReady, searchTerm, activeTab, load]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;

    const requestId = requestRef.current;
    setLoadingMore(true);
    setLoadMoreError(null);

    try {
      const rows = await fetchProfileViewers({
        limit: PAGE_SIZE,
        offset: viewers.length,
        search: searchTerm,
        filter: activeTab,
      });

      if (requestRef.current !== requestId) return;
      setViewers((previous) => [...previous, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (err) {
      if (requestRef.current !== requestId) return;
      console.error('[profile-views-page] load more failed:', err);
      setLoadMoreError('We could not load more viewers.');
    } finally {
      setLoadingMore(false);
    }
  };

  if (!authReady || (loading && !summary)) {
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
            <div className="pf-title">Profile Views</div>
            <span className="pf-toolbar-spacer" />
          </div>
        </header>
        <main className="pf-content">
          <div className="pf-views-loading" role="status" aria-live="polite">
            <span className="pf-views-spinner" aria-hidden="true" />
            Loading your profile views…
          </div>
        </main>
        <MobileNav />
      </div>
    );
  }

  if (error && !summary) {
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
            <div className="pf-title">Profile Views</div>
            <span className="pf-toolbar-spacer" />
          </div>
        </header>
        <main className="pf-content">
          <div className="pf-views-empty" role="alert">
            <div className="pf-views-empty-title">Could not load profile views</div>
            <p className="pf-views-empty-body">{error}</p>
            <button
              type="button"
              className="pf-btn pf-btn-primary"
              onClick={() => void load(searchTerm)}
            >
              Try again
            </button>
          </div>
        </main>
        <MobileNav />
      </div>
    );
  }

  const data = summary as ProfileViewSummary;
  const uniqueViewers = data.unique_viewers;
  const returningViewers = data.returning_viewers;
  const newVisitorCount = Math.max(0, uniqueViewers - returningViewers);
  const noViewsAtAll = uniqueViewers === 0;
  const noSearchResults = !noViewsAtAll && viewers.length === 0;

  const tabCounts: Record<ViewerTab, number> = {
    all: uniqueViewers,
    new: newVisitorCount,
    repeated: returningViewers,
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
          <div className="pf-title">Profile Views</div>
          <span className="pf-toolbar-spacer" />
        </div>
        <div className="pf-subtitle">
          See who&rsquo;s been checking out your profile.
        </div>
      </header>

      <main className="pf-content">
        <section className="pf-views-intro" aria-label="Profile views overview">
          <p className="pf-views-eyebrow">Your audience</p>
          <h1 className="pf-views-heading">Who is looking at your profile</h1>
          <p className="pf-views-sub">
            Unique viewers counts distinct accounts once, no matter how often they
            return. Total visits includes every repeat visit.
          </p>
        </section>

        <section className="pf-views-overview" aria-label="Viewer statistics">
          <div className="pf-views-card pf-views-card-primary">
            <span className="pf-views-card-label">Unique viewers</span>
            <span className="pf-views-card-value">{uniqueViewers}</span>
            <span className="pf-views-card-note">Distinct accounts</span>
          </div>
          <div className="pf-views-card">
            <span className="pf-views-card-label">Returning</span>
            <span className="pf-views-card-value">{returningViewers}</span>
            <span className="pf-views-card-note">Visited more than once</span>
          </div>
          <div className="pf-views-card">
            <span className="pf-views-card-label">Total visits</span>
            <span className="pf-views-card-value">{data.total_visits}</span>
            <span className="pf-views-card-note">Repeat visits included</span>
          </div>
          <div className="pf-views-card">
            <span className="pf-views-card-label">Latest activity</span>
            <span className="pf-views-card-value pf-views-card-value-sm">
              {relativeTime(data.most_recent_at)}
            </span>
            <span className="pf-views-card-note">Most recent visit</span>
          </div>
        </section>

        {/* Three-tab navigation */}
        <nav className="pf-views-tabs" aria-label="Visitor filter">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const count = tabCounts[tab.key];
            const showBadge = tab.key === 'new' && count > 0;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={
                  showBadge
                    ? `${tab.label}, ${count} visitors`
                    : `${tab.label}${isActive ? ', selected' : ''}`
                }
                onClick={() => setActiveTab(tab.key)}
                className={`pf-views-tab ${
                  isActive ? 'pf-views-tab-active' : ''
                }`}
              >
                <span className="pf-views-tab-label">{tab.label}</span>
                {showBadge && (
                  <span className="pf-views-tab-badge" aria-hidden="true">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="pf-views-search">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search viewers by name or @username"
            aria-label="Search profile viewers"
          />
        </div>

        {error ? (
          <div className="pf-views-inline-error" role="alert">
            <span>{error}</span>
            <button type="button" className="pf-btn pf-btn-small pf-btn-quiet" onClick={() => void load(searchTerm)}>
              Retry
            </button>
          </div>
        ) : null}

        {noViewsAtAll ? (
          <div className="pf-views-empty">
            <div className="pf-views-empty-icon" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <div className="pf-views-empty-title">No profile views yet</div>
            <p className="pf-views-empty-body">
              When another member opens your profile, they will appear here. Your own
              visits never count.
            </p>
          </div>
        ) : noSearchResults ? (
          <div className="pf-views-empty">
            <div className="pf-views-empty-title">
              {activeTab === 'new'
                ? 'No new visitors right now'
                : activeTab === 'repeated'
                  ? 'No repeat visitors yet'
                  : 'No viewers match your search'}
            </div>
            <p className="pf-views-empty-body">
              {activeTab === 'new'
                ? 'First-time viewers will appear here.'
                : activeTab === 'repeated'
                  ? 'Viewers who return will appear here.'
                  : 'Try a different name or @username.'}
            </p>
          </div>
        ) : (
          <>
            <ul className="pf-views-list" aria-label="Profile viewers">
              {viewers.map((viewer) => {
                const name = displayNameFor(viewer);
                const returning = viewer.view_count > 1;

                return (
                  <li key={viewer.viewer_id} className="pf-views-row">
                    <ProfileLink
                      userId={viewer.viewer_id}
                      label={`Open ${name}'s profile`}
                      className="pf-views-person"
                    >
                      <span className="pf-views-avatar-wrap">
                        {viewer.avatar_url ? (
                          <img loading="lazy"
                            src={viewer.avatar_url} alt="" className="pf-views-avatar" />
                        ) : (
                          <span className="pf-views-avatar pf-views-avatar-fallback" aria-hidden="true">
                            {initials(name)}
                          </span>
                        )}
                        {viewer.is_online ? (
                          <span className="pf-views-online" role="img" aria-label="Online" />
                        ) : null}
                      </span>
                      <span className="pf-views-person-text">
                        <span className="pf-views-person-name">{name}</span>
                        {viewer.username ? (
                          <span className="pf-views-person-username">@{viewer.username}</span>
                        ) : null}
                      </span>
                    </ProfileLink>

                    <div className="pf-views-dates">
                      <span>First seen {formatDate(viewer.first_viewed_at)}</span>
                      <span>Last seen {relativeTime(viewer.last_viewed_at)}</span>
                    </div>

                    <div className="pf-views-row-actions">
                      {returning && activeTab === 'repeated' ? (
                        <span className="pf-views-badge is-returning">
                          {visitCountLabel(viewer.view_count)}
                        </span>
                      ) : null}
                      <FollowButton
                        targetUserId={viewer.viewer_id}
                        initialFollowing={viewer.is_followed_by_me}
                        size="sm"
                      />
                    </div>
                  </li>
                );
              })}
            </ul>

            {loadMoreError ? (
              <div className="pf-views-inline-error" role="alert">
                <span>{loadMoreError}</span>
              </div>
            ) : null}

            {hasMore ? (
              <div className="pf-views-more">
                <button
                  type="button"
                  className="pf-btn pf-btn-quiet"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading…' : 'Load more viewers'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </main>

      <MobileNav />
    </div>
  );
}
