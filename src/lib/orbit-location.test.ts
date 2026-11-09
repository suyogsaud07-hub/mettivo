// @vitest-environment happy-dom

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { supabase } from '@/lib/supabase';
import {
  fetchLocationSharingPrefs,
  setLocationSharing,
  setLocationRetention,
  fetchOrbitProfiles,
  fetchOrbitHeatmap,
  updateOrbitLocation,
  OrbitLocationError,
} from '@/lib/orbit-location';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}));

const mockRpc = supabase.rpc as ReturnType<typeof vi.fn>;
const mockFrom = supabase.from as ReturnType<typeof vi.fn>;

const mockResponse = (data: unknown, error: unknown = null) => ({
  data,
  error,
});

function makeDbError(message: string, code: string): Error {
  const err = new Error(message);
  (err as { code?: string }).code = code;
  return err;
}

describe('orbit-location lib', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockFrom.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchLocationSharingPrefs', () => {
    it('returns prefs from the database', async () => {
      const maybeSingle = vi.fn().mockResolvedValue(mockResponse({
        location_sharing_enabled: true,
        location_retention_enabled: false,
      }));
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({ maybeSingle }),
      });

      const prefs = await fetchLocationSharingPrefs();
      expect(prefs.location_sharing_enabled).toBe(true);
      expect(prefs.location_retention_enabled).toBe(false);
    });

    it('degrades gracefully on missing column error', async () => {
      const missingColError = makeDbError('column does not exist', '42703');
      const maybeSingle = vi.fn().mockResolvedValue(mockResponse(null, missingColError));
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({ maybeSingle }),
      });

      const prefs = await fetchLocationSharingPrefs();
      expect(prefs.location_sharing_enabled).toBe(false);
      expect(prefs.location_retention_enabled).toBe(true);
    });
  });

  describe('setLocationSharing', () => {
    it('upserts the sharing preference', async () => {
      mockFrom.mockReturnValue({
        upsert: vi.fn().mockResolvedValue(mockResponse(null)),
      });

      await setLocationSharing(true);
      expect(mockFrom).toHaveBeenCalledWith('user_preferences');
    });

    it('throws on error', async () => {
      const dbError = makeDbError('db error', '42501');
      mockFrom.mockReturnValue({
        upsert: vi.fn().mockResolvedValue(mockResponse(null, dbError)),
      });

      await expect(setLocationSharing(true)).rejects.toBeInstanceOf(
        OrbitLocationError
      );
    });
  });

  describe('setLocationRetention', () => {
    it('upserts the retention preference', async () => {
      mockFrom.mockReturnValue({
        upsert: vi.fn().mockResolvedValue(mockResponse(null)),
      });

      await setLocationRetention(false);
      expect(mockFrom).toHaveBeenCalledWith('user_preferences');
    });
  });

  describe('fetchOrbitProfiles', () => {
    it('maps RPC response to OrbitProfile objects', async () => {
      mockRpc.mockResolvedValue(mockResponse([
        {
          id: 'u-1',
          display_name: 'Test User',
          username: 'testuser',
          avatar_url: null,
          age: 25,
          gender: 'Woman',
          city: 'Copenhagen',
          country: 'Denmark',
          intention: null,
          casual_intent: null,
          bio: null,
          is_online: true,
          snapped_lat: 55.6761,
          snapped_lng: 12.5683,
          distance_meters: 1500,
          location_status: 'live',
          location_age_seconds: 120,
        },
      ]));

      const profiles = await fetchOrbitProfiles({
        lat: 55.6761,
        lng: 12.5683,
        includeLastKnown: true,
      });

      expect(profiles).toHaveLength(1);
      expect(profiles[0].id).toBe('u-1');
      expect(profiles[0].display_name).toBe('Test User');
      expect(profiles[0].location_status).toBe('live');
      expect(profiles[0].location_age_seconds).toBe(120);
      expect(mockRpc).toHaveBeenCalledWith('get_orbit_profiles', {
        p_lat: 55.6761,
        p_lng: 12.5683,
        p_radius_km: 10,
        p_min_age: 18,
        p_max_age: 99,
        p_gender: null,
        p_online_only: false,
        p_country: null,
        p_include_last_known: true,
      });
    });

    it('returns empty array on missing relation error', async () => {
      const missingRelError = makeDbError('function does not exist', 'PGRST202');
      mockRpc.mockResolvedValue(mockResponse(null, missingRelError));

      const profiles = await fetchOrbitProfiles({
        lat: 55.6761,
        lng: 12.5683,
      });
      expect(profiles).toEqual([]);
    });
  });

  describe('fetchOrbitHeatmap', () => {
    it('maps RPC response to heatmap cells', async () => {
      mockRpc.mockResolvedValue(mockResponse([
        {
          cell_id: 'abc123',
          cell_lat: 55.67,
          cell_lng: 12.56,
          live_count: 5,
          known_count: 2,
        },
      ]));

      const cells = await fetchOrbitHeatmap({
        neLat: 55.7, neLng: 12.6, swLat: 55.6, swLng: 12.5,
      });

      expect(cells).toHaveLength(1);
      expect(cells[0].live_count).toBe(5);
      expect(cells[0].known_count).toBe(2);
    });
  });

  describe('updateOrbitLocation', () => {
    it('calls the update_orbit_location RPC', async () => {
      mockRpc.mockResolvedValue(mockResponse(null));

      await updateOrbitLocation({
        latitude: 55.6761,
        longitude: 12.5683,
        accuracyMeters: 10,
      });

      expect(mockRpc).toHaveBeenCalledWith('update_orbit_location', {
        p_latitude: 55.6761,
        p_longitude: 12.5683,
        p_accuracy: 10,
      });
    });

    it('throws on error', async () => {
      const dbError = makeDbError('db error', '53400');
      mockRpc.mockResolvedValue(mockResponse(null, dbError));

      await expect(
        updateOrbitLocation({ latitude: 55.6761, longitude: 12.5683 })
      ).rejects.toBeInstanceOf(OrbitLocationError);
    });
  });
});
