import type { WarehouseMediaType } from '@bookorbit/types';

import type { CatalogKeyRow, LocalCandidate, LocalMatchStrategy } from '../local-scan.types';

const CALIBRE_INTERNAL_PREFIXES = ['.caltrash/', '.calnotes/'];
const TRAILING_CALIBRE_ID = / \(\d+\)$/;

export class EbookMatchStrategy implements LocalMatchStrategy {
  readonly mediaType: WarehouseMediaType = 'ebook';

  catalogKey(row: CatalogKeyRow): string | null {
    const value = row.rawPayload.calibre_path;
    if (typeof value !== 'string' || value.length === 0) return null;
    return value.replace(/^\/+/, '');
  }

  diskKey(candidate: LocalCandidate): string | null {
    const relative = candidate.relativePath.replace(/^\/+/, '');
    if (CALIBRE_INTERNAL_PREFIXES.some((prefix) => relative.startsWith(prefix))) return null;

    const segments = relative.split('/');
    if (segments.length < 3) return null;
    return segments.slice(0, 2).join('/');
  }

  titleFor(candidate: LocalCandidate): string {
    const key = this.diskKey(candidate);
    if (!key) return candidate.fileName;
    const bookDirectory = key.split('/')[1] ?? candidate.fileName;
    return bookDirectory.replace(TRAILING_CALIBRE_ID, '');
  }
}
