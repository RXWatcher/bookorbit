import { createHash } from 'node:crypto';

import type { WarehouseCatalogAuthorRef, WarehouseCatalogSeriesRef } from '@bookorbit/types';

export function catalogAuthorRefs(value: unknown): WarehouseCatalogAuthorRef[] {
  const seen = new Set<string>();
  const refs: WarehouseCatalogAuthorRef[] = [];

  for (const name of safeStringArray(value).flatMap(splitCatalogAuthorValue)) {
    const displayName = catalogAuthorDisplayName(name);
    const key = displayName.toLowerCase();
    if (!displayName || seen.has(key)) continue;
    seen.add(key);
    refs.push({
      id: catalogAuthorVirtualId(displayName),
      name: displayName,
    });
  }

  return refs;
}

export function catalogSeriesRef(value: unknown): WarehouseCatalogSeriesRef | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name) return null;
  return {
    id: catalogSeriesVirtualId(name),
    name,
  };
}

export function catalogAuthorCanonicalName(value: string): string {
  return catalogAuthorDisplayName(value).toLowerCase();
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function splitCatalogAuthorValue(value: string): string[] {
  const normalized = value.trim();
  if (!normalized) return [];

  const delimiterSplit = normalized
    .split(/\s*(?:;|\s+&\s+|\s+and\s+)\s*/i)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const candidates = delimiterSplit.length > 1 ? delimiterSplit : [normalized];

  return candidates.flatMap((entry) => splitCommaCatalogAuthorValue(entry));
}

function splitCommaCatalogAuthorValue(value: string): string[] {
  const parts = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (parts.length <= 1) return [value];
  if (parts.length === 2 && looksLikeLastFirstCatalogAuthor(parts[0], parts[1])) return [value];
  return parts;
}

function catalogAuthorDisplayName(value: string): string {
  const trimmed = value.trim();
  const parts = trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (parts.length === 2 && looksLikeLastFirstCatalogAuthor(parts[0], parts[1])) {
    return `${parts[1]} ${parts[0]}`.trim();
  }

  return trimmed;
}

function looksLikeLastFirstCatalogAuthor(last: string, first: string): boolean {
  return plausibleCatalogNamePart(last, 2) && plausibleCatalogNamePart(first, 3) && !last.includes('.');
}

function plausibleCatalogNamePart(value: string, maxWords: number): boolean {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= maxWords && words.every((word) => /^[\p{L}.'-]+$/u.test(word));
}

function catalogAuthorVirtualId(displayName: string): number {
  const canonicalName = displayName.trim().toLowerCase();
  const hash = createHash('md5').update(canonicalName).digest('hex').slice(0, 13);
  return Number(-(BigInt(`0x${hash}`) + 1000n));
}

function catalogSeriesVirtualId(name: string): number {
  let hash = 0;
  const normalized = name.trim().toLowerCase();
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) | 0;
  }
  return -Math.max(1, Math.abs(hash));
}
