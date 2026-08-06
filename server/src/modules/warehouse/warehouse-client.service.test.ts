import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';

import { WarehouseApiError } from './warehouse.errors';
import { WarehouseClientService } from './warehouse-client.service';
import { WAREHOUSE_REQUEST_TIMEOUT_MS } from './warehouse.constants';

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')) as T;
}

function mockJsonResponse(body: unknown, status = 200, statusText = 'OK'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function mockBinaryResponse(body: Buffer, headers: Record<string, string> = {}, status = 200, statusText = 'OK'): Response {
  const normalizedHeaders = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get: vi.fn((key: string) => normalizedHeaders.get(key.toLowerCase()) ?? null),
    },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(body);
        controller.close();
      },
    }),
    arrayBuffer: vi.fn().mockRejectedValue(new Error('binary responses should stream without buffering')),
    json: vi.fn().mockResolvedValue({ error: statusText }),
  } as unknown as Response;
}

async function binaryBodyToBuffer(body: Buffer | Readable): Promise<Buffer> {
  if (Buffer.isBuffer(body)) {
    return body;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

describe('WarehouseClientService', () => {
  let service: WarehouseClientService;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    service = new WarehouseClientService();
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('testConnection calls /health with X-API-Key header and returns ok for HTTP 200', async () => {
    fetchMock.mockResolvedValue(mockJsonResponse({}, 200));

    const result = await service.testConnection('https://catalog.example.com/', 'top-secret-key');

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.message).toBe('Connected');
    expect(new Date(result.checkedAt).toISOString()).toBe(result.checkedAt);

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const parsed = new URL(requestUrl);
    expect(parsed.origin + parsed.pathname).toBe('https://catalog.example.com/health');
    expect(parsed.searchParams.get('api_key')).toBeNull();
    expect(requestInit?.headers).toMatchObject({
      'X-API-Key': 'top-secret-key',
      'User-Agent': 'BookOrbit Catalog Source Sync',
    });
  });

  it('testConnection formats non-ok health responses as catalog source API errors', async () => {
    fetchMock.mockResolvedValue(mockJsonResponse({ error: 'Unauthorized' }, 401, 'Unauthorized'));

    const result = await service.testConnection('https://catalog.example.com/', 'top-secret-key');

    expect(result).toEqual({
      ok: false,
      status: 401,
      message: 'Catalog source API error 401: Unauthorized',
      checkedAt: result.checkedAt,
    });
    expect(new Date(result.checkedAt).toISOString()).toBe(result.checkedAt);
  });

  it('testConnection aborts stalled health checks with a safe timeout error', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => {
      const signal = init?.signal as AbortSignal | undefined;

      return new Promise((_resolve, reject) => {
        const handleAbort = (): void => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        };

        signal?.addEventListener('abort', handleAbort, { once: true });
      });
    });

    const promise = service.testConnection('https://catalog.example.com/', 'top-secret-key');
    const assertion = expect(promise).rejects.toThrow('Catalog source request timed out');

    await vi.advanceTimersByTimeAsync(WAREHOUSE_REQUEST_TIMEOUT_MS);

    await assertion;
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(requestInit?.signal).toBeDefined();
  });

  it('listBooks clamps page size to the upstream max limit', async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse({
        items: [readFixture('book.json')],
        page: 2,
        limit: 100,
        total: 1,
        hasNextPage: false,
      }),
    );

    const result = await service.listBooks({
      baseUrl: 'https://catalog.example.com///',
      apiKey: 'top-secret-key',
      page: 2,
      limit: 500,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.hasCover).toBe(true);
    expect(result.items[0]).not.toHaveProperty('has_cover');
    const [requestUrl] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const parsed = new URL(requestUrl);
    expect(parsed.pathname).toBe('/api/v1/books');
    expect(parsed.searchParams.get('page')).toBe('2');
    expect(parsed.searchParams.get('limit')).toBe('100');
    expect(parsed.searchParams.get('api_key')).toBeNull();
  });

  it('listBooks accepts alternate upstream total count field names', async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse({
        items: [readFixture('book.json')],
        page: 1,
        limit: 100,
        total_count: 25,
      }),
    );

    const result = await service.listBooks({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      page: 1,
      limit: 100,
    });

    expect(result.total).toBe(25);
  });

  it('listComics calls the normal-user comic item endpoint and strips storage paths from summaries', async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse({
        items: [
          {
            id: 'comic 1/with slash',
            title: 'Saga #1',
            author: 'Brian K. Vaughan',
            authors: ['Brian K. Vaughan', 'Fiona Staples'],
            series: 'Saga',
            series_id: 'series-1',
            issue_number: '1',
            year: 2012,
            cover_url: '/media/private/saga-1.jpg',
            storage_path: 'ceph://bucket/private.cbz',
          },
        ],
        total: 1,
      }),
    );

    const result = await service.listComics({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      page: 1,
      limit: 5,
    });

    expect(result.items).toEqual([
      {
        id: 'comic 1/with slash',
        title: 'Saga #1',
        author: 'Brian K. Vaughan',
        authors: ['Brian K. Vaughan', 'Fiona Staples'],
        series: 'Saga',
        seriesId: 'series-1',
        issueNumber: '1',
        year: 2012,
        coverUrl: undefined,
        hasCover: undefined,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/\/media\/|ceph:|storage_path/);

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const parsed = new URL(requestUrl);
    expect(parsed.pathname).toBe('/api/v1/comics/items');
    expect(parsed.searchParams.get('limit')).toBe('5');
    expect(parsed.searchParams.get('api_key')).toBeNull();
    expect(requestInit?.headers).toMatchObject({ 'X-API-Key': 'top-secret-key' });
  });

  it('listAudiobooks maps upstream errors without exposing the API key', async () => {
    fetchMock.mockResolvedValue(mockJsonResponse({ error: 'Unauthorized' }, 401, 'Unauthorized'));

    await expect(
      service.listAudiobooks({
        baseUrl: 'https://catalog.example.com',
        apiKey: 'top-secret-key',
        page: 1,
        limit: 10,
      }),
    ).rejects.toThrow('Catalog source API error 401: Unauthorized');

    await expect(
      service.listAudiobooks({
        baseUrl: 'https://catalog.example.com',
        apiKey: 'top-secret-key',
        page: 1,
        limit: 10,
      }),
    ).rejects.not.toThrow('top-secret-key');
  });

  it('aborts stalled JSON requests with a safe timeout error', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => {
      const signal = init?.signal as AbortSignal | undefined;

      return new Promise((_resolve, reject) => {
        const handleAbort = (): void => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        };

        signal?.addEventListener('abort', handleAbort, { once: true });
      });
    });

    const promise = service.listBooks({
      baseUrl: 'https://catalog.example.com',
      apiKey: 'top-secret-key',
      page: 1,
      limit: 10,
    });
    const assertion = expect(promise).rejects.toThrow('Catalog source request timed out');

    await vi.advanceTimersByTimeAsync(WAREHOUSE_REQUEST_TIMEOUT_MS);

    await assertion;
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(requestInit?.signal).toBeDefined();
  });

  it('requestAudiobook posts only title and optional author to the abiplayer request endpoint', async () => {
    fetchMock.mockResolvedValue(mockJsonResponse(readFixture('audiobook-request.json'), 201, 'Created'));

    const result = await service.requestAudiobook({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      title: 'Missing Audiobook',
      author: 'Ada Writer',
    });

    expect(result).toEqual(readFixture('audiobook-request.json'));

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const parsed = new URL(requestUrl);
    expect(parsed.pathname).toBe('/api/v1/audiobooks/abiplayer/requests');
    expect(parsed.searchParams.get('api_key')).toBeNull();
    expect(requestInit?.method).toBe('POST');
    expect(requestInit?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-API-Key': 'top-secret-key',
      'User-Agent': 'BookOrbit Catalog Source Sync',
    });
    expect(typeof requestInit?.body).toBe('string');
    expect(JSON.parse(requestInit!.body as string)).toEqual({
      title: 'Missing Audiobook',
      author: 'Ada Writer',
    });
  });

  it('requestAudiobook omits undefined and blank authors from the upstream body', async () => {
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse(readFixture('audiobook-request.json'), 201, 'Created'))
      .mockResolvedValueOnce(mockJsonResponse(readFixture('audiobook-request.json'), 201, 'Created'));

    await service.requestAudiobook({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      title: 'Missing Audiobook',
      author: undefined,
    });
    await service.requestAudiobook({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      title: 'Missing Audiobook',
      author: '   ',
    });

    for (const [, requestInit] of fetchMock.mock.calls as [string, RequestInit | undefined][]) {
      expect(JSON.parse(requestInit!.body as string)).toEqual({
        title: 'Missing Audiobook',
      });
    }
  });

  it('searchExternalBooks encodes q and sends only X-API-Key auth', async () => {
    fetchMock.mockResolvedValue(mockJsonResponse(readFixture('external-book-search.json')));

    const result = await service.searchExternalBooks({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      q: 'Ada Writer / Missing Book?',
    });

    expect(result.results[0]).toMatchObject({
      title: 'Missing Book',
      author: 'Ada Writer',
    });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const parsed = new URL(requestUrl);
    expect(requestUrl).toBe('https://catalog.example.com/api/v1/search/external?q=Ada+Writer+%2F+Missing+Book%3F');
    expect(parsed.searchParams.get('q')).toBe('Ada Writer / Missing Book?');
    expect(parsed.searchParams.get('api_key')).toBeNull();
    expect(parsed.searchParams.get('apikey')).toBeNull();
    expect(requestInit?.headers).toMatchObject({
      'X-API-Key': 'top-secret-key',
      'User-Agent': 'BookOrbit Catalog Source Sync',
    });
    expect(requestInit?.headers).not.toMatchObject({ Authorization: expect.any(String) });
  });

  it('search audiobook helpers encode q and send only X-API-Key auth', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          results: [
            {
              title: 'External Audio',
              author: 'Ada Writer',
              source: 'audible',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          results: [
            {
              id: 'abp-1',
              title: 'Abiplayer Audio',
              authors: ['Ada Writer'],
            },
          ],
        }),
      );

    await service.searchExternalAudiobooks({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      q: 'Ada Writer / Audio?',
    });
    await service.searchAbiplayerAudiobooks({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      q: 'Ada Writer / Audio?',
    });

    const [externalUrl, externalInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const [abiplayerUrl, abiplayerInit] = fetchMock.mock.calls[1] as [string, RequestInit | undefined];

    expect(externalUrl).toBe('https://catalog.example.com/api/v1/audiobooks/search/external?q=Ada+Writer+%2F+Audio%3F');
    expect(abiplayerUrl).toBe('https://catalog.example.com/api/v1/audiobooks/abiplayer/search?q=Ada+Writer+%2F+Audio%3F');

    for (const [requestUrl, requestInit] of [
      [externalUrl, externalInit],
      [abiplayerUrl, abiplayerInit],
    ] as [string, RequestInit | undefined][]) {
      const parsed = new URL(requestUrl);
      expect(parsed.searchParams.get('q')).toBe('Ada Writer / Audio?');
      expect(parsed.searchParams.get('api_key')).toBeNull();
      expect(parsed.searchParams.get('apikey')).toBeNull();
      expect(requestInit?.headers).toMatchObject({
        'X-API-Key': 'top-secret-key',
        'User-Agent': 'BookOrbit Catalog Source Sync',
      });
      expect(requestInit?.headers).not.toMatchObject({ Authorization: expect.any(String) });
    }
  });

  it('requestBook posts only isbn, preferred_format, and search_result while compacting undefined fields', async () => {
    fetchMock.mockResolvedValue(mockJsonResponse(readFixture('ebook-request.json'), 201, 'Created'));

    const result = await service.requestBook({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      isbn: '9780000000001',
      preferred_format: undefined,
      search_result: {
        title: 'Missing Book',
        author: 'Ada Writer',
      },
      ignored: 'not sent upstream',
    } as unknown as Parameters<WarehouseClientService['requestBook']>[0]);

    expect(result).toEqual(readFixture('ebook-request.json'));

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const parsed = new URL(requestUrl);
    expect(parsed.pathname).toBe('/api/v1/monitoring/add');
    expect(parsed.search).toBe('');
    expect(parsed.searchParams.get('api_key')).toBeNull();
    expect(requestInit?.method).toBe('POST');
    expect(requestInit?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-API-Key': 'top-secret-key',
      'User-Agent': 'BookOrbit Catalog Source Sync',
    });
    expect(JSON.parse(requestInit!.body as string)).toEqual({
      isbn: '9780000000001',
      search_result: {
        title: 'Missing Book',
        author: 'Ada Writer',
      },
    });
  });

  it('requestBook normalizes Book Warehouse request_id responses into stable ids', async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse(
        {
          message: 'Download request queued successfully',
          request_id: 'request-from-warehouse',
          status: 'searching',
        },
        202,
        'Accepted',
      ),
    );

    const result = await service.requestBook({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      search_result: {
        title: 'Missing Book',
      },
    });

    expect(result).toMatchObject({
      id: 'request-from-warehouse',
      request_id: 'request-from-warehouse',
      status: 'searching',
    });
  });

  it('listBookRequests accepts array and tolerant wrapper shapes', async () => {
    const ebookRequest = readFixture('ebook-request.json');
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse([ebookRequest]))
      .mockResolvedValueOnce(mockJsonResponse({ items: [ebookRequest] }))
      .mockResolvedValueOnce(mockJsonResponse({ requests: [ebookRequest] }))
      .mockResolvedValueOnce(mockJsonResponse({ monitoring: [ebookRequest] }))
      .mockResolvedValueOnce(mockJsonResponse({ results: [ebookRequest] }));

    const calls = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.listBookRequests({
          baseUrl: 'https://catalog.example.com/',
          apiKey: 'top-secret-key',
        }),
      ),
    );

    expect(calls).toEqual([[ebookRequest], [ebookRequest], [ebookRequest], [ebookRequest], [ebookRequest]]);

    for (const [requestUrl, requestInit] of fetchMock.mock.calls as [string, RequestInit | undefined][]) {
      const parsed = new URL(requestUrl);
      expect(parsed.pathname).toBe('/api/v1/monitoring');
      expect(parsed.search).toBe('');
      expect(parsed.searchParams.get('api_key')).toBeNull();
      expect(requestInit?.headers).toMatchObject({ 'X-API-Key': 'top-secret-key' });
    }
  });

  it('listAudiobookRequests encodes optional filters and accepts tolerant wrapper shapes', async () => {
    const audiobookRequest = {
      ...readFixture<Record<string, unknown>>('audiobook-request.json'),
      remote_id: 'audio-remote-1',
      completed_remote_id: 'audio-completed-1',
    };
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse([audiobookRequest]))
      .mockResolvedValueOnce(mockJsonResponse({ items: [audiobookRequest] }))
      .mockResolvedValueOnce(mockJsonResponse({ requests: [audiobookRequest] }))
      .mockResolvedValueOnce(mockJsonResponse({ queue: [audiobookRequest] }))
      .mockResolvedValueOnce(mockJsonResponse({ results: [audiobookRequest] }));

    const calls = await Promise.all([
      service.listAudiobookRequests({
        baseUrl: 'https://catalog.example.com/',
        apiKey: 'top-secret-key',
        status: 'pending review',
        limit: 25,
      }),
      service.listAudiobookRequests({
        baseUrl: 'https://catalog.example.com/',
        apiKey: 'top-secret-key',
      }),
      service.listAudiobookRequests({
        baseUrl: 'https://catalog.example.com/',
        apiKey: 'top-secret-key',
      }),
      service.listAudiobookRequests({
        baseUrl: 'https://catalog.example.com/',
        apiKey: 'top-secret-key',
      }),
      service.listAudiobookRequests({
        baseUrl: 'https://catalog.example.com/',
        apiKey: 'top-secret-key',
      }),
    ]);

    expect(calls).toEqual([
      [
        {
          id: 'audio-request-1',
          title: 'Missing Audiobook',
          author: 'Ada Writer',
          status: 'pending',
          remoteId: 'audio-remote-1',
          completedRemoteId: 'audio-completed-1',
        },
      ],
      [
        {
          id: 'audio-request-1',
          title: 'Missing Audiobook',
          author: 'Ada Writer',
          status: 'pending',
          remoteId: 'audio-remote-1',
          completedRemoteId: 'audio-completed-1',
        },
      ],
      [
        {
          id: 'audio-request-1',
          title: 'Missing Audiobook',
          author: 'Ada Writer',
          status: 'pending',
          remoteId: 'audio-remote-1',
          completedRemoteId: 'audio-completed-1',
        },
      ],
      [
        {
          id: 'audio-request-1',
          title: 'Missing Audiobook',
          author: 'Ada Writer',
          status: 'pending',
          remoteId: 'audio-remote-1',
          completedRemoteId: 'audio-completed-1',
        },
      ],
      [
        {
          id: 'audio-request-1',
          title: 'Missing Audiobook',
          author: 'Ada Writer',
          status: 'pending',
          remoteId: 'audio-remote-1',
          completedRemoteId: 'audio-completed-1',
        },
      ],
    ]);

    const [filteredUrl] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(filteredUrl).toBe('https://catalog.example.com/api/v1/audiobooks/abiplayer/requests?status=pending+review&limit=25');

    for (const [requestUrl, requestInit] of fetchMock.mock.calls as [string, RequestInit | undefined][]) {
      const parsed = new URL(requestUrl);
      expect(parsed.pathname).toBe('/api/v1/audiobooks/abiplayer/requests');
      expect(parsed.searchParams.get('api_key')).toBeNull();
      expect(parsed.searchParams.get('apikey')).toBeNull();
      expect(requestInit?.headers).toMatchObject({ 'X-API-Key': 'top-secret-key' });
    }
  });

  it('listAudiobookRequestQueue accepts tolerant wrapper shapes', async () => {
    const queue = readFixture('audiobook-request-queue.json');
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse(queue))
      .mockResolvedValueOnce(mockJsonResponse({ items: queue }))
      .mockResolvedValueOnce(mockJsonResponse({ requests: queue }))
      .mockResolvedValueOnce(mockJsonResponse({ queue }))
      .mockResolvedValueOnce(mockJsonResponse({ results: queue }));

    const calls = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.listAudiobookRequestQueue({
          baseUrl: 'https://catalog.example.com/',
          apiKey: 'top-secret-key',
        }),
      ),
    );

    expect(calls).toEqual([queue, queue, queue, queue, queue]);

    for (const [requestUrl, requestInit] of fetchMock.mock.calls as [string, RequestInit | undefined][]) {
      const parsed = new URL(requestUrl);
      expect(parsed.pathname).toBe('/api/v1/audiobooks/abiplayer/queue');
      expect(parsed.search).toBe('');
      expect(parsed.searchParams.get('api_key')).toBeNull();
      expect(requestInit?.headers).toMatchObject({ 'X-API-Key': 'top-secret-key' });
    }
  });

  it('listAudiobookRequestQueue sends an optional bounded limit without query-string auth', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse([]));

    await expect(
      service.listAudiobookRequestQueue({
        baseUrl: 'https://catalog.example.com/',
        apiKey: 'top-secret-key',
        limit: 50,
      }),
    ).resolves.toEqual([]);

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const parsed = new URL(requestUrl);
    expect(parsed.pathname).toBe('/api/v1/audiobooks/abiplayer/queue');
    expect(parsed.searchParams.get('limit')).toBe('50');
    expect(parsed.searchParams.get('api_key')).toBeNull();
    expect(parsed.searchParams.get('apikey')).toBeNull();
    expect(requestInit?.headers).toMatchObject({ 'X-API-Key': 'top-secret-key' });
  });

  it('listAudiobookRequestQueue tolerates null upstream payloads', async () => {
    fetchMock.mockResolvedValue(mockJsonResponse(null));

    await expect(
      service.listAudiobookRequestQueue({
        baseUrl: 'https://catalog.example.com/',
        apiKey: 'top-secret-key',
      }),
    ).resolves.toEqual([]);
  });

  it('getBookRequest, cancelBookRequest, and streamBookRequest encode ids without exposing raw responses', async () => {
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse(readFixture('ebook-request.json')))
      .mockResolvedValueOnce(mockJsonResponse({ id: 'book request/1?', status: 'cancelled' }, 202, 'Accepted'))
      .mockResolvedValueOnce(
        mockBinaryResponse(Buffer.from('ebook-bytes'), {
          'Content-Type': 'application/epub+zip',
          'Content-Length': '11',
        }),
      );

    const detail = await service.getBookRequest({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      id: 'book request/1?',
    });
    const cancellation = await service.cancelBookRequest({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      id: 'book request/1?',
    });
    const stream = await service.streamBookRequest({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      id: 'book request/1?',
    });

    expect(detail).toEqual(readFixture('ebook-request.json'));
    expect(cancellation).toEqual({
      status: 202,
      payload: { id: 'book request/1?', status: 'cancelled' },
    });
    expect(cancellation).not.toHaveProperty('headers');
    expect(cancellation).not.toHaveProperty('url');
    expect(stream).toMatchObject({
      status: 200,
      contentType: 'application/epub+zip',
      contentLength: 11,
      fileName: null,
    });
    expect(stream.body).toBeInstanceOf(Readable);
    await expect(binaryBodyToBuffer(stream.body)).resolves.toEqual(Buffer.from('ebook-bytes'));
    expect(stream).not.toHaveProperty('headers');
    expect(stream).not.toHaveProperty('url');

    const paths = fetchMock.mock.calls.map(([requestUrl]) => new URL(requestUrl as string).pathname);
    expect(paths).toEqual([
      '/api/v1/monitoring/book%20request%2F1%3F',
      '/api/v1/monitoring/book%20request%2F1%3F',
      '/api/v1/monitoring/book%20request%2F1%3F/stream',
    ]);
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.method).toBe('DELETE');

    for (const [requestUrl, requestInit] of fetchMock.mock.calls as [string, RequestInit | undefined][]) {
      const parsed = new URL(requestUrl);
      expect(parsed.searchParams.get('api_key')).toBeNull();
      expect(requestInit?.headers).toMatchObject({ 'X-API-Key': 'top-secret-key' });
    }
  });

  it('ebook request upstream errors use safe WarehouseApiError text', async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse(
        {
          error: 'Denied top-secret-key https://catalog.example.com/api/v1/monitoring?api_key=top-secret-key',
        },
        403,
        'Forbidden',
      ),
    );

    let caught: unknown;
    try {
      await service.listBookRequests({
        baseUrl: 'https://catalog.example.com',
        apiKey: 'top-secret-key',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WarehouseApiError);
    expect((caught as Error).message).toBe('Catalog source API error 403: Denied');
    expect((caught as Error).message).not.toContain('top-secret-key');
    expect((caught as Error).message).not.toContain('catalog.example.com');
    expect((caught as Error).message).not.toContain('api_key');
  });

  it('audiobook request upstream errors use safe WarehouseApiError text', async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse(
        {
          error: 'Denied top-secret-key https://catalog.example.com/api/v1/audiobooks/abiplayer/requests?api_key=top-secret-key',
        },
        403,
        'Forbidden',
      ),
    );

    let caught: unknown;
    try {
      await service.listAudiobookRequestQueue({
        baseUrl: 'https://catalog.example.com',
        apiKey: 'top-secret-key',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WarehouseApiError);
    expect((caught as Error).message).toBe('Catalog source API error 403: Denied');
    expect((caught as Error).message).not.toContain('top-secret-key');
    expect((caught as Error).message).not.toContain('catalog.example.com');
    expect((caught as Error).message).not.toContain('api_key');
  });

  it('network failures are generic and do not leak source details', async () => {
    const networkError = new Error('connect failed https://catalog.example.com/api/v1/audiobooks/abiplayer/queue?api_key=top-secret-key', {
      cause: new Error('nested failure top-secret-key https://catalog.example.com/private'),
    });
    networkError.stack = 'Error: connect failed https://catalog.example.com/api/v1/audiobooks/abiplayer/queue?api_key=top-secret-key';
    fetchMock.mockRejectedValue(networkError);
    const leakPattern = /top-secret-key|catalog\.example\.com|api_key/;

    let caught: unknown;
    try {
      await service.listAudiobookRequestQueue({
        baseUrl: 'https://catalog.example.com',
        apiKey: 'top-secret-key',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('Catalog source request failed');
    expect((caught as Error).message).not.toMatch(leakPattern);
    expect((caught as Error).stack).not.toMatch(leakPattern);
    expect((caught as Error).cause).toBeInstanceOf(Error);
    expect(((caught as Error).cause as Error).message).toBe('Catalog source request failed');
    expect(((caught as Error).cause as Error).message).not.toMatch(leakPattern);
    expect(((caught as Error).cause as Error).stack).not.toMatch(leakPattern);
    expect(((caught as Error).cause as Error).cause).toBeUndefined();
  });

  it('non-error network failures are generic', async () => {
    fetchMock.mockRejectedValue('connect failed https://catalog.example.com/api/v1/audiobooks/abiplayer/queue?api_key=top-secret-key');

    let caught: unknown;
    try {
      await service.listAudiobookRequestQueue({
        baseUrl: 'https://catalog.example.com',
        apiKey: 'top-secret-key',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('Catalog source request failed');
    expect((caught as Error).message).not.toContain('top-secret-key');
    expect((caught as Error).message).not.toContain('catalog.example.com');
    expect((caught as Error).message).not.toContain('api_key');
    expect((caught as Error).cause).toBeUndefined();
  });

  it('upstream error details redact bare hosts, provider wording, and secret-shaped auth labels', async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse(
        {
          error: 'Denied by Book Warehouse provider catalog.example.com with x-api-key=top-secret-key',
        },
        403,
        'Book Warehouse provider catalog.example.com',
      ),
    );

    await expect(
      service.getBookRequest({
        baseUrl: 'https://catalog.example.com',
        apiKey: 'top-secret-key',
        id: 'book-request-1',
      }),
    ).rejects.toThrow('Catalog source API error 403: Denied by with');

    await expect(
      service.getBookRequest({
        baseUrl: 'https://catalog.example.com',
        apiKey: 'top-secret-key',
        id: 'book-request-1',
      }),
    ).rejects.not.toThrow(/Book Warehouse|provider|catalog\.example\.com|x-api-key|top-secret-key/);
  });

  it('exposes typed response shapes for auxiliary upstream endpoints', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          results: [
            {
              title: 'External Audio',
              author: 'Ada Writer',
              source: 'audible',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          results: [
            {
              id: 'abp-1',
              title: 'Abiplayer Audio',
              authors: ['Ada Writer'],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(
          {
            id: 'book-request-1',
            status: 'pending',
            title: 'Missing Book',
          },
          201,
          'Created',
        ),
      );

    const externalAudiobooks = await service.searchExternalAudiobooks({
      baseUrl: 'https://catalog.example.com',
      apiKey: 'top-secret-key',
      q: 'Ada Writer',
    });
    const abiplayerAudiobooks = await service.searchAbiplayerAudiobooks({
      baseUrl: 'https://catalog.example.com',
      apiKey: 'top-secret-key',
      q: 'Ada Writer',
    });
    const requestedBook = await service.requestBook({
      baseUrl: 'https://catalog.example.com',
      apiKey: 'top-secret-key',
      isbn: '9780000000001',
    });

    expect(externalAudiobooks.results[0]?.title).toBe('External Audio');
    expect(externalAudiobooks.results[0]?.author).toBe('Ada Writer');
    expect(abiplayerAudiobooks.results[0]?.id).toBe('abp-1');
    expect(abiplayerAudiobooks.results[0]?.authors).toEqual(['Ada Writer']);
    expect(requestedBook.id).toBe('book-request-1');
    expect(requestedBook.status).toBe('pending');
  });

  it('getAudiobook calls the detail endpoint and maps tolerant upstream audiobook fields', async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse({
        ...readFixture<Record<string, unknown>>('audiobook.json'),
        subtitle: 'A catalog exercise',
        narrator: 'Fallback Narrator',
        narrators: ['Case Reader'],
        duration_seconds: 54321,
        has_cover: true,
        identifiers: { asin: 'B000TEST' },
        chapters: [
          {
            id: 'chapter-1',
            title: 'Opening',
            start_seconds: 0,
            end_seconds: 300,
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
        ],
      }),
    );

    const result = await service.getAudiobook({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      id: 'audio 1/with slash',
    });

    expect(result).toMatchObject({
      id: 'audio-1',
      title: 'The Test Audiobook',
      subtitle: 'A catalog exercise',
      authors: ['Ada Writer'],
      narrators: ['Case Reader'],
      durationSeconds: 54321,
      hasCover: true,
      identifiers: { asin: 'B000TEST' },
      chapters: [
        {
          id: 'chapter-1',
          title: 'Opening',
          startSeconds: 0,
          endSeconds: 300,
          durationSeconds: 300,
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
    expect(result.rawPayload).toMatchObject({ id: 'audio-1' });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const parsed = new URL(requestUrl);
    expect(requestUrl).toBe('https://catalog.example.com/api/v1/audiobooks/audio%201%2Fwith%20slash');
    expect(parsed.pathname).toBe('/api/v1/audiobooks/audio%201%2Fwith%20slash');
    expect(parsed.search).toBe('');
    expect(parsed.searchParams.get('api_key')).toBeNull();
    expect(requestInit?.headers).toMatchObject({ 'X-API-Key': 'top-secret-key' });
  });

  it('getAudiobook sanitizes negative timings and omits files without ids', async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse({
        id: 'audio-1',
        title: 'Invalid Metadata',
        duration: -10,
        chapters: [
          {
            title: 'Broken timing',
            start_seconds: -5,
            end_seconds: -1,
            duration_seconds: -20,
          },
        ],
        files: [
          {
            filename: 'missing-id.m4b',
            duration_seconds: 120,
            size_bytes: 1000,
          },
          {
            file_id: 'file-1',
            name: '',
            duration_seconds: -300,
            size_bytes: -42,
          },
        ],
      }),
    );

    const result = await service.getAudiobook({
      baseUrl: 'https://catalog.example.com',
      apiKey: 'top-secret-key',
      id: 'audio-1',
    });

    expect(result.durationSeconds).toBeNull();
    expect(result.chapters).toEqual([
      {
        title: 'Broken timing',
        startSeconds: 0,
        endSeconds: null,
        durationSeconds: null,
      },
    ]);
    expect(result.files).toEqual([
      {
        id: 'file-1',
        name: 'file-1',
        format: null,
        durationSeconds: null,
        sizeBytes: null,
      },
    ]);
  });

  it('binary audiobook helpers call documented paths with encoded ids and X-API-Key only', async () => {
    fetchMock
      .mockResolvedValueOnce(mockBinaryResponse(Buffer.from('cover'), { 'Content-Type': 'image/jpeg' }))
      .mockResolvedValueOnce(mockBinaryResponse(Buffer.from('stream'), { 'Content-Type': 'audio/mpeg' }))
      .mockResolvedValueOnce(mockBinaryResponse(Buffer.from('download'), { 'Content-Type': 'application/zip' }))
      .mockResolvedValueOnce(mockBinaryResponse(Buffer.from('file'), { 'Content-Type': 'audio/mp4' }));

    await service.getAudiobookCover({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      id: 'audio 1/with slash',
    });
    await service.streamAudiobook({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      id: 'audio 1/with slash',
    });
    await service.downloadAudiobook({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      id: 'audio 1/with slash',
    });
    await service.downloadAudiobookFile({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      id: 'audio 1/with slash',
      fileId: 'file 2/side A',
    });

    const paths = fetchMock.mock.calls.map(([requestUrl]) => new URL(requestUrl as string).pathname);
    expect(paths).toEqual([
      '/api/v1/audiobooks/audio%201%2Fwith%20slash/cover',
      '/api/v1/audiobooks/audio%201%2Fwith%20slash/stream',
      '/api/v1/audiobooks/audio%201%2Fwith%20slash/download',
      '/api/v1/audiobooks/audio%201%2Fwith%20slash/files/file%202%2Fside%20A/download',
    ]);

    for (const [requestUrl, requestInit] of fetchMock.mock.calls as [string, RequestInit | undefined][]) {
      const parsed = new URL(requestUrl);
      expect(parsed.searchParams.get('api_key')).toBeNull();
      expect(requestInit?.headers).toMatchObject({ 'X-API-Key': 'top-secret-key' });
    }
  });

  it('binary audiobook stream forwards safe range headers and preserves safe range metadata', async () => {
    fetchMock.mockResolvedValueOnce(
      mockBinaryResponse(
        Buffer.from('partial-audio'),
        {
          'Content-Type': 'audio/mpeg',
          'Content-Length': '13',
          'Content-Range': 'bytes 100-112/1000',
          'Accept-Ranges': 'bytes',
          Location: 'https://catalog.example.com/private',
        },
        206,
        'Partial Content',
      ),
    );

    const result = await service.streamAudiobook({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      id: 'audio-1',
      range: 'bytes=100-112',
    });

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(requestInit?.headers).toMatchObject({
      'X-API-Key': 'top-secret-key',
      Range: 'bytes=100-112',
    });
    expect(result).toMatchObject({
      status: 206,
      contentLength: 13,
      contentRange: 'bytes 100-112/1000',
      acceptRanges: 'bytes',
    });
    expect(JSON.stringify(result)).not.toContain('catalog.example.com');
  });

  it('binary ebook download does not forward malformed range headers', async () => {
    fetchMock
      .mockResolvedValueOnce(mockBinaryResponse(Buffer.from('ebook'), { 'Content-Type': 'application/epub+zip' }))
      .mockResolvedValueOnce(mockBinaryResponse(Buffer.from('ebook'), { 'Content-Type': 'application/epub+zip' }));

    await service.downloadBook({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      id: 'book-1',
      range: 'bytes=0-10\r\nX-API-Key: leaked',
    });
    await service.downloadBook({ baseUrl: 'https://catalog.example.com/', apiKey: 'top-secret-key', id: 'book-1', range: 'bytes=100-50' });

    for (const [, requestInit] of fetchMock.mock.calls as [string, RequestInit | undefined][]) {
      expect(requestInit?.headers).not.toHaveProperty('Range');
    }
  });

  it('binary audiobook stream preserves safe unsatisfied range metadata without upstream body leakage', async () => {
    fetchMock.mockResolvedValueOnce(
      mockBinaryResponse(
        Buffer.from('raw upstream body'),
        {
          'Content-Type': 'audio/ogg; codecs=opus',
          'Content-Range': 'bytes */1000',
          'Accept-Ranges': 'bytes',
        },
        416,
        'Range Not Satisfiable',
      ),
    );

    const result = await service.streamAudiobook({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      id: 'audio-1',
      range: 'bytes=1000-1200',
    });

    expect(result).toMatchObject({
      status: 416,
      contentType: 'audio/ogg; codecs=opus',
      contentLength: 0,
      contentRange: 'bytes */1000',
      acceptRanges: 'bytes',
    });
    await expect(binaryBodyToBuffer(result.body)).resolves.toEqual(Buffer.alloc(0));
    expect(JSON.stringify(result)).not.toContain('raw upstream body');
  });

  it('binary audiobook stream preserves trimmed content-type parameters from upstream responses', async () => {
    fetchMock.mockResolvedValueOnce(
      mockBinaryResponse(
        Buffer.from('partial-audio'),
        {
          'Content-Type': ' audio/ogg; codecs=opus ',
          'Content-Length': '13',
          'Content-Range': 'bytes 100-112/1000',
          'Accept-Ranges': 'bytes',
        },
        206,
        'Partial Content',
      ),
    );

    const result = await service.streamAudiobook({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      id: 'audio-1',
      range: 'bytes=100-112',
    });

    expect(result).toMatchObject({
      status: 206,
      contentType: 'audio/ogg; codecs=opus',
      contentLength: 13,
      contentRange: 'bytes 100-112/1000',
      acceptRanges: 'bytes',
    });
  });

  it('binary ebook download helper calls the documented path with encoded id and X-API-Key only', async () => {
    fetchMock.mockResolvedValueOnce(mockBinaryResponse(Buffer.from('ebook'), { 'Content-Type': 'application/epub+zip' }));

    await service.downloadBook({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      id: 'book 1/with slash',
    });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const parsed = new URL(requestUrl);
    expect(parsed.pathname).toBe('/api/v1/books/book%201%2Fwith%20slash/download');
    expect(parsed.searchParams.get('api_key')).toBeNull();
    expect(requestInit?.headers).toMatchObject({ 'X-API-Key': 'top-secret-key' });
  });

  it('binary ebook cover helper calls the documented path with encoded id and size', async () => {
    fetchMock.mockResolvedValueOnce(mockBinaryResponse(Buffer.from('cover'), { 'Content-Type': 'image/webp' }));

    await service.getBookCover({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      id: 'book 1/with slash',
      size: 'medium',
    });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const parsed = new URL(requestUrl);
    expect(parsed.pathname).toBe('/api/v1/books/book%201%2Fwith%20slash/cover/medium');
    expect(parsed.searchParams.get('api_key')).toBeNull();
    expect(requestInit?.headers).toMatchObject({ 'X-API-Key': 'top-secret-key' });
  });

  it('comic binary helpers call normal-user API paths with encoded ids and safe range headers', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockBinaryResponse(Buffer.from('comic-bytes'), {
          'Content-Type': 'application/vnd.comicbook+zip',
          'Content-Length': '11',
          'Content-Range': 'bytes 0-10/200',
          'Accept-Ranges': 'bytes',
        }),
      )
      .mockResolvedValueOnce(
        mockBinaryResponse(Buffer.from('page-bytes'), {
          'Content-Type': 'image/jpeg',
          'Content-Length': '10',
          'Content-Range': 'bytes 0-9/200',
          'Accept-Ranges': 'bytes',
        }),
      );

    await service.downloadComic({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      id: 'comic 1/with slash',
      range: 'bytes=0-10',
    });
    await service.getComicPageImage({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      id: 'comic 1/with slash',
      pageIndex: 0,
      range: 'bytes=0-10',
    });

    const [downloadUrl, downloadInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const [pageUrl, pageInit] = fetchMock.mock.calls[1] as [string, RequestInit | undefined];
    expect(new URL(downloadUrl).pathname).toBe('/api/v1/comics/items/comic%201%2Fwith%20slash/download');
    expect(new URL(pageUrl).pathname).toBe('/api/v1/comics/items/comic%201%2Fwith%20slash/pages/0');
    expect(downloadInit?.headers).toMatchObject({ 'X-API-Key': 'top-secret-key', Range: 'bytes=0-10' });
    expect(pageInit?.headers).toMatchObject({ 'X-API-Key': 'top-secret-key', Range: 'bytes=0-10' });
    expect(downloadUrl).not.toContain('/media/');
    expect(pageUrl).not.toContain('/media/');
  });

  it('comic page lists and requests use normal-user comic endpoints', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          pages: [{ index: 0, content_type: 'image/jpeg', width: 1280, height: 1920, size_bytes: 42, path: '/media/private/page.jpg' }],
          total: 1,
        }),
      )
      .mockResolvedValueOnce(mockJsonResponse({ id: 'request-1', status: 'pending', title: 'Saga', author: 'Image' }))
      .mockResolvedValueOnce(mockJsonResponse({ requests: [{ id: 'request-1', status: 'pending', title: 'Saga', author: 'Image' }] }));

    await expect(
      service.listComicPages({ baseUrl: 'https://catalog.example.com/', apiKey: 'top-secret-key', id: 'comic 1/with slash' }),
    ).resolves.toEqual({
      items: [{ index: 0, contentType: 'image/jpeg', width: 1280, height: 1920, sizeBytes: 42 }],
      total: 1,
    });
    await service.requestComic({
      baseUrl: 'https://catalog.example.com/',
      apiKey: 'top-secret-key',
      seriesTitle: 'Saga',
      issueNumber: '1',
      publisher: 'Image',
      year: 2012,
    });
    await service.listComicRequests({ baseUrl: 'https://catalog.example.com/', apiKey: 'top-secret-key', limit: 10 });

    expect(new URL((fetchMock.mock.calls[0] as [string, RequestInit | undefined])[0]).pathname).toBe(
      '/api/v1/comics/items/comic%201%2Fwith%20slash/pages',
    );
    const [requestUrl, requestInit] = fetchMock.mock.calls[1] as [string, RequestInit | undefined];
    expect(new URL(requestUrl).pathname).toBe('/api/v1/comics/requests');
    expect(requestInit?.method).toBe('POST');
    expect(typeof requestInit?.body).toBe('string');
    expect(JSON.parse(requestInit?.body as string)).toEqual({
      series_title: 'Saga',
      issue_number: '1',
      publisher: 'Image',
      year: 2012,
    });
    expect(new URL((fetchMock.mock.calls[2] as [string, RequestInit | undefined])[0]).pathname).toBe('/api/v1/comics/requests');
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/\/media\/|ceph:|api_key=top-secret-key/);
  });

  it('comic series browsing uses normal-user series endpoints without leaking storage paths', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          series: [{ id: 'series 1', title: 'Saga', publisher: 'Image', year: 2012, path: '/media/private/series' }],
          page: 1,
          limit: 10,
          total: 1,
          has_next_page: false,
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          results: [{ id: 'series 2', title: 'Crossed', publisher: 'Avatar', year: 2008, storage_path: 'ceph://bucket/series' }],
          page: 1,
          limit: 5,
          total: 1,
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          items: [
            {
              id: 'comic 1',
              title: 'Saga #1',
              series_id: 'series 1',
              issue_number: '1',
              year: 2012,
              media_path: '/media/private.cbz',
              file_path: '/media/private-file.cbz',
              ceph_path: 'ceph://bucket/comic.cbz',
              storagePath: 'ceph://bucket/storage.cbz',
            },
          ],
          page: 2,
          limit: 20,
          total: 1,
        }),
      );

    await expect(service.listComicSeries({ baseUrl: 'https://catalog.example.com/', apiKey: 'top-secret-key', page: 1, limit: 10 })).resolves.toEqual(
      {
        items: [{ id: 'series 1', title: 'Saga', publisher: 'Image', year: 2012 }],
        page: 1,
        limit: 10,
        total: 1,
        hasNextPage: false,
      },
    );
    await expect(
      service.searchComicSeries({ baseUrl: 'https://catalog.example.com/', apiKey: 'top-secret-key', q: 'crossed', page: 1, limit: 5 }),
    ).resolves.toEqual({
      items: [{ id: 'series 2', title: 'Crossed', publisher: 'Avatar', year: 2008 }],
      page: 1,
      limit: 5,
      total: 1,
      hasNextPage: false,
    });
    await expect(
      service.listComicSeriesItems({
        baseUrl: 'https://catalog.example.com/',
        apiKey: 'top-secret-key',
        seriesId: 'series 1/with slash',
        page: 2,
        limit: 20,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: 'comic 1',
          title: 'Saga #1',
          seriesId: 'series 1',
          issueNumber: '1',
          year: 2012,
        },
      ],
      page: 2,
      limit: 20,
      total: 1,
      hasNextPage: false,
    });

    const [seriesUrl] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const [searchUrl] = fetchMock.mock.calls[1] as [string, RequestInit | undefined];
    const [itemsUrl] = fetchMock.mock.calls[2] as [string, RequestInit | undefined];
    expect(new URL(seriesUrl).pathname).toBe('/api/v1/comics/series');
    expect(Object.fromEntries(new URL(seriesUrl).searchParams.entries())).toEqual({ page: '1', limit: '10' });
    expect(new URL(searchUrl).pathname).toBe('/api/v1/comics/series/search');
    expect(Object.fromEntries(new URL(searchUrl).searchParams.entries())).toEqual({ q: 'crossed', page: '1', limit: '5' });
    expect(new URL(itemsUrl).pathname).toBe('/api/v1/comics/series/series%201%2Fwith%20slash/items');
    expect(Object.fromEntries(new URL(itemsUrl).searchParams.entries())).toEqual({ page: '2', limit: '20' });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/\/media\/|ceph:|api_key=top-secret-key/);
  });

  it('binary audiobook helpers return safe wrappers without raw Response or leaked upstream data', async () => {
    fetchMock.mockResolvedValue(
      mockBinaryResponse(Buffer.from('audio-bytes'), {
        'Content-Type': 'audio/mpeg',
        'Content-Length': '11',
        'Content-Disposition': 'attachment; filename="../secret\r\nname.mp3"',
      }),
    );

    const result = await service.downloadAudiobook({
      baseUrl: 'https://catalog.example.com/upstream',
      apiKey: 'top-secret-key',
      id: 'audio-1',
    });

    expect(result).toMatchObject({
      status: 200,
      contentType: 'audio/mpeg',
      contentLength: 11,
      fileName: '_secretname.mp3',
    });
    expect(result.body).toBeInstanceOf(Readable);
    await expect(binaryBodyToBuffer(result.body)).resolves.toEqual(Buffer.from('audio-bytes'));
    expect(result).not.toHaveProperty('ok');
    expect(result).not.toHaveProperty('headers');
    expect(result).not.toHaveProperty('url');
    expect(JSON.stringify(result)).not.toContain('top-secret-key');
    expect(JSON.stringify(result)).not.toContain('catalog.example.com');
  });

  it('binary audiobook helper errors use sanitized WarehouseApiError messages', async () => {
    fetchMock.mockResolvedValue(mockJsonResponse({ error: 'Unauthorized top-secret-key https://catalog.example.com/private' }, 401, 'Unauthorized'));

    await expect(
      service.getAudiobookCover({
        baseUrl: 'https://catalog.example.com',
        apiKey: 'top-secret-key',
        id: 'audio-1',
      }),
    ).rejects.toThrow('Catalog source API error 401: Unauthorized');
  });
});
