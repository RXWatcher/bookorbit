import { ConfigService } from '@nestjs/config';
import { rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassThrough } from 'stream';

import type { AbsCatalogService } from '../services/abs-catalog.service';
import type { AbsPlaybackService } from '../services/abs-playback.service';
import type { AbsStreamService } from '../services/abs-stream.service';
import { makeAbsUser, makeReply, makeRequest, thrownStatus } from '../__testing__/abs-test-helpers';
import { AbsItemsController } from './abs-items.controller';

function build() {
  const catalogService = {
    getLibraryItem: vi.fn().mockResolvedValue({ id: 'li_3' }),
    getItemFile: vi.fn().mockResolvedValue({ id: 7, bookId: 3, format: 'm4b', absolutePath: '/audio/Book Title.m4b' }),
    getDownloadFile: vi.fn().mockResolvedValue({ id: 7, bookId: 3, format: 'm4b', absolutePath: '/audio/Book Title.m4b' }),
    getDownloadBundle: vi.fn().mockResolvedValue({ title: 'Book Title', files: [{ absolutePath: '/audio/Book Title.m4b' }] }),
    warehouseBinary: vi.fn().mockResolvedValue(null),
    warehouseCover: vi.fn().mockResolvedValue(null),
  } as unknown as AbsCatalogService;
  const playbackService = { startSession: vi.fn().mockResolvedValue({ id: 'sess-1', playMethod: 0 }) } as unknown as AbsPlaybackService;
  const streamService = { streamFile: vi.fn().mockResolvedValue(undefined) } as unknown as AbsStreamService;
  const config = { get: () => tmpdir() } as unknown as ConfigService;
  return {
    controller: new AbsItemsController(catalogService, playbackService, streamService, config),
    catalogService,
    playbackService,
    streamService,
  };
}

/** A reply mock whose `raw` is a real writable stream so the zip-download path can pipe into it. */
function makeRawReply() {
  const chunks: Buffer[] = [];
  const raw = new PassThrough();
  raw.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  const headers: Record<string, unknown> = {};
  (raw as unknown as { setHeader: (k: string, v: unknown) => void; headers: Record<string, unknown> }).setHeader = (k, v) => {
    headers[k] = v;
  };
  return { reply: { raw } as any, raw, chunks, headers };
}

describe('AbsItemsController#getItem', () => {
  it('404s on a malformed item id', async () => {
    const { controller } = build();
    expect(await thrownStatus(() => controller.getItem(makeAbsUser(), 'nope', {}))).toBe(404);
  });

  it('delegates to the catalog service, passing minified through', async () => {
    const { controller, catalogService } = build();
    await controller.getItem(makeAbsUser(), 'li_3', { minified: '1' });
    expect(catalogService.getLibraryItem).toHaveBeenCalledWith(expect.anything(), 3, true, false);
  });

  it('requests progress attachment only when include contains progress', async () => {
    const { controller, catalogService } = build();
    await controller.getItem(makeAbsUser(), 'li_3', { expanded: '1', include: 'authors,progress' });
    expect(catalogService.getLibraryItem).toHaveBeenCalledWith(expect.anything(), 3, false, true);
  });
});

describe('AbsItemsController#play', () => {
  it('404s on a malformed item id', async () => {
    const { controller } = build();
    expect(await thrownStatus(() => controller.play(makeAbsUser(), 'nope', {}, makeRequest()))).toBe(404);
  });

  it('starts a playback session for a valid item, threading the caller ip for deviceInfo', async () => {
    const { controller, playbackService } = build();
    const body = { supportedMimeTypes: ['audio/mpeg'] };
    const session = await controller.play(makeAbsUser(), 'li_3', body, makeRequest());
    expect(playbackService.startSession).toHaveBeenCalledWith(expect.anything(), 3, body, undefined);
    expect(session).toMatchObject({ id: 'sess-1' });
  });
});

describe('AbsItemsController#cover', () => {
  it('404s on a malformed item id', async () => {
    const { controller } = build();
    const { reply } = makeReply();
    expect(await thrownStatus(() => controller.cover(makeAbsUser(), 'nope', makeRequest(), reply))).toBe(404);
  });

  it('404s when no cover file exists for the item', async () => {
    const { controller } = build();
    const { reply } = makeReply();
    // appDataPath points at an empty tmp dir, so the cover directory does not exist -> 404.
    expect(await thrownStatus(() => controller.cover(makeAbsUser(), 'li_999999', makeRequest(), reply))).toBe(404);
  });
});

describe('AbsItemsController#streamFileInline', () => {
  it('404s on a malformed item id', async () => {
    const { controller } = build();
    const { reply } = makeReply();
    expect(await thrownStatus(() => controller.streamFileInline(makeAbsUser(), 'nope', '7', makeRequest(), reply))).toBe(404);
  });

  it('404s on a non-numeric file id', async () => {
    const { controller } = build();
    const { reply } = makeReply();
    expect(await thrownStatus(() => controller.streamFileInline(makeAbsUser(), 'li_3', 'abc', makeRequest(), reply))).toBe(404);
  });

  it('resolves the file and streams it inline (no attachment disposition)', async () => {
    const { controller, catalogService, streamService } = build();
    const { reply, captured } = makeReply();
    await controller.streamFileInline(makeAbsUser(), 'li_3', '7', makeRequest(), reply);
    expect(catalogService.getItemFile).toHaveBeenCalledWith(expect.anything(), 3, 7);
    expect(captured.headers['Content-Disposition']).toBeUndefined();
    expect(streamService.streamFile).toHaveBeenCalledWith(expect.anything(), reply, '/audio/Book Title.m4b', 'm4b');
  });
});

