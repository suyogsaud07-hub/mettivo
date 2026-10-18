import { describe, expect, it } from 'vitest';
import {
  extractCity,
  extractCountry,
  formatLocationLabel,
  isLocationCheckStale,
  locationLabelDiffers,
  normalizeLocation,
  parseNominatimResponse,
} from './location';

describe('isLocationCheckStale', () => {
  const now = new Date('2026-10-19T12:00:00.000Z');

  it('treats a missing timestamp as stale (never confirmed)', () => {
    expect(isLocationCheckStale(null, now)).toBe(true);
    expect(isLocationCheckStale(undefined, now)).toBe(true);
  });

  it('treats an unparseable timestamp as stale', () => {
    expect(isLocationCheckStale('not-a-date', now)).toBe(true);
  });

  it('is not stale within the 5-day window', () => {
    expect(isLocationCheckStale('2026-10-18T12:00:00.000Z', now)).toBe(false);
    expect(isLocationCheckStale('2026-10-15T12:00:00.000Z', now)).toBe(false);
  });

  it('is stale past the 5-day window', () => {
    expect(isLocationCheckStale('2026-10-14T11:59:59.000Z', now)).toBe(true);
  });
});

describe('extractCity', () => {
  it('prefers city over looser fields', () => {
    expect(extractCity({ city: 'Kathmandu', town: 'X', state: 'Bagmati' })).toBe('Kathmandu');
  });

  it('falls back through town, village, hamlet, municipality, county, state', () => {
    expect(extractCity({ town: 'Dhangadhi' })).toBe('Dhangadhi');
    expect(extractCity({ village: 'Kerung' })).toBe('Kerung');
    expect(extractCity({ county: 'Kanchanpur' })).toBe('Kanchanpur');
    expect(extractCity({ state: 'Sudurpashchim' })).toBe('Sudurpashchim');
  });

  it('returns null for a missing or city-less address', () => {
    expect(extractCity(null)).toBeNull();
    expect(extractCity(undefined)).toBeNull();
    expect(extractCity({ country: 'Nepal' })).toBeNull();
  });

  it('ignores blank strings', () => {
    expect(extractCity({ city: '   ', town: 'Dhangadhi' })).toBe('Dhangadhi');
  });
});

describe('extractCountry', () => {
  it('uses the pretty country name', () => {
    expect(extractCountry({ country: 'Nepal', country_code: 'np' })).toBe('Nepal');
  });

  it('falls back to the uppercased ISO code', () => {
    expect(extractCountry({ country_code: 'np' })).toBe('NP');
  });

  it('returns null when neither is present', () => {
    expect(extractCountry({ city: 'Kathmandu' })).toBeNull();
    expect(extractCountry(null)).toBeNull();
  });
});

describe('formatLocationLabel', () => {
  it('joins city and country', () => {
    expect(formatLocationLabel('Kathmandu', 'Nepal')).toBe('Kathmandu, Nepal');
  });

  it('handles a partial address', () => {
    expect(formatLocationLabel('Kathmandu', null)).toBe('Kathmandu');
    expect(formatLocationLabel(null, 'Nepal')).toBe('Nepal');
    expect(formatLocationLabel(null, null)).toBeNull();
  });
});

describe('normalizeLocation', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normalizeLocation('  Kathmandu,   Nepal ')).toBe('kathmandu, nepal');
    expect(normalizeLocation(null)).toBe('');
  });
});

describe('locationLabelDiffers', () => {
  it('is false when the detected label matches, ignoring case/space', () => {
    expect(locationLabelDiffers('Kathmandu, Nepal', 'kathmandu,  nepal')).toBe(false);
  });

  it('is true when the city actually changed', () => {
    expect(locationLabelDiffers('Dhangadhi, Nepal', 'Kathmandu, Nepal')).toBe(true);
  });

  it('is false when nothing was detected (permission denied)', () => {
    expect(locationLabelDiffers('Dhangadhi, Nepal', null)).toBe(false);
  });

  it('is true when a location is detected but none is stored', () => {
    expect(locationLabelDiffers(null, 'Kathmandu, Nepal')).toBe(true);
    expect(locationLabelDiffers('', 'Kathmandu, Nepal')).toBe(true);
  });
});

describe('parseNominatimResponse', () => {
  it('narrows a well-formed response', () => {
    const parsed = parseNominatimResponse({
      display_name: 'Kathmandu, Bagmati, Nepal',
      address: { city: 'Kathmandu', country: 'Nepal', country_code: 'np' },
    });
    expect(parsed.display_name).toBe('Kathmandu, Bagmati, Nepal');
    expect(parsed.address?.city).toBe('Kathmandu');
    expect(parsed.address?.country).toBe('Nepal');
  });

  it('surfaces the error field', () => {
    expect(parseNominatimResponse({ error: 'Unable to geocode' }).error).toBe('Unable to geocode');
  });

  it('drops non-string fields and non-object bodies', () => {
    const parsed = parseNominatimResponse({
      address: { city: 42, town: null, village: 'Kerung' },
    });
    expect(parsed.address?.city).toBeUndefined();
    expect(parsed.address?.town).toBeUndefined();
    expect(parsed.address?.village).toBe('Kerung');

    expect(parseNominatimResponse(null)).toEqual({});
    expect(parseNominatimResponse('nope')).toEqual({});
    expect(parseNominatimResponse([1, 2, 3])).toEqual({});
  });

  it('tolerates a missing address object', () => {
    expect(parseNominatimResponse({ display_name: 'Somewhere' }).address).toBeUndefined();
  });
});
