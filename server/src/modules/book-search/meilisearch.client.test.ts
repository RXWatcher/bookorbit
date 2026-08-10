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

  it('returns false from health rather than throwing when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    await expect(new MeilisearchClient({ url: 'http://meili:7700', apiKey: 'k' }).health()).resolves.toBe(false);
  });
});
