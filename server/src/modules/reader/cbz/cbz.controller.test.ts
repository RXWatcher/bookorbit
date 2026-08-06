import { PassThrough } from 'stream';

import { CbzController } from './cbz.controller';

describe('CbzController', () => {
  const cbzService = {
    getPageCount: vi.fn(),
    streamPage: vi.fn(),
    getCatalogPageCount: vi.fn(),
    streamCatalogPage: vi.fn(),
  };

  const controller = new CbzController(cbzService as any);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('wraps page count response from service', async () => {
    const user = { id: 7, isSuperuser: false, permissions: [] } as any;
    cbzService.getPageCount.mockResolvedValue(42);

    const result = await controller.getPageCount(12, user);

    expect(result).toEqual({ pageCount: 42 });
    expect(cbzService.getPageCount).toHaveBeenCalledWith(12, user);
  });

  it('sets response headers and streams page bytes', async () => {
    const user = { id: 7, isSuperuser: false, permissions: [] } as any;
    const stream = new PassThrough();
    const reply = {
      header: vi.fn(),
      type: vi.fn(),
      send: vi.fn(),
    };
    cbzService.streamPage.mockResolvedValue({ stream, mimeType: 'image/png' });

    await controller.getPage(12, 3, user, reply as any);

    expect(cbzService.streamPage).toHaveBeenCalledWith(12, 3, user);
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'public, max-age=31536000, immutable');
    expect(reply.type).toHaveBeenCalledWith('image/png');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it('wraps source-backed page count response from service', async () => {
    const user = { id: 7, isSuperuser: false, permissions: [] } as any;
    cbzService.getCatalogPageCount.mockResolvedValue(12);

    const result = await controller.getCatalogPageCount('remote-1', 'cbz', user);

    expect(result).toEqual({ pageCount: 12 });
    expect(cbzService.getCatalogPageCount).toHaveBeenCalledWith('remote-1', 'cbz', user);
  });

  it.each(['cbr', 'cb7'])('passes source-backed %s page count format through to the service', async (format) => {
    const user = { id: 7, isSuperuser: false, permissions: [] } as any;
    cbzService.getCatalogPageCount.mockResolvedValue(3);

    await expect(controller.getCatalogPageCount('remote-1', format, user)).resolves.toEqual({ pageCount: 3 });

    expect(cbzService.getCatalogPageCount).toHaveBeenCalledWith('remote-1', format, user);
  });

  it('sets response headers and streams source-backed page bytes', async () => {
    const user = { id: 7, isSuperuser: false, permissions: [] } as any;
    const stream = new PassThrough();
    const reply = {
      header: vi.fn(),
      type: vi.fn(),
      send: vi.fn(),
    };
    cbzService.streamCatalogPage.mockResolvedValue({ stream, mimeType: 'image/jpeg' });

    await controller.getCatalogPage('remote-1', 4, 'cbz', user, reply as any);

    expect(cbzService.streamCatalogPage).toHaveBeenCalledWith('remote-1', 'cbz', 4, user);
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'private, max-age=86400');
    expect(reply.type).toHaveBeenCalledWith('image/jpeg');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it.each(['cbr', 'cb7'])('passes source-backed %s page stream format through to the service', async (format) => {
    const user = { id: 7, isSuperuser: false, permissions: [] } as any;
    const stream = new PassThrough();
    const reply = {
      header: vi.fn(),
      type: vi.fn(),
      send: vi.fn(),
    };
    cbzService.streamCatalogPage.mockResolvedValue({ stream, mimeType: 'image/png' });

    await controller.getCatalogPage('remote-1', 2, format, user, reply as any);

    expect(cbzService.streamCatalogPage).toHaveBeenCalledWith('remote-1', format, 2, user);
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'private, max-age=86400');
    expect(reply.type).toHaveBeenCalledWith('image/png');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });
});
