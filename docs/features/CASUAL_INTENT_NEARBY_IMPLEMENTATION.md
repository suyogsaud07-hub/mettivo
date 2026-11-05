# Casual Intent Categories & Nearby Map Implementation

## Overview

This document describes the implementation of two new features for METTIVO:

1. **Casual Intent Categories** - Three new casual dating intent options
2. **Nearby Map** - Snapchat/Darlivo-style location-based discovery with privacy protection

---

## Feature 1: Casual Intent Categories

### Database Changes

#### Migration: `20261105010000_casual_intent_categories.sql`

```sql
-- Add casual_intent column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS casual_intent TEXT 
  CHECK (casual_intent IS NULL OR casual_intent IN ('free_tonight', 'short_term_fun', 'friends_with_benefits'));

-- Add index for filtering
CREATE INDEX IF NOT EXISTS profiles_casual_intent_idx 
  ON public.profiles (casual_intent) 
  WHERE casual_intent IS NOT NULL;

-- Add to explore_categories table (if exists)
INSERT INTO public.explore_categories (id, name, description, icon, is_active, category_type)
VALUES 
  ('free_tonight', 'Free Tonight', 'Looking for connections tonight', '🌙', true, 'casual'),
  ('short_term_fun', 'Short Term Fun', 'Seeking short-term fun and excitement', '🎉', true, 'casual'),
  ('friends_with_benefits', 'Friends with Benefits', 'Looking for casual relationships with benefits', '🔥', true, 'casual')
ON CONFLICT (id) DO NOTHING;
```

### TypeScript Types

**File:** `src/lib/casual-intent.ts`

```typescript
export type CasualIntent = 
  | 'free_tonight'
  | 'short_term_fun'
  | 'friends_with_benefits'
  | null;

export interface CasualIntentConfig {
  id: CasualIntent;
  label: string;
  description: string;
  icon: string;
  color: string;
  bgColor: string;
}

export const CASUAL_INTENTS: CasualIntentConfig[] = [
  {
    id: 'free_tonight',
    label: 'Free Tonight',
    description: 'Looking for connections tonight',
    icon: '🌙',
    color: '#D4B18A',
    bgColor: 'rgba(212, 177, 138, 0.15)',
  },
  {
    id: 'short_term_fun',
    label: 'Short Term Fun',
    description: 'Seeking short-term fun and excitement',
    icon: '🎉',
    color: '#C78C8D',
    bgColor: 'rgba(199, 140, 141, 0.15)',
  },
  {
    id: 'friends_with_benefits',
    label: 'Friends with Benefits',
    description: 'Looking for casual relationships with benefits',
    icon: '🔥',
    color: '#B58A83',
    bgColor: 'rgba(181, 138, 131, 0.15)',
  },
];
```

### UI Component

**File:** `src/components/explore/CasualIntentCards.tsx`

Two variants available:
- **`variant="cards"`** - Full featured cards with icons, descriptions (3-column grid)
- **`variant="chips"`** - Compact chip-style buttons for inline filtering

**Usage in Discover Page:**
```tsx
import CasualIntentCards from '@/components/explore/CasualIntentCards';

<CasualIntentCards 
  selectedIntent={selectedIntent}
  onSelect={setSelectedIntent}
  variant="cards"
/>
```

**Usage in Explore Page:**
```tsx
<CasualIntentCards 
  selectedIntent={selectedIntent}
  onSelect={setSelectedIntent}
  variant="chips"
/>
```

