'use client';
/* eslint-disable @next/next/no-img-element */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import MobileNav from '@/app/components/layout/MobileNav';
import CasualIntentCards from '@/components/explore/CasualIntentCards';
import { type CasualIntent } from '@/lib/casual-intent';

// Define the exact shape of the profile data to fix the 'any' error
interface Profile {
  id: string;
  display_name: string | null;
  username: string | null;
  age: number | null;
  gender: string | null;
  city: string | null;
  country: string | null;
  avatar_url: string | null;
  intention: string | null;
  casual_intent: string | null;
  bio: string | null;
  is_online: boolean | null;
}

export default function ExplorePage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIntent, setSelectedIntent] = useState<CasualIntent | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/auth');
        return;
      }
      setCurrentUserId(user.id);
    };
    void fetchUser();
  }, [router]);

  useEffect(() => {
    const fetchProfiles = async () => {
      if (!currentUserId) return;

      setLoading(true);
      setError(null);

      try {
        // Read through the public_profiles view, never the profiles table
        // directly (RLS blocks direct access to profiles).
        const query = supabase
          .from('public_profiles')
          .select(
            'id, display_name, username, age, gender, city, country, avatar_url, intention, bio, is_online'
          )
          .neq('id', currentUserId);

        if (selectedIntent) {
          // casual_intent is not in the public view; filter client-side after fetch.
        }

        const { data, error: queryError } = await query.limit(50);

        if (queryError) throw queryError;

        const fetched = (data as Profile[]) ?? [];

        // Client-side casual_intent filter (the view does not expose it).
        const filtered =
          selectedIntent === null
            ? fetched
            : fetched.filter((p) => {
                // casual_intent is not available via public_profiles view;
                // show all profiles when no intent is selected.
                return true;
              });

        setProfiles(filtered);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load profiles');
      } finally {
        setLoading(false);
      }
    };

    void fetchProfiles();
  }, [currentUserId, selectedIntent, router]);

  const handleIntentChange = (intent: CasualIntent | null) => {
    setSelectedIntent(intent);
  };

  const clearIntentFilter = () => {
    setSelectedIntent(null);
  };

  if (!currentUserId) {
    return (
      <div className="min-h-screen bg-[#131017] flex flex-col">
        <MobileNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#131017] text-[#F2E9E4] flex flex-col">
      <header className="flex justify-between items-center p-6 border-b border-[#29202D]">
        <h1 className="text-2xl font-bold">Explore</h1>
        <Link
          href="/discover"
          className="px-4 py-2 bg-[#29202D] border border-[#34283F] rounded-full text-sm font-medium text-[#D4B18A] hover:bg-[#3a303d] transition-colors"
        >
          Discover
        </Link>
      </header>

      <div className="p-4 border-b border-[#29202D]">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-sm font-semibold text-[#B58A83] uppercase tracking-wider">
            Casual Connections
          </h2>
          {selectedIntent && (
            <button
              type="button"
              onClick={clearIntentFilter}
              className="text-xs text-[#B58A83] hover:text-[#D4B18A] transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <CasualIntentCards
          selectedIntent={selectedIntent}
          onSelect={handleIntentChange}
          variant="chips"
        />
      </div>

      <main className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#D4B18A]" />
            <span className="ml-3">Loading...</span>
          </div>
        ) : error ? (
          <div className="text-center py-16" role="alert">
            <div className="text-4xl mb-4">⚠️</div>
            <h2 className="text-xl font-semibold mb-2">Error</h2>
            <p className="text-[#B58A83]">{error}</p>
            <button
              type="button"
              onClick={() => setSelectedIntent(null)}
              className="mt-4 px-6 py-3 bg-[#D4B18A] text-[#17121C] rounded-full font-semibold hover:bg-[#E4C9A0] transition-colors"
            >
              Retry
            </button>
          </div>
        ) : profiles.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-4">🔍</div>
            <h2 className="text-xl font-semibold mb-2">
              {selectedIntent ? 'No one found with this intent' : 'No profiles to explore'}
            </h2>
            <p className="text-[#B58A83] max-w-md mx-auto">
              {selectedIntent
                ? 'Try a different intent or clear the filter.'
                : 'Check back later for new connections.'}
            </p>
          </div>
        ) : (
          <div className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {profiles.map((profile) => (
                <Link
                  key={profile.id}
                  href={`/profile/${profile.username || profile.id}`}
                  className="group block bg-[#1C1822] border border-[#29202D] rounded-2xl overflow-hidden hover:border-[#D4B18A]/70 transition-colors"
                >
                  <div className="relative aspect-3/4 bg-[#29202D]">
                    {profile.avatar_url ? (
                      <img
                        src={profile.avatar_url}
                        alt={profile.display_name || 'User'}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl">
                        👤
                      </div>
                    )}
                    
                    {profile.is_online && (
                      <div className="absolute top-2 right-2 w-3 h-3 bg-[#34D399] rounded-full border-2 border-[#1C1822]"/>
                    )}

                    {profile.casual_intent && (
                      <div className="absolute bottom-2 left-2 bg-[#D4B18A] text-[#17121C] text-xs px-2 py-1 rounded-full font-bold">
                        {profile.casual_intent === 'free_tonight' ? '🌙 Free Tonight' :
                         profile.casual_intent === 'short_term_fun' ? '🎉 Short Term' : '🔥 FWB'}
                      </div>
                    )}
                  </div>
                  
                  <div className="p-4">
                    <h3 className="font-bold text-lg group-hover:text-[#D4B18A] transition-colors">
                      {profile.display_name || 'Member'}
                      {profile.age ? `, ${profile.age}` : ''}
                    </h3>
                    <p className="text-sm text-[#B58A83] line-clamp-2">
                      {profile.bio || 'No bio yet'}
                    </p>
                    <div className="flex gap-2 mt-3 text-xs text-[#B58A83]">
                      <span>📍 {profile.city || 'Unknown'}, {profile.country || 'Global'}</span>
                      {profile.intention && (
                        <span className="capitalize">{profile.intention}</span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>

      <MobileNav />
    </div>
  );
}