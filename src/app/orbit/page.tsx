'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Map, { Marker, Popup, MapRef, useMap } from 'react-map-gl';
import type { GeoJSONSourceSpecification, LayerSpecification, PointLike } from 'mapbox-gl';
import type { FeatureCollection, Point, Feature } from 'geojson';
import 'mapbox-gl/dist/mapbox-gl.css';
import MobileNav from '@/app/components/layout/MobileNav';
import { getCasualIntentEmoji } from '@/components/profile/CasualIntentChips';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
const MAP_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';
const GLOBAL_RADIUS_KM = 20000;
const DEFAULT_ZOOM = 10;
const LOCATE_ZOOM = 12;
const MOVE_DEBOUNCE_MS = 300;
const REFRESH_INTERVAL_MS = 20000;
const SOURCE_ID = 'orbit-profiles';
const CLUSTER_LAYER = 'orbit-clusters';
const CLUSTER_LABEL_LAYER = 'orbit-cluster-labels';
const POINT_LAYER = 'orbit-points';

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

interface OwnLocation {
  latitude: number;
  longitude: number;
}

const hasCoords = (
  p: OrbitProfile,
): p is OrbitProfile & { snappedLat: number; snappedLon: number } =>
  typeof p.snappedLat === 'number' && typeof p.snappedLon === 'number';

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

const buildOrbitGeoJSON = (profiles: OrbitProfile[]): FeatureCollection<Point> => ({
  type: 'FeatureCollection',
  features: profiles
    .filter(hasCoords)
    .map((profile) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [profile.snappedLon, profile.snappedLat],
      },
      properties: {
        id: profile.id,
        is_online: profile.isOnline === true,
        display_name: profile.displayName,
        distance_meters: profile.distanceMeters,
      },
    })),
});

