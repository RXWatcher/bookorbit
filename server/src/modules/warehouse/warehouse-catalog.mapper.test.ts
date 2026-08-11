import {
  mapWarehouseAudiobookCatalogItemRow,
  mapWarehouseAudiobookDetail,
  mapWarehouseComicCatalogItemRow,
  mapWarehouseEbookCatalogItemRow,
} from './warehouse-catalog.mapper';

describe('mapWarehouseEbookCatalogItemRow', () => {
  const syncedAt = new Date('2026-06-02T12:34:56.000Z');

  it('maps author string to authors array', () => {
    const row = mapWarehouseEbookCatalogItemRow(
      {
        id: 'book-1',
        title: 'The Test Book',
        author: 'Ada Writer',
      },
      syncedAt,
    );

    expect(row).toMatchObject({
      mediaType: 'ebook',
      remoteId: 'book-1',
      title: 'The Test Book',
      sortTitle: 'The Test Book',
      authors: ['Ada Writer'],
      syncedAt,
    });
  });

  it('maps scalar authors to authors array', () => {
    const row = mapWarehouseEbookCatalogItemRow(
      {
        id: 'book-1b',
        title: 'The Scalar Authors Book',
        authors: 'Ada Writer',
      },
      syncedAt,
    );

    expect(row).toMatchObject({
      mediaType: 'ebook',
      remoteId: 'book-1b',
      title: 'The Scalar Authors Book',
      authors: ['Ada Writer'],
      syncedAt,
    });
  });

  it('splits combined authors and dedupes normalized names', () => {
    const row = mapWarehouseEbookCatalogItemRow(
      {
        id: 'book-combined-authors',
        title: 'The Combined Authors Book',
        authors: ['Brian K. Vaughan, Fiona Staples', 'Brian K. Vaughan', 'Le Guin, Ursula'],
      },
      syncedAt,
    );

    expect(row.authors).toEqual(['Brian K. Vaughan', 'Fiona Staples', 'Ursula Le Guin']);
  });

  it('maps hasCover, identifiers, language, format, and series', () => {
    const row = mapWarehouseEbookCatalogItemRow(
      {
        id: 'book-2',
        title: 'Series Book',
        authors: ['Ada Writer', 'Bea Writer'],
        series: 'Catalog Chronicles',
        language: 'en',
        publisher: 'Orbit Press',
        format: 'EPUB',
        has_cover: true,
        isbn: '9780000000001',
        isbn13: '9780000000001',
        isbn10: '0000000000',
      },
      syncedAt,
    );

    expect(row).toMatchObject({
      mediaType: 'ebook',
      remoteId: 'book-2',
      title: 'Series Book',
      authors: ['Ada Writer', 'Bea Writer'],
      series: 'Catalog Chronicles',
      language: 'en',
      publisher: 'Orbit Press',
      format: 'EPUB',
      hasCover: true,
      identifiers: {
        isbn: '9780000000001',
        isbn13: '9780000000001',
        isbn10: '0000000000',
      },
    });
  });

  it('maps ebook file_format as the catalog format', () => {
    const row = mapWarehouseEbookCatalogItemRow(
      {
        id: 'book-file-format',
        title: 'Snake Case Format',
        author: 'Ada Writer',
        file_format: 'epub',
      },
      syncedAt,
    );

    expect(row).toMatchObject({
      mediaType: 'ebook',
      remoteId: 'book-file-format',
      title: 'Snake Case Format',
      format: 'epub',
    });
  });

  it('maps ebook series order from common payload fields', () => {
    const row = mapWarehouseEbookCatalogItemRow(
      {
        id: 'book-series-index',
        title: 'Indexed Series Book',
        series: 'Catalog Chronicles',
        series_index: '2.5',
      },
      syncedAt,
    );

    expect(row.seriesIndex).toBe(2.5);
  });

  it('maps ebook series title from warehouse snake_case payloads', () => {
    const row = mapWarehouseEbookCatalogItemRow(
      {
        id: 'book-series-name',
        title: 'Snake Case Series Book',
        series_name: 'Catalog Chronicles',
        series_index: '3',
      },
      syncedAt,
    );

    expect(row.series).toBe('Catalog Chronicles');
    expect(row.seriesIndex).toBe(3);
  });

  it('maps ebook genres and tags from scalar or array payload fields', () => {
    const row = mapWarehouseEbookCatalogItemRow(
      {
        id: 'book-genres',
        title: 'Genre Book',
        genre: 'Science Fiction',
        tags: ['space opera', ' award winner ', ''],
      },
      syncedAt,
    );

    expect(row.genres).toEqual(['Science Fiction']);
    expect(row.tags).toEqual(['space opera', 'award winner']);
  });

  it('tolerates missing optional fields', () => {
    const row = mapWarehouseEbookCatalogItemRow(
      {
        id: 99,
      },
      syncedAt,
    );

    expect(row).toEqual({
      mediaType: 'ebook',
      remoteId: '99',
      title: 'Untitled',
      subtitle: null,
      sortTitle: 'Untitled',
      authors: [],
      narrators: [],
      series: null,
      seriesIndex: null,
      genres: [],
      tags: [],
      language: null,
      publisher: null,
      identifiers: {},
      format: null,
      fileSizeBytes: null,
      publishedYear: null,
      hasCover: false,
      upstreamCreatedAt: null,
      upstreamUpdatedAt: null,
      rawPayload: { id: 99 },
      syncedAt,
    });
  });

  it('preserves raw payload', () => {
    const payload = {
      id: 'book-3',
      title: 'Raw Payload Book',
      extra: {
        nested: true,
      },
    };

    const row = mapWarehouseEbookCatalogItemRow(payload, syncedAt);

    expect(row.rawPayload).toBe(payload);
  });
});

