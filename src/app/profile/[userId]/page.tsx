'use client';

import { useEffect, useRef, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { fetchUserMoments, likeMoment, unlikeMoment } from '@/lib/moments';
import { isFollowing } from '@/lib/follows';
import { ConversationError, startConversation } from '@/lib/conversations';
import { isProfileLiked } from '@/lib/likes';
import { fetchProfileViewCount, recordProfileView } from '@/lib/profile-views';
import { fetchPublicProfile, PublicProfileError, type PublicProfile } from '@/lib/public-profiles';
import type { MomentAuthor, MomentFeedRow } from '@/lib/types';
import MobileNav from '../../components/layout/MobileNav';
import ProfileHeader from '../../components/profile/ProfileHeader';
import ProfileTabs, { type ProfileTab } from '../../components/profile/ProfileTabs';
import ProfileDetails from '../../components/profile/ProfileDetails';
import ProfileMoments from '../../components/profile/ProfileMoments';
import FollowButton from '../../components/profile/FollowButton';
import ProfileLikeButton from '../../components/profile/ProfileLikeButton';
import ProfileViewsIconButton from '../../components/profile/ProfileViewsIconButton';
import { ReportButton } from '../../components/moderation/ReportButton';

/**
 * Another member's public profile.
 *
 * The mirror of `/profile/dashboard`: the same header, counters, bio and dual
 * tabs, rendered read-only. It reads the `public_profiles` view (an allow-list),
 * so private fields — notably `birth_date`, email and phone — are never in the
 * payload, and it uses the same shared components as the own-profile view so the
 * two cannot drift.
 *
 * The Follow button writes only the viewer's own outbound edge, which is what
 * `follows_insert_own` / `follows_delete_own` permit.
 */
export default function PublicProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const router = useRouter();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [startingConversation, setStartingConversation] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>('feed');

  // Profile-like and profile-view state. The like count is seeded from the
  // profile row and adjusted only after the database confirms the change.
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [viewCount, setViewCount] = useState<number | undefined>(undefined);

  /**
   * One genuine visit per profile navigation. The ref survives React Strict
   * Mode's effect replay and re-renders, so a single navigation cannot be
   * recorded twice, while a real unmount/remount (leaving and returning) uses a
   * fresh instance and is recorded again.
   */
  const recordedViewRef = useRef<string | null>(null);

  const [posts, setPosts] = useState<MomentFeedRow[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsError, setPostsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Navigating between two member profiles reuses this component, so every
      // piece of the previous member's state is cleared before the new load,
      // otherwise the old profile flashes (or sticks) under the new URL.
      setLoading(true);
      setLoadError(null);
      setNotFound(false);
      setProfile(null);
      setFollowing(false);
      setStartingConversation(false);
      setNotice(null);
      setLiked(false);
      setLikeCount(0);
      setViewCount(undefined);

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.replace('/auth');
          return;
        }
        if (cancelled) return;
        setCurrentUserId(user.id);

        const data = await fetchPublicProfile(userId);
        if (cancelled) return;

        if (!data) {
          setNotFound(true);
          return;
        }
        setProfile(data);
        setLikeCount(data.profile_likes_count ?? 0);

        const isSelf = user.id === userId;

        const followState = isSelf ? false : await isFollowing(userId);
        if (!cancelled) setFollowing(followState);

        // Load the caller's existing like so the button renders "Liked" on entry.
        const likedState = isSelf ? false : await isProfileLiked(userId);
        if (!cancelled) setLiked(likedState);
      } catch (err) {
        console.error('[public-profile] load failed:', err);
        if (!cancelled) {
          setLoadError(
            err instanceof PublicProfileError
              ? err.message
              : 'We could not load this profile. Please try again.'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [userId, router]);

  // Record a genuine visit to someone else's profile. This is deliberately a
  // separate effect: a failure here is logged and swallowed so the profile still
  // renders. Preloads never reach this page, and the ref prevents React Strict
  // Mode's effect replay from recording the same navigation twice.
  useEffect(() => {
    // Only a profile that actually rendered counts as a view: a missing or
    // unreadable profile must not inflate someone's analytics.
    if (!profile || profile.id !== userId || !currentUserId || currentUserId === userId) return;
    if (recordedViewRef.current === userId) return;
    recordedViewRef.current = userId;

    void (async () => {
      try {
        const result = await recordProfileView(userId);
        // Only apply the result if the member is still looking at this profile.
        if (recordedViewRef.current !== userId) return;
        if (result.unique_viewers !== undefined) {
          setViewCount(result.unique_viewers);
          return;
        }
        // A blocked/missing profile is not recorded, but the public aggregate
        // is still useful and safe to display.
        const count = await fetchProfileViewCount(userId);
        if (recordedViewRef.current === userId) setViewCount(count);
      } catch (err) {
        console.error('[public-profile] view tracking failed:', err);
        try {
          const count = await fetchProfileViewCount(userId);
          if (recordedViewRef.current === userId) setViewCount(count);
        } catch (fallbackErr) {
          console.error('[public-profile] view count fallback failed:', fallbackErr);
        }
      }
    })();
  }, [currentUserId, userId, profile]);

  // Viewing your own profile does not record a visit, but the public count is
  // still shown.
  useEffect(() => {
    if (!currentUserId || currentUserId !== userId) return;

    let cancelled = false;
    void (async () => {
      try {
        const count = await fetchProfileViewCount(userId);
        if (!cancelled) setViewCount(count);
      } catch (err) {
        console.error('[public-profile] view count failed:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUserId, userId]);

  useEffect(() => {
    let cancelled = false;

    async function loadPosts() {
      // Same reasoning as the profile effect: drop the prior member's posts.
      setPostsLoading(true);
      setPostsError(null);
      setPosts([]);

      try {
        const rows = await fetchUserMoments(userId);
        if (!cancelled) {
          setPosts(rows);
          setPostsError(null);
        }
      } catch (err) {
        console.error('[public-profile] posts failed:', err);
        if (!cancelled) setPostsError('Could not load posts.');
      } finally {
        if (!cancelled) setPostsLoading(false);
      }
    }

    void loadPosts();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const isOwn = currentUserId !== null && currentUserId === userId;

  const handleLike = async (post: MomentFeedRow) => {
    const wasLiked = post.liked_by_me;
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
      console.error('[public-profile] like failed:', err);
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
    }
  };

  const handleLikedChange = (nowLiked: boolean) => {
    // Runs only after the database confirmed the change, so this reflects the
    // real count delta rather than an optimistic guess. Keep the prop in sync so
    // the button cannot revert when the page re-renders for another reason.
    setLiked(nowLiked);
    setLikeCount((current) => Math.max(0, current + (nowLiked ? 1 : -1)));
  };

  const handleSendText = async () => {
    if (startingConversation) return;
    setStartingConversation(true);
    setNotice(null);

    try {
      const connection = await startConversation(userId);
      router.push(`/chat/${connection.conversationId}`);
    } catch (err) {
      setNotice(
        err instanceof ConversationError
          ? err.message
          : 'The conversation could not be opened. Please try again.'
      );
    } finally {
      setStartingConversation(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.center}>Loading profile...</div>
    );
  }

  if (notFound) {
    return (
      <div style={styles.container}>
        <div style={styles.topBar}>
          <button style={styles.iconButton} onClick={() => router.back()} aria-label="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div style={styles.title}>Profile</div>
          <span style={styles.iconSpacer} />
        </div>
        <div style={styles.empty}>
          <div style={styles.emptyTitle}>Profile not found</div>
          This member may have removed their account.
        </div>
        <MobileNav />
      </div>
    );
  }

  if (loadError || !profile) {
    return (
      <div style={styles.center}>
        <p style={{ marginBottom: '16px' }}>{loadError ?? 'We could not load this profile.'}</p>
        <button type="button" onClick={() => window.location.reload()} style={styles.retry}>
          Try again
        </button>
      </div>
    );
  }

  const displayName = profile.display_name ?? 'Member';

  const author: MomentAuthor = {
    id: profile.id,
    displayName,
    avatarUrl: profile.avatar_url,
    gender: profile.gender ?? '',
    country: profile.country ?? '',
  };

  return (
    <div style={styles.container}>
      <div style={styles.topBar}>
        <button style={styles.iconButton} onClick={() => router.back()} aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div style={styles.title}>{isOwn ? 'My Profile' : displayName}</div>
        {!isOwn ? (
          <ReportButton
            targetUserId={profile.id}
            targetType="user"
            title={`Report ${displayName}`}
            ariaLabel={`Report ${displayName}`}
            className="p-2"
          />
        ) : (
          <span style={styles.iconSpacer} />
        )}
      </div>

      <ProfileHeader
        displayName={displayName}
        username={profile.username}
        age={profile.age}
        gender={profile.gender}
        city={profile.city}
        country={profile.country}
        avatarUrl={profile.avatar_url}
        isOnline={profile.is_online === true}
        intention={profile.intention}
        matches={profile.matches_count ?? 0}
        following={profile.following_count ?? 0}
        followers={profile.followers_count ?? 0}
        likes={likeCount}
        bio={profile.bio}
        bioAction={
          !isOwn && profile.bio?.trim() ? (
            <ReportButton
              targetUserId={profile.id}
              targetType="bio"
              title={`Report ${displayName}'s bio`}
              ariaLabel={`Report ${displayName}'s bio`}
            />
          ) : undefined
        }
        onStatNavigate={(key) => {
          // Only Followers is browsable on another member's profile. Matches,
          // Following and Likes stay informational (see the list privacy RPCs).
          if (key === 'followers') {
            router.push(`/profile/stats/followers?user=${profile.id}`);
          }
        }}
        navigableStats={['followers']}
        topAction={
          !isOwn ? <ProfileViewsIconButton count={viewCount ?? null} /> : undefined
        }
        actions={
          !isOwn ? (
            <>
              <FollowButton targetUserId={profile.id} initialFollowing={following} size="md" />
              <ProfileLikeButton
                key={profile.id}
                targetUserId={profile.id}
                initialLiked={liked}
                onLikedChange={handleLikedChange}
                size="md"
              />
              <button
                type="button"
                onClick={() => void handleSendText()}
                disabled={startingConversation}
                style={{
                  ...styles.sendTextButton,
                  opacity: startingConversation ? 0.6 : 1,
                }}
              >
                {startingConversation ? 'Opening…' : 'Message'}
              </button>
            </>
          ) : null
        }
      />

      {notice && <div style={styles.notice}>{notice}</div>}

      <ProfileTabs active={activeTab} onChange={setActiveTab} />

      {activeTab === 'feed' ? (
        <div
          role="tabpanel"
          id="profile-panel-feed"
          aria-labelledby="profile-tab-feed"
        >
          <ProfileMoments
            posts={posts}
            author={author}
            isOwn={isOwn}
            currentUserId={currentUserId}
            loading={postsLoading}
            error={postsError}
            title={isOwn ? 'Your Posts' : `${displayName}'s Posts`}
            emptyTitle="No posts yet"
            emptyBody={
              isOwn
                ? 'Share photos, videos and updates in Moments and they will appear here.'
                : `${displayName} has not shared any Moments yet.`
            }
            onLike={(item) => void handleLike(item)}
          />
        </div>
      ) : (
        <div
          role="tabpanel"
          id="profile-panel-details"
          aria-labelledby="profile-tab-details"
        >
          <ProfileDetails
            data={{
              bio: profile.bio,
              age: profile.age,
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
          />
        </div>
      )}

      <MobileNav />
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    maxWidth: '900px',
    margin: '0 auto',
    backgroundColor: '#131017',
    color: '#EAE2F0',
    fontFamily: 'system-ui',
    paddingBottom: '100px',
  },
  center: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#131017',
    color: '#D8B38A',
    padding: '24px',
    textAlign: 'center' as const,
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px',
    borderBottom: '1px solid #34283F',
  },
  iconButton: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    backgroundColor: '#211A28',
    border: '1px solid #34283F',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    cursor: 'pointer',
    color: '#EAE2F0',
  },
  iconSpacer: { width: '40px', height: '40px' },
  title: { fontSize: '18px', fontWeight: 700, color: '#EAE2F0', letterSpacing: '0.5px' },
  empty: {
    margin: '40px 20px',
    padding: '40px 24px',
    textAlign: 'center' as const,
    color: '#B58A83',
    fontSize: '14px',
    border: '1px dashed #4A1828',
    borderRadius: '20px',
  },
  emptyTitle: { fontSize: '18px', fontWeight: 700, color: '#EAE2F0', marginBottom: '8px' },
  retry: {
    backgroundColor: '#D8B38A',
    color: '#131017',
    padding: '12px 28px',
    borderRadius: '30px',
    fontSize: '14px',
    fontWeight: 700,
    border: 'none',
    cursor: 'pointer',
  },
  sendTextButton: {
    backgroundColor: '#211A28',
    color: '#D8B38A',
    padding: '12px 24px',
    borderRadius: '30px',
    fontSize: '14px',
    fontWeight: 700,
    border: '1px solid #4A1828',
    cursor: 'pointer',
  },
  notice: {
    margin: '0 20px 16px 20px',
    padding: '12px 16px',
    borderRadius: '14px',
    backgroundColor: '#211A28',
    border: '1px solid #4A1828',
    color: '#D8B38A',
    fontSize: '13px',
    textAlign: 'center' as const,
  },
};
