import type {
  HardcoverBookSyncEffectiveReason,
  HardcoverBookSyncMode,
  HardcoverBookSyncOverride,
  HardcoverSyncDisabledReason,
  ReadStatus,
} from '@bookorbit/types';

const SYNCABLE_STATUSES = new Set<ReadStatus>(['want_to_read', 'reading', 'rereading', 'on_hold', 'read', 'skimmed', 'abandoned']);

export interface HardcoverBookSyncPolicySettings {
  effectiveEnabled: boolean;
  disabledReason: HardcoverSyncDisabledReason | null;
  bookSyncMode: HardcoverBookSyncMode;
}

export interface HardcoverBookSyncDecision {
  syncEnabled: boolean;
  effectiveReason: HardcoverBookSyncEffectiveReason | null;
}

export function normalizeHardcoverBookSyncOverride(
  input: { syncOverride?: string | null; syncExcluded?: boolean | null } | null | undefined,
): HardcoverBookSyncOverride {
  if (input?.syncOverride === 'included' || input?.syncOverride === 'excluded') return input.syncOverride;
  if (input?.syncExcluded === true) return 'excluded';
  return null;
}

export function resolveHardcoverBookSyncOverrideForToggle(bookSyncMode: HardcoverBookSyncMode, syncEnabled: boolean): HardcoverBookSyncOverride {
  if (bookSyncMode === 'selected_only') {
    return syncEnabled ? 'included' : null;
  }
  return syncEnabled ? null : 'excluded';
}

export function resolveHardcoverBookSyncDecision(input: {
  settings: HardcoverBookSyncPolicySettings;
  status: string | null | undefined;
  syncOverride: HardcoverBookSyncOverride;
}): HardcoverBookSyncDecision {
  if (!input.settings.effectiveEnabled) {
    return {
      syncEnabled: false,
      effectiveReason: input.settings.disabledReason ?? 'global_disabled',
    };
  }

  if (!input.status || !SYNCABLE_STATUSES.has(input.status as ReadStatus)) {
    return {
      syncEnabled: false,
      effectiveReason: input.status === 'unread' ? 'unread' : 'unsupported_status',
    };
  }

  if (input.syncOverride === 'excluded') {
    return { syncEnabled: false, effectiveReason: 'excluded' };
  }

  if (input.syncOverride === 'included') {
    return { syncEnabled: true, effectiveReason: null };
  }

  if (input.settings.bookSyncMode === 'all_eligible') {
    return { syncEnabled: true, effectiveReason: null };
  }

  return { syncEnabled: false, effectiveReason: 'not_selected' };
}
