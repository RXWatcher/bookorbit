import { BookSearchController } from './book-search.controller';

describe('BookSearchController', () => {
  it('returns settings without the api key', async () => {
    const settings = {
      get: vi.fn().mockResolvedValue({
        enabled: true,
        url: 'http://m:7700',
        activeIndex: 'i',
        hasApiKey: true,
      }),
      save: vi.fn(),
    };
    const controller = new BookSearchController(settings as never, { rebuildInBackground: vi.fn() } as never, { lastProvider: vi.fn() } as never);

    const result = await controller.getSettings();

    expect(result).toMatchObject({ hasApiKey: true });
    expect(JSON.stringify(result)).not.toContain('apiKey"');
  });

  it('detaches a rebuild and answers accepted', () => {
    const indexer = { rebuildInBackground: vi.fn() };
    const controller = new BookSearchController({ get: vi.fn(), save: vi.fn() } as never, indexer as never, { lastProvider: vi.fn() } as never);

    expect(controller.rebuild()).toEqual({ started: true });
    expect(indexer.rebuildInBackground).toHaveBeenCalled();
  });
});
