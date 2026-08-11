import type { WarehouseRequestRow } from '../../db/schema';

import { mapWarehouseRequestRow, normalizeWarehouseRequestStatus } from './warehouse-request.mapper';

describe('normalizeWarehouseRequestStatus', () => {
  it.each([
    [undefined, 'unknown'],
    [null, 'unknown'],
    ['', 'unknown'],
    ['   ', 'unknown'],
    ['mystery', 'unknown'],
    ['pending', 'pending'],
    ['requested', 'pending'],
    ['new', 'pending'],
    ['processing', 'processing'],
    ['downloading', 'processing'],
    ['queued', 'processing'],
    ['searching', 'processing'],
    ['monitoring', 'processing'],
    ['active', 'processing'],
    ['in_progress', 'processing'],
    ['completed', 'completed'],
    ['succeeded', 'completed'],
    ['success', 'completed'],
    ['available', 'completed'],
    ['done', 'completed'],
    ['failed', 'failed'],
    ['error', 'failed'],
    ['errored', 'failed'],
    ['not_found', 'failed'],
    ['cancelled', 'cancelled'],
    ['canceled', 'cancelled'],
  ] as const)('maps %s to %s', (input, expected) => {
    expect(normalizeWarehouseRequestStatus(input)).toBe(expected);
  });

  it('normalizes case and separators', () => {
    expect(normalizeWarehouseRequestStatus(' In Progress ')).toBe('processing');
    expect(normalizeWarehouseRequestStatus('IN-PROGRESS')).toBe('processing');
  });
});

