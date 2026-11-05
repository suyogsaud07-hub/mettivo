'use client';

import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function ContinueToMettivo() {
  const router = useRouter();

  const handleClick = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        await supabase
          .from('profiles')
          .update({ onboarding_completed: true })
          .eq('id', session.user.id);
      }
    } catch {
      // non-blocking: still route forward
    }
    router.push('/auth');
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: '14px 28px',
        borderRadius: '999px',
        background: 'linear-gradient(135deg, #d8b38a, #c78c8d)',
        color: '#1a130c',
        fontSize: '14px',
        fontWeight: 800,
        border: 'none',
        cursor: 'pointer',
        letterSpacing: '0.2px',
      }}
    >
      Continue to Mettivo
    </button>
  );
}
