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
