'use client';
/* eslint-disable @next/next/no-img-element */
/* eslint-disable react-hooks/set-state-in-effect */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Map, { Marker, Popup, ViewStateChangeEvent, MapRef } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import MobileNav from '@/app/components/layout/MobileNav';
import { getCasualIntentEmoji } from '@/components/profile/CasualIntentChips';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
const MAP_STYLE = 'mapbox://styles/mapbox/dark-v11';

const DEFAULT_VIEWPORT = {
  latitude: 20,
  longitude: 0,
  zoom: 1.5,
};

const GENDER_OPTIONS = [
  { id: null, label: 'All' },
  { id: 'Woman', label: 'Female' },
  { id: 'Man', label: 'Male' },
  { id: 'Nonbinary', label: 'Non-binary' },
];

interface OrbitProfile {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  age: number | null;
  gender: string | null;
  city: string | null;
  country: string | null;
  intention: string | null;
  casualIntent: string | null;
  bio: string | null;
  isOnline: boolean | null;
  snappedLat: number | null;
  snappedLon: number | null;
  distanceMeters: number;
}

interface Filters {
  radiusKm: number | 'global';
  minAge: number;
  maxAge: number;
  gender: string | null;
  onlineOnly: boolean;
  country: string | null;
}

interface CustomMarkerProps {
  user: OrbitProfile;
  isSelected: boolean;
  onClick: () => void;
}

interface CustomPopupProps {
  user: OrbitProfile;
  onClose: () => void;
  formatDistance: (meters: number) => string;
  getCountryFlag: (country: string | null) => string;
}

interface FilterPanelProps {
  filters: Filters;
  onChange: (newFilters: Partial<Filters>) => void;
  onReset: () => void;
  onClose: () => void;
}

const formatDistance = (meters: number): string => {
  if (meters < 1000) return `${Math.round(meters)}m`;
  const km = meters / 1000;
  return km < 10 ? `${km.toFixed(1)}km` : `${Math.round(km)}km`;
};

const getCountryFlag = (country: string | null): string => {
  const flags: Record<string, string> = {
    Nepal: '🇳🇵', 'United States': '🇺🇸', 'United Kingdom': '🇬🇧', India: '🇮🇳',
    Australia: '🇦🇺', Canada: '🇨🇦', Philippines: '🇵🇭', Indonesia: '🇮🇩',
    Singapore: '🇸🇬', Japan: '🇯🇵', 'South Korea': '🇰🇷', Germany: '🇩🇪',
    France: '🇫🇷', Brazil: '🇧🇷',
  };
  return country ? (flags[country] ?? '🌐') : '🌐';
};

const CustomMarker = ({ user, isSelected, onClick }: CustomMarkerProps) => {
  const intentEmoji = getCasualIntentEmoji(user.casualIntent);
  return (
    <button
      type="button"
      onClick={onClick}
      className="outline-none bg-transparent border-none cursor-pointer"
      aria-label={`View ${user.displayName}'s profile`}
    >
      <div className="relative">
        <div
          className="w-12 h-12 rounded-full overflow-hidden border-2 border-[#1C1822] shadow-lg"
          style={{
            transform: isSelected ? 'scale(1.2)' : 'scale(1)',
            transition: 'transform 0.2s ease',
            boxShadow: user.isOnline ? '0 0 0 3px #10B981' : '0 0 10px rgba(212, 177, 138, 0.5)',
          }}
        >
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt={user.displayName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #4A1828, #29202D)' }}>
              <span className="text-lg">👤</span>
            </div>
          )}
        </div>
        {user.casualIntent && intentEmoji && (
          <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#D4B18A] flex items-center justify-center text-xs border border-[#1C1822]">
            {intentEmoji}
          </div>
        )}
      </div>
    </button>
  );
};

