'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Map, { Marker, Popup, ViewStateChangeEvent } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import MobileNav from '@/app/components/layout/MobileNav';
import { getCasualIntentEmoji } from '@/components/profile/CasualIntentChips';

/**
 * Nearby Map Page
 *
 * Full-screen dark mode map using Mapbox (mapbox://styles/mapbox/dark-v11)
 * Shows nearby users as avatar markers on the map.
 * Features:
 * - Browser geolocation for user's current location
 * - Privacy: Uses snapped locations (1km grid) from RPC
 * - Custom avatar markers with casual intent badges
 * - Filter by casual intent
 * - Radius filter
 * - Center on user's location button
 */

// Mapbox token must be set in environment
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

if (!MAPBOX_TOKEN) {
  console.warn(
    '[nearby] Mapbox token not configured. Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN in your environment.'
  );
}

// Map style: dark theme
const MAP_STYLE = 'mapbox://styles/mapbox/dark-v11';

interface NearbyUser {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  age: number | null;
  gender: string | null;
  casualIntent: string | null;
  snappedLat: number | null;
  snappedLon: number | null;
  distanceMeters: number;
}

// Custom Marker component
interface CustomMarkerProps {
  user: NearbyUser;
  onClick: () => void;
  selected: boolean;
}

function CustomMarker({ user, onClick, selected }: CustomMarkerProps) {
  const intentEmoji = getCasualIntentEmoji(user.casualIntent);

  return (
    <button
      type="button"
      onClick={onClick}
      className="outline-none bg-transparent border-none cursor-pointer"
      aria-label={`View ${user.displayName}'s profile`}
    >
      <div className="relative">
        {/* Avatar marker */}
        <div
          className="w-14 h-14 rounded-full overflow-hidden border-3 border-[#1C1822] shadow-lg"
          style={{
            transform: selected ? 'scale(1.1)' : 'scale(1)',
            transition: 'transform 0.2s ease',
          }}
        >
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.displayName}
              className="w-full h-full object-cover"
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #4A1828, #29202D)',
              }}
            >
              <span className="text-xl">👤</span>
            </div>
          )}
        </div>

        {/* Casual intent badge */}
        {user.casualIntent && intentEmoji && (
          <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-[#D4B18A] flex items-center justify-center text-sm border-2 border-[#1C1822]">
            {intentEmoji}
          </div>
        )}

        {/* Online indicator */}
        {false && ( // Placeholder for online status
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-[#34D399] rounded-full border-2 border-[#1C1822]" />
        )}
      </div>
    </button>
  );
}

// Custom Popup component
interface CustomPopupProps {
  user: NearbyUser;
  onClose: () => void;
}

