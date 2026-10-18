/**
 * Location verification — pure helpers and response types.
 *
 * Everything here is free of React, DOM and network I/O so it can be unit
 * tested in the node Vitest environment (`src/lib/location.test.ts`). The React
 * hook that consumes it lives in `src/hooks/useLocationVerification.ts`.
 *
 * The geocoding provider is OpenStreetMap Nominatim. Its `reverse` endpoint is
 * free and needs no API key, but its response is loosely typed and may omit any
 * part of `address` — hence the defensive parsing below rather than trusting a
 * shape.
 */

/** How long a confirmation is trusted before the prompt is shown again. */
export const LOCATION_STALE_DAYS = 5;

/** `LOCATION_STALE_DAYS` expressed in milliseconds. */
export const LOCATION_STALE_MS = LOCATION_STALE_DAYS * 24 * 60 * 60 * 1000;

/** The subset of Nominatim's `address` object this feature reads. */
export interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  suburb?: string;
  county?: string;
  state?: string;
  country?: string;
  country_code?: string;
}

/** The shape of a Nominatim `reverse` response we depend on. */
export interface NominatimReverseResponse {
  address?: NominatimAddress;
  display_name?: string;
  /** Present on failure, e.g. `"Unable to geocode"`. */
  error?: string;
}

/** A city/country pair resolved from a coordinate, plus a display label. */
export interface DetectedLocation {
  city: string | null;
  country: string | null;
  /** `"City, Country"`, or whichever of the two is known, or `null`. */
  label: string | null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Narrows Nominatim's untyped JSON into `NominatimReverseResponse`.
 *
 * Accepts `unknown` on purpose: `response.json()` is `any`, and the contract is
 * "never trust the network". A missing/!object body yields `{}`.
 */
export function parseNominatimResponse(data: unknown): NominatimReverseResponse {
  if (typeof data !== 'object' || data === null) return {};

  const record = data as Record<string, unknown>;
  const result: NominatimReverseResponse = {};

  const error = asString(record.error);
  if (error !== undefined) result.error = error;

  const displayName = asString(record.display_name);
  if (displayName !== undefined) result.display_name = displayName;

  const rawAddress = record.address;
  if (typeof rawAddress === 'object' && rawAddress !== null) {
    const address = rawAddress as Record<string, unknown>;
    result.address = {
      city: asString(address.city),
      town: asString(address.town),
      village: asString(address.village),
      hamlet: asString(address.hamlet),
      municipality: asString(address.municipality),
      suburb: asString(address.suburb),
      county: asString(address.county),
      state: asString(address.state),
      country: asString(address.country),
      country_code: asString(address.country_code),
    };
  }

  return result;
}

/**
 * Best-effort city name from a Nominatim address.
 *
 * Falls back down a chain because rural coordinates often have no `city` — the
 * settlement may only appear as `town`, `village`, `hamlet` or (last resort)
 * `municipality`/`county`/`state`. Returns `null` when none is present.
 */
export function extractCity(
  address: NominatimAddress | null | undefined,
): string | null {
  if (!address) return null;
  const candidates = [
    address.city,
    address.town,
    address.village,
    address.hamlet,
    address.municipality,
    address.county,
    address.state,
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) return value;
  }
  return null;
}

/**
 * Country name, falling back to the uppercased ISO `country_code` when the
 * pretty name is absent. Returns `null` when both are missing.
 */
export function extractCountry(
  address: NominatimAddress | null | undefined,
): string | null {
  if (!address) return null;
  const name = address.country?.trim();
  if (name) return name;
  const code = address.country_code?.trim();
  return code ? code.toUpperCase() : null;
}

/** Joins a city and country into a display label: `"City, Country"`. */
export function formatLocationLabel(
  city: string | null,
  country: string | null,
): string | null {
  if (city && country) return `${city}, ${country}`;
  return city ?? country ?? null;
}

/** Case/whitespace-insensitive form used only for comparison, never storage. */
export function normalizeLocation(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Whether `last_location_check` is old enough (or absent) to prompt again.
 * A `null`/invalid timestamp counts as stale — a member who has never confirmed
 * is asked once.
 */
export function isLocationCheckStale(
  lastCheck: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastCheck) return true;
  const timestamp = Date.parse(lastCheck);
  if (Number.isNaN(timestamp)) return true;
  return now.getTime() - timestamp > LOCATION_STALE_MS;
}

/**
 * Whether a freshly detected label differs from what is stored.
 *
 * Returns `false` when nothing was detected (so a permission-denied check never
 * masquerades as a move), and `true` when a location *was* detected but the
 * stored value is empty — a member with no saved city has, in effect, moved.
 */
export function locationLabelDiffers(
  current: string | null | undefined,
  detectedLabel: string | null,
): boolean {
  const detected = normalizeLocation(detectedLabel);
  if (!detected) return false;
  return normalizeLocation(current) !== detected;
}