describe('mapWarehouseComicCatalogItemRow', () => {
  // The comic list payload has no cover field, so coverFlag() reported false on every
  // comic and the grid rendered placeholders over perfectly good page images.
  it('reports a cover even though the payload carries no cover field', () => {
    const row = mapWarehouseComicCatalogItemRow({ id: 'c1', title: 'T' } as never, new Date('2026-01-01T00:00:00Z'));
    expect(row.hasCover).toBe(true);
  });

  // A comic payload carries seriesId but no series name. Without the lookup every comic
  // stores a null series, and the library becomes a flat list of story titles.
  it('resolves the series name from seriesId', () => {
    const row = mapWarehouseComicCatalogItemRow(
      { id: 'c1', title: 'Trigon-Ometry', seriesId: 's-nightwing', issueNumber: '15' } as never,
      new Date('2026-01-01T00:00:00Z'),
      new Map([['s-nightwing', 'Nightwing']]),
    );
    expect(row.series).toBe('Nightwing');
    expect(row.seriesIndex).toBe(15);
  });

  it('accepts the snake case series_id spelling', () => {
    const row = mapWarehouseComicCatalogItemRow(
      { id: 'c1', title: 'T', series_id: 's-batman' } as never,
      new Date('2026-01-01T00:00:00Z'),
      new Map([['s-batman', 'Batman']]),
    );
    expect(row.series).toBe('Batman');
  });

  it('prefers an explicit series name over the lookup', () => {
    const row = mapWarehouseComicCatalogItemRow(
      { id: 'c1', title: 'T', series: 'Explicit', seriesId: 's-batman' } as never,
      new Date('2026-01-01T00:00:00Z'),
      new Map([['s-batman', 'Batman']]),
    );
    expect(row.series).toBe('Explicit');
  });

  it('leaves series null when the map is missing or has no entry', () => {
    const payload = { id: 'c1', title: 'T', seriesId: 's-unknown' } as never;
    expect(mapWarehouseComicCatalogItemRow(payload, new Date()).series).toBeNull();
    expect(mapWarehouseComicCatalogItemRow(payload, new Date(), new Map()).series).toBeNull();
  });

  const syncedAt = new Date('2026-06-02T12:34:56.000Z');

  it('maps comic summaries into source-backed catalog rows without storage paths', () => {
    const row = mapWarehouseComicCatalogItemRow(
      {
        id: 'comic-1',
        title: 'Saga #1',
        author: 'Brian K. Vaughan',
        authors: ['Brian K. Vaughan', 'Fiona Staples'],
        series: 'Saga',
        seriesId: 'series-1',
        issueNumber: '1',
        year: 2012,
        publisher: 'Image',
        format: 'CBZ',
        storage_path: 'ceph://bucket/private.cbz',
        media_path: '/media/private/saga.cbz',
      },
      syncedAt,
    );

    expect(row).toMatchObject({
      mediaType: 'comic',
      remoteId: 'comic-1',
      title: 'Saga #1',
      authors: ['Brian K. Vaughan', 'Fiona Staples'],
      series: 'Saga',
      publisher: 'Image',
      format: 'CBZ',
      hasCover: true,
      syncedAt,
    });
    expect(row.identifiers).toEqual({
      seriesId: 'series-1',
      issueNumber: '1',
      year: '2012',
    });
    expect(JSON.stringify(row)).not.toMatch(/ceph:\/\/|\/media\//);
  });
});

describe('mapWarehouseAudiobookCatalogItemRow', () => {
  const syncedAt = new Date('2026-06-02T12:34:56.000Z');

  it('maps scalar authors and narrators to arrays', () => {
    const row = mapWarehouseAudiobookCatalogItemRow(
      {
        id: 'audio-1',
        title: 'The Test Audiobook',
        author: 'Ada Writer',
        narrator: 'Case Reader',
      },
      syncedAt,
    );

    expect(row).toMatchObject({
      mediaType: 'audiobook',
      remoteId: 'audio-1',
      title: 'The Test Audiobook',
      sortTitle: 'The Test Audiobook',
      authors: ['Ada Writer'],
      narrators: ['Case Reader'],
      syncedAt,
    });
  });

  it('maps array authors and narrators', () => {
    const row = mapWarehouseAudiobookCatalogItemRow(
      {
        id: 'audio-2',
        title: 'Array Cast',
        authors: ['Ada Writer', 'Bea Writer'],
        narrators: ['Case Reader', 'Dee Voice'],
      },
      syncedAt,
    );

    expect(row.authors).toEqual(['Ada Writer', 'Bea Writer']);
    expect(row.narrators).toEqual(['Case Reader', 'Dee Voice']);
  });

  it.each([
    ['duration', { duration: 3600 }],
    ['durationSeconds', { durationSeconds: 7200 }],
    ['duration_seconds', { duration_seconds: 1800 }],
  ])('maps nonnegative duration from %s', (_label, durationFields) => {
    const row = mapWarehouseAudiobookCatalogItemRow(
      {
        id: 'audio-duration',
        title: 'Timed Audio',
        ...durationFields,
      },
      syncedAt,
    );

    expect(row.durationSeconds).toBe(Object.values(durationFields)[0]);
  });

  it('maps numeric-string catalog duration to an integer', () => {
    const row = mapWarehouseAudiobookCatalogItemRow(
      {
        id: 'audio-duration-string',
        title: 'Timed Audio',
        duration: '3600',
      },
      syncedAt,
    );

    expect(row.durationSeconds).toBe(3600);
  });

  it('maps negative or invalid duration to null', () => {
    expect(
      mapWarehouseAudiobookCatalogItemRow(
        {
          id: 'negative-duration',
          title: 'Broken Timing',
          duration: -1,
        },
        syncedAt,
      ).durationSeconds,
    ).toBeNull();

    expect(
      mapWarehouseAudiobookCatalogItemRow(
        {
          id: 'invalid-duration',
          title: 'Broken Timing',
          durationSeconds: Number.NaN,
        },
        syncedAt,
      ).durationSeconds,
    ).toBeNull();

    expect(
      mapWarehouseAudiobookCatalogItemRow(
        {
          id: 'negative-string-duration',
          title: 'Broken Timing',
          duration_seconds: '-1',
        },
        syncedAt,
      ).durationSeconds,
    ).toBeNull();

    expect(
      mapWarehouseAudiobookCatalogItemRow(
        {
          id: 'invalid-string-duration',
          title: 'Broken Timing',
          duration: 'forever',
        },
        syncedAt,
      ).durationSeconds,
    ).toBeNull();
  });

  it('maps catalog metadata and identifiers from ISBN, ASIN, and source ids', () => {
    const row = mapWarehouseAudiobookCatalogItemRow(
      {
        id: 99,
        title: '',
        series: 'Catalog Chronicles',
        language: 'en',
        publisher: 'Orbit Press',
        format: 'M4B',
        cover_url: 'https://catalog.example.test/covers/audio-99.jpg',
        isbn: '9780000000001',
        isbn13: '9780000000002',
        asin: 'B000TEST',
        sourceId: 'src-camel',
        source_id: 'src-snake',
      },
      syncedAt,
    );

    expect(row).toMatchObject({
      mediaType: 'audiobook',
      remoteId: '99',
      title: 'Untitled',
      series: 'Catalog Chronicles',
      language: 'en',
      publisher: 'Orbit Press',
      format: 'M4B',
      hasCover: true,
      identifiers: {
        isbn: '9780000000001',
        isbn13: '9780000000002',
        asin: 'B000TEST',
        sourceId: 'src-camel',
        source_id: 'src-snake',
      },
    });
  });

  it('maps audiobook series title from warehouse snake_case payloads', () => {
    const row = mapWarehouseAudiobookCatalogItemRow(
      {
        id: 'audio-series-name',
        title: 'Snake Case Series Audio',
        series_name: 'My Daughter Left the Nest and Returned an S-Rank Adventurer',
        series_index: 2,
      },
      syncedAt,
    );

    expect(row.series).toBe('My Daughter Left the Nest and Returned an S-Rank Adventurer');
    expect(row.seriesIndex).toBe(2);
  });

  it('maps audiobook genres and tags from scalar or array payload fields', () => {
    const row = mapWarehouseAudiobookCatalogItemRow(
      {
        id: 'audio-genres',
        title: 'Genre Audio',
        genres: ['Fantasy', ' Epic Fantasy ', ''],
        tag: 'full cast',
      },
      syncedAt,
    );

    expect(row.genres).toEqual(['Fantasy', 'Epic Fantasy']);
    expect(row.tags).toEqual(['full cast']);
  });

  it('folds safe nested identifiers and lets top-level values override collisions', () => {
    const row = mapWarehouseAudiobookCatalogItemRow(
      {
        id: 'audio-nested-identifiers',
        title: 'Nested Identifiers',
        identifiers: {
          isbn: 'nested-isbn',
          asin: 12345,
          vendor: 'warehouse',
          ignoredObject: { value: 'unsafe' },
          ignoredArray: ['unsafe'],
          ignoredBoolean: true,
        },
        isbn: 'top-level-isbn',
        source_id: 67890,
      },
      syncedAt,
    );

    expect(row.identifiers).toEqual({
      isbn: 'top-level-isbn',
      asin: '12345',
      vendor: 'warehouse',
      source_id: '67890',
    });
  });

  it('preserves raw payload internally for cache rows', () => {
    const payload = {
      id: 'audio-raw',
      title: 'Raw Audio',
      apiKey: 'internal-only',
      upstreamUrl: 'https://catalog.example.test/audiobooks/audio-raw',
    };

    const row = mapWarehouseAudiobookCatalogItemRow(payload, syncedAt);

    expect(row.rawPayload).toBe(payload);
  });
});

describe('mapWarehouseAudiobookDetail', () => {
  it('maps numeric-string chapter timings and file duration/size', () => {
    const detail = mapWarehouseAudiobookDetail({
      chapters: [
        {
          id: 'chapter-string-timing',
          title: 'String Timing',
          start_seconds: '30',
          end_seconds: '90',
          duration_seconds: '60',
        },
      ],
      files: [
        {
          file_id: 'file-string-size',
          filename: 'part-two.m4b',
          duration_seconds: '120',
          size_bytes: '456789',
        },
      ],
    });

    expect(detail).toEqual({
      chapters: [
        {
          id: 'chapter-string-timing',
          title: 'String Timing',
          startSeconds: 30,
          endSeconds: 90,
          durationSeconds: 60,
        },
      ],
      files: [
        {
          id: 'file-string-size',
          name: 'part-two.m4b',
          format: null,
          durationSeconds: 120,
          sizeBytes: 456789,
        },
      ],
    });
  });

  it('maps chapters and files from raw-ish objects using public-safe DTOs', () => {
    const detail = mapWarehouseAudiobookDetail({
      rawPayload: {
        apiKey: 'secret',
        upstreamUrl: 'https://catalog.example.test/audiobooks/audio-1',
      },
      vendorCopy: 'do not expose',
      chapters: [
        {
          id: 'chapter-1',
          title: 'Opening',
          start_seconds: 0,
          end_seconds: 300,
        },
        {
          title: '',
          startSeconds: -10,
          duration_seconds: 120,
        },
      ],
      files: [
        {
          file_id: 'file-1',
          filename: 'part-one.m4b',
          mime_type: 'audio/mp4',
          duration_seconds: 300,
          size_bytes: 123456,
        },
        {
          name: 'missing-id.m4b',
        },
      ],
    });

    expect(detail).toEqual({
      chapters: [
        {
          id: 'chapter-1',
          title: 'Opening',
          startSeconds: 0,
          endSeconds: 300,
          durationSeconds: 300,
        },
        {
          id: undefined,
          title: 'Chapter',
          startSeconds: 0,
          endSeconds: null,
          durationSeconds: 120,
        },
      ],
      files: [
        {
          id: 'file-1',
          name: 'part-one.m4b',
          format: 'audio/mp4',
          durationSeconds: 300,
          sizeBytes: 123456,
        },
      ],
    });
    expect(detail).not.toHaveProperty('rawPayload');
    expect(detail).not.toHaveProperty('apiKey');
    expect(detail).not.toHaveProperty('upstreamUrl');
    expect(detail).not.toHaveProperty('vendorCopy');
  });
});
