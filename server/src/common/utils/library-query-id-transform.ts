import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types';

export function transformLibraryIdsQueryValue(value: unknown): number[] | undefined {
  if (value == null) return undefined;
  const values = Array.isArray(value) ? value : [value];
  return values.map(transformLibraryIdQueryValue).filter((id): id is number => id !== undefined);
}

export function transformLibraryIdQueryValue(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' && typeof value !== 'boolean') return Number.NaN;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'ebook' || normalized === 'ebooks') return CLOUD_EBOOK_LIBRARY_ID;
  if (normalized === 'audio' || normalized === 'audiobook' || normalized === 'audiobooks') return CLOUD_AUDIO_LIBRARY_ID;
  if (normalized === 'comic' || normalized === 'comics') return CLOUD_COMIC_LIBRARY_ID;
  return Number(value);
}