function featureStringProp(feature: Feature<Point> | undefined, key: string): string | undefined {
  const props = feature?.properties;
  if (!props || typeof props !== 'object') return undefined;
  const value = (props as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

interface CustomPopupProps {
  user: OrbitProfile;
  onClose: () => void;
  formatDistance: (meters: number) => string;
  getCountryFlag: (country: string | null) => string;
}

const CustomPopup = ({
  user,
  onClose,
  formatDistance,
  getCountryFlag,
}: CustomPopupProps) => {
  const distance = formatDistance(user.distanceMeters);
  const intentEmoji = getCasualIntentEmoji(user.casualIntent);
  return (
    <div className="bg-[#1C1822] border border-[#34283F] rounded-xl p-4 shadow-xl max-w-72">
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
      {user.casualIntent && intentEmoji && (
        <div className="flex items-center gap-1 mb-3">
          <span className="text-sm">{intentEmoji}</span>
          <span className="text-sm text-[#D4B18A] font-medium">{user.casualIntent.replace(/_/g, ' ')}</span>
        </div>
      )}
      <div className="flex gap-2 text-sm text-[#B58A83] flex-wrap">
        <span>{getCountryFlag(user.country)} {user.gender}</span>
        <span>📍 {distance}</span>
        {user.isOnline && <span className="text-[#10B981]">● Online</span>}
        {user.bio && <span className="text-[#B58A83] text-sm truncate max-w-[200px]" title={user.bio}>{user.bio}</span>}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="mt-3 w-full py-2 rounded-full bg-[#D4B18A] text-[#17121C] font-medium text-sm hover:bg-[#E4C9A0] transition-colors"
      >
        View Profile
      </button>
    </div>
  );
};

interface FilterPanelProps {
  filters: Filters;
  onChange: (newFilters: Partial<Filters>) => void;
  onReset: () => void;
  onClose: () => void;
}

const FilterPanel = ({ filters, onChange, onReset, onClose }: FilterPanelProps) => {
  const isGlobal = filters.radiusKm === 'global';
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
            <label className="text-sm font-semibold text-[#D4B18A] uppercase tracking-wider">Discovery</label>
            <span className="text-sm text-[#B58A83]">{isGlobal ? 'Global' : `${filters.radiusKm} km`}</span>
          </div>
          <div className="flex gap-2 items-center">
            <input
              type="range"
              min="1"
              max="500"
              value={isGlobal ? 50 : Number(filters.radiusKm)}
              onChange={(e) => onChange({ radiusKm: Number(e.target.value) })}
              className="flex-1 h-2 bg-[#29202D] rounded-lg appearance-none cursor-pointer accent-[#D4B18A]"
              disabled={isGlobal}
            />
            <button
              type="button"
              onClick={() => onChange({ radiusKm: isGlobal ? 50 : 'global' })}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${isGlobal ? 'bg-[#D4B18A] text-[#17121C]' : 'bg-[#29202D] text-[#B58A83] border border-[#34283F]'}`}
            >
              {isGlobal ? 'Nearby' : 'Global'}
            </button>
          </div>
          <p className="text-xs text-[#B58A83] mt-2">
            {isGlobal ? 'Worldwide discovery.' : 'Radius-based discovery around the map centre.'}
          </p>
        </div>
        <div className="mb-6">
          <label className="text-sm font-semibold text-[#D4B18A] uppercase tracking-wider mb-3">Age Range</label>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-[#B58A83] mb-1">Min</label>
              <input
                type="number"
                value={filters.minAge}
                onChange={(e) => onChange({ minAge: Math.max(18, Math.min(99, Number(e.target.value))) })}
                min="18"
                max="99"
                className="w-full bg-[#29202D] border border-[#34283F] rounded-lg p-2 text-[#F2E9E4] focus:outline-none focus:ring-1 focus:ring-[#D4B18A]"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-[#B58A83] mb-1">Max</label>
              <input
                type="number"
                value={filters.maxAge}
                onChange={(e) => onChange({ maxAge: Math.max(18, Math.min(99, Number(e.target.value))) })}
                min="18"
                max="99"
                className="w-full bg-[#29202D] border border-[#34283F] rounded-lg p-2 text-[#F2E9E4] focus:outline-none focus:ring-1 focus:ring-[#D4B18A]"
              />
            </div>
          </div>
        </div>
        <div className="mb-6">
          <label className="block text-sm font-semibold text-[#D4B18A] uppercase tracking-wider mb-3">Gender</label>
          <div className="flex gap-2 flex-wrap">
            {GENDER_OPTIONS.map((option) => (
              <button
                key={option.id ?? 'all'}
                type="button"
                onClick={() => onChange({ gender: option.id })}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${filters.gender === option.id ? 'bg-[#D4B18A] text-[#17121C]' : 'bg-[#29202D] text-[#B58A83] border border-[#34283F]'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-6">
          <div className="flex justify-between items-center">
            <label className="text-sm font-semibold text-[#D4B18A] uppercase tracking-wider">Online Now</label>
            <button
              type="button"
              onClick={() => onChange({ onlineOnly: !filters.onlineOnly })}
              className={`relative w-12 h-6 rounded-full transition-colors ${filters.onlineOnly ? 'bg-[#D4B18A]' : 'bg-[#29202D]'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${filters.onlineOnly ? 'translate-x-6' : ''}`}
              />
            </button>
          </div>
        </div>
        <div className="mb-6">
          <label className="block text-sm font-semibold text-[#D4B18A] uppercase tracking-wider mb-3">Country</label>
          <input
            type="text"
            value={filters.country ?? ''}
            onChange={(e) => onChange({ country: e.target.value || null })}
            placeholder="Enter country name"
            className="w-full bg-[#29202D] border border-[#34283F] rounded-lg p-3 text-[#F2E9E4] focus:outline-none focus:ring-1 focus:ring-[#D4B18A]"
          />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onReset} className="flex-1 py-3 rounded-full bg-transparent border border-[#34283F] text-[#B58A83] font-medium hover:bg-[#29202D] transition-colors">
            Reset
          </button>
          <button type="button" onClick={onClose} className="flex-1 py-3 rounded-full bg-[#D4B18A] text-[#17121C] font-medium hover:bg-[#E4C9A0] transition-colors">
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};

interface OrbitMapLayersProps {
  profiles: OrbitProfile[];
  onProfileClick: (profile: OrbitProfile) => void;
  onFlyTo: (center: [number, number], zoom: number) => void;
}

const OrbitMapLayers = ({
  profiles,
  onProfileClick,
  onFlyTo,
}: OrbitMapLayersProps) => {
  const maps = useMap();
  const map = maps.current?.getMap();
  const mapLoadedRef = useRef(false);

  // Latest registration function, kept in a ref so the load/styledata
  // listeners always build from the current `profiles` without capturing a
  // stale closure. Existing sources/layers are checked before registration,
  // so this is idempotent and safe under React Strict Mode.
  const registerRef = useRef<((m: NonNullable<typeof map>) => void) | null>(
    null
  );

  const registerOrbitLayers = useCallback(
    (m: NonNullable<typeof map>) => {
      const geoJSON = buildOrbitGeoJSON(profiles);

      if (!m.getSource(SOURCE_ID)) {
        const spec: GeoJSONSourceSpecification = {
          type: 'geojson',
          data: geoJSON,
          cluster: true,
          clusterRadius: 40,
          clusterMaxZoom: 14,
        };
        m.addSource(SOURCE_ID, spec);

        m.addLayer({
          id: CLUSTER_LAYER,
          type: 'circle',
          source: SOURCE_ID,
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': '#D9B38C',
            'circle-radius': ['step', ['get', 'point_count'], 20, 10, 30, 40, 40],
            'circle-opacity': 0.85,
            'circle-stroke-color': '#17121A',
            'circle-stroke-width': 2,
          },
        } as LayerSpecification);

        m.addLayer({
          id: CLUSTER_LABEL_LAYER,
          type: 'symbol',
          source: SOURCE_ID,
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['to-string', ['get', 'point_count']],
            'text-font': ['default'],
            'text-size': 12,
            'text-anchor': 'center',
          },
          paint: { 'text-color': '#17121A' },
        } as LayerSpecification);

        m.addLayer({
          id: POINT_LAYER,
          type: 'circle',
          source: SOURCE_ID,
          filter: ['!has', 'point_count'],
          paint: {
            'circle-color': [
              'case',
              ['boolean', ['get', 'is_online'], false],
              '#10B981',
              '#6B5B7B',
            ],
            'circle-radius': 7,
            'circle-opacity': 0.9,
            'circle-stroke-color': '#17121A',
            'circle-stroke-width': 2,
          },
        } as LayerSpecification);
      } else {
        const source = m.getSource(SOURCE_ID);
        if (source && source.type === 'geojson') {
          source.setData(geoJSON);
        }
      }
    },
    [profiles]
  );

  // Keep `registerRef.current` pointing at the latest `registerOrbitLayers` so
  // the load/styledata listeners always build from the current `profiles`
  // without capturing a stale closure. This runs in an effect (not during
  // render) to avoid touching refs while rendering.
  useEffect(() => {
    registerRef.current = registerOrbitLayers;
  }, [registerOrbitLayers]);

  // Register custom sources/layers once the map style has finished loading.
  // `map.loaded()` is checked directly (no `setState` in an effect body), and
  // the `load` event listener triggers registration once the style is ready.
  useEffect(() => {
    if (!map) return;
    const onLoad = () => {
      mapLoadedRef.current = true;
      registerRef.current?.(map);
    };
    if (map.loaded()) {
      onLoad();
    } else {
      map.on('load', onLoad);
    }
    return () => {
      map.off('load', onLoad);
    };
  }, [map]);

  // Refresh the source data when profiles change, once the style is loaded.
  useEffect(() => {
    if (!map || !mapLoadedRef.current) return;
    registerRef.current?.(map);
  }, [map, profiles]);

  // Restore custom sources/layers after a dynamic style reload. Mapbox drops
  // programmatic sources/layers when the style changes; re-register them once
  // the new style finishes loading.
  useEffect(() => {
    if (!map) return;
    const onStyleReload = () => {
      mapLoadedRef.current = false;
      if (map.loaded()) {
        registerRef.current?.(map);
      } else {
        map.once('load', () => {
          mapLoadedRef.current = true;
          registerRef.current?.(map);
        });
      }
    };
    map.on('styledata', onStyleReload);
    return () => {
      map.off('styledata', onStyleReload);
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    const handleClick = (e: { point: PointLike }) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [CLUSTER_LAYER, POINT_LAYER],
      });
      const feature = features[0];
      if (!feature) return;
      const layerId = feature.layer?.id;
      if (layerId === CLUSTER_LAYER) {
        const coords = (feature.geometry as unknown as { coordinates: [number, number] } | undefined)?.coordinates;
        if (coords) onFlyTo(coords, map.getZoom() + 2);
      } else if (layerId === POINT_LAYER) {
        const id = featureStringProp(feature as Feature<Point>, 'id');
        if (!id) return;
        const profile = profiles.find((p) => p.id === id);
        if (profile) onProfileClick(profile);
      }
    };

    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [map, profiles, onProfileClick, onFlyTo]);

  return null;
};

interface OrbitMapProps {
  viewport: { latitude: number; longitude: number; zoom: number };
  profiles: OrbitProfile[];
  ownLocation: OwnLocation | null;
  selectedProfile: OrbitProfile | null;
  onProfileClick: (profile: OrbitProfile) => void;
  onClosePopup: () => void;
  onMapMove: (viewport: { latitude: number; longitude: number; zoom: number }) => void;
  onFlyTo: (center: [number, number], zoom: number) => void;
  mapRef: RefObject<MapRef | null>;
}

const OrbitMap = ({
  viewport,
  profiles,
  ownLocation,
  selectedProfile,
  onProfileClick,
  onClosePopup,
  onMapMove,
  onFlyTo,
  mapRef,
}: OrbitMapProps) => {
  return (
    <Map
      initialViewState={viewport}
      mapStyle={MAP_STYLE}
      mapboxAccessToken={MAPBOX_TOKEN}
      onMove={(evt) => onMapMove(evt.viewState)}
      ref={mapRef}
      style={{ width: '100%', height: '100%' }}
      maxBounds={[
        [-180, -90],
        [180, 90],
      ]}
      minZoom={1.5}
      maxZoom={18}
    >
      <OrbitMapLayers
        profiles={profiles}
        onProfileClick={onProfileClick}
        onFlyTo={onFlyTo}
      />
      {ownLocation && (
        <Marker
          latitude={ownLocation.latitude}
          longitude={ownLocation.longitude}
          anchor="center"
        >
          <button
            type="button"
            className="w-9 h-9 rounded-full bg-[#D4B18A] border-4 border-[#17121A] shadow-lg flex items-center justify-center cursor-pointer hover:scale-110 transition-transform"
            onClick={() => {
              mapRef.current?.getMap()?.flyTo({
                center: [ownLocation.longitude, ownLocation.latitude],
                zoom: DEFAULT_ZOOM,
                speed: 1.5,
              });
            }}
            aria-label="Your location"
          >
            <span className="text-[#17121A] text-lg">📍</span>
          </button>
        </Marker>
      )}

      {selectedProfile && hasCoords(selectedProfile) && (
        <Popup
          latitude={selectedProfile.snappedLat}
          longitude={selectedProfile.snappedLon}
          anchor="bottom"
          onClose={onClosePopup}
          closeOnClick={false}
          offset={20}
        >
          <CustomPopup
            user={selectedProfile}
            onClose={onClosePopup}
            formatDistance={formatDistance}
            getCountryFlag={getCountryFlag}
          />
        </Popup>
      )}
    </Map>
  );
};

export default function OrbitPage() {
  const router = useRouter();
  const mapRef: RefObject<MapRef | null> = useRef<MapRef | null>(null);

  const [viewport, setViewport] = useState({
    latitude: DEFAULT_VIEWPORT.latitude,
    longitude: DEFAULT_VIEWPORT.longitude,
    zoom: DEFAULT_VIEWPORT.zoom,
  });
  const viewportRef = useRef(viewport);

  const [profiles, setProfiles] = useState<OrbitProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

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
  const [ownLocation, setOwnLocation] = useState<OwnLocation | null>(null);

  const requestSeqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locatingRef = useRef(false);
  const isInteractingRef = useRef(false);

  const radiusKm = filters.radiusKm === 'global' ? GLOBAL_RADIUS_KM : filters.radiusKm;

  const fetchProfiles = useCallback(
    async (lat: number, lng: number, radius: number) => {
      const seq = ++requestSeqRef.current;
      setLoading(true);
      setError(null);

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.push('/auth');
          return;
        }

        const { data, error: rpcError } = await supabase.rpc('get_orbit_profiles', {
          p_lat: lat,
          p_lng: lng,
          p_radius_km: radius,
          p_min_age: filters.minAge,
          p_max_age: filters.maxAge,
          p_gender: filters.gender,
          p_online_only: filters.onlineOnly,
          p_country: filters.country,
        });

        if (seq !== requestSeqRef.current) return;
        if (rpcError) throw rpcError;

        if (data && Array.isArray(data)) {
          const parsed = data.map((row: Record<string, unknown>) => ({
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
          setProfiles(parsed);
        }
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        console.error('[orbit] get_orbit_profiles failed:', err);
        const errorMessage = err instanceof Error ? err.message : 'Failed to load profiles';
        setError(errorMessage);
        setProfiles([]);
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [filters, router],
  );

  const discoveryRefetch = useCallback(() => {
    if (isInteractingRef.current) return;
    void fetchProfiles(viewportRef.current.latitude, viewportRef.current.longitude, radiusKm);
  }, [fetchProfiles, radiusKm]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    let mounted = true;
    const start = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/auth');
        return;
      }

      let gotLocation = false;
      if (navigator.geolocation) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: false,
              timeout: 10000,
              maximumAge: 5 * 60 * 1000,
            });
          });
          const { latitude, longitude } = position.coords;
          if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
            setViewport({ latitude, longitude, zoom: LOCATE_ZOOM });
            setOwnLocation({ latitude, longitude });
            gotLocation = true;

            const { error: saveError } = await supabase.rpc('update_location_snapped', {
              p_user_id: user.id,
              p_latitude: latitude,
              p_longitude: longitude,
            });
            if (saveError) {
              setLocateError(`Could not save your location: ${saveError.message}`);
            } else {
              void fetchProfiles(latitude, longitude, radiusKm);
            }
          }
        } catch {
          // fall through to fallback view below
        }
      }

      if (!gotLocation && mounted) {
        setViewport({
          latitude: DEFAULT_VIEWPORT.latitude,
          longitude: DEFAULT_VIEWPORT.longitude,
          zoom: DEFAULT_VIEWPORT.zoom,
        });
      }
      if (mounted) setLoading(false);
    };
    start();
    return () => {
      mounted = false;
    };
  }, [fetchProfiles, radiusKm, router]);

  const handleMapMove = useCallback(
    (next: { latitude: number; longitude: number; zoom: number }) => {
      setViewport(next);
      viewportRef.current = next;
      isInteractingRef.current = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        isInteractingRef.current = false;
        void fetchProfiles(next.latitude, next.longitude, radiusKm);
      }, MOVE_DEBOUNCE_MS);
    },
    [fetchProfiles, radiusKm],
  );

  const handleLocateMe = useCallback(async () => {
    if (locatingRef.current) return;
    if (!navigator.geolocation) {
      setLocateError('Geolocation is not supported by this browser.');
      return;
    }
    locatingRef.current = true;
    setLocating(true);
    setLocateError(null);

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        });
      });
      const { latitude, longitude } = position.coords;
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        throw new Error('Invalid coordinates received.');
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/auth');
        return;
      }

      const { error: saveError } = await supabase.rpc('update_location_snapped', {
        p_user_id: user.id,
        p_latitude: latitude,
        p_longitude: longitude,
      });
      if (saveError) throw saveError;

      setOwnLocation({ latitude, longitude });
      setViewport({ latitude, longitude, zoom: 13 });
      mapRef.current?.getMap()?.flyTo({
        center: [longitude, latitude],
        zoom: 13,
        speed: 1.5,
      });
      void fetchProfiles(latitude, longitude, radiusKm);
    } catch (err) {
      let message = 'Could not determine your location.';
      if (err instanceof Error) {
        message = err.message;
      } else if (typeof err === 'object' && err !== null && 'code' in err) {
        const code = (err as { code?: number }).code;
        switch (code) {
          case 1:
            message = 'Location access was denied. You can still browse the map.';
            break;
          case 2:
            message = 'Location information is unavailable.';
            break;
          case 3:
            message = 'Location request timed out.';
            break;
          default:
            message = 'Could not determine your location.';
        }
      }
      setLocateError(message);
    } finally {
      locatingRef.current = false;
      setLocating(false);
    }
  }, [fetchProfiles, radiusKm, router]);

  const handleSearchThisArea = useCallback(() => {
    void fetchProfiles(viewportRef.current.latitude, viewportRef.current.longitude, radiusKm);
  }, [fetchProfiles, radiusKm]);

  const handleMarkerClick = useCallback((profile: OrbitProfile) => {
    setSelectedProfile(profile);
  }, []);

  const handleFilterChange = useCallback((newFilters: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
    void fetchProfiles(viewportRef.current.latitude, viewportRef.current.longitude, radiusKm);
  }, [fetchProfiles, radiusKm]);

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
    void fetchProfiles(viewportRef.current.latitude, viewportRef.current.longitude, GLOBAL_RADIUS_KM);
  }, [fetchProfiles]);

  useEffect(() => {
    refreshIntervalRef.current = setInterval(discoveryRefetch, REFRESH_INTERVAL_MS);
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [discoveryRefetch]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const flyTo = useCallback(
    (center: [number, number], zoom: number) => {
      mapRef.current?.getMap()?.flyTo({ center, zoom, speed: 1.5, essential: true });
    },
    [],
  );

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

  return (
    <div className="min-h-screen bg-[#131017] text-[#F2E9E4] flex flex-col relative">
      <header className="absolute top-0 left-0 right-0 z-20 p-4 flex justify-between items-center">
        <div className="bg-[#1C1822]/80 backdrop-blur-md rounded-xl px-4 py-2">
          <h1 className="text-lg font-bold">Live Orbit</h1>
        </div>
        <div className="bg-[#1C1822]/80 backdrop-blur-md rounded-xl p-1 flex gap-1">
          <span className="text-xs text-[#B58A83]">{profiles.length} nearby</span>
        </div>
      </header>

      {locateError && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 bg-[#3B1220] border border-[#7F1D2E] text-[#FCA5B5] rounded-full px-4 py-1.5 text-xs whitespace-nowrap shadow-lg">
          {locateError}
        </div>
      )}



      {error && (
        <div className="absolute bottom-26 left-4 z-10 bg-[#3B1220] border border-[#7F1D2E] text-[#FCA5B5] rounded-xl p-4 max-w-xs" role="alert">
          <p className="text-sm">{error}</p>
          <button type="button" onClick={() => setError(null)} className="mt-2 text-xs underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="fixed inset-0 w-full h-full z-0" style={{ overflow: 'hidden' }}>
        <OrbitMap
          viewport={viewport}
          profiles={profiles}
          ownLocation={ownLocation}
          selectedProfile={selectedProfile}
          onProfileClick={handleMarkerClick}
          onClosePopup={() => setSelectedProfile(null)}
          onMapMove={handleMapMove}
          onFlyTo={flyTo}
          mapRef={mapRef}
        />

        {viewport.zoom > DEFAULT_VIEWPORT.zoom && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10">
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

        {loading && !(
          viewport.latitude === DEFAULT_VIEWPORT.latitude &&
          viewport.longitude === DEFAULT_VIEWPORT.longitude &&
          viewport.zoom === DEFAULT_VIEWPORT.zoom
        ) && (
          <div className="absolute bottom-24 left-4 z-10 bg-[#1C1822]/80 backdrop-blur-md rounded-xl p-3">
            <div className="flex items-center gap-2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#D4B18A]" />
              <span className="text-sm text-[#B58A83]">Loading...</span>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handleLocateMe}
        disabled={locating}
        className={`absolute bottom-24 right-4 z-20 w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform ${locating ? 'opacity-80' : 'bg-[#D4B18A] hover:bg-[#E4C9A0] hover:scale-105'}`}
        aria-label={locating ? 'Locating…' : 'Locate me'}
      >
        {locating ? (
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#17121A]" />
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#17121A" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="2" x2="12" y2="12" />
            <line x1="12" y1="12" x2="12.01" y2="12" />
          </svg>
        )}
      </button>

      <button
        type="button"
        onClick={() => setFiltersOpen(true)}
        className="absolute bottom-10 right-4 z-20 w-12 h-12 rounded-full bg-[#D4B18A] border-4 border-[#17121A] shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
        aria-label="Open filters"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#17121A" strokeWidth="2">
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
