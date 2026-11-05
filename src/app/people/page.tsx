'use client';

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import MobileNav from '@/app/components/layout/MobileNav';

interface Person {
  id: string;
  displayName: string;
  age: number | null;
  city: string | null;
  bio: string | null;
  photoUrl: string | null;
}

export default function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPeople = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!user) return;

      const { data, error: dbError } = await supabase
        .from('profiles')
        .select('id, display_name, age, city, bio, avatar_url')
        .neq('id', user.id)
        .eq('onboarding_completed', true)
        .limit(10);

      if (dbError) throw dbError;

      const rows = (data ?? []) as Array<{
        id: string;
        display_name: string | null;
        age: number | null;
        city: string | null;
        bio: string | null;
        avatar_url: string | null;
      }>;

      setPeople(
        rows.map((row) => ({
          id: row.id,
          displayName: row.display_name ?? 'Member',
          age: row.age,
          city: row.city,
          bio: row.bio,
          photoUrl: row.avatar_url,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load people');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The loader only updates state after an await, so this is a one-shot
    // mount fetch rather than a synchronous cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPeople();
  }, [loadPeople]);

  const current = people[index];

  const pass = () => {
    if (!current) return;
    console.log(`Passed on ${current.displayName}`);
    setIndex((i) => (i + 1 < people.length ? i + 1 : i));
  };

  const like = () => {
    if (!current) return;
    console.log(`Liked ${current.displayName}`);
    setIndex((i) => (i + 1 < people.length ? i + 1 : i));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#131017] text-[#F2E9E4] flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#D4B18A]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#131017] text-[#F2E9E4] flex flex-col items-center justify-center p-6 text-center">
        <h2 className="text-xl font-bold text-[#F2E9E4]">We could not load People</h2>
        <p className="mt-2 text-[#B58A83]">{error}</p>
        <button type="button" onClick={() => void loadPeople()} className="mt-4 px-6 py-3 bg-[#D4B18A] text-[#17121C] rounded-full font-semibold">
          Try again
        </button>
        <MobileNav />
      </div>
    );
  }

  if (!current) {
    return (
      <div className="min-h-screen bg-[#131017] text-[#F2E9E4] flex flex-col items-center justify-center p-6 text-center">
        <div className="text-6xl mb-4">🃏</div>
        <h2 className="text-xl font-bold text-[#F2E9E4]">You&apos;re all caught up</h2>
        <p className="mt-2 text-[#B58A83]">No more profiles in your stack right now.</p>
        <button type="button" onClick={() => void loadPeople()} className="mt-4 px-6 py-3 bg-[#D4B18A] text-[#17121C] rounded-full font-semibold">
          Refresh
        </button>
        <MobileNav />
      </div>
    );
  }

  const bioPreview = current.bio
    ? current.bio.length > 200
      ? `${current.bio.slice(0, 200)}…`
      : current.bio
    : 'No bio yet.';

  return (
    <div className="min-h-screen bg-[#131017] text-[#F2E9E4] relative">
      <header className="absolute top-0 left-0 right-0 z-20 p-6 flex justify-between items-center">
        <div className="bg-[#1C1822]/80 backdrop-blur-md rounded-xl px-4 py-2">
          <h1 className="text-lg font-bold text-[#F2E9E4]">People</h1>
        </div>
        <div className="bg-[#1C1822]/80 backdrop-blur-md rounded-xl px-4 py-2">
          <span className="text-sm text-[#B58A83]">{index + 1} of {people.length}</span>
        </div>
      </header>

      <main className="relative flex items-center justify-center min-h-[60vh] px-6">
        <article className="w-full max-w-md bg-[#1C1822] border border-[#34283F] rounded-3xl overflow-hidden shadow-2xl relative">
          {current.photoUrl ? (
            <img
              src={current.photoUrl}
              alt={current.displayName}
              className="w-full h-[560px] object-cover"
              style={{ width: '100%', height: '100%' }}
            />
          ) : (
            <div className="w-full h-[560px] bg-[#29202D] flex items-center justify-center">
              <span className="text-6xl">👤</span>
            </div>
          )}
          <div className="p-6">
            <div className="flex justify-between items-start mb-2">
              <h2 className="text-2xl font-bold text-[#F2E9E4]">
                {current.displayName}
                {current.age ? (
                  <span className="ml-2 text-[#D4B18A] text-xl">{current.age}</span>
                ) : null}
              </h2>
              <p className="text-sm text-[#B58A83]">{current.city ?? 'City'}</p>
            </div>
            <p className="mt-2 text-[#B58A83] leading-relaxed">{bioPreview}</p>
          </div>
        </article>
      </main>

      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 flex gap-6">
        <button
          type="button"
          onClick={pass}
          aria-label={`Pass on ${current.displayName}`}
          className="w-20 h-20 rounded-full bg-[#EF4444] shadow-2xl flex items-center justify-center active:scale-95 transition-transform"
        >
          <span className="text-4xl text-white">✕</span>
        </button>
        <button
          type="button"
          onClick={like}
          aria-label={`Like ${current.displayName}`}
          className="w-20 h-20 rounded-full bg-[#10B981] shadow-2xl flex items-center justify-center active:scale-95 transition-transform"
        >
          <span className="text-4xl text-white">❤</span>
        </button>
      </div>

      <div className="absolute bottom-0 left-0 right-0 z-20">
        <MobileNav />
      </div>
    </div>
  );
}
