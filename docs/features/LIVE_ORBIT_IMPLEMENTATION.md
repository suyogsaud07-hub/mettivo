# Live Orbit - Global Draggable Map Implementation

## Overview

Live Orbit is a fully functional, globally draggable live map feature that allows users to see who is online around the world. It provides an interactive map interface with comprehensive filtering capabilities.

## Features Implemented

### 1. Discover Page Integration
- ✅ New "Live Orbit" card added below "Explore More" card
- ✅ Routes to `/orbit` page
- ✅ Matches existing design with dark luxury theme

### 2. Database Updates
- ✅ Dropped old `get_nearby_profiles` function
- ✅ Created new `get_orbit_profiles` RPC with advanced filtering:
  - Map center coordinates (p_lat, p_lng)
  - Radius (supports 'global' for 20000km)
  - Age range (min_age, max_age)
  - Gender filter
  - Online status filter
  - Country filter
- ✅ Maintains privacy with snapped locations (1km grid)

### 3. Orbit Map Page
- ✅ Full-screen dark mode Mapbox map
- ✅ Fully draggable and zoomable (whole world view)
- ✅ Default center: user's location via `navigator.geolocation`
- ✅ Custom avatar markers with casual intent badges
- ✅ "Search this area" button appears when map is dragged
- ✅ User's location marker
- ✅ Online/offline status indicators

### 4. Filter System
- ✅ Floating "Filters" button
- ✅ Bottom sheet modal with smooth animations
- ✅ Distance slider (1km to 500km + Global toggle)
- ✅ Age range inputs (min/max)
- ✅ Gender filter (All, Female, Male, Non-binary)
- ✅ Online status toggle
- ✅ Country filter (text input)
- ✅ Apply and Reset buttons
- ✅ Auto-refresh on filter change

### 5. Privacy Protection
- ✅ All locations snapped to 1km grid via `ST_SnapToGrid`
- ✅ Exact home locations never exposed to frontend
- ✅ RPC returns only snapped coordinates
- ✅ Distance calculations use raw locations for accuracy

---

## Files Created/Modified

### Database Migrations

#### 1. `supabase/migrations/20261106000000_orbit_profiles_rpc.sql`
```sql
-- Drops old function
DROP FUNCTION IF EXISTS public.get_nearby_profiles(float, float, float);

-- Creates new advanced filtering function
CREATE OR REPLACE FUNCTION public.get_orbit_profiles(
  p_lat float,
  p_lng float,
  p_radius_km float DEFAULT 10,
  p_min_age integer DEFAULT 18,
  p_max_age integer DEFAULT 99,
  p_gender text DEFAULT NULL,
  p_online_only boolean DEFAULT false,
  p_country text DEFAULT NULL
)
RETURNS TABLE (...) -- Returns profiles with snapped coordinates
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
-- Implementation with all filters
```

### Frontend Components

#### 2. `src/app/orbit/page.tsx` - Main Orbit Page
- Full-screen Mapbox map with dark theme
- Custom marker and popup components
- Filter panel with bottom sheet
- Search this area functionality
- User location tracking

#### 3. `src/app/orbit/styles.css` - Custom Styles
- Marker styling
- Filter panel styling
- Button and input styling
- Loading and error states
- Animations

#### 4. `src/app/discover/page.tsx` - Updated
- Added "Live Orbit" card below "Explore More"
- Links to `/orbit` page
- Matches existing design patterns

#### 5. `src/lib/nearby.ts` - Enhanced
- Added `OrbitProfile` interface
- Added `OrbitProfilesOptions` interface
- Added `fetchOrbitProfiles` function
- Maintains backward compatibility with `fetchNearbyProfiles`

---

## Setup Instructions

### 1. Install Dependencies
```bash
npm install react-map-gl mapbox-gl
# or
yarn add react-map-gl mapbox-gl
```

### 2. Configure Mapbox Token
Add to `.env.local`:
```env
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_mapbox_token_here
```
Get token at: https://account.mapbox.com/access-tokens

### 3. Apply Database Migration
In Supabase SQL Editor:
```sql
-- Run the migration file
-- File: supabase/migrations/20261106000000_orbit_profiles_rpc.sql
```

### 4. Verify Configuration
- Mapbox token is set
- PostGIS extension is enabled
- All dependencies are installed
- Restart Next.js dev server

---

## Technical Details

### RPC Function Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| p_lat | float | - | Map center latitude |
| p_lng | float | - | Map center longitude |
| p_radius_km | float | 10 | Search radius in km (use 20000 for global) |
| p_min_age | integer | 18 | Minimum age |
| p_max_age | integer | 99 | Maximum age |
| p_gender | text | NULL | Gender filter (Woman, Man, Nonbinary) |
| p_online_only | boolean | false | Only show online users |
| p_country | text | NULL | Country filter |

