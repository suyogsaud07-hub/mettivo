'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMap } from 'react-map-gl';
import type { Map, LayerSpecification } from 'mapbox-gl';
import { fetchOrbitHeatmap, type OrbitHeatmapCell } from '@/lib/orbit-location';

const SOURCE_ID = 'orbit-heatmap';
const LAYER_ID = 'orbit-heatmap-density';

interface OrbitHeatmapLayerProps {
  /** Map bounding box: [swLng, swLat, neLng, neLat]. */
  bounds: [number, number, number, number] | null;
  /** Whether the heatmap layer is enabled. */
  enabled: boolean;
}

/**
 * Server-side aggregated heatmap layer for Orbit.
 *
 * Fetches pre-aggregated density cells from `get_orbit_heatmap()` (PostGIS
 * server-side aggregation — never individual coordinates) and renders them as
 * size/opacity-scaled circles on the map. Live density and last-known density
 * are rendered as two stacked layers so both are visible.
 */
export default function OrbitHeatmapLayer({
  bounds,
  enabled,
}: OrbitHeatmapLayerProps) {
  const mapRef = useMap();
  const [cells, setCells] = useState<OrbitHeatmapCell[]>([]);
  const registerRef = useRef<((m: Map) => void) | null>(null);

  // Fetch cells when bounds change.
  useEffect(() => {
    if (!enabled || !bounds) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCells([]);
      return;
    }
    const [swLng, swLat, neLng, neLat] = bounds;
    // setCells is invoked inside the promise callback (not synchronously
    // within the effect body), satisfying the hooks rules.
    fetchOrbitHeatmap({
      neLat,
      neLng,
      swLat,
      swLng,
      cellMeters: 500,
    }).then(setCells).catch(() => setCells([]));
  }, [enabled, bounds]);

  const registerHeatmap = useCallback(
    (m: Map) => {
      if (!m.isStyleLoaded()) return;

      // GeoJSON source of density cells (point features).
      const geoJSON = {
        type: 'FeatureCollection' as const,
        features: cells.map((cell) => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [cell.cell_lng, cell.cell_lat],
          },
          properties: {
            cell_id: cell.cell_id,
            live_count: cell.live_count,
            known_count: cell.known_count,
          },
        })),
      };

      if (!m.getSource(SOURCE_ID)) {
        m.addSource(SOURCE_ID, {
          type: 'geojson',
          data: geoJSON,
        } as Parameters<typeof m.addSource>[1]);

        // Live density layer — green.
        m.addLayer({
          id: `${LAYER_ID}-live`,
          type: 'circle',
          source: SOURCE_ID,
          filter: ['>', ['get', 'live_count'], 0],
          paint: {
            'circle-color': '#10B981',
            'circle-radius': [
              'step',
              ['get', 'live_count'],
              8,
              3,
              16,
              7,
              32,
              24,
            ],
            'circle-opacity': 0.6,
            'circle-stroke-color': '#064E3B',
            'circle-stroke-width': 1,
          },
        } as LayerSpecification);

        // Last-known density layer — champagne gold.
        m.addLayer({
          id: `${LAYER_ID}-known`,
          type: 'circle',
          source: SOURCE_ID,
          filter: [
            'all',
            ['<=', ['get', 'live_count'], 0],
            ['>', ['get', 'known_count'], 0],
          ],
          paint: {
            'circle-color': '#D9B38C',
            'circle-radius': [
              'step',
              ['get', 'known_count'],
              8,
              3,
              16,
              7,
              32,
              24,
            ],
            'circle-opacity': 0.45,
            'circle-stroke-color': '#45321F',
            'circle-stroke-width': 1,
          },
        } as LayerSpecification);
      } else {
        const source = m.getSource(SOURCE_ID);
        if (source && source.type === 'geojson') {
          source.setData(geoJSON);
        }
      }
    },
    [cells]
  );

  useEffect(() => {
    registerRef.current = registerHeatmap;
  }, [registerHeatmap]);

  // Register once the map style is loaded.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const onLoad = () => {
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
  }, [mapRef]);

  // Refresh source when cells change.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    registerRef.current?.(map);
  }, [mapRef, cells]);

  // Re-register after style reload.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const onStyleReload = () => {
      if (map.loaded()) {
        registerRef.current?.(map);
      } else {
        map.once('load', () => {
          registerRef.current?.(map);
        });
      }
    };
    map.on('styledata', onStyleReload);
    return () => {
      map.off('styledata', onStyleReload);
    };
  }, [mapRef]);

  return null;
}
