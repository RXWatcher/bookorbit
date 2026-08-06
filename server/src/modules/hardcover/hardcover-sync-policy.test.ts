import { describe, expect, it } from 'vitest';

import {
  resolveHardcoverBookSyncDecision,
  resolveHardcoverBookSyncOverrideForToggle,
  normalizeHardcoverBookSyncOverride,
} from './hardcover-sync-policy';

const baseSettings = {
  effectiveEnabled: true,
  disabledReason: null,
  bookSyncMode: 'all_eligible' as const,
};

describe('hardcover-sync-policy', () => {
  it('syncs eligible books by default in all_eligible mode', () => {
    expect(
      resolveHardcoverBookSyncDecision({
        settings: baseSettings,
        status: 'reading',
        syncOverride: null,
      }),
    ).toEqual({ syncEnabled: true, effectiveReason: null });
  });

  it('treats an explicit exclusion as out of scope', () => {
    expect(
      resolveHardcoverBookSyncDecision({
        settings: baseSettings,
        status: 'reading',
        syncOverride: 'excluded',
      }),
    ).toEqual({ syncEnabled: false, effectiveReason: 'excluded' });
  });

  it('requires an explicit include in selected_only mode', () => {
    expect(
      resolveHardcoverBookSyncDecision({
        settings: { ...baseSettings, bookSyncMode: 'selected_only' },
        status: 'reading',
        syncOverride: null,
      }),
    ).toEqual({ syncEnabled: false, effectiveReason: 'not_selected' });
  });

  it('allows an explicit include in selected_only mode', () => {
    expect(
      resolveHardcoverBookSyncDecision({
        settings: { ...baseSettings, bookSyncMode: 'selected_only' },
        status: 'reading',
        syncOverride: 'included',
      }),
    ).toEqual({ syncEnabled: true, effectiveReason: null });
  });

  it('blocks unread and unsupported statuses', () => {
    expect(
      resolveHardcoverBookSyncDecision({
        settings: baseSettings,
        status: 'unread',
        syncOverride: null,
      }),
    ).toEqual({ syncEnabled: false, effectiveReason: 'unread' });

    expect(
      resolveHardcoverBookSyncDecision({
        settings: baseSettings,
        status: 'custom-status',
        syncOverride: null,
      }),
    ).toEqual({ syncEnabled: false, effectiveReason: 'unsupported_status' });
  });

  it('maps toggle state to the correct override for each mode', () => {
    expect(resolveHardcoverBookSyncOverrideForToggle('all_eligible', true)).toBeNull();
    expect(resolveHardcoverBookSyncOverrideForToggle('all_eligible', false)).toBe('excluded');
    expect(resolveHardcoverBookSyncOverrideForToggle('selected_only', true)).toBe('included');
    expect(resolveHardcoverBookSyncOverrideForToggle('selected_only', false)).toBeNull();
  });

  it('normalizes legacy exclusion rows', () => {
    expect(normalizeHardcoverBookSyncOverride({ syncExcluded: true })).toBe('excluded');
    expect(normalizeHardcoverBookSyncOverride({ syncOverride: 'included', syncExcluded: true })).toBe('included');
    expect(normalizeHardcoverBookSyncOverride({ syncOverride: 'excluded' })).toBe('excluded');
    expect(normalizeHardcoverBookSyncOverride(null)).toBeNull();
    expect(normalizeHardcoverBookSyncOverride(undefined)).toBeNull();
    expect(normalizeHardcoverBookSyncOverride({})).toBeNull();
  });

  it('returns the specific disabled reason when effectiveEnabled is false', () => {
    expect(
      resolveHardcoverBookSyncDecision({
        settings: { effectiveEnabled: false, disabledReason: 'missing_token', bookSyncMode: 'all_eligible' },
        status: 'reading',
        syncOverride: null,
      }),
    ).toEqual({ syncEnabled: false, effectiveReason: 'missing_token' });
  });

  it('falls back to global_disabled when no specific disabled reason is set', () => {
    expect(
      resolveHardcoverBookSyncDecision({
        settings: { effectiveEnabled: false, disabledReason: null, bookSyncMode: 'all_eligible' },
        status: 'reading',
        syncOverride: null,
      }),
    ).toEqual({ syncEnabled: false, effectiveReason: 'global_disabled' });
  });

  it('treats null status as unsupported', () => {
    expect(
      resolveHardcoverBookSyncDecision({
        settings: baseSettings,
        status: null,
        syncOverride: null,
      }),
    ).toEqual({ syncEnabled: false, effectiveReason: 'unsupported_status' });
  });

  it('excluded override blocks sync even when explicitly included would win in selected_only mode', () => {
    expect(
      resolveHardcoverBookSyncDecision({
        settings: { ...baseSettings, bookSyncMode: 'selected_only' },
        status: 'reading',
        syncOverride: 'excluded',
      }),
    ).toEqual({ syncEnabled: false, effectiveReason: 'excluded' });
  });

  it('included override enables sync even in selected_only mode', () => {
    expect(
      resolveHardcoverBookSyncDecision({
        settings: { ...baseSettings, bookSyncMode: 'selected_only' },
        status: 'reading',
        syncOverride: 'included',
      }),
    ).toEqual({ syncEnabled: true, effectiveReason: null });
  });
});