### Returned Columns

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | User ID |
| display_name | TEXT | Display name |
| username | TEXT | Username |
| avatar_url | TEXT | Profile picture URL |
| age | INTEGER | User's age |
| gender | TEXT | User's gender |
| city | TEXT | City |
| country | TEXT | Country |
| intention | TEXT | Dating intention |
| casual_intent | TEXT | Casual intent (Free Tonight, etc.) |
| bio | TEXT | User bio |
| is_online | BOOLEAN | Online status |
| snapped_lat | float | Privacy-protected latitude |
| snapped_lng | float | Privacy-protected longitude |
| distance_meters | float | Distance from map center |

### Privacy Implementation

The RPC function uses `ST_SnapToGrid` to snap locations to a 1km grid:

```sql
-- In the RPC function
ST_Y(p.snapped_location::GEOMETRY)::float AS snapped_lat,
ST_X(p.snapped_location::GEOMETRY)::float AS snapped_lng
```

This ensures:
1. Users appear on a grid, not their exact location
2. Grid cell size is approximately 1km (0.008983 degrees)
3. Exact home addresses are never exposed
4. Distance calculations still use raw locations for accuracy

---

## Usage Examples

### Fetch Orbit Profiles from Frontend

```typescript
import { fetchOrbitProfiles } from '@/lib/nearby';

// Basic usage
const { profiles, error } = await fetchOrbitProfiles({
  latitude: 20,
  longitude: 0,
  radiusKm: 'global', // or 10 for 10km radius
});

// With filters
const { profiles, error } = await fetchOrbitProfiles({
  latitude: 37.7749,
  longitude: -122.4194,
  radiusKm: 50,
  minAge: 25,
  maxAge: 35,
  gender: 'Woman',
  onlineOnly: true,
  country: 'United States',
});
```

### Using the Map Component

```tsx
import Map, { Marker, Popup } from 'react-map-gl';

<Map
  initialViewState={{
    latitude: 20,
    longitude: 0,
    zoom: 1.5,
  }}
  mapStyle="mapbox://styles/mapbox/dark-v11"
  mapboxAccessToken={MAPBOX_TOKEN}
  maxBounds={[
    [-180, -90], // Southwest
    [180, 90],   // Northeast
  ]}
  minZoom={1.5}
  maxZoom={18}
>
  {profiles.map((profile) => (
    <Marker
      key={profile.id}
      latitude={profile.snappedLat ?? 0}
      longitude={profile.snappedLon ?? 0}
    >
      <CustomMarker user={profile} />
    </Marker>
  ))}
</Map>
```

---

## Theme Colors

The implementation uses the following color scheme matching the "Midnight Romance" luxury theme:

| Purpose | Color | Hex Code |
|---------|-------|----------|
| Background | Deep Purple | `#131017` / `#0D0A10` |
| Surface | Dark Purple | `#1C1822` / `#29202D` |
| Border | Muted Purple | `#34283F` / `#4A1828` |
| Primary | Gold | `#D4B18A` / `#D8B38A` |
| Text Primary | Off White | `#F2E9E4` / `#EAE2F0` |
| Text Secondary | Muted Text | `#B58A83` / `#B99AA4` |
| Online Indicator | Green | `#10B981` |
| Error | Soft Red | `#FCA5B5` / `#F3A7AD` |

---

## Component Structure

### OrbitPage
```
OrbitPage
├── Map (react-map-gl)
│   ├── UserMarker (current user's location)
│   ├── ProfileMarkers (all orbit profiles)
│   └── Popup (selected profile details)
├── Header
├── SearchThisAreaButton (appears when map moved)
├── FiltersButton
└── FilterPanel (bottom sheet)
    ├── DistanceSlider
    ├── AgeRangeInputs
    ├── GenderFilter
    ├── OnlineToggle
    ├── CountryInput
    └── ActionButtons (Apply, Reset)
```

### CustomMarker
- Avatar image or fallback
- Online status indicator (green border)
- Casual intent badge
- Hover and selected states

### CustomPopup
- Profile avatar
- Display name and age
- Username
- Casual intent badge
- Location and distance
- Online status

---

## User Experience

### First Visit
1. User is redirected to `/orbit` from Discover page
2. Browser geolocation is requested
3. Map centers on user's location with zoom level 10
4. Profiles within global radius are fetched (default)
5. Avatar markers appear on map

