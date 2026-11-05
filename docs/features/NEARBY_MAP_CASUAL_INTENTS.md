# Nearby Map & Casual Intent Categories - Implementation Guide

This document provides a complete implementation for the Nearby Map feature (Snapchat/Darlivo style) and Casual Intent Categories for the Mettivo dating app.

## Overview

### Features Implemented

1. **Casual Intent Categories**
   - Three new intent options: Free Tonight (🌙), Short Term Fun (🎉), Friends with Benefits (🔥)
   - Database support with `casual_intent` column
   - React chip components matching the dark luxury theme

2. **Nearby Map**
   - Full-screen dark-themed map using Mapbox GL JS
   - Privacy-protected location snapping (1km grid)
   - Custom avatar markers with intent badges
   - Radius and intent filters
   - Center on user's location button

### Privacy Protection

**IMPORTANT**: User locations are **always snapped to a 1km grid** before being returned to the frontend. This means:
- Exact home addresses are never exposed
- Users appear on a grid system, not their precise location
- The RPC function `get_nearby_profiles` returns only snapped coordinates
- Distance calculations use the raw location for accuracy, but display coordinates are snapped

---

## Database Setup

### 1. Enable PostGIS Extension

In your Supabase dashboard, run:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

### 2. Run Migration Files

Apply these migrations in order:

1. **20261105010000_casual_intent_categories.sql** - Adds casual intent support
2. **20261105020000_postgis_location.sql** - Adds location columns and RPC functions
3. **20261105030000_enable_extensions.sql** - Enables PostgreSQL extensions (optional)

#### File: `supabase/migrations/20261105010000_casual_intent_categories.sql`

```sql
-- Add casual_intent column with constraint
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS casual_intent TEXT 
  CHECK (casual_intent IS NULL OR casual_intent IN ('free_tonight', 'short_term_fun', 'friends_with_benefits'));

-- Add index for filtering
CREATE INDEX IF NOT EXISTS profiles_casual_intent_idx 
  ON public.profiles (casual_intent) 
  WHERE casual_intent IS NOT NULL;

-- Add categories to explore_categories table
INSERT INTO public.explore_categories (id, name, description, icon, is_active, category_type)
VALUES 
  ('free_tonight', 'Free Tonight', 'Looking for connections tonight', '🌙', true, 'casual'),
  ('short_term_fun', 'Short Term Fun', 'Seeking short-term fun and excitement', '🎉', true, 'casual'),
  ('friends_with_benefits', 'Friends with Benefits', 'Looking for casual relationships with benefits', '🔥', true, 'casual')
ON CONFLICT (id) DO NOTHING;

-- Grant permissions
GRANT UPDATE (casual_intent) ON public.profiles TO authenticated;
```

#### File: `supabase/migrations/20261105020000_postgis_location.sql`

