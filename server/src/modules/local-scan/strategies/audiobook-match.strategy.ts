import type { WarehouseMediaType } from '@bookorbit/types';

import type { CatalogKeyRow, LocalCandidate, LocalMatchStrategy } from '../local-scan.types';

/** Calibre style decorations that differ between the two sides for the same book. */
const SERIES_PREFIX = /^.*?\s+\d+(?:\.\d+)?\s+-\s+/;
const TRAILING_YEAR = /\s*\((?:19|20)\d{2}\)\s*$/;
const NOISE = /[^a-z0-9]+/g;

/** Author plus title, stripped of series prefix, year and punctuation. */
function looseKey(author: string, title: string): string | null {
  const normalisedTitle = title.replace(TRAILING_YEAR, '').replace(SERIES_PREFIX, '').toLowerCase().replace(NOISE, ' ').trim();
  const normalisedAuthor = author.toLowerCase().replace(NOISE, ' ').trim();
  if (!normalisedTitle || !normalisedAuthor) return null;
  return `${normalisedAuthor}|${normalisedTitle}`;
}

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

  fallbackCatalogKey(row: CatalogKeyRow): string | null {
    const key = this.catalogKey(row);
    if (!key) return null;
    const segments = key.split('/');
    if (segments.length < 2) return null;
    return looseKey(segments[0], segments[segments.length - 1]);
  }

  fallbackDiskKey(candidate: LocalCandidate): string | null {
    const key = this.diskKey(candidate);
    if (!key) return null;
    const segments = key.split('/');
    if (segments.length < 2) return null;
    return looseKey(segments[0], segments[segments.length - 1]);
  }

  titleFor(candidate: LocalCandidate): string {
    const key = this.diskKey(candidate);
    if (!key) return candidate.fileName;
    const segments = key.split('/');
    return segments[segments.length - 1] ?? candidate.fileName;
  }
}
