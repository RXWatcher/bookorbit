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
  skipped: number;
}
