'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileNav from '../components/layout/MobileNav';
import MomentCard from '../components/moments/MomentCard';
import { supabase } from '@/lib/supabase';
import type { MomentAuthor, MomentFeedRow, MomentVisibility } from '@/lib/types';
import {
  MOMENT_EMOJI,
  MOMENT_TAGS,
  MOMENT_VISIBILITIES,
  MOMENT_VISIBILITY_HELP,
  MOMENT_VISIBILITY_LABELS,
  MomentError,
  createMoment,
  fetchMomentAuthors,
  fetchMomentFeed,
  likeMoment,
  mergeMomentTags,
  subscribeToMoments,
  unlikeMoment,
  type MomentTab,
} from '@/lib/moments';
import {
  MAX_VIDEO_SECONDS,
  MediaError,
  prepareMedia,
  releaseMedia,
  uploadMedia,
  type PreparedMedia,
} from '@/lib/media';
import { FollowError, followUser } from '@/lib/follows';
import {
  NO_RESTRICTIONS,
  describeRestriction,
  fetchMyRestrictions,
  isAccountRestricted,
  type MyRestrictions,
} from '@/lib/reports';

export default function MomentsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('For You');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [posts, setPosts] = useState<MomentFeedRow[]>([]);
  const [authors, setAuthors] = useState<Record<string, MomentAuthor>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newCaption, setNewCaption] = useState('');
  const [newTags, setNewTags] = useState<string[]>([]);
  const [newVisibility, setNewVisibility] = useState<MomentVisibility>('public');
  const [media, setMedia] = useState<PreparedMedia | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restrictions, setRestrictions] = useState<MyRestrictions>(NO_RESTRICTIONS);

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

      // M25: a paused account can read Moments but not post to them. The
      // database enforces this too; the notice just explains the locked +.
      setRestrictions(await fetchMyRestrictions());

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

  // Release the object URL if the page unmounts with a preview still loaded.
  useEffect(() => () => releaseMedia(media), [media]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2000);
  }, []);

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

  const handleFollow = async (authorId: string) => {
    setError(null);
    try {
      await followUser(authorId);
      showNotice('Now following!');
    } catch (err) {
      console.error('Follow failed:', err);
      setError(
        err instanceof FollowError || err instanceof MomentError
          ? err.message
          : 'Could not follow this member.'
      );
    }
  };

  const handleMediaPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so re-picking the same file still fires a change event.
    event.target.value = '';
    if (!file) return;

    setError(null);
    setPreparing(true);
    try {
      // The effect below releases whatever preview was here before.
      setMedia(await prepareMedia(file));
    } catch (err) {
      console.error('Media pick failed:', err);
      setError(err instanceof MediaError ? err.message : 'Could not use that file.');
    } finally {
      setPreparing(false);
    }
  };

  const handleRemoveMedia = () => {
    setMedia(null);
  };

  const toggleTag = (tag: string) => {
    setNewTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
    );
  };

  const handleCreatePost = async () => {
    if (posting || preparing) return;

    const caption = newCaption.trim();
    if (!caption && !media) {
      setError('Add a caption or media before posting.');
      return;
    }

    setPosting(true);
    setError(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new MomentError('You must be signed in to post.', '28000');

      // Upload first: nothing is published unless the media lands in Storage.
      const url = media ? await uploadMedia(media, user.id) : null;

      await createMoment(
        caption,
        url ? [url] : [],
        mergeMomentTags(newTags, caption),
        media?.mediaType ?? null,
        newVisibility
      );

      setMedia(null);
      setNewCaption('');
      setNewTags([]);
      setNewVisibility('public');
      setIsCreateOpen(false);
      showNotice('Moment posted!');

      // Re-read rather than splicing locally, so counts and feed order stay
      // authoritative.
      await loadFeed(activeTab, activeTag);
    } catch (err) {
      console.error('Create post failed:', err);
      setError(
        err instanceof MomentError || err instanceof MediaError
          ? err.message
          : 'Could not publish your Moment.'
      );
    } finally {
      setPosting(false);
    }
  };

  const restrictionMessage = describeRestriction(restrictions);
  const paused = isAccountRestricted(restrictions);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerTitle}>Moments</div>
      </div>

      <div style={styles.tabsContainer}>
        {tabs.map((tab) => (
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

      {restrictionMessage && (
        <div role="status" style={styles.restriction}>
          {restrictionMessage}
        </div>
      )}

      {loading ? (
        <div style={styles.empty}>Loading Moments...</div>
      ) : posts.length === 0 ? (
        <div style={styles.empty}>
          {activeTab === 'Following'
            ? 'No Moments from people you follow yet.'
            : activeTag
              ? `Nothing tagged #${activeTag} yet.`
              : 'No Moments yet. Tap + to share the first one.'}
        </div>
      ) : (
        posts.map((post) => {
          const author = authors[post.author_id] ?? {
            id: post.author_id,
            displayName: 'Someone',
            avatarUrl: null,
            gender: '',
            country: '',
          };

          return (
            <MomentCard
              key={post.id}
              post={post}
              author={author}
              currentUserId={currentUserId}
              isOwn={post.author_id === currentUserId}
              onLike={(item) => void handleLike(item.id)}
              onFollow={(authorId) => void handleFollow(authorId)}
            />
          );
        })
      )}

      <button
        style={{ ...styles.fab, ...(paused ? styles.fabDisabled : {}) }}
        onClick={() => {
          if (paused) return;
          setIsCreateOpen(true);
        }}
        aria-label="New Moment"
        aria-disabled={paused}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>

      {isCreateOpen && (
        <div style={styles.modalOverlay} onClick={() => setIsCreateOpen(false)}>
          <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>New Moment</div>
              <button
                style={styles.closeBtn}
                onClick={() => {
                  setIsCreateOpen(false);
                  setNewCaption('');
                  setNewTags([]);
                  setNewVisibility('public');
                }}
              >
                ×
              </button>
            </div>

            <textarea
              style={styles.input}
              placeholder="Share a status…"
              value={newCaption}
              maxLength={2000}
              onChange={(e) => setNewCaption(e.target.value)}
            />
            <div style={styles.counterRow}>
              <span style={styles.counter}>{newCaption.length}/2000</span>
            </div>

            <div style={styles.emojiRow}>
              {MOMENT_EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  style={styles.emojiBtn}
                  onClick={() => setNewCaption((current) => `${current}${emoji}`)}
                >
                  {emoji}
                </button>
              ))}
            </div>

            <div style={styles.composerTags}>
              {MOMENT_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  style={{ ...styles.composerTag, ...(newTags.includes(tag) ? styles.composerTagActive : {}) }}
                  onClick={() => toggleTag(tag)}
                >
                  #{tag}
                </button>
              ))}
            </div>

            {media ? (
              <div style={styles.mediaPreviewContainer}>
                {media.mediaType === 'video' ? (
                  <video src={media.previewUrl} style={styles.mediaPreview} controls muted playsInline />
                ) : (
                  <img src={media.previewUrl} alt="Preview" style={styles.mediaPreview} />
                )}
                <button style={styles.removeMediaBtn} onClick={handleRemoveMedia} aria-label="Remove media">
                  ×
                </button>
              </div>
            ) : (
              <div style={styles.uploadRow}>
                <label style={styles.uploadBtn}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                  </svg>
                  Photo or video
                  <input type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleMediaPick} />
                </label>
                <label style={styles.uploadBtn}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 7l-7 5 7 5V7z"></path>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                  </svg>
                  Record video
                  <input type="file" accept="video/*" capture="environment" style={{ display: 'none' }} onChange={handleMediaPick} />
                </label>
              </div>
            )}

            <div style={styles.hint}>
              {preparing
                ? 'Optimizing media…'
                : `HD images are resized automatically; videos must be ${MAX_VIDEO_SECONDS} seconds or shorter.`}
            </div>

            <div style={styles.visibilityBlock}>
              <div style={styles.visibilityTitle}>Who can see this?</div>
              <div style={styles.visibilityRow} role="radiogroup" aria-label="Who can see this?">
                {MOMENT_VISIBILITIES.map((option) => {
                  const active = newVisibility === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      data-testid={`moment-visibility-${option}`}
                      style={{
                        ...styles.visibilityOption,
                        ...(active ? styles.visibilityOptionActive : {}),
                      }}
                      onClick={() => setNewVisibility(option)}
                    >
                      <span aria-hidden="true" style={styles.visibilityIcon}>
                        {option === 'public' ? '🌐' : option === 'matches' ? '👥' : '🔒'}
                      </span>
                      <span style={styles.visibilityOptionLabel}>
                        {MOMENT_VISIBILITY_LABELS[option]}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div style={styles.visibilityHelp}>{MOMENT_VISIBILITY_HELP[newVisibility]}</div>
            </div>

            <button
              style={{ ...styles.postBtn, opacity: posting || preparing ? 0.6 : 1 }}
              onClick={() => void handleCreatePost()}
              disabled={posting || preparing}
            >
              {posting ? 'Posting…' : 'Post to Moments'}
            </button>
          </div>
        </div>
      )}

      <MobileNav />
    </div>
  );
}

