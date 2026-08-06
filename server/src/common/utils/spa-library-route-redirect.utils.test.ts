import { describe, expect, it } from 'vitest';

import { canonicalizeSpaLibraryRouteUrl } from './spa-library-route-redirect.utils';

describe('canonicalizeSpaLibraryRouteUrl', () => {
  it('redirects legacy source-backed library path ids to friendly aliases', () => {
    expect(canonicalizeSpaLibraryRouteUrl('/library/-1?view=grid')).toBe('/library/ebooks?view=grid');
    expect(canonicalizeSpaLibraryRouteUrl('/library/-1?view=grid#top')).toBe('/library/ebooks?view=grid#top');
    expect(canonicalizeSpaLibraryRouteUrl('/library/-2/items/audio%201%2Fside%20A')).toBe('/library/audiobooks/items/audio%201%2Fside%20A');
    expect(canonicalizeSpaLibraryRouteUrl('/read/library/-2/items/audio-1?format=mp3')).toBe('/read/library/audiobooks/items/audio-1?format=mp3');
    expect(canonicalizeSpaLibraryRouteUrl('/library/-3?view=grid')).toBe('/library/comics?view=grid');
    expect(canonicalizeSpaLibraryRouteUrl('/read/library/-3/items/comic-1?format=cbz')).toBe('/read/library/comics/items/comic-1?format=cbz');
  });

  it('redirects legacy source-backed library query filters to friendly aliases', () => {
    expect(canonicalizeSpaLibraryRouteUrl('/series?libraryId=-2&sort=name')).toBe('/series?libraryId=audiobooks&sort=name');
    expect(canonicalizeSpaLibraryRouteUrl('/authors?libraryId=-1')).toBe('/authors?libraryId=ebooks');
    expect(canonicalizeSpaLibraryRouteUrl('/series?libraryId=-3&sort=name')).toBe('/series?libraryId=comics&sort=name');
    expect(canonicalizeSpaLibraryRouteUrl('/authors?libraryId=comic')).toBe('/authors?libraryId=comics');
  });

  it('leaves canonical and unrelated urls alone', () => {
    expect(canonicalizeSpaLibraryRouteUrl('/library/ebooks?view=grid')).toBeNull();
    expect(canonicalizeSpaLibraryRouteUrl('/library/7/items/42')).toBeNull();
    expect(canonicalizeSpaLibraryRouteUrl('/api/v1/libraries')).toBeNull();
    expect(canonicalizeSpaLibraryRouteUrl('library/-1')).toBeNull();
  });
});
