import type { WarehouseMediaType } from '@bookorbit/types';

import type { CatalogKeyRow, LocalCandidate, LocalMatchStrategy } from '../local-scan.types';

export class AudiobookMatchStrategy implements LocalMatchStrategy {
  readonly mediaType: WarehouseMediaType = 'audiobook';

  constructor(private readonly remotePrefix: string) {}

  catalogKey(row: CatalogKeyRow): string | null {
    const files = row.rawPayload.files;
    if (!Array.isArray(files)) return null;

    for (const file of files) {
      const storageKey = (file as { storage_key?: unknown }).storage_key;
      if (typeof storageKey !== 'string') continue;
      if (!storageKey.startsWith(this.remotePrefix)) continue;

      const relative = storageKey.slice(this.remotePrefix.length);
      const segments = relative.split('/');
      if (segments.length < 2) continue;
      return segments.slice(0, segments.length - 1).join('/');
    }

    return null;
  }

  diskKey(candidate: LocalCandidate): string | null {
    const relative = candidate.relativePath.replace(/^\/+/, '');
    const segments = relative.split('/');
    if (segments.length < 2) return null;
    return segments.slice(0, segments.length - 1).join('/');
  }

  titleFor(candidate: LocalCandidate): string {
    const key = this.diskKey(candidate);
    if (!key) return candidate.fileName;
    const segments = key.split('/');
    return segments[segments.length - 1] ?? candidate.fileName;
  }
}