const CustomPopup = ({ user, onClose, formatDistance, getCountryFlag }: CustomPopupProps) => {
  const distance = formatDistance(user.distanceMeters);
  return (
    <div className="bg-[#1C1822] border border-[#34283F] rounded-xl p-4 shadow-xl max-w-70">
      <button type="button" onClick={onClose} className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center bg-[#29202D] text-[#B58A83] rounded-full hover:bg-[#34283F] transition-colors" aria-label="Close">
        ×
      </button>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-12 h-12 rounded-full overflow-hidden bg-[#29202D]">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt={user.displayName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xl">👤</div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-[#F2E9E4] truncate">{user.displayName}{user.age ? `, ${user.age}` : ''}</h3>
          {user.username && <p className="text-sm text-[#B58A83]">@{user.username}</p>}
        </div>
      </div>
      {user.casualIntent && (
        <div className="flex items-center gap-1 mb-3">
          <span className="text-sm">{getCasualIntentEmoji(user.casualIntent)}</span>
          <span className="text-sm text-[#D4B18A] font-medium">{user.casualIntent.replace(/_/g, ' ')}</span>
        </div>
      )}
      <div className="flex gap-2 text-sm text-[#B58A83] flex-wrap">
        <span>{getCountryFlag(user.country)} {user.gender}</span>
        <span>📍 {distance}</span>
        {user.isOnline && <span className="text-[#10B981]">● Online</span>}
      </div>
    </div>
  );
};

const FilterPanel = ({ filters, onChange, onReset, onClose }: FilterPanelProps) => {
  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-[#1C1822] border-t border-[#34283F] rounded-t-xl p-6 max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-[#F2E9E4]">Filters</h2>
          <button type="button" onClick={onClose} className="text-[#B58A83] text-2xl hover:text-[#D4B18A]">×</button>
        </div>
        <div className="mb-6">
          <div className="flex justify-between items-center mb-3">
            <label className="text-sm font-semibold text-[#D4B18A] uppercase tracking-wider">Distance</label>
            <span className="text-sm text-[#B58A83]">{filters.radiusKm === 'global' ? 'Global' : `${filters.radiusKm}km`}</span>
          </div>
          <div className="flex gap-2 items-center">
            <input
              type="range" min="1" max="500"
              value={filters.radiusKm === 'global' ? 500 : Number(filters.radiusKm)}
              onChange={(e) => onChange({ radiusKm: Number(e.target.value) })}
              className="flex-1 h-2 bg-[#29202D] rounded-lg appearance-none cursor-pointer accent-[#D4B18A]"
              disabled={filters.radiusKm === 'global'}
            />
            <button
              type="button"
              onClick={() => onChange({ radiusKm: filters.radiusKm === 'global' ? 50 : 'global' })}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filters.radiusKm === 'global' ? 'bg-[#D4B18A] text-[#17121C]' : 'bg-[#29202D] text-[#B58A83] border border-[#34283F]'}`}
            >
              Global
            </button>
          </div>
        </div>
        <div className="mb-6">
          <label className="block text-sm font-semibold text-[#D4B18A] uppercase tracking-wider mb-3">Age Range</label>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-[#B58A83] mb-1">Min</label>
              <input type="number" value={filters.minAge} onChange={(e) => onChange({ minAge: Math.max(18, Math.min(99, Number(e.target.value))) })} min="18" max="99" className="w-full bg-[#29202D] border border-[#34283F] rounded-lg p-2 text-[#F2E9E4] focus:outline-none focus:ring-1 focus:ring-[#D4B18A]" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-[#B58A83] mb-1">Max</label>
              <input type="number" value={filters.maxAge} onChange={(e) => onChange({ maxAge: Math.max(18, Math.min(99, Number(e.target.value))) })} min="18" max="99" className="w-full bg-[#29202D] border border-[#34283F] rounded-lg p-2 text-[#F2E9E4] focus:outline-none focus:ring-1 focus:ring-[#D4B18A]" />
            </div>
          </div>
        </div>
        <div className="mb-6">
          <label className="block text-sm font-semibold text-[#D4B18A] uppercase tracking-wider mb-3">Gender</label>
          <div className="flex gap-2 flex-wrap">
            {GENDER_OPTIONS.map((option) => (
              <button key={option.id || 'all'} type="button" onClick={() => onChange({ gender: option.id })} className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${filters.gender === option.id ? 'bg-[#D4B18A] text-[#17121C]' : 'bg-[#29202D] text-[#B58A83] border border-[#34283F]'}`}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-6">
          <div className="flex justify-between items-center">
            <label className="text-sm font-semibold text-[#D4B18A] uppercase tracking-wider">Online Now</label>
            <button type="button" onClick={() => onChange({ onlineOnly: !filters.onlineOnly })} className={`relative w-12 h-6 rounded-full transition-colors ${filters.onlineOnly ? 'bg-[#D4B18A]' : 'bg-[#29202D]'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${filters.onlineOnly ? 'translate-x-6' : ''}`} />
            </button>
          </div>
        </div>
        <div className="mb-6">
          <label className="block text-sm font-semibold text-[#D4B18A] uppercase tracking-wider mb-3">Country</label>
          <input type="text" value={filters.country || ''} onChange={(e) => onChange({ country: e.target.value || null })} placeholder="Enter country name" className="w-full bg-[#29202D] border border-[#34283F] rounded-lg p-3 text-[#F2E9E4] focus:outline-none focus:ring-1 focus:ring-[#D4B18A]" />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onReset} className="flex-1 py-3 rounded-full bg-transparent border border-[#34283F] text-[#B58A83] font-medium hover:bg-[#29202D] transition-colors">Reset</button>
          <button type="button" onClick={onClose} className="flex-1 py-3 rounded-full bg-[#D4B18A] text-[#17121C] font-medium hover:bg-[#E4C9A0] transition-colors">Apply</button>
        </div>
      </div>
    </div>
  );
};

