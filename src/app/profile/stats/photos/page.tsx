'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase'; 
import MobileNav from '../../../components/layout/MobileNav';

export default function PhotosPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [photos, setPhotos] = useState<string[]>([]);

  useEffect(() => {
    async function loadPhotos() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/auth'); return; }
      const { data } = await supabase.from('profiles').select('photos').eq('id', user.id).single();
      if (data && data.photos) {
        setPhotos(data.photos.filter((p: string) => p));
      }
      setLoading(false);
    }
    loadPhotos();
  }, [router]);

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', fontFamily: 'system-ui', paddingBottom: '100px' },
    header: { display: 'flex', alignItems: 'center', padding: '20px', borderBottom: '1px solid #29202D' },
    backBtn: { background: 'none', border: 'none', color: '#F2E9E4', cursor: 'pointer', marginRight: '16px' },
    headerTitle: { fontSize: '20px', fontWeight: '700', color: '#F2E9E4' },
    subtitle: { fontSize: '13px', color: '#B58A83', padding: '16px 20px 0 20px' },
    photoGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', padding: '20px' },
    photo: { width: '100%', aspectRatio: '1/1', borderRadius: '16px', objectFit: 'cover' as const, backgroundColor: '#1C1822', border: '1px solid #29202D' },
    emptyState: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center' as const },
    emptyIcon: { fontSize: '50px', marginBottom: '16px' },
    emptyText: { fontSize: '16px', color: '#B58A83' }
  };

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D0A10', color: '#D4B18A' }}>Loading...</div>;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => router.back()}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <div style={styles.headerTitle}>📸 My Photos</div>
      </div>
      <div style={styles.subtitle}>Your gallery of moments</div>
      
      {photos.length === 0 ? (
        <div style={styles.emptyState}><div style={styles.emptyIcon}>📸</div><div style={styles.emptyText}>No photos yet.</div></div>
      ) : (
        <div style={styles.photoGrid}>
          {photos.map((url, i) => <img key={i} src={url} alt="Photo" style={styles.photo} />)}
        </div>
      )}
      <MobileNav />
    </div>
  );
}