const styles = {
  container: { minHeight: '100vh', backgroundColor: '#131017', color: '#EAE2F0', fontFamily: 'system-ui', paddingBottom: '100px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px', borderBottom: '1px solid #34283F' },
  headerTitle: { fontSize: '24px', fontWeight: 800, color: '#EAE2F0' },

  tabsContainer: { display: 'flex', gap: '20px', padding: '16px 20px', borderBottom: '1px solid #34283F' },
  tab: { fontSize: '16px', fontWeight: 700, color: '#B58A83', cursor: 'pointer', background: 'none', border: 'none', paddingBottom: '8px', position: 'relative' as const },
  tabActive: { color: '#D8B38A' },
  tabUnderline: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: '3px', backgroundColor: '#D8B38A', borderRadius: '3px' },

  tagsContainer: { display: 'flex', gap: '10px', padding: '16px 20px', overflowX: 'auto' as const },
  tag: { padding: '8px 16px', borderRadius: '20px', backgroundColor: '#211A28', color: '#B58A83', fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap' as const, border: '1px solid #34283F', cursor: 'pointer' },
  tagActive: { backgroundColor: '#4A1828', color: '#D8B38A', borderColor: '#D8B38A' },

  fab: { position: 'fixed' as const, bottom: '110px', right: '24px', width: '60px', height: '60px', borderRadius: '50%', background: 'linear-gradient(135deg, #D8B38A, #B58A83)', color: '#131017', display: 'flex', justifyContent: 'center', alignItems: 'center', boxShadow: '0 10px 30px rgba(216, 179, 138, 0.45)', cursor: 'pointer', border: 'none', zIndex: 200 },
  fabDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  restriction: { margin: '16px 20px', backgroundColor: '#33240F', border: '1px solid #8A5A16', color: '#F5D08A', borderRadius: '14px', padding: '12px 16px', fontSize: '13px', lineHeight: 1.5 },

  modalOverlay: { position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(13, 10, 16, 0.9)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center', alignItems: 'flex-end', zIndex: 1000 },
  modalBox: { backgroundColor: '#211A28', width: '100%', maxWidth: '500px', maxHeight: '92vh', overflowY: 'auto' as const, borderTopLeftRadius: '30px', borderTopRightRadius: '30px', padding: '24px', borderTop: '1px solid #4A1828' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  modalTitle: { fontSize: '20px', fontWeight: 800, color: '#EAE2F0' },
  closeBtn: { background: 'none', border: 'none', color: '#B58A83', fontSize: '24px', cursor: 'pointer' },
  input: { width: '100%', padding: '16px', borderRadius: '16px', border: '1px solid #4A1828', backgroundColor: '#131017', color: '#EAE2F0', fontSize: '15px', outline: 'none', minHeight: '100px', resize: 'vertical' as const, fontFamily: 'system-ui', boxSizing: 'border-box' as const },
  counterRow: { display: 'flex', justifyContent: 'flex-end', margin: '6px 4px 12px 4px' },
  counter: { fontSize: '12px', color: '#B58A83' },
  emojiRow: { display: 'flex', gap: '6px', flexWrap: 'wrap' as const, marginBottom: '14px' },
  emojiBtn: { width: '36px', height: '36px', borderRadius: '10px', border: '1px solid #34283F', backgroundColor: '#131017', fontSize: '18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  composerTags: { display: 'flex', gap: '8px', flexWrap: 'wrap' as const, marginBottom: '18px' },
  composerTag: { padding: '6px 14px', borderRadius: '20px', border: '1px solid #34283F', backgroundColor: '#131017', color: '#B58A83', fontSize: '12px', fontWeight: 600, cursor: 'pointer' },
  composerTagActive: { backgroundColor: '#4A1828', color: '#D8B38A', borderColor: '#D8B38A' },
  uploadRow: { display: 'flex', gap: '12px', marginBottom: '8px' },
  uploadBtn: { flex: 1, padding: '16px', borderRadius: '16px', border: '2px dashed #4A1828', backgroundColor: '#131017', color: '#B58A83', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '8px', textAlign: 'center' as const },
  mediaPreviewContainer: { position: 'relative' as const, width: '100%', marginBottom: '8px' },
  mediaPreview: { width: '100%', maxHeight: '320px', objectFit: 'cover' as const, borderRadius: '12px', backgroundColor: '#0B0910' },
  removeMediaBtn: { position: 'absolute' as const, top: '8px', right: '8px', width: '28px', height: '28px', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '16px', cursor: 'pointer', fontWeight: 'bold' },
  hint: { fontSize: '12px', color: '#7C6F86', margin: '6px 2px 16px 2px', lineHeight: 1.4 },
  visibilityBlock: { marginBottom: '18px' },
  visibilityTitle: { fontSize: '13px', fontWeight: 700, color: '#EAE2F0', marginBottom: '10px' },
  visibilityRow: { display: 'flex', gap: '8px' },
  visibilityOption: { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '6px', padding: '12px 8px', borderRadius: '14px', border: '1px solid #34283F', backgroundColor: '#131017', color: '#B58A83', fontSize: '12px', fontWeight: 600, cursor: 'pointer' },
  visibilityOptionActive: { backgroundColor: '#4A1828', borderColor: '#D8B38A', color: '#D8B38A' },
  visibilityIcon: { fontSize: '18px' },
  visibilityOptionLabel: { textAlign: 'center' as const, lineHeight: 1.2 },
  visibilityHelp: { fontSize: '12px', color: '#7C6F86', marginTop: '8px' },
  postBtn: { width: '100%', padding: '18px', borderRadius: '30px', background: 'linear-gradient(135deg, #D8B38A, #B58A83)', color: '#131017', fontSize: '16px', fontWeight: 800, border: 'none', cursor: 'pointer' },

  error: { margin: '16px 20px', backgroundColor: '#3B1220', border: '1px solid #7F1D2E', color: '#FCA5B5', borderRadius: '14px', padding: '12px 16px', fontSize: '13px', lineHeight: 1.5 },
  notice: { margin: '16px 20px', backgroundColor: '#14321F', border: '1px solid #1F6F43', color: '#86EFAC', borderRadius: '14px', padding: '12px 16px', fontSize: '13px' },
  empty: { padding: '48px 24px', textAlign: 'center' as const, color: '#B58A83', fontSize: '14px' },
};
