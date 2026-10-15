'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileNav from '../components/layout/MobileNav';
import { supabase } from '@/lib/supabase';
import type { MomentAuthor, MomentFeedRow } from '@/lib/types';
import {
  MOMENT_TAGS,
  MomentError,
  addMomentComment,
  countryFlag,
  createMoment,
  fetchMomentAuthors,
  fetchMomentFeed,
  followUser,
  genderIcon,
  likeMoment,
  shareMoment,
  subscribeToMoments,
  unlikeMoment,
  type MomentTab,
} from '@/lib/moments';

export default function MomentsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('For You');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [posts, setPosts] = useState<MomentFeedRow[]>([]);
  const [authors, setAuthors] = useState<Record<string, MomentAuthor>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newCaption, setNewCaption] = useState('');
  const [newMedia, setNewMedia] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const tabs = ['Following', 'For You', 'Latest'];

  const loadFeed = useCallback(
    async (tab: string, tag: string | null) => {
      try {
        const rows = await fetchMomentFeed({
          tab: tab as MomentTab,
          tag,
          userId: currentUserId ?? undefined,
        });
        setPosts(rows);
        setAuthors(await fetchMomentAuthors(rows.map((row) => row.author_id)));
      } catch (err) {
        console.error('Failed to load moments:', err);
        setError(err instanceof MomentError ? err.message : 'Could not load Moments.');
      } finally {
        // Always leaves the loading state, even on failure.
        setLoading(false);
      }
    },
    [currentUserId]
  );

  // Identify the member, then load the feed and subscribe to new posts.
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const start = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (cancelled) return;

      if (!user) {
        router.replace('/auth');
        return;
      }

      setCurrentUserId(user.id);

      unsubscribe = subscribeToMoments(() => {
        void loadFeed(activeTab, activeTag);
      });
    };

    void start();

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
    // Subscribing once per mount is intentional: the callback re-reads the
    // current tab through a ref-free closure by reloading on every insert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!currentUserId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFeed(activeTab, activeTag);
  }, [currentUserId, activeTab, activeTag, loadFeed]);

  const handleLike = async (postId: string) => {
    const target = posts.find((post) => post.id === postId);
    if (!target) return;

    const wasLiked = target.liked_by_me;
    setError(null);

    // Optimistic flip; reverted if the write fails.
    setPosts((prev) =>
      prev.map((post) =>
        post.id === postId
          ? {
              ...post,
              liked_by_me: !wasLiked,
              like_count: Math.max(0, post.like_count + (wasLiked ? -1 : 1)),
            }
          : post
      )
    );

    try {
      if (wasLiked) await unlikeMoment(postId);
      else await likeMoment(postId);
    } catch (err) {
      console.error('Like failed:', err);
      setError(err instanceof MomentError ? err.message : 'Could not update your like.');
      setPosts((prev) =>
        prev.map((post) =>
          post.id === postId
            ? {
                ...post,
                liked_by_me: wasLiked,
                like_count: Math.max(0, post.like_count + (wasLiked ? 1 : -1)),
              }
            : post
        )
      );
    }
  };

  const handleComment = async (postId: string) => {
    const comment = prompt('Write a comment:');
    if (!comment || !comment.trim()) return;

    setError(null);
    try {
      await addMomentComment(postId, comment);
      setPosts((prev) =>
        prev.map((post) =>
          post.id === postId ? { ...post, comment_count: post.comment_count + 1 } : post
        )
      );
      setNotice('Comment posted!');
      window.setTimeout(() => setNotice(null), 2000);
    } catch (err) {
      console.error('Comment failed:', err);
      setError(err instanceof MomentError ? err.message : 'Could not post your comment.');
    }
  };

  const handleShare = async (post: { id: string; caption: string | null }) => {
    setError(null);
    try {
      const total = await shareMoment(post.id);
      setPosts((prev) =>
        prev.map((item) => (item.id === post.id ? { ...item, shares: total } : item))
      );

      // Give the member something genuinely useful: the post text on their clipboard.
      const shareText = post.caption?.trim() || 'Check out this Moment on Mettivo.';
      try {
        await navigator.clipboard.writeText(shareText);
        setNotice('Copied to your clipboard!');
      } catch {
        setNotice('Share count updated.');
      }
      window.setTimeout(() => setNotice(null), 2000);
    } catch (err) {
      console.error('Share failed:', err);
      setError(err instanceof MomentError ? err.message : 'Could not share this Moment.');
    }
  };

  const handleFollow = async (authorId: string) => {
    setError(null);
    try {
      await followUser(authorId);
      setNotice('Now following!');
      window.setTimeout(() => setNotice(null), 2000);
    } catch (err) {
      console.error('Follow failed:', err);
      setError(err instanceof MomentError ? err.message : 'Could not follow this member.');
    }
  };

  const handleCreatePost = async () => {
    if (posting) return;
    setPosting(true);
    setError(null);

    try {
      await createMoment(
        newCaption,
        newMedia ? [newMedia] : [],
        activeTag ? [activeTag] : []
      );

      setIsCreateOpen(false);
      setNewCaption('');
      setNewMedia(null);

      // Re-read rather than splicing locally, so counts and the feed order stay
      // authoritative.
      await loadFeed(activeTab, activeTag);
    } catch (err) {
      console.error('Create post failed:', err);
      setError(err instanceof MomentError ? err.message : 'Could not publish your Moment.');
    } finally {
      setPosting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewMedia(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveMedia = () => {
    setNewMedia(null);
  };

  const visiblePosts = useMemo(() => posts, [posts]);

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', fontFamily: 'system-ui', paddingBottom: '100px' },
    
    // Header
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px', borderBottom: '1px solid #29202D' },
    headerTitle: { fontSize: '24px', fontWeight: '800', color: '#F2E9E4' },

    // Top Tabs
    tabsContainer: { display: 'flex', gap: '20px', padding: '16px 20px', borderBottom: '1px solid #29202D' },
    tab: { fontSize: '16px', fontWeight: '700', color: '#B58A83', cursor: 'pointer', background: 'none', border: 'none', paddingBottom: '8px', position: 'relative' as const },
    tabActive: { color: '#D4B18A' },
    tabUnderline: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: '3px', backgroundColor: '#D4B18A', borderRadius: '3px' },

    // Tags
    tagsContainer: { display: 'flex', gap: '10px', padding: '16px 20px', overflowX: 'auto' as const },
    tag: { padding: '8px 16px', borderRadius: '20px', backgroundColor: '#1C1822', color: '#B58A83', fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap' as const, border: '1px solid #29202D', cursor: 'pointer' },
    tagActive: { backgroundColor: '#4A1828', color: '#D4B18A', borderColor: '#D4B18A' },

    // Post Card
    postCard: { backgroundColor: '#1C1822', margin: '0 20px 20px 20px', borderRadius: '20px', border: '1px solid #29202D', overflow: 'hidden' },
    postHeader: { display: 'flex', alignItems: 'center', gap: '12px', padding: '16px' },
    avatar: { width: '44px', height: '44px', borderRadius: '50%', objectFit: 'cover' as const, backgroundColor: '#29202D' },
    avatarFallback: { width: '44px', height: '44px', borderRadius: '50%', backgroundColor: '#29202D', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' },
    postUserInfo: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: '2px' },
    nameRow: { display: 'flex', alignItems: 'center', gap: '6px' },
    name: { fontSize: '15px', fontWeight: '700', color: '#F2E9E4' },
    flag: { fontSize: '14px' },
    genderIcon: { fontSize: '12px', color: '#D4B18A' },
    caption: { fontSize: '14px', color: '#F2E9E4', lineHeight: '1.5', padding: '0 16px 12px 16px' },
    
    // Media Grid
    mediaGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px' },
    mediaItem: { width: '100%', aspectRatio: '1/1', objectFit: 'cover' as const, backgroundColor: '#29202D' },
    singleMedia: { width: '100%', maxHeight: '400px', objectFit: 'cover' as const, backgroundColor: '#29202D' },

    // Action Bar
    actionBar: { display: 'flex', alignItems: 'center', gap: '20px', padding: '16px' },
    actionBtn: { display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: '#B58A83', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
    actionBtnLiked: { color: '#EF4444' },

    // Floating Action Button
    fab: { position: 'fixed' as const, bottom: '110px', right: '24px', width: '60px', height: '60px', borderRadius: '50%', background: 'linear-gradient(135deg, #A855F7, #7C3AED)', color: '#FFF', display: 'flex', justifyContent: 'center', alignItems: 'center', boxShadow: '0 10px 30px rgba(168, 85, 247, 0.5)', cursor: 'pointer', border: 'none', zIndex: 200 },

    // Create Modal
    modalOverlay: { position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(13, 10, 16, 0.9)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center', alignItems: 'flex-end', zIndex: 1000 },
    modalBox: { backgroundColor: '#1C1822', width: '100%', maxWidth: '500px', borderTopLeftRadius: '30px', borderTopRightRadius: '30px', padding: '24px', borderTop: '1px solid #4A1828' },
    modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
    modalTitle: { fontSize: '20px', fontWeight: '800', color: '#F2E9E4' },
    closeBtn: { background: 'none', border: 'none', color: '#B58A83', fontSize: '24px', cursor: 'pointer' },
    input: { width: '100%', padding: '16px', borderRadius: '16px', border: '1px solid #4A1828', backgroundColor: '#0D0A10', color: '#F2E9E4', fontSize: '15px', outline: 'none', minHeight: '100px', resize: 'vertical' as const, marginBottom: '16px', fontFamily: 'system-ui' },
    uploadBtn: { width: '100%', padding: '16px', borderRadius: '16px', border: '2px dashed #4A1828', backgroundColor: '#0D0A10', color: '#B58A83', fontSize: '15px', fontWeight: '600', cursor: 'pointer', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '8px', marginBottom: '20px' },
    mediaPreviewContainer: { position: 'relative' as const, width: '100%', marginBottom: '20px' },
    mediaPreview: { width: '100%', maxHeight: '250px', objectFit: 'cover' as const, borderRadius: '12px' },
    removeMediaBtn: { position: 'absolute' as const, top: '8px', right: '8px', width: '28px', height: '28px', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '16px', cursor: 'pointer', fontWeight: 'bold' },
    postBtn: { width: '100%', padding: '18px', borderRadius: '30px', background: 'linear-gradient(135deg, #A855F7, #7C3AED)', color: '#FFF', fontSize: '16px', fontWeight: '800', border: 'none', cursor: 'pointer' },

    // Status
    error: { margin: '16px 20px', backgroundColor: '#3B1220', border: '1px solid #7F1D2E', color: '#FCA5B5', borderRadius: '14px', padding: '12px 16px', fontSize: '13px', lineHeight: 1.5 },
    notice: { margin: '16px 20px', backgroundColor: '#14321F', border: '1px solid #1F6F43', color: '#86EFAC', borderRadius: '14px', padding: '12px 16px', fontSize: '13px' },
    empty: { padding: '48px 24px', textAlign: 'center' as const, color: '#B58A83', fontSize: '14px' }
  };

  return (
    <div style={styles.container}>
      
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerTitle}>Moments</div>
      </div>

      {/* Top Tabs */}
      <div style={styles.tabsContainer}>
        {tabs.map(tab => (
          <button 
            key={tab} 
            style={{ ...styles.tab, ...(activeTab === tab ? styles.tabActive : {}) }}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
            {activeTab === tab && <div style={styles.tabUnderline} />}
          </button>
        ))}
      </div>

      {/* Tags */}
      <div style={styles.tagsContainer}>
        {MOMENT_TAGS.map((tag) => (
          <div
            key={tag}
            style={{ ...styles.tag, ...(activeTag === tag ? styles.tagActive : {}) }}
            onClick={() => setActiveTag((current) => (current === tag ? null : tag))}
          >
            #{tag}
          </div>
        ))}
      </div>

      {error && (
        <div role="alert" style={styles.error}>
          {error}
        </div>
      )}
      {notice && <div style={styles.notice}>{notice}</div>}

      {/* Feed */}
      {loading ? (
        <div style={styles.empty}>Loading Moments...</div>
      ) : visiblePosts.length === 0 ? (
        <div style={styles.empty}>
          {activeTab === 'Following'
            ? 'No Moments from people you follow yet.'
            : activeTag
              ? `Nothing tagged #${activeTag} yet.`
              : 'No Moments yet. Tap + to share the first one.'}
        </div>
      ) : (
        visiblePosts.map((post) => {
          const author = authors[post.author_id];
          const name = author?.displayName ?? 'Someone';

          return (
            <div key={post.id} style={styles.postCard}>
              
              {/* Post Header */}
              <div style={styles.postHeader}>
                {author?.avatarUrl ? (
                  <img src={author.avatarUrl} alt={name} style={styles.avatar} />
                ) : (
                  <div style={styles.avatarFallback}>{author ? genderIcon(author.gender) : '👤'}</div>
                )}
                <div style={styles.postUserInfo}>
                  <div style={styles.nameRow}>
                    <span style={styles.flag}>{countryFlag(author?.country)}</span>
                    <span style={styles.name}>{name}</span>
                    <span style={styles.genderIcon}>{author ? genderIcon(author.gender) : ''}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#B58A83' }}>Active now</div>
                </div>
                {post.author_id !== currentUserId && (
                  <button
                    style={{ padding: '6px 16px', borderRadius: '20px', backgroundColor: 'transparent', border: '1px solid #D4B18A', color: '#D4B18A', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                    onClick={() => void handleFollow(post.author_id)}
                  >
                    Follow
                  </button>
                )}
              </div>

              {/* Caption */}
              {post.caption && <div style={styles.caption}>{post.caption}</div>}

              {/* Media Grid */}
              {post.media.length > 0 && (
                <div style={post.media.length === 1 ? { padding: '0 16px' } : { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px' }}>
                  {post.media.map((url, idx) => (
                    <img 
                      key={idx} 
                      src={url} 
                      alt={`Post media ${idx}`} 
                      style={post.media.length === 1 ? styles.singleMedia : styles.mediaItem} 
                    />
                  ))}
                </div>
              )}

              {/* Action Bar */}
              <div style={styles.actionBar}>
                <button 
                  style={{ ...styles.actionBtn, ...(post.liked_by_me ? styles.actionBtnLiked : {}) }}
                  onClick={() => void handleLike(post.id)}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill={post.liked_by_me ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                  </svg>
                  {post.like_count}
                </button>

                <button style={styles.actionBtn} onClick={() => void handleComment(post.id)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                  </svg>
                  {post.comment_count}
                </button>

                <button style={styles.actionBtn} onClick={() => void handleShare(post)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
                    <polyline points="16 6 12 2 8 6"></polyline>
                    <line x1="12" y1="2" x2="12" y2="15"></line>
                  </svg>
                  {post.shares}
                </button>
              </div>
            </div>
          );
        })
      )}

      {/* Floating Action Button */}
      <button style={styles.fab} onClick={() => setIsCreateOpen(true)}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>

      {/* Create Post Modal */}
      {isCreateOpen && (
        <div style={styles.modalOverlay} onClick={() => setIsCreateOpen(false)}>
          <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>New Moment</div>
              <button style={styles.closeBtn} onClick={() => { setIsCreateOpen(false); setNewCaption(''); setNewMedia(null); }}>×</button>
            </div>
            
            <textarea 
              style={styles.input} 
              placeholder="What's on your mind?" 
              value={newCaption}
              onChange={(e) => setNewCaption(e.target.value)}
            />

            {newMedia ? (
              <div style={styles.mediaPreviewContainer}>
                <img src={newMedia} alt="Preview" style={styles.mediaPreview} />
                {/* REMOVE MEDIA BUTTON */}
                <button style={styles.removeMediaBtn} onClick={handleRemoveMedia}>
                  ×
                </button>
              </div>
            ) : (
              <label style={styles.uploadBtn}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                Upload Photo or Video
                <input type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleFileUpload} />
              </label>
            )}

            <button style={styles.postBtn} onClick={() => void handleCreatePost()} disabled={posting}>
              {posting ? 'Posting...' : 'Post to Moments'}
            </button>
          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <MobileNav />

    </div>
  );
}
