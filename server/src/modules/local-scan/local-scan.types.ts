import type { WarehouseMediaType } from '@bookorbit/types';

export interface LocalCandidate {
  absolutePath: string;
  relativePath: string;
  fileName: string;
}

export interface CatalogKeyRow {
  remoteId: string;
  title: string;
  rawPayload: Record<string, unknown>;
}

export interface LocalMatchStrategy {
  readonly mediaType: WarehouseMediaType;
  catalogKey(row: CatalogKeyRow): string | null;
  diskKey(candidate: LocalCandidate): string | null;
  titleFor(candidate: LocalCandidate): string;
  /**
   * A looser identity used only when the primary key finds no match.
   *
   * The same audiobook can sit in differently named directories on each side. The warehouse
   * had "James Islington/Hierarchy 1 - The Will of the Many (2023)" while the disk had
   * "James Islington/The Will of the Many (2023)", so a path key alone reported a book that
   * was already catalogued as missing. Returning null disables the fallback.
   */
  fallbackCatalogKey?(row: CatalogKeyRow): string | null;
  fallbackDiskKey?(candidate: LocalCandidate): string | null;
}

export interface LocalScanSummary {
  rootId: number;
  scanned: number;
  matched: number;
  inserted: number;
  /** Candidates the strategy could not derive a key for. These are invisible in the
   *  library, so a non-zero value means content was dropped, not deduplicated. */
  unkeyed: number;
  /** Sibling files resolving to a book already handled in this run. Expected and harmless. */
  deduped: number;
  /** Matched only by the looser author plus title key, not by path. */
  matchedByFallback: number;
  /** Rows dropped because a warehouse sync landed the same book mid-walk. */
  reconciled: number;
  unreadableDirs: number;
  symlinksSkipped: number;
}

export interface WalkStats {
  unreadableDirs: number;
  symlinksSkipped: number;
}
