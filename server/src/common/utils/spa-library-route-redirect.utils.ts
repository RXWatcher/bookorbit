import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types';

function sourceBackedAlias(value: string): 'ebooks' | 'audiobooks' | 'comics' | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === String(CLOUD_EBOOK_LIBRARY_ID) || normalized === 'ebook' || normalized === 'ebooks') return 'ebooks';
  if (normalized === String(CLOUD_AUDIO_LIBRARY_ID) || normalized === 'audio' || normalized === 'audiobook' || normalized === 'audiobooks') {
    return 'audiobooks';
  }
  if (normalized === String(CLOUD_COMIC_LIBRARY_ID) || normalized === 'comic' || normalized === 'comics') return 'comics';
  return null;
}

export function canonicalizeSpaLibraryRouteUrl(value: string): string | null {
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/api')) return null;

  const url = new URL(value, 'http://bookorbit.local');
  const pathSegments = url.pathname.split('/');
  let changed = false;

  for (let index = 1; index < pathSegments.length; index += 1) {
    if (pathSegments[index - 1] !== 'library') continue;
    const canonical = sourceBackedAlias(pathSegments[index] ?? '');
    if (canonical && pathSegments[index] !== canonical) {
      pathSegments[index] = canonical;
      changed = true;
    }
  }

  const libraryId = url.searchParams.get('libraryId');
  if (libraryId !== null) {
    const canonical = sourceBackedAlias(libraryId);
    if (canonical && libraryId !== canonical) {
      url.searchParams.set('libraryId', canonical);
      changed = true;
    }
  }

  if (!changed) return null;
  return `${pathSegments.join('/')}${url.search}${url.hash}`;
}
