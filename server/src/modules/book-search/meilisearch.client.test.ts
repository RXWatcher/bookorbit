import { GatewayTimeoutException, HttpException } from '@nestjs/common';

import { MeilisearchClient } from './meilisearch.client';

function mockFetch(handler: (url: string, init: RequestInit) => { status?: number; body?: unknown }) {
  return vi.fn().mockImplementation((url: string, init: RequestInit) => {
    const { status = 200, body = {} } = handler(url, init);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
  });
}

describe('MeilisearchClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports health from the health endpoint', async () => {
    const fetchMock = mockFetch(() => ({ body: { status: 'available' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new MeilisearchClient({
        url: 'http://meili:7700',
        apiKey: 'k',
      }).health(),
    ).resolves.toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('http://meili:7700/health');
  });

  it('reports unhealthy rather than throwing when the server errors', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(() => ({ status: 500 })),
    );

    await expect(
      new MeilisearchClient({
        url: 'http://meili:7700',
        apiKey: 'k',
      }).health(),
    ).resolves.toBe(false);
  });

  it('sends the api key as a bearer token', async () => {
    const fetchMock = mockFetch(() => ({ body: {} }));
    vi.stubGlobal('fetch', fetchMock);

    await new MeilisearchClient({
      url: 'http://meili:7700',
      apiKey: 'secret-key',
    }).addDocuments('books', []);

    const init = fetchMock.mock.calls[0][1] as {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBe('Bearer secret-key');
  });

  it('puts documents on the index documents endpoint', async () => {
    const fetchMock = mockFetch(() => ({ body: {} }));
    vi.stubGlobal('fetch', fetchMock);

    await new MeilisearchClient({
      url: 'http://meili:7700',
      apiKey: 'k',
    }).addDocuments('books', []);

    expect(fetchMock.mock.calls[0][0]).toBe('http://meili:7700/indexes/books/documents');
  });

  it('returns hit ids and the estimated total from a search', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(() => ({
        body: {
          hits: [{ id: 'catalog:ebook:1' }, { id: 'native:2' }],
          estimatedTotalHits: 2,
        },
      })),
    );

    await expect(
      new MeilisearchClient({ url: 'http://meili:7700', apiKey: 'k' }).search('books', { q: 'dune', offset: 0, limit: 10 }),
    ).resolves.toEqual({ ids: ['catalog:ebook:1', 'native:2'], total: 2 });
  });

  it('raises a bad gateway when the server rejects a write', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(() => ({ status: 403, body: { message: 'invalid api key' } })),
    );

    await expect(
      new MeilisearchClient({
        url: 'http://meili:7700',
        apiKey: 'bad',
      }).addDocuments('books', []),
    ).rejects.toThrow();
  });

  it('returns an empty result when the search response has no hits key', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(() => ({ body: { estimatedTotalHits: 5 } })),
    );

    await expect(
      new MeilisearchClient({ url: 'http://meili:7700', apiKey: 'k' }).search('books', { q: 'dune', offset: 0, limit: 10 }),
    ).resolves.toEqual({ ids: [], total: 5 });
  });

  it('surfaces a fetch rejection as an HttpException rather than a raw Error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    const client = new MeilisearchClient({ url: 'http://meili:7700', apiKey: 'k' });

    await expect(client.addDocuments('books', [])).rejects.toBeInstanceOf(HttpException);
  });

  it('surfaces a timeout as a gateway timeout HttpException', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    const client = new MeilisearchClient({ url: 'http://meili:7700', apiKey: 'k' });

    await expect(client.addDocuments('books', [])).rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it('raises the maximum total hits above the default so deep pages are not blank', async () => {
    const fetchMock = mockFetch(() => ({ body: {} }));
    vi.stubGlobal('fetch', fetchMock);

    await new MeilisearchClient({ url: 'http://meili:7700', apiKey: 'k' }).applySettings('books');

    const init = fetchMock.mock.calls[0][1] as { body: string };
    const body = JSON.parse(init.body) as { pagination: { maxTotalHits: number } };
    expect(body.pagination.maxTotalHits).toBeGreaterThanOrEqual(500_000);
  });

  it('returns the task id of a write so the caller can confirm it landed', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(() => ({ status: 202, body: { taskUid: 9, status: 'enqueued' } })),
    );

    const client = new MeilisearchClient({ url: 'http://meili:7700', apiKey: 'k' });

    await expect(client.addDocuments('books', [])).resolves.toBe(9);
    await expect(client.deleteDocuments('books', ['catalog:ebook:1'])).resolves.toBe(9);
  });

  it('resolves waitForTask once the task succeeded', async () => {
    const fetchMock = mockFetch(() => ({ body: { status: 'succeeded' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new MeilisearchClient({ url: 'http://meili:7700', apiKey: 'k' }).waitForTask(9)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe('http://meili:7700/tasks/9');
  });

  it('raises when the task failed, so the caller keeps its outbox events', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(() => ({ body: { status: 'failed' } })),
    );

    await expect(new MeilisearchClient({ url: 'http://meili:7700', apiKey: 'k' }).waitForTask(9)).rejects.toBeInstanceOf(HttpException);
  });

  it('raises a gateway timeout when the task is still running at the deadline', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(() => ({ body: { status: 'processing' } })),
    );

    await expect(new MeilisearchClient({ url: 'http://meili:7700', apiKey: 'k' }).waitForTask(9, 0)).rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it('returns false from health rather than throwing when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    await expect(new MeilisearchClient({ url: 'http://meili:7700', apiKey: 'k' }).health()).resolves.toBe(false);
  });
});

describe('MeilisearchClient search strategy', () => {
  it('requires every query word so the reported total stays meaningful', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ hits: [], estimatedTotalHits: 0 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await new MeilisearchClient({ url: 'http://meili:7700', apiKey: 'k' }).search('books', { q: 'the will of many', offset: 0, limit: 10 });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as { matchingStrategy?: string };
    expect(body.matchingStrategy).toBe('all');
  });
});
