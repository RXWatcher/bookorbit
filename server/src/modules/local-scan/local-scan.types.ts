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
  /** Rows dropped because a warehouse sync landed the same book mid-walk. */
  reconciled: number;
  unreadableDirs: number;
  symlinksSkipped: number;
}

export interface WalkStats {
  unreadableDirs: number;
  symlinksSkipped: number;
}