### Map Interaction
- **Drag**: Move map to explore different areas
- **Zoom**: Pinch to zoom in/out (min zoom: 1.5 for world view)
- **Click Marker**: Open popup with profile details
- **Search This Area**: Button appears when map is dragged, refetches profiles for new center

### Filtering
1. Click Filters button (floating action button)
2. Bottom sheet opens with filter options
3. Adjust filters (distance, age, gender, online, country)
4. Click Apply to update map
5. Map automatically refetches profiles with new filters

### Privacy Indicators
- All markers show snapped locations (1km grid)
- Online users have green border/indicator
- Casual intent shown as emoji badge

---

## Performance Considerations

1. **Map Limits**: Maximum 100 profiles returned per request
2. **Caching**: Consider caching RPC results for similar map centers
3. **Debouncing**: Add debounce to filter changes to avoid rapid refetches
4. **Lazy Loading**: Load markers in batches as user zooms/moves
5. **Marker Clustering**: For areas with many users, consider clustering

---

## Security Considerations

1. **Authentication**: All RPC functions require authenticated user
2. **RLS**: Row Level Security enforced in PostgreSQL
3. **Blocking**: Blocked users are excluded from results
4. **Privacy**: Locations are always snapped to grid
5. **Rate Limiting**: Consider adding rate limiting to RPC functions

---

## Testing

### Test RPC Function
```sql
-- Basic test
SELECT * FROM public.get_orbit_profiles(
  37.7749,  -- San Francisco latitude
  -122.4194, -- San Francisco longitude
  10,        -- 10km radius
  18,        -- min age
  99,        -- max age
  NULL,      -- all genders
  false,     -- not online only
  NULL       -- all countries
);

-- Global test
SELECT * FROM public.get_orbit_profiles(
  0,         -- Equator
  0,         -- Prime Meridian
  20000,     -- Global (20000km)
  18,        -- min age
  99,        -- max age
  'Woman',   -- female only
  true,      -- online only
  NULL       -- all countries
);
```

### Verify Privacy
```sql
-- Check snapped vs raw locations
SELECT 
  id,
  ST_X(location::GEOMETRY) as raw_lon,
  ST_Y(location::GEOMETRY) as raw_lat,
  ST_X(snapped_location::GEOMETRY) as snapped_lon,
  ST_Y(snapped_location::GEOMETRY) as snapped_lat
FROM public.profiles 
WHERE location IS NOT NULL AND snapped_location IS NOT NULL
LIMIT 10;
```

The differences should be approximately 0.008983 degrees or less (≈1km).

---

## Troubleshooting

### Mapbox Token Not Working
1. Verify token is set in `.env.local`
2. Check token has required scopes: `styles:read`, `map:read`
3. Restart Next.js dev server
4. Verify token is not expired

### No Profiles Showing
1. Check if users have location data:
   ```sql
   SELECT COUNT(*) FROM public.profiles WHERE snapped_location IS NOT NULL;
   ```
2. Verify users have completed onboarding:
   ```sql
   SELECT COUNT(*) FROM public.profiles WHERE onboarding_completed = true;
   ```
3. Check RPC function permissions:
   ```sql
   SELECT * FROM information_schema.routines 
   WHERE routine_name = 'get_orbit_profiles';
   ```

### Filters Not Working
1. Verify RPC function accepts all parameters:
   ```sql
   SELECT proname, proargnames 
   FROM pg_proc 
   WHERE proname = 'get_orbit_profiles';
   ```
2. Test with specific filters:
   ```sql
   SELECT * FROM public.get_orbit_profiles(0, 0, 20000, 25, 35, 'Woman', true, NULL);
   ```

### Map Not Draggable
1. Check Mapbox GL JS is loaded
2. Verify `maxBounds` is set correctly
3. Check for CSS issues (overflow, z-index)
4. Test on different devices

### Location Not Detected
1. Check browser geolocation permissions
2. Verify `navigator.geolocation` is available
3. Test fallback to IP-based location
4. Check for errors in browser console

---

## Future Enhancements

1. **Real-time Updates**: Use Supabase Realtime to update map when users come online/offline
2. **Cluster Markers**: Implement marker clustering for dense areas
3. **Heatmap**: Show user density heatmap
4. **Location Sharing**: Allow users to share approximate location with specific users
5. **Travel Mode**: Show users from a specific country/region the user is traveling to
6. **Time Zones**: Show profiles based on time zone preferences
7. **Custom Map Style**: Create custom Mapbox style matching brand colors
8. **3D Terrain**: Enable terrain view for more immersive experience
9. **Route Drawing**: Show routes between users
10. **Group Mode**: Show groups of friends on the map
