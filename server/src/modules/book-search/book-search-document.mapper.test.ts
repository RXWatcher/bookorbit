import {
  catalogDocumentId,
  mapCatalogRowToDocument,
  mapNativeBookToDocument,
  nativeDocumentId,
  parseSearchDocumentId,
} from './book-search-document.mapper';

const CATALOG_ROW = {
  mediaType: 'audiobook',
  remoteId: 'abc-123',
  title: 'The Will of the Many',
  sortTitle: 'Will of the Many, The',
  authors: ['James Islington'],
  narrators: ['Euan Morton'],
  series: 'Hierarchy',
  seriesIndex: 1,
  publisher: 'Saga Press',
  language: 'english',
  tags: ['fantasy'],
  genres: ['Fiction'],
  identifiers: { isbn: '9781250767000', asin: 'B0BS3K9T2Z' },
  format: 'm4b',
  publishedYear: 2023,
  hasCover: true,
  durationSeconds: 91234,
  fileSizeBytes: 512000,
  syncedAt: new Date('2026-08-01T00:00:00Z'),
};

describe('book search document mapper', () => {
  it('namespaces catalogue and native ids so they cannot collide', () => {
    expect(catalogDocumentId('audiobook', 'abc-123')).toBe('catalog_audiobook_YWJjLTEyMw');
    expect(nativeDocumentId(42)).toBe('native_42');
  });

  it('maps a catalogue row onto the document shape', () => {
    const doc = mapCatalogRowToDocument(CATALOG_ROW);

    expect(doc.id).toBe('catalog_audiobook_YWJjLTEyMw');
    expect(doc.source).toBe('catalog');
    expect(doc.title).toBe('The Will of the Many');
    expect(doc.authors).toEqual(['James Islington']);
    expect(doc.narrators).toEqual(['Euan Morton']);
    expect(doc.libraryId).toBeNull();
  });

  it('flattens identifiers to values, because the keys are not searched', () => {
    expect(mapCatalogRowToDocument(CATALOG_ROW).identifiers).toEqual(['9781250767000', 'B0BS3K9T2Z']);
  });

  it('tolerates a sparse row rather than throwing', () => {
    const doc = mapCatalogRowToDocument({
      mediaType: 'ebook',
      remoteId: 'x',
      title: 'Bare',
      sortTitle: null,
      authors: [],
      narrators: [],
      series: null,
      seriesIndex: null,
      publisher: null,
      language: null,
      tags: [],
      genres: [],
      identifiers: {},
      format: null,
      publishedYear: null,
      hasCover: false,
      durationSeconds: null,
      fileSizeBytes: null,
      syncedAt: null,
    });

    expect(doc.title).toBe('Bare');
    expect(doc.identifiers).toEqual([]);
    expect(doc.addedAt).toBeNull();
  });

  it('maps a native book, carrying its library id', () => {
    const doc = mapNativeBookToDocument({
      id: 42,
      libraryId: 7,
      title: 'Local Book',
      sortTitle: null,
      authors: ['Someone'],
      series: null,
      seriesIndex: null,
      publisher: null,
      language: 'en',
      format: 'epub',
      publishedYear: 2001,
      hasCover: true,
      fileSizeBytes: 100,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect(doc.id).toBe('native_42');
    expect(doc.source).toBe('native');
    expect(doc.mediaType).toBe('ebook');
    expect(doc.libraryId).toBe(7);
    expect(doc.narrators).toEqual([]);
  });

  describe('id round trip', () => {
    const REALISTIC_REMOTE_IDS = [
      ['a uuid', '3c6f2f0e-9b1a-4e2a-8c3d-1a2b3c4d5e6f'],
      ['a local scan hash, which already carries a colon of its own', 'local:fc410bea628cd8ad20098c44b66124deb795d3e42a165226dfa6043c30d90f51'],
      ['a remote id containing a hyphen', 'has-a-hyphen'],
      ['a remote id containing an underscore', 'has_an_underscore'],
      ['a remote id containing a colon', 'has:a:colon'],
    ] as const;

    it.each(REALISTIC_REMOTE_IDS)('round trips a catalogue id for %s', (_label, remoteId) => {
      const id = catalogDocumentId('audiobook', remoteId);
      const parsed = parseSearchDocumentId(id);

      expect(parsed).toEqual({ source: 'catalog', mediaType: 'audiobook', remoteId });
    });

    it('round trips a native book id', () => {
      const id = nativeDocumentId(42);
      const parsed = parseSearchDocumentId(id);

      expect(parsed).toEqual({ source: 'native', bookId: 42 });
    });
  });

  describe('id validity for meilisearch', () => {
    const VALID_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
    const MAX_ID_BYTES = 511;

    it('produces the real value that meilisearch rejected in production', () => {
      const id = catalogDocumentId('audiobook', 'local:fc410bea628cd8ad20098c44b66124deb795d3e42a165226dfa6043c30d90f51');

      expect(id).toMatch(VALID_ID_PATTERN);
      expect(Buffer.byteLength(id, 'utf8')).toBeLessThanOrEqual(MAX_ID_BYTES);
    });

    it.each([
      ['a uuid', '3c6f2f0e-9b1a-4e2a-8c3d-1a2b3c4d5e6f'],
      ['a local scan hash', 'local:fc410bea628cd8ad20098c44b66124deb795d3e42a165226dfa6043c30d90f51'],
      ['a hyphen', 'has-a-hyphen'],
      ['an underscore', 'has_an_underscore'],
      ['a colon', 'has:a:colon'],
    ] as const)('keeps a catalogue id valid for a remote id with %s', (_label, remoteId) => {
      const id = catalogDocumentId('audiobook', remoteId);

      expect(id).toMatch(VALID_ID_PATTERN);
      expect(Buffer.byteLength(id, 'utf8')).toBeLessThanOrEqual(MAX_ID_BYTES);
    });

    it('keeps a native id valid', () => {
      const id = nativeDocumentId(9001);

      expect(id).toMatch(VALID_ID_PATTERN);
      expect(Buffer.byteLength(id, 'utf8')).toBeLessThanOrEqual(MAX_ID_BYTES);
    });
  });

  it('never collides two remote ids that a naive sanitiser would flatten to the same value', () => {
    const stripped = catalogDocumentId('audiobook', 'local:abc');
    const hyphenated = catalogDocumentId('audiobook', 'local-abc');

    expect(stripped).not.toBe(hyphenated);
    expect(parseSearchDocumentId(stripped)).toEqual({ source: 'catalog', mediaType: 'audiobook', remoteId: 'local:abc' });
    expect(parseSearchDocumentId(hyphenated)).toEqual({ source: 'catalog', mediaType: 'audiobook', remoteId: 'local-abc' });
  });
});
