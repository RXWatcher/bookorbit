import { AudiobookMatchStrategy } from './audiobook-match.strategy';

const PREFIX = '/media/zd-storage-ceph-books/audiobooks/Audiobooks_English/';

describe('AudiobookMatchStrategy', () => {
  const strategy = new AudiobookMatchStrategy(PREFIX);

  it('keys catalogue rows on the storage_key directory with the prefix removed', () => {
    expect(
      strategy.catalogKey({
        remoteId: 'abc',
        title: 'Lightseekers',
        rawPayload: {
          files: [{ storage_key: `${PREFIX}Femi Kayode/Lightseekers (2021)/Femi Kayode - Lightseekers (2021).m4b` }],
        },
      }),
    ).toBe('Femi Kayode/Lightseekers (2021)');
  });

  it('returns null when storage_key sits outside the configured prefix', () => {
    expect(
      strategy.catalogKey({
        remoteId: 'abc',
        title: 'Other',
        rawPayload: { files: [{ storage_key: '/media/somewhere-else/Author/Book/file.m4b' }] },
      }),
    ).toBeNull();
  });

  it('returns null when there are no files', () => {
    expect(strategy.catalogKey({ remoteId: 'a', title: 't', rawPayload: { files: [] } })).toBeNull();
    expect(strategy.catalogKey({ remoteId: 'a', title: 't', rawPayload: {} })).toBeNull();
  });

  it('keys disk candidates on the book directory', () => {
    expect(
      strategy.diskKey({
        absolutePath: '/mnt/ab/Femi Kayode/Lightseekers (2021)/file.m4b',
        relativePath: 'Femi Kayode/Lightseekers (2021)/file.m4b',
        fileName: 'file.m4b',
      }),
    ).toBe('Femi Kayode/Lightseekers (2021)');
  });

  it('produces the same key from both sides for the same book', () => {
    const fromCatalog = strategy.catalogKey({
      remoteId: 'abc',
      title: 'Lightseekers',
      rawPayload: { files: [{ storage_key: `${PREFIX}Femi Kayode/Lightseekers (2021)/x.m4b` }] },
    });
    const fromDisk = strategy.diskKey({
      absolutePath: '/mnt/ab/Femi Kayode/Lightseekers (2021)/x.m4b',
      relativePath: 'Femi Kayode/Lightseekers (2021)/x.m4b',
      fileName: 'x.m4b',
    });

    expect(fromCatalog).toBe(fromDisk);
  });

  it('derives a title from the book directory', () => {
    expect(
      strategy.titleFor({
        absolutePath: '/mnt/ab/Femi Kayode/Lightseekers (2021)/file.m4b',
        relativePath: 'Femi Kayode/Lightseekers (2021)/file.m4b',
        fileName: 'file.m4b',
      }),
    ).toBe('Lightseekers (2021)');
  });
});

describe('AudiobookMatchStrategy fallback matching', () => {
  const strategy = new AudiobookMatchStrategy(PREFIX);

  it('matches the same book filed under a series prefixed directory upstream', () => {
    // The real case: the warehouse had "Hierarchy 1 - The Will of the Many (2023)" while the
    // disk had "The Will of the Many (2023)", so the path keys disagreed and the book was
    // inserted a second time as local.
    const fromCatalog = strategy.fallbackCatalogKey({
      remoteId: 'r1',
      title: 'The Will of the Many',
      rawPayload: { files: [{ storage_key: `${PREFIX}James Islington/Hierarchy 1 - The Will of the Many (2023)/a.m4b` }] },
    });
    const fromDisk = strategy.fallbackDiskKey({
      absolutePath: '/mnt/ab/James Islington/The Will of the Many (2023)/a.m4b',
      relativePath: 'James Islington/The Will of the Many (2023)/a.m4b',
      fileName: 'a.m4b',
    });

    expect(fromCatalog).not.toBeNull();
    expect(fromCatalog).toBe(fromDisk);
  });

  it('does not collapse different books by the same author', () => {
    const one = strategy.fallbackDiskKey({
      absolutePath: '/mnt/ab/James Islington/The Will of the Many (2023)/a.m4b',
      relativePath: 'James Islington/The Will of the Many (2023)/a.m4b',
      fileName: 'a.m4b',
    });
    const two = strategy.fallbackDiskKey({
      absolutePath: '/mnt/ab/James Islington/The Shadow of What Was Lost (2014)/a.m4b',
      relativePath: 'James Islington/The Shadow of What Was Lost (2014)/a.m4b',
      fileName: 'a.m4b',
    });

    expect(one).not.toBe(two);
  });

  it('does not collapse the same title by different authors', () => {
    const one = strategy.fallbackDiskKey({
      absolutePath: '/mnt/ab/Author One/Shared Title (2020)/a.m4b',
      relativePath: 'Author One/Shared Title (2020)/a.m4b',
      fileName: 'a.m4b',
    });
    const two = strategy.fallbackDiskKey({
      absolutePath: '/mnt/ab/Author Two/Shared Title (2020)/a.m4b',
      relativePath: 'Author Two/Shared Title (2020)/a.m4b',
      fileName: 'a.m4b',
    });

    expect(one).not.toBe(two);
  });

  it('ignores punctuation and case differences', () => {
    const one = strategy.fallbackDiskKey({
      absolutePath: '/mnt/ab/A B/The Wind-Up Bird Chronicle (1997)/a.m4b',
      relativePath: 'A B/The Wind-Up Bird Chronicle (1997)/a.m4b',
      fileName: 'a.m4b',
    });
    const two = strategy.fallbackDiskKey({
      absolutePath: '/mnt/ab/A B/the wind up bird chronicle/a.m4b',
      relativePath: 'A B/the wind up bird chronicle/a.m4b',
      fileName: 'a.m4b',
    });

    expect(one).toBe(two);
  });
});
