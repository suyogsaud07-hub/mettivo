'use client';

import { useCallback, useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { fetchUserMoments, likeMoment, addMomentComment, shareMoment, unlikeMoment } from '@/lib/moments';
import { isFollowing } from '@/lib/follows';
import { fetchPublicProfile, PublicProfileError, type PublicProfile } from '@/lib/public-profiles';
import type { MomentAuthor, MomentFeedRow } from '@/lib/types';
import MobileNav from '../../components/layout/MobileNav';
import ProfileHeader from '../../components/profile/ProfileHeader';
import ProfileTabs, { type ProfileTab } from '../../components/profile/ProfileTabs';
import ProfileDetails from '../../components/profile/ProfileDetails';
import ProfileMoments from '../../components/profile/ProfileMoments';
import FollowButton from '../../components/profile/FollowButton';

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
  const [activeTab, setActiveTab] = useState<ProfileTab>('feed');

  const [posts, setPosts] = useState<MomentFeedRow[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
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

        const followState = user.id === userId ? false : await isFollowing(userId);
        if (!cancelled) setFollowing(followState);
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

  useEffect(() => {
    let cancelled = false;

    async function loadPosts() {
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

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2000);
  }, []);

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

  const handleComment = async (post: MomentFeedRow) => {
    const comment = window.prompt('Write a comment:');
    if (!comment || !comment.trim()) return;

    try {
      await addMomentComment(post.id, comment);
      setPosts((prev) =>
        prev.map((item) =>
          item.id === post.id ? { ...item, comment_count: item.comment_count + 1 } : item
        )
      );
      showNotice('Comment posted');
    } catch (err) {
      console.error('[public-profile] comment failed:', err);
    }
  };

  const handleShare = async (post: MomentFeedRow) => {
    try {
      const total = await shareMoment(post.id);
      setPosts((prev) => prev.map((item) => (item.id === post.id ? { ...item, shares: total } : item)));

      const shareText = post.caption?.trim() || 'Check out this Moment on Mettivo.';
      try {
        await navigator.clipboard.writeText(shareText);
        showNotice('Copied to your clipboard');
      } catch {
        showNotice('Share count updated');
      }
    } catch (err) {
      console.error('[public-profile] share failed:', err);
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
        <span style={styles.iconSpacer} />
      </div>

      <ProfileHeader
        displayName={displayName}
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
        likes={profile.profile_likes_count ?? 0}
        actions={
          !isOwn ? (
            <FollowButton targetUserId={profile.id} initialFollowing={following} size="md" />
          ) : null
        }
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

      <ProfileTabs active={activeTab} onChange={setActiveTab} />

      {activeTab === 'feed' ? (
        <ProfileMoments
          posts={posts}
          author={author}
          isOwn={isOwn}
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
          onComment={(item) => void handleComment(item)}
          onShare={(item) => void handleShare(item)}
        />
      ) : (
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
            politics: profile.politics,
            pets: profile.pets,
            personality: profile.personality,
            hobbies: profile.hobbies,
          }}
        />
      )}

      {notice && <div style={styles.toast}>{notice}</div>}

      <MobileNav />
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
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
  section: {
    margin: '0 20px 24px 20px',
    backgroundColor: '#211A28',
    borderRadius: '20px',
    padding: '20px',
    border: '1px solid #34283F',
  },
  sectionHeader: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' },
  sectionIcon: {
    width: '32px',
    height: '32px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #4A1828, #D8B38A)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    fontSize: '16px',
  },
  sectionTitle: { fontSize: '16px', fontWeight: 700, color: '#EAE2F0' },
  bioText: { fontSize: '14px', color: '#EAE2F0', lineHeight: 1.6, margin: 0 },
  emptyText: { fontSize: '13px', color: '#B58A83' },
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
  toast: {
    position: 'fixed' as const,
    left: '50%',
    bottom: '96px',
    transform: 'translateX(-50%)',
    zIndex: 110,
    padding: '12px 20px',
    borderRadius: '999px',
    fontSize: '13px',
    fontWeight: 600,
    backgroundColor: '#D8B38A',
    color: '#131017',
    boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
  },
};
