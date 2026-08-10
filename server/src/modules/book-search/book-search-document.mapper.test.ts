import { catalogDocumentId, mapCatalogRowToDocument, mapNativeBookToDocument, nativeDocumentId } from './book-search-document.mapper';

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
    expect(catalogDocumentId('audiobook', 'abc-123')).toBe('catalog:audiobook:abc-123');
    expect(nativeDocumentId(42)).toBe('native:42');
  });

  it('maps a catalogue row onto the document shape', () => {
    const doc = mapCatalogRowToDocument(CATALOG_ROW);

    expect(doc.id).toBe('catalog:audiobook:abc-123');
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

    expect(doc.id).toBe('native:42');
    expect(doc.source).toBe('native');
    expect(doc.mediaType).toBe('ebook');
    expect(doc.libraryId).toBe(7);
    expect(doc.narrators).toEqual([]);
  });
});
