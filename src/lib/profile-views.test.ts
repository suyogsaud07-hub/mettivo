// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import {
  parseRecordResult,
  parseSummary,
  parseViewer,
} from '@/lib/profile-views';

describe('parseViewer', () => {
  it('parses a complete viewer row', () => {
    const raw = {
      viewer_id: 'u-1',
      first_name: 'Shrisha',
      last_name: 'Giri',
      has_last_name: true,
      username: 'shrisha',
      display_name: 'Shrisha Giri',
      avatar_url: 'https://example.com/avatar.jpg',
      is_online: true,
      first_viewed_at: '2026-01-01T00:00:00Z',
      last_viewed_at: '2026-01-02T00:00:00Z',
      view_count: 3,
      is_followed_by_me: false,
    };
    const row = parseViewer(raw);
    expect(row).not.toBeNull();
    expect(row!.viewer_id).toBe('u-1');
    expect(row!.first_name).toBe('Shrisha');
    expect(row!.view_count).toBe(3);
    expect(row!.is_followed_by_me).toBe(false);
  });

  it('returns null for missing required fields', () => {
    expect(parseViewer({ viewer_id: 'u-1' })).toBeNull();
    expect(parseViewer(null)).toBeNull();
    expect(parseViewer('not an object')).toBeNull();
  });

  it('handles null first_name / last_name gracefully', () => {
    const row = parseViewer({
      viewer_id: 'u-1',
      first_name: null,
      last_name: null,
      has_last_name: false,
      username: null,
      display_name: 'Member',
      avatar_url: null,
      is_online: false,
      first_viewed_at: '2026-01-01T00:00:00Z',
      last_viewed_at: '2026-01-01T00:00:00Z',
      view_count: 1,
      is_followed_by_me: false,
    });
    expect(row).not.toBeNull();
    expect(row!.first_name).toBeNull();
    expect(row!.view_count).toBe(1);
  });
});

describe('parseSummary', () => {
  it('parses a complete summary', () => {
    const raw = {
      unique_viewers: 12,
      returning_viewers: 5,
      total_visits: 20,
      most_recent_at: '2026-01-02T00:00:00Z',
    };
    const summary = parseSummary(raw);
    expect(summary).not.toBeNull();
    expect(summary!.unique_viewers).toBe(12);
    expect(summary!.returning_viewers).toBe(5);
    expect(summary!.total_visits).toBe(20);
  });

  it('returns null when required numbers are missing', () => {
    expect(parseSummary({ unique_viewers: 1 })).toBeNull();
    expect(parseSummary(null)).toBeNull();
    expect(parseSummary('not an object')).toBeNull();
  });
});

describe('parseRecordResult', () => {
  it('parses a recorded visit', () => {
    const raw = {
      recorded: true,
      is_new_viewer: true,
      unique_viewers: 3,
      total_visits: 5,
      viewer_visits: 1,
    };
    const result = parseRecordResult(raw);
    expect(result).not.toBeNull();
    expect(result!.recorded).toBe(true);
    expect(result!.is_new_viewer).toBe(true);
    expect(result!.unique_viewers).toBe(3);
  });

  it('parses a non-recorded reason', () => {
    const raw = { recorded: false, reason: 'self_view' };
    const result = parseRecordResult(raw);
    expect(result!.recorded).toBe(false);
    expect(result!.reason).toBe('self_view');
  });

  it('returns null for malformed payloads', () => {
    expect(parseRecordResult({ recorded: 'yes' })).toBeNull();
    expect(parseRecordResult(null)).toBeNull();
  });
});