export default function OrbitPage() {
  const router = useRouter();
  const mapRef = useRef<MapRef | null>(null);

  const [viewport, setViewport] = useState({
    latitude: DEFAULT_VIEWPORT.latitude,
    longitude: DEFAULT_VIEWPORT.longitude,
    zoom: DEFAULT_VIEWPORT.zoom,
  });
  const [mapMoved, setMapMoved] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);

  const [profiles, setProfiles] = useState<OrbitProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    radiusKm: 'global',
    minAge: 18,
    maxAge: 99,
    gender: null,
    onlineOnly: false,
    country: null,
  });

  const [selectedProfile, setSelectedProfile] = useState<OrbitProfile | null>(null);

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/auth');
        return;
      }

      const lat = viewport.latitude;
      const lng = viewport.longitude;
      const radiusKm = filters.radiusKm === 'global' ? 20000 : filters.radiusKm;

      const { data, error: rpcError } = await supabase.rpc('get_orbit_profiles', {
        p_lat: lat,
        p_lng: lng,
        p_radius_km: radiusKm,
        p_min_age: filters.minAge,
        p_max_age: filters.maxAge,
        p_gender: filters.gender,
        p_online_only: filters.onlineOnly,
        p_country: filters.country,
      });

      if (rpcError) throw rpcError;

      if (data && Array.isArray(data)) {
        const parsedProfiles: OrbitProfile[] = data.map((row: Record<string, unknown>) => ({
          id: String(row.id ?? ''),
          displayName: String(row.display_name ?? 'Member'),
          username: row.username ? String(row.username) : null,
          avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
          age: typeof row.age === 'number' ? row.age : null,
          gender: row.gender ? String(row.gender) : null,
          city: row.city ? String(row.city) : null,
          country: row.country ? String(row.country) : null,
          intention: row.intention ? String(row.intention) : null,
          casualIntent: row.casual_intent ? String(row.casual_intent) : null,
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
  }, [viewport.latitude, viewport.longitude, filters, router]);

  useEffect(() => {
    const getUserLocation = () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setViewport({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              zoom: 10,
            });
            setInitialLoad(false);
          },
          () => {
            // IF LOCATION FAILS: Just show the global view and a small banner
            setViewport({ latitude: 20, longitude: 0, zoom: 1.5 });
            setInitialLoad(false);
            setLocationError('Location blocked. Showing global view.');
          },
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
        );
      } else {
        setViewport({ latitude: 20, longitude: 0, zoom: 1.5 });
        setInitialLoad(false);
        setLocationError('Geolocation not supported. Showing global view.');
      }
    };

    getUserLocation();
  }, []);

  useEffect(() => {
    if (!initialLoad) {
      void fetchProfiles();
    }
  }, [initialLoad, fetchProfiles]);

  const handleViewportChange = useCallback((evt: ViewStateChangeEvent) => {
    setViewport(evt.viewState);
    if (mapRef.current) {
      const current = mapRef.current.getCenter();
      if (current.lat !== DEFAULT_VIEWPORT.latitude || current.lng !== DEFAULT_VIEWPORT.longitude) {
        setMapMoved(true);
      }
    }
  }, []);

  const handleMapLoad = useCallback(() => {
    setInitialLoad(false);
  }, []);

  const handleSearchThisArea = useCallback(() => {
    void fetchProfiles();
    setMapMoved(false);
  }, [fetchProfiles]);

  const handleMarkerClick = useCallback((profile: OrbitProfile) => {
    setSelectedProfile(profile);
  }, []);

  const handleFilterChange = useCallback((newFilters: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters({
      radiusKm: 'global',
      minAge: 18,
      maxAge: 99,
      gender: null,
      onlineOnly: false,
      country: null,
    });
    setFiltersOpen(false);
  }, []);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="min-h-screen bg-[#131017] text-[#F2E9E4] flex flex-col items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-6">🗺️</div>
          <h1 className="text-2xl font-bold mb-4">Map Configuration Required</h1>
          <p className="text-[#B58A83] mb-6">To use Live Orbit, configure a Mapbox access token.</p>
          <div className="bg-[#1C1822] border border-[#34283F] rounded-xl p-4 text-left">
            <code className="text-sm">NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_token</code>
            <p className="mt-2 text-xs text-[#B58A83]">Add to .env.local</p>
          </div>
          <button type="button" onClick={() => router.back()} className="mt-6 px-6 py-3 bg-[#29202D] border border-[#34283F] text-[#D4B18A] rounded-full hover:bg-[#34283F] transition-colors">
            Go Back
          </button>
        </div>
        <MobileNav />
      </div>
    );
  }

  // REMOVED THE BLOCKING LOCATION ERROR SCREEN HERE.
  // The map will now always render, even if location fails.

  return (
    <div className="min-h-screen bg-[#131017] text-[#F2E9E4] flex flex-col relative">
      <header className="absolute top-0 left-0 right-0 z-20 p-4 flex justify-between items-center">
        <div className="bg-[#1C1822]/80 backdrop-blur-md rounded-xl px-4 py-2">
          <h1 className="text-lg font-bold">Live Orbit</h1>
        </div>
        <div className="bg-[#1C1822]/80 backdrop-blur-md rounded-xl p-1 flex gap-1">
          <span className="text-xs text-[#B58A83]">{profiles.length} online</span>
        </div>
      </header>

      {/* Show a small banner if location was blocked, instead of blocking the map */}
      {locationError && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 bg-[#3B1220] border border-[#7F1D2E] text-[#FCA5B5] rounded-full px-4 py-1.5 text-xs whitespace-nowrap shadow-lg">
          {locationError}
        </div>
      )}

      <main className="flex-1 relative">
        <Map
          initialViewState={viewport}
          mapStyle={MAP_STYLE}
          mapboxAccessToken={MAPBOX_TOKEN}
          onMove={handleViewportChange}
          onLoad={handleMapLoad}
          ref={mapRef}
          style={{ width: '100%', height: '100%' }}
          maxBounds={[[ -180, -90 ], [ 180, 90 ]]}
          minZoom={1.5}
          maxZoom={18}
        >
          {!initialLoad && (
            <Marker latitude={viewport.latitude} longitude={viewport.longitude} anchor="center">
              <button
                type="button"
                className="w-8 h-8 rounded-full bg-[#D4B18A] border-4 border-[#1C1822] shadow-lg flex items-center justify-center cursor-pointer hover:scale-110 transition-transform"
                onClick={() => {
                  mapRef.current?.flyTo({ center: [ viewport.longitude, viewport.latitude ], zoom: 10, speed: 1.5 });
                }}
                aria-label="Your location"
              >
                <span className="text-[#17121C] text-lg">📍</span>
              </button>
            </Marker>
          )}

          {profiles.map((profile) => {
            if (profile.snappedLat === null || profile.snappedLon === null) return null;
            return (
              <Marker key={profile.id} latitude={profile.snappedLat} longitude={profile.snappedLon} anchor="bottom">
                <CustomMarker
                  user={profile}
                  isSelected={selectedProfile?.id === profile.id}
                  onClick={() => handleMarkerClick(profile)}
                />
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
              <CustomPopup
                user={selectedProfile}
                onClose={() => setSelectedProfile(null)}
                formatDistance={formatDistance}
                getCountryFlag={getCountryFlag}
              />
            </Popup>
          )}

          {mapMoved && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10">
              <button
                type="button"
                onClick={handleSearchThisArea}
                className="bg-[#D4B18A] text-[#17121C] px-6 py-3 rounded-full font-semibold shadow-lg hover:bg-[#E4C9A0] transition-colors flex items-center gap-2"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                Search This Area
              </button>
            </div>
          )}

          {profiles.length === 0 && !loading && !initialLoad && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#1C1822] border border-[#34283F] rounded-xl p-4 text-center shadow-xl">
              <div className="text-4xl mb-2">🔍</div>
              <p className="text-[#B58A83]">No one found in this area</p>
              {filters.radiusKm !== 'global' && (
                <button
                  type="button"
                  onClick={() => handleFilterChange({ radiusKm: 'global' })}
                  className="mt-2 text-[#D4B18A] text-sm underline"
                >
                  Try global search
                </button>
              )}
            </div>
          )}

          {error && (
            <div className="absolute bottom-24 left-4 z-10 bg-[#3B1220] border border-[#7F1D2E] text-[#FCA5B5] rounded-xl p-4 max-w-xs" role="alert">
              <p className="text-sm">{error}</p>
              <button type="button" onClick={() => setError(null)} className="mt-2 text-xs underline">
                Dismiss
              </button>
            </div>
          )}
        </Map>

        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          className="absolute bottom-24 right-4 z-10 w-12 h-12 rounded-full bg-[#D4B18A] border-4 border-[#1C1822] shadow-lg flex items-center justify-center hover:scale-110 transition-transform"
          aria-label="Open filters"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#17121C" strokeWidth="2">
            <line x1="4" y1="21" x2="4" y2="14" />
            <line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" />
            <line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" />
            <line x1="9" y1="8" x2="15" y2="8" />
            <line x1="17" y1="16" x2="23" y2="16" />
          </svg>
        </button>

        {loading && !initialLoad && (
          <div className="absolute bottom-24 left-4 z-10 bg-[#1C1822]/80 backdrop-blur-md rounded-xl p-3">
            <div className="flex items-center gap-2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#D4B18A]" />
              <span className="text-sm text-[#B58A83]">Loading...</span>
            </div>
          </div>
        )}
      </main>

      {filtersOpen && (
        <FilterPanel
          filters={filters}
          onChange={handleFilterChange}
          onReset={resetFilters}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      <div className="absolute bottom-0 left-0 right-0 z-20">
        <MobileNav />
      </div>
    </div>
  );
}