```sql
-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- Add location columns
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS location GEOGRAPHY(POINT, 4326);

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS snapped_location GEOGRAPHY(POINT, 4326);

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS last_location_update TIMESTAMPTZ;

-- Create spatial indexes
CREATE INDEX IF NOT EXISTS profiles_snapped_location_idx 
  ON public.profiles USING GIST(snapped_location);

CREATE INDEX IF NOT EXISTS profiles_last_location_update_idx 
  ON public.profiles (last_location_update) 
  WHERE last_location_update IS NOT NULL;

-- Function to snap location to 1km grid for privacy
CREATE OR REPLACE FUNCTION public.snap_location_to_grid(
  p_location GEOGRAPHY(POINT, 4326),
  p_grid_size_meters numeric DEFAULT 1000
)
RETURNS GEOGRAPHY(POINT, 4326)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  grid_size_degrees numeric := p_grid_size_meters / 111111.0;
  snapped_geom GEOMETRY(POINT, 4326);
BEGIN
  snapped_geom := ST_SnapToGrid(
    p_location::GEOMETRY,
    grid_size_degrees,
    grid_size_degrees,
    0,
    0
  );
  RETURN snapped_geom::GEOGRAPHY(POINT, 4326);
END;
$$;

-- Function to update user's location with automatic snapping
CREATE OR REPLACE FUNCTION public.update_location_snapped(
  p_user_id UUID,
  p_latitude numeric,
  p_longitude numeric
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  grid_size numeric := 0.008983; -- Approximately 1km
BEGIN
  UPDATE public.profiles
  SET 
    latitude = p_latitude,
    longitude = p_longitude,
    location = ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::GEOGRAPHY(POINT, 4326),
    snapped_location = public.snap_location_to_grid(
      ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::GEOGRAPHY(POINT, 4326),
      1000
    ),
    last_location_update = now()
  WHERE id = p_user_id;
END;
$$;

-- Main RPC: Get nearby profiles with privacy protection
CREATE OR REPLACE FUNCTION public.get_nearby_profiles(
  user_lat float,
  user_lng float,
  radius_km float DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  display_name TEXT,
  username TEXT,
  avatar_url TEXT,
  age INTEGER,
  gender TEXT,
  city TEXT,
  country TEXT,
  intention TEXT,
  casual_intent TEXT,
  bio TEXT,
  is_online BOOLEAN,
  snapped_lat float,
  snapped_lng float,
  distance_meters float
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_point GEOGRAPHY(POINT, 4326);
BEGIN
  user_point := ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::GEOGRAPHY(POINT, 4326);

  RETURN QUERY
  SELECT 
    p.id,
    p.display_name,
    p.username,
    p.avatar_url,
    p.age,
    p.gender,
    p.city,
    p.country,
    p.intention,
    p.casual_intent,
    p.bio,
    p.is_online,
    ST_Y(p.snapped_location::GEOMETRY)::float AS snapped_lat,
    ST_X(p.snapped_location::GEOMETRY)::float AS snapped_lng,
    ST_Distance(user_point, COALESCE(p.location, p.snapped_location, user_point))::float AS distance_meters
  FROM public.profiles p
  WHERE 
    p.snapped_location IS NOT NULL
    AND p.onboarding_completed = true
    AND (p.is_suspended IS NULL OR p.is_suspended = false)
    AND (p.banned_until IS NULL OR p.banned_until > now())
    AND ST_DWithin(user_point, COALESCE(p.location, user_point), radius_km * 1000)
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks 
      WHERE blocker_id = auth.uid() AND blocked_id = p.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks 
      WHERE blocker_id = p.id AND blocked_id = auth.uid()
    )
    AND p.id != auth.uid()
  ORDER BY 
    ST_Distance(user_point, COALESCE(p.location, user_point))
  LIMIT 100;
END;
$$;

-- Grant permissions
REVOKE ALL ON FUNCTION public.get_nearby_profiles(float, float, float) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_nearby_profiles(float, float, float) TO authenticated;

REVOKE ALL ON FUNCTION public.update_location_snapped(UUID, numeric, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_location_snapped(UUID, numeric, numeric) TO authenticated;

GRANT SELECT (location, snapped_location, last_location_update) ON public.profiles TO authenticated;
```

---

## Frontend Implementation

### 1. Install Dependencies

```bash
npm install react-map-gl mapbox-gl
```

Or with yarn:

```bash
yarn add react-map-gl mapbox-gl
```

### 2. Add Mapbox Token

Add to your `.env.local` file:

```
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_mapbox_token_here
```

Get a token from: https://account.mapbox.com/access-tokens

### 3. Casual Intent Chips Component

#### File: `src/components/profile/CasualIntentChips.tsx`

