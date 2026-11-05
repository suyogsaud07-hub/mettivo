'use client';
/* eslint-disable @next/next/no-img-element */
/* eslint-disable react-hooks/set-state-in-effect */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Map, { Marker, Popup, ViewStateChangeEvent, MapRef } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import MobileNav from '@/app/components/layout/MobileNav';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
const MAP_STYLE = 'mapbox://styles/mapbox/dark-v11';

const DEFAULT_VIEWPORT = {
  latitude: 27.7172, // Kathmandu fallback
  longitude: 85.3240,
  zoom: 11,
};

interface NearbyProfile {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  age: number | null;
  gender: string | null;
  city: string | null;
  country: string | null;
  bio: string | null;
  isOnline: boolean | null;
  snappedLat: number | null;
  snappedLon: number | null;
  distanceMeters: number;
}

export default function NearbyPage() {
  const router = useRouter();
  const mapRef = useRef<MapRef | null>(null);

  const [viewport, setViewport] = useState({
    latitude: DEFAULT_VIEWPORT.latitude,
    longitude: DEFAULT_VIEWPORT.longitude,
    zoom: DEFAULT_VIEWPORT.zoom,
  });
  
  const [profiles, setProfiles] = useState<NearbyProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<NearbyProfile | null>(null);

  const fetchProfiles = useCallback(async (lat: number, lng: number) => {
    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/auth');
        return;
      }

      const { data, error: rpcError } = await supabase.rpc('get_nearby_profiles', {
        user_lat: lat,
        user_lng: lng,
        radius_km: 20, // 20km radius for nearby
      });

      if (rpcError) throw rpcError;

      if (data && Array.isArray(data)) {
        const parsedProfiles: NearbyProfile[] = data.map((row: Record<string, unknown>) => ({
          id: String(row.id ?? ''),
          displayName: String(row.display_name ?? 'Member'),
          username: row.username ? String(row.username) : null,
          avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
          age: typeof row.age === 'number' ? row.age : null,
          gender: row.gender ? String(row.gender) : null,
          city: row.city ? String(row.city) : null,
          country: row.country ? String(row.country) : null,
          bio: row.bio ? String(row.bio) : null,
          isOnline: typeof row.is_online === 'boolean' ? row.is_online : null,
          snappedLat: typeof row.snapped_lat === 'number' ? row.snapped_lat : null,
          snappedLon: typeof row.snapped_lng === 'number' ? row.snapped_lng : null,
          distanceMeters: typeof row.distance_meters === 'number' ? row.distance_meters : 0,
        }));
        setProfiles(parsedProfiles);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load profiles';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setViewport({ latitude, longitude, zoom: 12 });
          void fetchProfiles(latitude, longitude);
        },
        () => {
          setLoading(false);
          setLocationError('Could not get your location. Showing default area.');
          void fetchProfiles(DEFAULT_VIEWPORT.latitude, DEFAULT_VIEWPORT.longitude);
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
      );
    } else {
      setLoading(false);
      setLocationError('Geolocation not supported. Showing default area.');
      void fetchProfiles(DEFAULT_VIEWPORT.latitude, DEFAULT_VIEWPORT.longitude);
    }
  }, [fetchProfiles]);

  const handleViewportChange = useCallback((evt: ViewStateChangeEvent) => {
    setViewport(evt.viewState);
  }, []);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="min-h-screen bg-[#131017] text-[#F2E9E4] flex flex-col items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-6">🗺️</div>
          <h1 className="text-2xl font-bold mb-4">Map Configuration Required</h1>
          <p className="text-[#B58A83] mb-6">To use the Nearby map, configure a Mapbox access token.</p>
          <button type="button" onClick={() => router.back()} className="mt-6 px-6 py-3 bg-[#29202D] border border-[#34283F] text-[#D4B18A] rounded-full hover:bg-[#34283F] transition-colors">
            Go Back
          </button>
        </div>
        <MobileNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#131017] text-[#F2E9E4] flex flex-col relative">
      <header className="absolute top-0 left-0 right-0 z-20 p-4 flex justify-between items-center">
        <div className="bg-[#1C1822]/80 backdrop-blur-md rounded-xl px-4 py-2">
          <h1 className="text-lg font-bold">Nearby</h1>
        </div>
        <div className="bg-[#1C1822]/80 backdrop-blur-md rounded-xl p-1 flex gap-1">
          <span className="text-xs text-[#B58A83]">{profiles.length} found</span>
        </div>
      </header>

      <main className="flex-1 relative">
        <Map
          initialViewState={viewport}
          mapStyle={MAP_STYLE}
          mapboxAccessToken={MAPBOX_TOKEN}
          onMove={handleViewportChange}
          ref={mapRef}
          style={{ width: '100%', height: '100%' }} // <--- The fix is here
          minZoom={2}
          maxZoom={18}
        >
          {profiles.map((profile) => {
            if (profile.snappedLat === null || profile.snappedLon === null) return null;
            return (
              <Marker key={profile.id} latitude={profile.snappedLat} longitude={profile.snappedLon} anchor="bottom">
                <button
                  type="button"
                  onClick={() => setSelectedProfile(profile)}
                  className="w-12 h-12 rounded-full overflow-hidden border-2 border-[#1C1822] shadow-lg hover:scale-110 transition-transform bg-neutral-800 flex items-center justify-center"
                >
                  {profile.avatarUrl ? (
                    <img src={profile.avatarUrl} alt={profile.displayName} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-lg">👤</span>
                  )}
                </button>
              </Marker>
            );
          })}

          {selectedProfile && (
            <Popup
              latitude={selectedProfile.snappedLat ?? 0}
              longitude={selectedProfile.snappedLon ?? 0}
              anchor="bottom"
              onClose={() => setSelectedProfile(null)}
              closeOnClick={false}
              offset={20}
            >
              <div className="bg-[#1C1822] border border-[#34283F] rounded-xl p-4 shadow-xl max-w-70 text-[#F2E9E4]">
                <button type="button" onClick={() => setSelectedProfile(null)} className="absolute top-2 right-2 text-[#B58A83] hover:text-white">×</button>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-[#29202D] flex items-center justify-center">
                    {selectedProfile.avatarUrl ? (
                      <img src={selectedProfile.avatarUrl} alt={selectedProfile.displayName} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xl">👤</span>
                    )}
                  </div>
                  <div>
                    <h3 className="font-bold">{selectedProfile.displayName}{selectedProfile.age ? `, ${selectedProfile.age}` : ''}</h3>
                    <p className="text-xs text-[#B58A83]">📍 {Math.round(selectedProfile.distanceMeters / 1000)}km away</p>
                  </div>
                </div>
              </div>
            </Popup>
          )}

          {/* Render location error if it exists */}
          {locationError && (
            <div className="absolute top-20 left-4 right-4 z-10 bg-[#3B1220] border border-[#7F1D2E] text-[#FCA5B5] rounded-xl p-3 text-center text-sm" role="alert">
              {locationError}
            </div>
          )}

          {/* Render fetch error if it exists to fix the unused variable warning */}
          {error && (
            <div className="absolute top-36 left-4 right-4 z-10 bg-[#3B1220] border border-[#7F1D2E] text-[#FCA5B5] rounded-xl p-3 text-center text-sm" role="alert">
              {error}
            </div>
          )}

          {loading && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 bg-[#1C1822]/80 backdrop-blur-md rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#D4B18A]" />
                <span className="text-sm font-medium">Finding people nearby...</span>
              </div>
            </div>
          )}
        </Map>

        <button
          type="button"
          onClick={() => {
            navigator.geolocation.getCurrentPosition((pos) => {
              mapRef.current?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 12 });
              void fetchProfiles(pos.coords.latitude, pos.coords.longitude);
            });
          }}
          className="absolute bottom-24 right-4 z-10 w-12 h-12 rounded-full bg-[#D4B18A] border-4 border-[#1C1822] shadow-lg flex items-center justify-center hover:scale-110 transition-transform"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#17121C" strokeWidth="2">
            <path d="M12 2a10 10 0 100 20 10 10 0 000-20z" />
            <path d="M12 8v8M8 12h8" />
          </svg>
        </button>
      </main>

      <div className="absolute bottom-0 left-0 right-0 z-20">
        <MobileNav />
      </div>
    </div>
  );
}