**Styling:**
- Matches Midnight Romance theme (deep purples #17121C, #1C1822, #29202D)
- Gold accent color (#D4B18A)
- Smooth hover transitions
- Selected state with gold border and glow

---

## Feature 2: Nearby Map

### Database Changes

#### Migration: `20261105020000_postgis_location.sql`

```sql
-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Add location columns
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS location GEOGRAPHY(POINT, 4326);

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS snapped_location GEOGRAPHY(POINT, 4326);

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS last_location_update TIMESTAMPTZ;

-- Create spatial index for fast queries
CREATE INDEX IF NOT EXISTS profiles_snapped_location_idx 
  ON public.profiles USING GIST(snapped_location);

CREATE INDEX IF NOT EXISTS profiles_last_location_update_idx 
  ON public.profiles (last_location_update) 
  WHERE last_location_update IS NOT NULL;
```

### RPC Functions

#### 1. Snap to Grid Function

```sql
CREATE OR REPLACE FUNCTION public.snap_to_grid(
  lat numeric,
  lon numeric,
  grid_size numeric DEFAULT 0.001
)
RETURNS GEOGRAPHY(POINT, 4326)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Snap to grid by rounding to nearest multiple of grid_size
  RETURN ST_SetSRID(
    ST_MakePoint(
      round(lon / grid_size) * grid_size,
      round(lat / grid_size) * grid_size
    ),
    4326
  )::GEOGRAPHY(POINT, 4326);
END;
$$;
```

**Privacy:** Grid size of 0.001 degrees ≈ 111 meters at equator. Users appear on a grid, not exact locations.

#### 2. Update Location with Snapping

```sql
CREATE OR REPLACE FUNCTION public.update_location_snapped(
  p_user_id UUID,
  p_latitude numeric,
  p_longitude numeric,
  p_grid_size numeric DEFAULT 0.001
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.profiles
  SET 
    latitude = p_latitude,
    longitude = p_longitude,
    location = ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::GEOGRAPHY(POINT, 4326),
    snapped_location = public.snap_to_grid(p_latitude, p_longitude, p_grid_size),
    last_location_update = now()
  WHERE id = p_user_id;
END;
$$;
```

#### 3. Nearby Profiles Query

```sql
CREATE OR REPLACE FUNCTION public.nearby_profiles(
  p_user_id UUID,
  p_radius_meters numeric DEFAULT 10000,
  p_limit integer DEFAULT 50
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
  distance_meters numeric
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
    p.avatar_url,
    p.age,
    p.gender,
    p.city,
    p.country,
    p.intention,
    p.casual_intent,
    p.bio,
    p.is_online,
    ST_Distance(ref.snapped_location, p.snapped_location)::numeric AS distance_meters
  FROM public.profiles p
  CROSS JOIN (SELECT snapped_location FROM public.profiles WHERE id = p_user_id) ref
  WHERE 
    p.id != p_user_id
    AND p.snapped_location IS NOT NULL
    AND p.onboarding_completed = true
    AND (p.is_suspended IS NULL OR p.is_suspended = false)
    AND (p.banned_until IS NULL OR p.banned_until > now())
    AND ST_DWithin(ref.snapped_location, p.snapped_location, p_radius_meters)
    -- Exclude blocked users
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks 
      WHERE blocker_id = p_user_id AND blocked_id = p.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks 
      WHERE blocker_id = p.id AND blocked_id = p_user_id
    )
  ORDER BY ST_Distance(ref.snapped_location, p.snapped_location)
  LIMIT p_limit;
END;
$$;
```

**Features:**
- Returns profiles within specified radius (default 10km)
- Uses snapped locations for privacy
- Excludes blocked users (both directions)
- Filters out suspended/banned users
- Sorted by distance
- Limited results (default 50)

### TypeScript API

**File:** `src/lib/nearby.ts`

```typescript
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
  isOnline: boolean;
  distanceMeters: number;
}

// Update user's location with privacy snapping
export async function updateUserLocation(
  latitude: number,
  longitude: number,
  gridSize: number = 0.001
): Promise<LocationUpdate | null> { ... }

// Fetch nearby profiles
export async function fetchNearbyProfiles(
  radiusMeters: number = 10000,
  limit: number = 50
): Promise<NearbyProfile[]> { ... }

// Request browser geolocation
export async function requestGeolocation(): Promise<{ latitude: number; longitude: number } | null> { ... }

// Check location permission
export async function checkLocationPermission(): Promise<boolean> { ... }

// Format distance for display
export function formatDistance(meters: number): string { ... }
```

### Nearby Page

**File:** `src/app/nearby/page.tsx`

**Features:**
- Dark-themed map matching Midnight Romance palette
- User's location marked with gold pin
- Nearby users displayed as avatar markers
- Distance indicators on each marker
- Casual intent badges (🌙, 🎉, 🔥)
- Hover tooltips with profile info
- Radius filter (5km, 10km, 25km)
- Casual intent filter (Free Tonight, Short Term Fun, FWB)
- Grid overlay for visual reference
- Privacy: uses snapped locations (users appear on grid, not exact addresses)

**Map Implementation:**
Currently uses a simple CSS-based visualization that can be easily upgraded to `react-map-gl` or Leaflet when Mapbox tokens are configured.

**To enable Mapbox:**
1. Set `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` in your environment
2. Install `react-map-gl` and `mapbox-gl`
3. Replace the simple map div with the Mapbox GL component

**Navigation:**
- Clicking a marker navigates to the user's profile page
- Mobile-friendly with bottom navigation

---

## Integration Guide

### Step 1: Apply Database Migrations

```bash
# Apply to Supabase
supabase migration up

# Or manually run the SQL in your Supabase dashboard
```

### Step 2: Enable PostGIS (if not already enabled)

```sql
-- Run this in your Supabase SQL editor
CREATE EXTENSION IF NOT EXISTS postgis;
```

### Step 3: Add Mapbox Token (Optional)

Create a `.env.local` file:
```
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_mapbox_token
```

### Step 4: Import and Use Components

#### Add Casual Intent Cards to Discover Page

```tsx
// src/app/discover/page.tsx
import CasualIntentCards from '@/components/explore/CasualIntentCards';

function DiscoverPage() {
  const [selectedIntent, setSelectedIntent] = useState<CasualIntent | null>(null);

  return (
    <div>
      {/* Existing content */}
      
      {/* Add casual intent cards */}
      <CasualIntentCards 
        selectedIntent={selectedIntent}
        onSelect={setSelectedIntent}
        variant="cards"
      />
      
      {/* Filter candidates by selected intent */}
      {selectedIntent && (
        <p className="text-sm text-muted">
          Showing users with intent: {getCasualIntentLabel(selectedIntent)}
        </p>
      )}
    </div>
  );
}
```

#### Add Casual Intent Filter to Explore Page

```tsx
// src/app/explore/page.tsx
import CasualIntentCards from '@/components/explore/CasualIntentCards';

function ExplorePage() {
  const [selectedIntent, setSelectedIntent] = useState<CasualIntent | null>(null);

  return (
    <div>
      {/* Existing content */}
      
      {/* Add filter chips */}
      <div className="p-4">
        <CasualIntentCards 
          selectedIntent={selectedIntent}
          onSelect={setSelectedIntent}
          variant="chips"
        />
      </div>
    </div>
  );
}
```

### Step 5: Add Navigation to Nearby Page

```tsx
// Add to your navigation components
<Link href="/nearby" className="...">
  Nearby
</Link>
```

---

## Configuration Options

### Casual Intent Categories

You can customize the casual intents in `src/lib/casual-intent.ts`:

```typescript
export const CASUAL_INTENTS: CasualIntentConfig[] = [
  {
    id: 'your_id',
    label: 'Your Label',
    description: 'Your description',
    icon: '😊',
    color: '#YourColor',
    bgColor: 'rgba(r, g, b, alpha)',
  },
  // ... more intents
];
```

### Nearby Map Settings

Adjust the grid size for privacy in `src/lib/nearby.ts`:

```typescript
export const GRID_SIZE = 0.001; // ~111 meters
// Use larger values for more privacy (e.g., 0.005 = ~550 meters)
// Use smaller values for more precision (e.g., 0.0005 = ~55 meters)
```

Adjust the default radius in the nearby page:

```typescript
const [radius, setRadius] = useState<number>(10); // km
```

---

## Security & Privacy Considerations

### Location Privacy

1. **Grid Snapping**: Locations are snapped to a grid (0.001 degrees ≈ 111m)
   - Users don't appear at their exact house
   - Configurable grid size

2. **Data Storage**: 
   - Raw coordinates stored in `latitude`, `longitude`, and `location` columns
   - Snapped coordinates stored in `snapped_location` column
   - Only snapped locations are used for queries

3. **Access Control**:
   - Only authenticated users can update their own location
   - Only authenticated users can query nearby profiles
   - Blocked users are excluded from results

4. **No Real-time Tracking**:
   - Locations are only updated when the user explicitly visits the nearby page
   - No background location tracking

### Profile Visibility

- Only profiles with `onboarding_completed = true` appear on the map
- Suspended and banned users are excluded
- Users can control their intent visibility

---

## Testing

### Test Casual Intent Categories

1. Update a user's casual intent:
   ```sql
   UPDATE public.profiles 
   SET casual_intent = 'free_tonight' 
   WHERE id = 'your-user-id';
   ```

2. Verify the intent appears in queries:
   ```sql
   SELECT casual_intent FROM public.profiles WHERE id = 'your-user-id';
   ```

### Test Nearby Functionality

1. Update a test user's location:
   ```sql
   SELECT public.update_location_snapped(
     'your-user-id',
     40.7128,  -- latitude
     -74.0060, -- longitude
     0.001
   );
   ```

2. Query nearby profiles:
   ```sql
   SELECT * FROM public.nearby_profiles(
     'your-user-id',
     10000,  -- 10km radius
     10      -- limit
   );
   ```

3. Verify snapping works:
   ```sql
   SELECT 
     latitude,
     longitude,
     ST_AsText(location) as raw_location,
     ST_AsText(snapped_location) as snapped_location
   FROM public.profiles 
   WHERE id = 'your-user-id';
   ```

---

## Future Enhancements

### Casual Intent Categories
- [ ] Add intent to user profiles UI
- [ ] Allow filtering by casual intent in discover
- [ ] Add intent badges to profile cards
- [ ] Include intent in matching algorithm

### Nearby Map
- [ ] Upgrade to react-map-gl with Mapbox
- [ ] Add clustering for many users
- [ ] Implement real-time updates
- [ ] Add direction indicators
- [ ] Allow users to adjust grid size
- [ ] Add location sharing preferences

---

## Files Created

### Database Migrations
1. `supabase/migrations/20261105010000_casual_intent_categories.sql`
2. `supabase/migrations/20261105020000_postgis_location.sql`

### TypeScript
1. `src/lib/casual-intent.ts` - Types and configs for casual intents
2. `src/lib/nearby.ts` - API functions for location services

### Components
1. `src/components/explore/CasualIntentCards.tsx` - UI component for casual intents

### Pages
1. `src/app/nearby/page.tsx` - Nearby map page

---

## Dependencies

### Required (Already Installed)
- `@supabase/supabase-js` - Supabase client
- `next/navigation` - Next.js routing
- `react` - React hooks

### Optional (For Mapbox)
- `react-map-gl` - React wrapper for Mapbox GL JS
- `mapbox-gl` - Mapbox GL JS
- Mapbox access token

---

## Notes

1. **Mapbox Configuration**: The nearby page currently uses a simple CSS-based map visualization. To enable full Mapbox functionality, uncomment and configure the `USE_MAPBOX` flag and install the required dependencies.

2. **PostGIS**: The PostGIS extension is required for spatial queries. Most Supabase projects have this enabled by default. If not, enable it via the Supabase dashboard or SQL editor.

3. **Location Permissions**: The browser will prompt users for location access. Handle permission denials gracefully with appropriate UI messages.

4. **Grid Size**: The 0.001 degree grid size provides a good balance between privacy and utility. Adjust based on your requirements.

5. **Profile Filtering**: The nearby query excludes blocked users and only shows users who have completed onboarding. Customize the query as needed.

---

## Support

For questions or issues with this implementation:

1. Check the console for errors
2. Verify database migrations are applied
3. Ensure PostGIS is enabled
4. Test with a small dataset first
5. Review the Supabase logs for any RPC errors