```tsx
'use client';

import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

interface CasualIntentChip {
  id: string;
  label: string;
  emoji: string;
  description: string;
}

const INTENTS: CasualIntentChip[] = [
  {
    id: 'free_tonight',
    label: 'Free Tonight',
    emoji: '🌙',
    description: 'Looking for connections tonight',
  },
  {
    id: 'short_term_fun',
    label: 'Short Term Fun',
    emoji: '🎉',
    description: 'Seeking short-term fun and excitement',
  },
  {
    id: 'friends_with_benefits',
    label: 'Friends with Benefits',
    emoji: '🔥',
    description: 'Looking for casual relationships with benefits',
  },
];

interface CasualIntentChipsProps {
  selectedIntent: string | null;
  onChange?: (intent: string | null) => void;
  variant?: 'chips' | 'select';
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export default function CasualIntentChips({
  selectedIntent,
  onChange,
  variant = 'chips',
  disabled = false,
  size = 'md',
}: CasualIntentChipsProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = useCallback(async (intentId: string | null) => {
    if (disabled) return;

    setError(null);
    setSaving(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ casual_intent: intentId })
        .eq('id', user.id);

      if (updateError) throw updateError;
      onChange?.(intentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update intent');
    } finally {
      setSaving(false);
    }
  }, [disabled, onChange]);

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-3 text-base',
  };

  if (variant === 'select') {
    return (
      <div className="w-full">
        <label className="block text-sm font-medium text-[#B58A83] mb-2">
          Casual Intent
        </label>
        <select
          value={selectedIntent ?? ''}
          onChange={(e) => void handleSelect(e.target.value || null)}
          disabled={disabled || saving}
          className="w-full bg-[#29202D] border border-[#34283F] text-[#F2E9E4] rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#D4B18A] disabled:opacity-50"
        >
          <option value="">None</option>
          {INTENTS.map((intent) => (
            <option key={intent.id} value={intent.id}>
              {intent.emoji} {intent.label}
            </option>
          ))}
        </select>
        {error && (
          <p className="mt-2 text-sm text-[#FCA5B5]" role="alert">{error}</p>
        )}
      </div>
    );
  }

  // Chips variant
  return (
    <div className="w-full">
      <label className="block text-sm font-medium text-[#B58A83] mb-3">
        Casual Intent
      </label>
      <div className="flex gap-2 flex-wrap">
        {INTENTS.map((intent) => {
          const isSelected = selectedIntent === intent.id;
          return (
            <button
              key={intent.id}
              type="button"
              onClick={() => void handleSelect(isSelected ? null : intent.id)}
              disabled={disabled || saving}
              className={`
                rounded-full font-semibold transition-all
                ${sizeClasses[size]}
                ${isSelected
                  ? 'bg-[#D4B18A] text-[#17121C] shadow-lg shadow-[#D4B18A]/30'
                  : 'bg-[#29202D] border border-[#34283F] text-[#B58A83] hover:border-[#D4B18A]/70 hover:text-[#D4B18A]'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              <span className="mr-1">{intent.emoji}</span>
              {intent.label}
            </button>
          );
        })}
        {selectedIntent && (
          <button
            type="button"
            onClick={() => void handleSelect(null)}
            disabled={disabled || saving}
            className={`
              rounded-full font-semibold transition-all
              ${sizeClasses[size]}
              bg-transparent border border-[#34283F] text-[#B58A83] 
              hover:bg-[#34283F] hover:text-[#F2E9E4]
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            × Clear
          </button>
        )}
      </div>
      {error && (
        <p className="mt-2 text-sm text-[#FCA5B5]" role="alert">{error}</p>
      )}
      <p className="mt-3 text-xs text-[#B58A83]/70">
        Select one that best describes what you're looking for
      </p>
    </div>
  );
}

// Helper functions
export function getCasualIntentLabel(intentId: string | null): string {
  const intent = INTENTS.find((i) => i.id === intentId);
  return intent?.label ?? '';
}

export function getCasualIntentEmoji(intentId: string | null): string {
  const intent = INTENTS.find((i) => i.id === intentId);
  return intent?.emoji ?? '';
}

export function getCasualIntentDescription(intentId: string | null): string {
  const intent = INTENTS.find((i) => i.id === intentId);
  return intent?.description ?? '';
}
```

### 4. Nearby Page

#### File: `src/app/nearby/page.tsx`

This file is already created. It includes:
- Full-screen Mapbox map with dark theme
- Custom avatar markers with casual intent badges
- Radius filter (5km, 10km, 25km)
- Casual intent filter
- Center on user's location button
- Popup with user details
- Error handling and loading states

### 5. Nearby Utility Functions

#### File: `src/lib/nearby.ts`

```tsx
/**
 * Nearby Location Functions
 */

import { supabase } from './supabase';

export interface NearbyProfile {
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

export interface NearbyProfilesOptions {
  latitude: number;
  longitude: number;
  radiusKm?: number;
  limit?: number;
  casualIntent?: string | null;
}

export async function fetchNearbyProfiles(
  options: NearbyProfilesOptions
): Promise<{ profiles: NearbyProfile[]; error: string | null }> {
  const { latitude, longitude, radiusKm = 10, limit = 100, casualIntent } = options;

  try {
    const { data, error } = await supabase.rpc('get_nearby_profiles', {
      user_lat: latitude,
      user_lng: longitude,
      radius_km: radiusKm,
    });

    if (error) throw error;
    if (!data || !Array.isArray(data)) return { profiles: [], error: null };

    const profiles: NearbyProfile[] = data.map((row: Record<string, unknown>) => ({
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

    const filteredProfiles = casualIntent
      ? profiles.filter((p) => p.casualIntent === casualIntent)
      : profiles;

    return { profiles: filteredProfiles.slice(0, limit), error: null };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to fetch nearby profiles';
    return { profiles: [], error: errorMessage };
  }
}

export async function updateUserLocation(
  latitude: number,
  longitude: number
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { error } = await supabase.rpc('update_location_snapped', {
      p_user_id: user.id,
      p_latitude: latitude,
      p_longitude: longitude,
    });

    if (error) throw error;
    return { success: true, error: null };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to update location';
    return { success: false, error: errorMessage };
  }
}

export function getBrowserLocation(): Promise<{
  latitude: number;
  longitude: number;
} | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => {
        resolve(null);
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 5 * 60 * 1000,
      }
    );
  });
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  const km = meters / 1000;
  return km < 10 ? `${km.toFixed(1)}km` : `${Math.round(km)}km`;
}
```

---

## PostgreSQL Extensions Examples

### File: `supabase/migrations/20261105030000_enable_extensions.sql`

This file includes examples for all requested extensions:

### 1. pg_stat_statements

Enable the extension:
```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

View slowest queries:
```sql
SELECT query, total_time, calls, mean_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
```

### 2. pg_cron

Enable the extension:
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

Schedule a nightly cleanup of expired `chat_media`:
```sql
SELECT cron.schedule(
  'cleanup-expired-chat-media',
  '0 3 * * *',  -- Every day at 3 AM
  $$DELETE FROM public.chat_media WHERE expires_at IS NOT NULL AND expires_at < now()$$
);
```

Manually run a job:
```sql
SELECT cron.manual_run('cleanup-expired-chat-media');
```

### 3. pg_trgm

Enable the extension:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Create a fuzzy search function for users:
```sql
CREATE OR REPLACE FUNCTION public.search_users_fuzzy(
  search_term text,
  limit_count integer DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  display_name TEXT,
  username TEXT,
  similarity DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.display_name,
    p.username,
    similarity(p.display_name, search_term)::DOUBLE PRECISION AS similarity
  FROM public.profiles p
  WHERE 
    p.onboarding_completed = true
    AND search_term % p.display_name
  ORDER BY similarity DESC
  LIMIT limit_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_users_fuzzy(text, integer) TO authenticated;
```

Usage from Next.js:
```typescript
const { data } = await supabase.rpc('search_users_fuzzy', {
  search_term: 'John',
  limit_count: 10
});
```

### 4. citext

Enable the extension:
```sql
CREATE EXTENSION IF NOT EXISTS citext;
```

Change a column to citext for case-insensitive matching:
```sql
-- For profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS email_citext citext;

-- Create trigger to sync
CREATE OR REPLACE FUNCTION public.sync_email_citext()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.email IS NOT NULL THEN
    NEW.email_citext := NEW.email::citext;
  ELSE
    NEW.email_citext := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_email_citext_trigger ON public.profiles;
CREATE TRIGGER profiles_email_citext_trigger
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_email_citext();

-- Now query case-insensitively
SELECT * FROM public.profiles WHERE email_citext = 'John@Example.com';
```

### 5. pg_net

Enable the extension:
```sql
CREATE EXTENSION IF NOT EXISTS pg_net;
```

Use for IP address storage and queries:
```sql
-- Store IP addresses
CREATE TABLE public.user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id),
  ip_address inet NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Query sessions from a specific IP range
SELECT * FROM public.user_sessions 
WHERE ip_address >> '192.168.1.0/24';

-- Check if IP is in a range
SELECT * FROM public.user_sessions 
WHERE ip_address << '192.168.1.100'::inet;

-- Get network prefix
SELECT ip_address, network(ip_address, 24) FROM public.user_sessions;
```

---

## Integration Guide

### 1. Add Casual Intent Chips to Profile Edit Page

```tsx
import CasualIntentChips from '@/components/profile/CasualIntentChips';

function ProfileEditPage() {
  const [casualIntent, setCasualIntent] = useState<string | null>(null);

  // Fetch current intent on mount
  useEffect(() => {
    async function loadIntent() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('casual_intent')
          .eq('id', user.id)
          .maybeSingle();
        setCasualIntent(data?.casual_intent || null);
      }
    }
    void loadIntent();
  }, []);

  return (
    <div>
      <CasualIntentChips
        selectedIntent={casualIntent}
        onChange={setCasualIntent}
      />
    </div>
  );
}
```

### 2. Add Nearby Link to Navigation

```tsx
// In your MobileNav or main navigation component
<Link 
  href="/nearby"
  className="nav-item"
>
  <span>🗺️ Nearby</span>
</Link>
```

### 3. Update User Location

When a user visits the nearby page or updates their location:

```tsx
import { updateUserLocation, getBrowserLocation } from '@/lib/nearby';

async function handleUpdateLocation() {
  const location = await getBrowserLocation();
  if (location) {
    const { success, error } = await updateUserLocation(
      location.latitude,
      location.longitude
    );
    if (success) {
      console.log('Location updated!');
    } else {
      console.error('Failed to update location:', error);
    }
  }
}
```

---

## Theme Colors

The implementation uses the following color scheme matching the "Midnight Romance" luxury theme:

| Purpose | Color | Hex Code |
|---------|-------|----------|
| Background | Deep Purple | `#131017` / `#17121C` |
| Surface | Dark Purple | `#1C1822` / `#29202D` |
| Border | Muted Purple | `#34283F` |
| Primary | Gold | `#D4B18A` |
| Accent | Soft Gold | `#E4C9A0` |
| Text Primary | Off White | `#F2E9E4` |
| Text Secondary | Muted Text | `#B58A83` |
| Error | Soft Red | `#FCA5B5` / `#7F1D2E` |

---

## Testing

### Test the RPC Functions

```sql
-- Test get_nearby_profiles
SELECT * FROM public.get_nearby_profiles(
  37.7749,  -- San Francisco latitude
  -122.4194, -- San Francisco longitude
  10         -- 10km radius
);

-- Test update_location_snapped (run as a specific user)
SELECT public.update_location_snapped(
  'user-id-here'::UUID,
  37.7749,
  -122.4194
);
```

### Verify Privacy

To verify that locations are being snapped to a 1km grid:

```sql
-- Check a user's raw vs snapped location
SELECT 
  ST_X(location::GEOMETRY) as raw_lon,
  ST_Y(location::GEOMETRY) as raw_lat,
  ST_X(snapped_location::GEOMETRY) as snapped_lon,
  ST_Y(snapped_location::GEOMETRY) as snapped_lat,
  -- Calculate the difference
  ABS(ST_X(location::GEOMETRY) - ST_X(snapped_location::GEOMETRY)) as lon_diff,
  ABS(ST_Y(location::GEOMETRY) - ST_Y(snapped_location::GEOMETRY)) as lat_diff
FROM public.profiles 
WHERE location IS NOT NULL AND snapped_location IS NOT NULL
LIMIT 10;
```

The differences should be less than or equal to 0.008983 degrees (~1km).

---

## Security Considerations

1. **Privacy**: Locations are always snapped to a 1km grid before being returned to the frontend
2. **RLS**: All RPC functions use `SECURITY DEFINER` and enforce RLS policies
3. **Permissions**: Functions are only accessible to authenticated users
4. **Blocking**: The `get_nearby_profiles` function respects block relationships
5. **Profile Visibility**: Only profiles with `onboarding_completed = true` are returned

---

## Troubleshooting

### Mapbox Token Not Working

1. Verify the token is set in `.env.local`:
   ```
   NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_token
   ```
2. Ensure the token has the required scopes: `styles:read`, `map:read`
3. Restart your Next.js dev server after adding the token

### Locations Not Showing

1. Verify PostGIS is enabled:
   ```sql
   SELECT PostGIS_version();
   ```
2. Check that users have location data:
   ```sql
   SELECT COUNT(*) FROM public.profiles WHERE location IS NOT NULL;
   ```
3. Verify snapped locations exist:
   ```sql
   SELECT COUNT(*) FROM public.profiles WHERE snapped_location IS NOT NULL;
   ```

### Casual Intent Not Saving

1. Check the database column:
   ```sql
   SELECT casual_intent FROM public.profiles WHERE id = 'your-user-id';
   ```
2. Verify the column exists and has the correct constraint:
   ```sql
   ALTER TABLE public.profiles 
   ADD CONSTRAINT casual_intent_check 
   CHECK (casual_intent IS NULL OR casual_intent IN ('free_tonight', 'short_term_fun', 'friends_with_benefits'));
   ```

### react-map-gl Import Errors

Ensure you have both dependencies installed:
```bash
npm install react-map-gl mapbox-gl
```

And import the CSS:
```tsx
import 'mapbox-gl/dist/mapbox-gl.css';
```

---

## Future Enhancements

1. **Real-time Updates**: Use Supabase Realtime to update the map when users move
2. **Cluster Markers**: Implement marker clustering for areas with many users
3. **Distance Rings**: Show radius circles on the map
4. **Location History**: Allow users to see their location history
5. **Location Sharing**: Allow users to share their approximate location with specific users
6. **Heatmap**: Show a heatmap of user density
7. **Custom Map Style**: Create a custom Mapbox style matching your brand colors
