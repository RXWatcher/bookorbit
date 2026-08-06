import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID } from '@bookorbit/types';
import type { Library } from '@bookorbit/types';

import { encodeAbsLibraryId } from './abs-id-codec';

export type AbsLibraryMediaType = 'book' | 'audiobook' | 'comic';

export interface AbsLibrarySettings {
  coverAspectRatio: Library['coverAspectRatio'];
}

export interface AbsLibrary {
  id: string;
  name: string;
  mediaType: AbsLibraryMediaType;
  settings: AbsLibrarySettings;
}

export function mapAbsLibrary(library: Pick<Library, 'id' | 'name' | 'coverAspectRatio'>): AbsLibrary {
  return {
    id: encodeAbsLibraryId(library.id),
    name: library.name,
    mediaType: library.id === CLOUD_AUDIO_LIBRARY_ID ? 'audiobook' : library.id === CLOUD_COMIC_LIBRARY_ID ? 'comic' : 'book',
    settings: {
      coverAspectRatio: library.coverAspectRatio,
    },
  };
}