describe('AbsItemsController#downloadFile', () => {
  it('404s on a malformed item id', async () => {
    const { controller } = build();
    const { reply } = makeReply();
    expect(await thrownStatus(() => controller.downloadFile(makeAbsUser(), 'nope', '7', makeRequest(), reply))).toBe(404);
  });

  it('404s on a non-numeric file id', async () => {
    const { controller } = build();
    const { reply } = makeReply();
    expect(await thrownStatus(() => controller.downloadFile(makeAbsUser(), 'li_3', 'abc', makeRequest(), reply))).toBe(404);
  });

  it('resolves the file and streams it with an attachment Content-Disposition', async () => {
    const { controller, catalogService, streamService } = build();
    const { reply, captured } = makeReply();
    await controller.downloadFile(makeAbsUser(), 'li_3', '7', makeRequest(), reply);
    expect(catalogService.getDownloadFile).toHaveBeenCalledWith(expect.anything(), 3, 7);
    expect(captured.headers['Content-Disposition']).toContain('attachment');
    expect(captured.headers['Content-Disposition']).toContain('Book Title.m4b');
    expect(streamService.streamFile).toHaveBeenCalledWith(expect.anything(), reply, '/audio/Book Title.m4b', 'm4b');
  });
});

describe('AbsItemsController#downloadItem', () => {
  it('404s on a malformed item id', async () => {
    const { controller } = build();
    const { reply } = makeRawReply();
    expect(await thrownStatus(() => controller.downloadItem(makeAbsUser(), 'nope', makeRequest(), reply))).toBe(404);
  });

  it('zips the item content files into the response', async () => {
    const filePath = join(tmpdir(), `abs-download-${Date.now()}.m4b`);
    writeFileSync(filePath, 'fake audio bytes');
    try {
      const { controller, catalogService } = build();
      (catalogService.getDownloadBundle as ReturnType<typeof vi.fn>).mockResolvedValue({
        title: 'Book Title',
        files: [{ absolutePath: filePath }],
      });
      const { reply, headers, chunks } = makeRawReply();
      await controller.downloadItem(makeAbsUser(), 'li_3', makeRequest(), reply);
      expect(headers['Content-Type']).toBe('application/zip');
      expect(String(headers['Content-Disposition'])).toContain('Book Title.zip');
      expect(chunks.length).toBeGreaterThan(0);
    } finally {
      rmSync(filePath, { force: true });
    }
  });
});

// Warehouse items have no book_files row, so the native path cannot serve them at all.
describe('AbsItemsController warehouse routing', () => {
  const binary = { status: 200, contentType: 'audio/mpeg', contentLength: 3, body: Buffer.from('abc'), acceptRanges: true, contentRange: null };

  it('streams a warehouse item from the catalogue, forwarding the Range header', async () => {
    const { controller, catalogService, streamService } = build();
    (catalogService.warehouseBinary as ReturnType<typeof vi.fn>).mockResolvedValue({ binary, kind: 'audio', fileName: 'a.m4b' });
    const { reply } = makeReply();

    await controller.streamFileInline(makeAbsUser(), 'li_-1000007', '7', makeRequest({ headers: { range: 'bytes=0-1' } }), reply);

    expect(catalogService.warehouseBinary).toHaveBeenCalledWith(expect.anything(), -1000007, 'bytes=0-1', 'stream');
    expect(streamService.streamFile).not.toHaveBeenCalled();
  });

  it('leaves native items on the on-disk path', async () => {
    const { controller, catalogService, streamService } = build();
    await controller.streamFileInline(makeAbsUser(), 'li_3', '7', makeRequest(), makeReply().reply);

    expect(catalogService.warehouseBinary).not.toHaveBeenCalled();
    expect(streamService.streamFile).toHaveBeenCalled();
  });

  it('404s a warehouse item the catalogue cannot resolve rather than falling through', async () => {
    const { controller, catalogService } = build();
    (catalogService.warehouseBinary as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await thrownStatus(() => controller.streamFileInline(makeAbsUser(), 'li_-1000007', '7', makeRequest(), makeReply().reply))).toBe(404);
  });

  it('serves a warehouse cover from the catalogue cover cache', async () => {
    const { controller, catalogService } = build();
    const cover = { status: 200, contentType: 'image/jpeg', contentLength: 3, body: Buffer.from('img'), acceptRanges: false, contentRange: null };
    (catalogService.warehouseCover as ReturnType<typeof vi.fn>).mockResolvedValue({ binary: cover, kind: 'audiobook-cover' });

    await controller.cover(makeAbsUser(), 'li_-1000007', makeRequest(), makeReply().reply);

    expect(catalogService.warehouseCover).toHaveBeenCalledWith(expect.anything(), -1000007);
  });
});
