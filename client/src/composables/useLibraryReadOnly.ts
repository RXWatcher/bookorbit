import type { Ref } from 'vue'

import { useAppInfo } from '@/features/settings/composables/useAppInfo'

/**
 * True when the instance never writes to library storage. Actions that would
 * be refused by the server (upload, add file, rename, move, dock ingest) must
 * be hidden rather than shown and left to fail.
 *
 * The value is shared app-wide and fetched at most once, so it is safe to call
 * from list rows and cards that render thousands of times.
 */
export function useLibraryReadOnly(): { libraryReadOnly: Ref<boolean> } {
  const { libraryReadOnly, ensureAppInfoLoaded } = useAppInfo()
  void ensureAppInfoLoaded()
  return { libraryReadOnly }
}