describe('mapWarehouseRequestRow', () => {
  const requestedAt = new Date('2026-06-03T10:00:00.000Z');
  const updatedAt = new Date('2026-06-03T10:05:00.000Z');
  const lastStatusSyncedAt = new Date('2026-06-03T10:10:00.000Z');

  it('omits upstream request identifiers and unsafe requested payload details from the public DTO', () => {
    const row = requestRow({
      upstreamRequestId: 'upstream-secret-request-id',
      requestedPayload: {
        isbn: '9780000000001',
        preferredFormat: 'EPUB',
        apiKey: 'secret-key',
        baseUrl: 'https://warehouse.example.test',
        upstreamUrl: 'https://warehouse.example.test/request/1',
        error: 'Raw provider error body',
        raw: { token: 'do-not-ship' },
        searchResult: {
          title: 'Public Book',
          author: 'Ada Writer',
          apiKey: 'nested-secret-key',
          upstreamUrl: 'https://warehouse.example.test/search/1',
          raw: { leaked: true },
          error: 'Nested raw provider error',
        },
      },
    });

    const dto = mapWarehouseRequestRow(row);

    expect(dto).not.toHaveProperty('upstreamRequestId');
    expect(dto.completedRemoteId).toBeNull();
    expect(JSON.stringify(dto)).not.toContain('upstream-secret-request-id');
    expect(JSON.stringify(dto)).not.toContain('book-remote-1');
    expect(JSON.stringify(dto)).not.toContain('secret-key');
    expect(JSON.stringify(dto)).not.toContain('warehouse.example.test');
    expect(JSON.stringify(dto)).not.toContain('Raw provider error body');
    expect(JSON.stringify(dto)).not.toContain('do-not-ship');
    expect(JSON.stringify(dto)).not.toContain('Nested raw provider error');
  });

  it('preserves safe requested payload summary fields without source identity', () => {
    const row = requestRow({
      requestedPayload: {
        isbn: '9780000000002',
        preferredFormat: 'PDF',
        searchResult: {
          title: 'Summary Book',
          author: 'Bea Writer',
          authors: ['Bea Writer', 'Case Writer'],
          isbn: '0000000000',
          isbn13: '9780000000002',
          coverUrl: 'https://covers.example.test/cover.jpg',
        },
      },
    });

    const dto = mapWarehouseRequestRow(row);

    expect(dto).toEqual({
      id: 1,
      mediaType: 'ebook',
      status: 'pending',
      title: 'Requested Book',
      author: 'Ada Writer',
      isbn: '9780000000000',
      completedRemoteId: null,
      requestedAt: requestedAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      lastStatusSyncedAt: lastStatusSyncedAt.toISOString(),
      requestedPayload: {
        isbn: '9780000000002',
        preferredFormat: 'PDF',
        searchResult: {
          title: 'Summary Book',
          author: 'Bea Writer',
          authors: ['Bea Writer', 'Case Writer'],
          isbn: '0000000000',
          isbn13: '9780000000002',
        },
      },
    });
  });

  it('preserves safe audiobook requested payload summary fields', () => {
    const row = requestRow({
      mediaType: 'audiobook',
      title: 'Requested Audiobook',
      author: 'Ada Narrator',
      isbn: null,
      requestedPayload: {
        title: 'Requested Audiobook',
        author: 'Ada Narrator',
        upstreamRequestId: 'request-secret-1',
        provider: 'Book Warehouse',
      },
    });

    const dto = mapWarehouseRequestRow(row);

    expect(dto).toMatchObject({
      mediaType: 'audiobook',
      title: 'Requested Audiobook',
      author: 'Ada Narrator',
      isbn: null,
      requestedPayload: {
        title: 'Requested Audiobook',
        author: 'Ada Narrator',
      },
    });
    expect(JSON.stringify(dto)).not.toContain('request-secret-1');
    expect(JSON.stringify(dto)).not.toContain('Book Warehouse');
  });

  it('omits ebook requested payload fields from audiobook summaries', () => {
    const row = requestRow({
      mediaType: 'audiobook',
      requestedPayload: {
        title: 'Requested Audiobook',
        author: 'Ada Narrator',
        isbn: '9780000000005',
        preferredFormat: 'MP3',
        searchResult: {
          title: 'Safe Search Result',
          author: 'Safe Writer',
          isbn13: '9780000000005',
        },
      },
    });

    const dto = mapWarehouseRequestRow(row);

    expect(dto.requestedPayload).toEqual({
      title: 'Requested Audiobook',
      author: 'Ada Narrator',
    });
  });

  it('omits unsafe audiobook requested payload title and author from public summaries', () => {
    const row = requestRow({
      mediaType: 'audiobook',
      requestedPayload: {
        title: 'https://warehouse.example.test/audiobooks/request/1',
        author: 'Bearer secret-token',
      },
    });

    const dto = mapWarehouseRequestRow(row);

    expect(dto.requestedPayload).toEqual({});
    expect(JSON.stringify(dto)).not.toContain('warehouse.example.test');
    expect(JSON.stringify(dto)).not.toContain('Bearer');
  });

  it('falls back to library request when an audiobook row title is unsafe', () => {
    const row = requestRow({
      mediaType: 'audiobook',
      title: 'Book Warehouse audiobook request',
      author: 'Safe Author',
      requestedPayload: {
        title: 'Safe Audiobook',
      },
    });

    const dto = mapWarehouseRequestRow(row);

    expect(dto.title).toBe('Library request');
    expect(dto.author).toBe('Safe Author');
    expect(dto.requestedPayload).toEqual({ title: 'Safe Audiobook' });
    expect(JSON.stringify(dto)).not.toContain('Book Warehouse audiobook request');
  });

  it('sanitizes unsafe top-level request fields in public DTOs', () => {
    const row = requestRow({
      title: 'Catalog source API request 123',
      author: 'Warehouse API request 123',
      isbn: 'tok_abcdefghijklmnopqrstuvwxyz123456',
    });

    const dto = mapWarehouseRequestRow(row);

    expect(dto).toMatchObject({
      title: 'Library request',
      author: null,
      isbn: null,
    });
    expect(JSON.stringify(dto)).not.toContain('Catalog source API request 123');
    expect(JSON.stringify(dto)).not.toContain('Warehouse API request 123');
    expect(JSON.stringify(dto)).not.toContain('tok_abcdefghijklmnopqrstuvwxyz123456');
  });

  it.each([
    'openlibrary',
    'google_books',
    'hardcover',
    'library-search',
    'Book Warehouse',
    'upstream',
    'https://warehouse.example.test/source',
    'api_key:secret',
  ])('omits source label %s from regular request summaries', (source) => {
    const row = requestRow({
      requestedPayload: {
        searchResult: {
          title: 'Summary Book',
          source,
        },
      },
    });

    const dto = mapWarehouseRequestRow(row);

    expect(dto.requestedPayload.searchResult).toEqual({ title: 'Summary Book' });
    expect(JSON.stringify(dto)).not.toContain(source);
  });

  it('omits forbidden provider wording from public search result text fields', () => {
    const row = requestRow({
      requestedPayload: {
        searchResult: {
          title: 'Book Warehouse Presents a Book',
          author: 'third-party edition',
          authors: ['Safe Writer', 'Provider Person', 'Vendor Editor'],
          isbn13: '9780000000003',
        },
      },
    });

    const dto = mapWarehouseRequestRow(row);

    expect(dto.requestedPayload.searchResult).toEqual({
      authors: ['Safe Writer'],
      isbn13: '9780000000003',
    });
    expect(JSON.stringify(dto)).not.toContain('Book Warehouse');
    expect(JSON.stringify(dto)).not.toContain('third-party');
    expect(JSON.stringify(dto)).not.toContain('Provider');
    expect(JSON.stringify(dto)).not.toContain('Vendor');
  });

  it('omits embedded URLs and secret-shaped text from public search result text fields', () => {
    const row = requestRow({
      requestedPayload: {
        searchResult: {
          title: 'See details at https://internal.example/request/1',
          author: 'x-api-key=secret',
          authors: ['Safe Writer', 'api key secret', 'Bearer secret-token', 'Authorization: token'],
          isbn13: '9780000000004',
        },
      },
    });

    const dto = mapWarehouseRequestRow(row);

    expect(dto.requestedPayload.searchResult).toEqual({
      authors: ['Safe Writer'],
      isbn13: '9780000000004',
    });
    expect(JSON.stringify(dto)).not.toContain('https://internal.example');
    expect(JSON.stringify(dto)).not.toContain('x-api-key');
    expect(JSON.stringify(dto)).not.toContain('api key');
    expect(JSON.stringify(dto)).not.toContain('Bearer');
    expect(JSON.stringify(dto)).not.toContain('Authorization');
  });

  it('exposes a safe completed item route id only for completed requests', () => {
    const dto = mapWarehouseRequestRow(
      requestRow({
        status: 'available',
        completedRemoteId: 'book 1/with slash',
      }),
    );

    expect(dto.completedRemoteId).toBe('book 1/with slash');

    const pendingDto = mapWarehouseRequestRow(requestRow({ status: 'pending', completedRemoteId: 'book 1/with slash' }));
    expect(pendingDto.completedRemoteId).toBeNull();
  });

  it.each(['book-warehouse-item-7', 'upstream-request-7', 'provider-item-7', 'source-item-7', 'vendor-item-7'])(
    'omits unsafe completed route id %s',
    (completedRemoteId) => {
      const dto = mapWarehouseRequestRow(requestRow({ status: 'completed', completedRemoteId }));

      expect(dto.completedRemoteId).toBeNull();
      expect(JSON.stringify(dto)).not.toContain(completedRemoteId);
    },
  );

  function requestRow(overrides: Partial<WarehouseRequestRow> = {}): WarehouseRequestRow {
    return {
      id: 1,
      userId: 42,
      mediaType: 'ebook',
      upstreamRequestId: 'upstream-request-1',
      status: 'pending',
      title: 'Requested Book',
      author: 'Ada Writer',
      isbn: '9780000000000',
      requestedPayload: {},
      completedRemoteId: 'book-remote-1',
      lastStatusSyncedAt,
      createdAt: requestedAt,
      updatedAt,
      ...overrides,
    };
  }
});