function CustomPopup({ user, onClose }: CustomPopupProps) {
  const distanceKm = (user.distanceMeters / 1000).toFixed(1);

  return (
    <div className="bg-[#1C1822] border border-[#34283F] rounded-xl p-4 shadow-xl max-w-[280px]">
      <button
        type="button"
        onClick={onClose}
        className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center bg-[#29202D] text-[#B58A83] rounded-full hover:bg-[#34283F] transition-colors"
        aria-label="Close"
      >
        ×
      </button>

      <div className="flex items-center gap-3 mb-3">
        <div className="w-12 h-12 rounded-full overflow-hidden bg-[#29202D]">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.displayName}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xl">
              👤
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-[#F2E9E4] truncate">
            {user.displayName}
            {user.age ? `, ${user.age}` : ''}
          </h3>
          {user.username && (
            <p className="text-sm text-[#B58A83]">@{user.username}</p>
          )}
        </div>
      </div>

      {user.casualIntent && (
        <div className="flex items-center gap-1 mb-3">
          <span className="text-sm">{getCasualIntentEmoji(user.casualIntent)}</span>
          <span className="text-sm text-[#D4B18A] font-medium">
            {user.casualIntent.replace(/_/g, ' ')}
          </span>
        </div>
      )}

      <div className="flex gap-2 text-sm text-[#B58A83]">
        <span>📍 {distanceKm}km away</span>
        {user.gender && (
          <span className="capitalize">{user.gender}</span>
        )}
      </div>
    </div>
  );
}

export default function NearbyPage() {
  const router = useRouter();
  const [viewport, setViewport] = useState({
    latitude: 0,
    longitude: 0,
    zoom: 12,
  });
  const [users, setUsers] = useState<NearbyUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<NearbyUser | null>(null);
  const [radius, setRadius] = useState<number>(10); // km
  const [locationPermission, setLocationPermission] = useState<boolean | null>(null);

  // Check if we have the user's location
  const hasLocation = viewport.latitude !== 0 || viewport.longitude !== 0;

  // Format distance for display
  const formatDistance = (meters: number): string => {
    if (meters < 1000) {
      return `${Math.round(meters)}m`;
    }
    const km = meters / 1000;
    return km < 10 ? `${km.toFixed(1)}km` : `${Math.round(km)}km`;
  };

  // Fetch location and nearby users
  const fetchLocationAndUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLocationError(null);

    try {
      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push('/auth');
        return;
      }

      // Get user's current location from browser
      const getPosition = (): Promise<{
        latitude: number;
        longitude: number;
      }> => {
        return new Promise((resolve, reject) => {
          if (!navigator.geolocation) {
            reject(new Error('Geolocation not supported'));
            return;
          }

          navigator.geolocation.getCurrentPosition(
            (position) => {
              resolve({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
              });
            },
            (error) => {
              reject(error);
            },
            {
              enableHighAccuracy: false,
              timeout: 10000,
              maximumAge: 5 * 60 * 1000,
            }
          );
        });
      };

      let lat: number, lng: number;

      try {
        const position = await getPosition();
        lat = position.latitude;
        lng = position.longitude;
        setLocationPermission(true);
      } catch (geolocationError) {
        // Try to get location from user's profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('latitude, longitude')
          .eq('id', user.id)
          .maybeSingle();

        if (profile?.latitude && profile?.longitude) {
          lat = profile.latitude;
          lng = profile.longitude;
          setLocationPermission(true);
        } else {
          throw new Error('Location not available');
        }
      }

      // Update viewport
      setViewport((prev) => ({
        ...prev,
        latitude: lat,
        longitude: lng,
      }));

      // Fetch nearby users using the RPC (returns snapped locations for privacy)
      const { data, error: rpcError } = await supabase.rpc('get_nearby_profiles', {
        user_lat: lat,
        user_lng: lng,
        radius_km: radius,
      });

      if (rpcError) {
        throw rpcError;
      }

      if (data && Array.isArray(data)) {
        const parsedUsers: NearbyUser[] = data.map((row: Record<string, unknown>) => ({
          id: String(row.id ?? ''),
          displayName: String(row.display_name ?? 'Member'),
          username: row.username ? String(row.username) : null,
          avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
          age: typeof row.age === 'number' ? row.age : null,
          gender: row.gender ? String(row.gender) : null,
          casualIntent: row.casual_intent ? String(row.casual_intent) : null,
          snappedLat: typeof row.snapped_lat === 'number' ? row.snapped_lat : null,
          snappedLon: typeof row.snapped_lng === 'number' ? row.snapped_lng : null,
          distanceMeters: typeof row.distance_meters === 'number' ? row.distance_meters : 0,
        }));
        setUsers(parsedUsers);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load nearby users';
      setError(errorMessage);
      if (errorMessage.includes('Geolocation')) {
        setLocationError('Location access required. Please enable location services.');
      } else {
        setLocationError('Unable to get your location.');
      }
    } finally {
      setLoading(false);
    }
  }, [radius, router]);

  // Initial load
  useEffect(() => {
    void fetchLocationAndUsers();
  }, []);

  // Reload when radius changes
  useEffect(() => {
    if (hasLocation) {
      void fetchLocationAndUsers();
    }
  }, [radius, hasLocation, fetchLocationAndUsers]);

  // Center map on user's location
  const handleCenterOnMe = useCallback(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setViewport({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            zoom: 14,
          });
        },
        () => {
          setError('Could not get current location');
        },
        {
          enableHighAccuracy: true,
          timeout: 5000,
        }
      );
    }
  }, []);

  // Handle viewport changes
  const handleViewportChange = useCallback((evt: ViewStateChangeEvent) => {
    setViewport(evt.viewState);
  }, []);

  // Handle marker click
  const handleMarkerClick = useCallback((user: NearbyUser) => {
    setSelectedUser(user);
  }, []);

  // Handle popup close
  const handlePopupClose = useCallback(() => {
    setSelectedUser(null);
  }, []);

  // Handle user profile click
  const handleProfileClick = useCallback((user: NearbyUser) => {
    router.push(`/profile/${user.username || user.id}`);
  }, [router]);

  // Filter users by casual intent
  const [selectedIntent, setSelectedIntent] = useState<string | null>(null);
  const filteredUsers = useMemo(() => {
    if (!selectedIntent) return users;
    return users.filter((user) => user.casualIntent === selectedIntent);
  }, [users, selectedIntent]);

  // No Mapbox token - show error
  if (!MAPBOX_TOKEN) {
    return (
      <div className="min-h-screen bg-[#131017] text-[#F2E9E4] flex flex-col items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-6">🗺️</div>
          <h1 className="text-2xl font-bold mb-4">Map Configuration Required</h1>
          <p className="text-[#B58A83] mb-6">
            To use the nearby map feature, you need to configure a Mapbox access token.
          </p>
          <div className="bg-[#1C1822] border border-[#34283F] rounded-xl p-4 text-left">
            <code className="text-sm">NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_token</code>
            <p className="mt-2 text-xs text-[#B58A83]">
              Add this to your .env.local file
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.back()}
            className="mt-6 px-6 py-3 bg-[#29202D] border border-[#34283F] text-[#D4B18A] rounded-full hover:bg-[#34283F] transition-colors"
          >
            Go Back
          </button>
        </div>
        <MobileNav />
      </div>
    );
  }

  // Location error
  if (locationError && !hasLocation) {
    return (
      <div className="min-h-screen bg-[#131017] text-[#F2E9E4] flex flex-col">
        <header className="flex justify-between items-center p-6">
          <h1 className="text-2xl font-bold">Nearby</h1>
        </header>
        <main className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="text-6xl">📍</div>
          <h2 className="text-xl font-semibold">Location Required</h2>
          <p className="text-[#B58A83] max-w-md">{locationError}</p>
          <button
            type="button"
            onClick={fetchLocationAndUsers}
            className="mt-4 px-6 py-3 bg-[#D4B18A] text-[#17121C] rounded-full font-semibold hover:bg-[#E4C9A0] transition-colors"
          >
            Retry
          </button>
        </main>
        <MobileNav />
      </div>
    );
  }

  // Loading state
  if (!hasLocation && loading) {
    return (
      <div className="min-h-screen bg-[#131017] text-[#F2E9E4] flex flex-col">
        <header className="flex justify-between items-center p-6">
          <h1 className="text-2xl font-bold">Nearby</h1>
        </header>
        <main className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#D4B18A]" />
          <p>Getting your location...</p>
        </main>
        <MobileNav />
      </div>
    );
  }

  // Main map view
  return (
    <div className="min-h-screen bg-[#131017] text-[#F2E9E4] flex flex-col relative">
      {/* Header */}
      <header className="absolute top-0 left-0 right-0 z-20 p-4 flex justify-between items-center">
        <div className="bg-[#1C1822]/80 backdrop-blur-md rounded-xl px-4 py-2">
          <h1 className="text-lg font-bold">Nearby</h1>
        </div>
        <div className="bg-[#1C1822]/80 backdrop-blur-md rounded-xl p-1 flex gap-1">
          <button
            type="button"
            onClick={() => setRadius(5)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              radius === 5
                ? 'bg-[#D4B18A] text-[#17121C]'
                : 'text-[#B58A83] hover:text-[#D4B18A]'
            }`}
          >
            5km
          </button>
          <button
            type="button"
            onClick={() => setRadius(10)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              radius === 10
                ? 'bg-[#D4B18A] text-[#17121C]'
                : 'text-[#B58A83] hover:text-[#D4B18A]'
            }`}
          >
            10km
          </button>
          <button
            type="button"
            onClick={() => setRadius(25)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              radius === 25
                ? 'bg-[#D4B18A] text-[#17121C]'
                : 'text-[#B58A83] hover:text-[#D4B18A]'
            }`}
          >
            25km
          </button>
        </div>
      </header>

      {/* Map */}
      <main className="flex-1 relative">
        <Map
          initialViewState={viewport}
          mapStyle={MAP_STYLE}
          mapboxAccessToken={MAPBOX_TOKEN}
          onMove={handleViewportChange}
          className="w-full h-full"
          // Custom cursor
          cursorStyle="pointer"
          // Attribution control
          attributionControl={true}
          // Remove Mapbox logo
          logoPosition="bottom-left"
        >
          {/* User's location marker */}
          {hasLocation && (
            <Marker
              latitude={viewport.latitude}
              longitude={viewport.longitude}
              anchor="center"
            >
              <button
                type="button"
                className="w-8 h-8 rounded-full bg-[#D4B18A] border-4 border-[#1C1822] shadow-lg flex items-center justify-center cursor-pointer hover:scale-110 transition-transform"
                onClick={handleCenterOnMe}
                aria-label="You are here"
              >
                <span className="text-[#17121C] text-lg">📍</span>
              </button>
            </Marker>
          )}

          {/* Nearby user markers */}
          {filteredUsers.map((user) => {
            if (user.snappedLat === null || user.snappedLon === null) return null;

            return (
              <Marker
                key={user.id}
                latitude={user.snappedLat}
                longitude={user.snappedLon}
                anchor="bottom"
              >
                <CustomMarker
                  user={user}
                  onClick={() => handleMarkerClick(user)}
                  selected={selectedUser?.id === user.id}
                />
              </Marker>
            );
          })}

          {/* Popup for selected user */}
          {selectedUser && (
            <Popup
              latitude={selectedUser.snappedLat ?? 0}
              longitude={selectedUser.snappedLon ?? 0}
              anchor="bottom"
              onClose={handlePopupClose}
              closeOnClick={false}
              offset={20}
              className="mapboxgl-popup-content"
            >
              <CustomPopup
                user={selectedUser}
                onClose={handlePopupClose}
              />
            </Popup>
          )}

          {/* No results message */}
          {filteredUsers.length === 0 && !loading && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#1C1822] border border-[#34283F] rounded-xl p-4 text-center shadow-xl">
              <div className="text-4xl mb-2">🔍</div>
              <p className="text-[#B58A83]">No one nearby matching your filters</p>
              {radius < 25 && (
                <button
                  type="button"
                  onClick={() => setRadius(25)}
                  className="mt-2 text-[#D4B18A] text-sm underline"
                >
                  Try expanding your search
                </button>
              )}
            </div>
          )}
        </Map>

        {/* Center on me button (mobile) */}
        <button
          type="button"
          onClick={handleCenterOnMe}
          className="absolute bottom-20 right-4 z-10 w-12 h-12 rounded-full bg-[#D4B18A] border-4 border-[#1C1822] shadow-lg flex items-center justify-center hover:scale-110 transition-transform"
          aria-label="Center on my location"
        >
          <span className="text-[#17121C] text-xl">🎯</span>
        </button>

        {/* Error message */}
        {error && (
          <div
            className="absolute bottom-20 left-4 z-10 bg-[#3B1220] border border-[#7F1D2E] text-[#FCA5B5] rounded-xl p-4 max-w-xs"
            role="alert"
          >
            <p className="text-sm">{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="mt-2 text-xs underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </main>

      {/* Casual Intent Filter */}
      <div className="absolute bottom-4 left-4 z-10 bg-[#1C1822]/80 backdrop-blur-md rounded-xl p-2">
        <div className="flex gap-1 flex-wrap">
          <button
            type="button"
            onClick={() => setSelectedIntent(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              !selectedIntent
                ? 'bg-[#D4B18A] text-[#17121C]'
                : 'text-[#B58A83] hover:text-[#D4B18A]'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setSelectedIntent('free_tonight')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              selectedIntent === 'free_tonight'
                ? 'bg-[#D4B18A] text-[#17121C]'
                : 'text-[#B58A83] hover:text-[#D4B18A]'
            }`}
          >
            <span className="mr-0.5">🌙</span> Free Tonight
          </button>
          <button
            type="button"
            onClick={() => setSelectedIntent('short_term_fun')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              selectedIntent === 'short_term_fun'
                ? 'bg-[#D4B18A] text-[#17121C]'
                : 'text-[#B58A83] hover:text-[#D4B18A]'
            }`}
          >
            <span className="mr-0.5">🎉</span> Short Term
          </button>
          <button
            type="button"
            onClick={() => setSelectedIntent('friends_with_benefits')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              selectedIntent === 'friends_with_benefits'
                ? 'bg-[#D4B18A] text-[#17121C]'
                : 'text-[#B58A83] hover:text-[#D4B18A]'
            }`}
          >
            <span className="mr-0.5">🔥</span> FWB
          </button>
        </div>
      </div>

      {/* Mobile Navigation */}
      <div className="absolute bottom-0 left-0 right-0 z-20">
        <MobileNav />
      </div>
    </div>
  );
}
