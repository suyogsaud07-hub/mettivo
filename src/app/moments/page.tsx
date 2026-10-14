'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileNav from '../components/layout/MobileNav';

// Mock data to demonstrate the feed functionality
const INITIAL_POSTS = [
  {
    id: 1,
    name: 'Ada',
    gender: 'Woman',
    flag: '🇵🇭',
    avatar: 'https://i.pravatar.cc/150?u=ada',
    caption: 'wala man lang gustong manuntok saken?',
    media: [
      'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?q=80&w=400&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?q=80&w=400&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?q=80&w=400&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=400&auto=format&fit=crop',
    ],
    likes: 66,
    comments: 7,
    shares: 1,
    likedByMe: false,
  },
  {
    id: 2,
    name: 'iris',
    gender: 'Woman',
    flag: '🇵🇭',
    avatar: 'https://i.pravatar.cc/150?u=iris',
    caption: 'hi sa mga tatay dyan, ano thought process nyo bat nag ccchat kayo s 17yo hahahah',
    media: [], // Text-only post
    likes: 24,
    comments: 3,
    shares: 0,
    likedByMe: false,
  },
];

const TAGS = ['Trending', 'Associate', 'Vibes', 'LateNight', 'Music', 'Travel'];

export default function MomentsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('For You');
  const [posts, setPosts] = useState(INITIAL_POSTS);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newCaption, setNewCaption] = useState('');
  const [newMedia, setNewMedia] = useState<string | null>(null);

  const tabs = ['Following', 'For You', 'Latest'];

  // Handle liking a post
  const handleLike = (postId: number) => {
    setPosts(prev => prev.map(post => {
      if (post.id === postId) {
        return {
          ...post,
          likes: post.likedByMe ? post.likes - 1 : post.likes + 1,
          likedByMe: !post.likedByMe
        };
      }
      return post;
    }));
  };

  // Handle comment (simulated)
  const handleComment = (postId: number) => {
    const comment = prompt("Write a comment:");
    if (comment) {
      setPosts(prev => prev.map(post => {
        if (post.id === postId) {
          return { ...post, comments: post.comments + 1 };
        }
        return post;
      }));
      alert("Comment posted!");
    }
  };

  // Handle share (simulated)
  const handleShare = (postId: number) => {
    alert("Post shared to your chat!");
    setPosts(prev => prev.map(post => {
      if (post.id === postId) {
        return { ...post, shares: post.shares + 1 };
      }
      return post;
    }));
  };

  // Handle creating a new post
  const handleCreatePost = () => {
    if (!newCaption && !newMedia) {
      alert("Please add a caption or media.");
      return;
    }
    
    const newPost = {
      id: Date.now(),
      name: 'Suyog', // Replace with real user data
      gender: 'Man',
      flag: '🇳🇵',
      avatar: 'https://i.pravatar.cc/150?u=suyog',
      caption: newCaption,
      media: newMedia ? [newMedia] : [],
      likes: 0,
      comments: 0,
      shares: 0,
      likedByMe: false,
    };

    setPosts([newPost, ...posts]);
    setIsCreateOpen(false);
    setNewCaption('');
    setNewMedia(null);
  };

  // Handle file upload
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

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', fontFamily: 'system-ui', paddingBottom: '100px' },
    
    // Header
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px', borderBottom: '1px solid #29202D' },
    headerTitle: { fontSize: '24px', fontWeight: '800', color: '#F2E9E4' },
    bellBtn: { position: 'relative' as const, background: 'none', border: 'none', color: '#F2E9E4', cursor: 'pointer' },
    bellBadge: { position: 'absolute' as const, top: '-4px', right: '-4px', backgroundColor: '#EF4444', color: '#FFF', fontSize: '10px', fontWeight: 'bold', width: '16px', height: '16px', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center' },

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
    avatar: { width: '44px', height: '44px', borderRadius: '50%', objectFit: 'cover' as const },
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
    mediaPreview: { width: '100%', maxHeight: '200px', objectFit: 'cover' as const, borderRadius: '12px', marginBottom: '20px' },
    postBtn: { width: '100%', padding: '18px', borderRadius: '30px', background: 'linear-gradient(135deg, #A855F7, #7C3AED)', color: '#FFF', fontSize: '16px', fontWeight: '800', border: 'none', cursor: 'pointer' }
  };

  return (
    <div style={styles.container}>
      
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerTitle}>Moments</div>
        <button style={styles.bellBtn}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
          <div style={styles.bellBadge}>1</div>
        </button>
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
        {TAGS.map((tag, index) => (
          <div key={tag} style={{ ...styles.tag, ...(index === 0 ? styles.tagActive : {}) }}>
            #{tag}
          </div>
        ))}
      </div>

      {/* Feed */}
      {posts.map((post) => (
        <div key={post.id} style={styles.postCard}>
          
          {/* Post Header */}
          <div style={styles.postHeader}>
            <img src={post.avatar} alt={post.name} style={styles.avatar} />
            <div style={styles.postUserInfo}>
              <div style={styles.nameRow}>
                <span style={styles.flag}>{post.flag}</span>
                <span style={styles.name}>{post.name}</span>
                <span style={styles.genderIcon}>{post.gender === 'Woman' ? '♀️' : '♂️'}</span>
              </div>
              <div style={{ fontSize: '12px', color: '#B58A83' }}>Active now</div>
            </div>
            <button style={{ padding: '6px 16px', borderRadius: '20px', backgroundColor: 'transparent', border: '1px solid #D4B18A', color: '#D4B18A', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>
              Follow
            </button>
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
              style={{ ...styles.actionBtn, ...(post.likedByMe ? styles.actionBtnLiked : {}) }}
              onClick={() => handleLike(post.id)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill={post.likedByMe ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
              </svg>
              {post.likes}
            </button>

            <button style={styles.actionBtn} onClick={() => handleComment(post.id)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
              </svg>
              {post.comments}
            </button>

            <button style={styles.actionBtn} onClick={() => handleShare(post.id)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
                <polyline points="16 6 12 2 8 6"></polyline>
                <line x1="12" y1="2" x2="12" y2="15"></line>
              </svg>
              {post.shares}
            </button>
          </div>
        </div>
      ))}

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
              <button style={styles.closeBtn} onClick={() => setIsCreateOpen(false)}>×</button>
            </div>
            
            <textarea 
              style={styles.input} 
              placeholder="What's on your mind?" 
              value={newCaption}
              onChange={(e) => setNewCaption(e.target.value)}
            />

            {newMedia ? (
              <img src={newMedia} alt="Preview" style={styles.mediaPreview} />
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

            <button style={styles.postBtn} onClick={handleCreatePost}>
              Post to Moments
            </button>
          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <MobileNav />

    </div>
  );
}