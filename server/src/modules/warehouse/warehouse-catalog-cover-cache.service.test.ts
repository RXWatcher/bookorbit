import type { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';

import { WarehouseCatalogCoverCacheService } from './warehouse-catalog-cover-cache.service';

function makeConfig(appDataPath: string): ConfigService {
  return {
    get: vi.fn().mockImplementation((key: string) => (key === 'storage.appDataPath' ? appDataPath : undefined)),
  } as unknown as ConfigService;
}

describe('WarehouseCatalogCoverCacheService', () => {
  let appDataPath: string;
  let service: WarehouseCatalogCoverCacheService;

  beforeEach(async () => {
    appDataPath = await fs.mkdtemp(join(tmpdir(), 'bookorbit-catalog-cover-cache-'));
    service = new WarehouseCatalogCoverCacheService(makeConfig(appDataPath));
  });

  afterEach(async () => {
    await fs.rm(appDataPath, { recursive: true, force: true });
  });

  it('persists sanitized ebook cover bytes without replaying upstream file names', async () => {
    await service.writeEbookCover('https://catalog-source.example.test', 'remote/private/url?apiKey=secret', 'medium', {
      status: 200,
      contentType: 'image/webp; upstream=https://private.example.test',
      contentLength: 3,
      body: Buffer.from('img'),
      fileName: 'private-cover.webp',
    });

    await expect(service.readEbookCover('https://catalog-source.example.test', 'remote/private/url?apiKey=secret', 'medium')).resolves.toEqual({
      status: 200,
      contentType: 'image/webp',
      contentLength: 3,
      body: Buffer.from('img'),
      fileName: null,
    });
  });

  it('does not cache non-image ebook cover responses', async () => {
    await service.writeEbookCover('https://catalog-source.example.test', 'remote-10', 'medium', {
      status: 200,
      contentType: 'application/json',
      contentLength: 2,
      body: Buffer.from('{}'),
      fileName: null,
    });

    await expect(service.readEbookCover('https://catalog-source.example.test', 'remote-10', 'medium')).resolves.toBeNull();
  });

  it('does not cache active image formats', async () => {
    await service.writeEbookCover('https://catalog-source.example.test', 'remote-10', 'medium', {
      status: 200,
      contentType: 'image/svg+xml',
      contentLength: 62,
      body: Buffer.from('<svg><script>fetch("https://private.example.test")</script></svg>'),
      fileName: null,
    });

    await expect(service.readEbookCover('https://catalog-source.example.test', 'remote-10', 'medium')).resolves.toBeNull();
  });

  it('materializes stream-backed ebook covers before caching them', async () => {
    await service.writeEbookCover('https://catalog-source.example.test', 'remote-10', 'medium', {
      status: 200,
      contentType: 'image/png',
      contentLength: 3,
      body: Readable.from([Buffer.from('img')]),
      fileName: 'remote-name.png',
    });

    await expect(service.readEbookCover('https://catalog-source.example.test', 'remote-10', 'medium')).resolves.toEqual({
      status: 200,
      contentType: 'image/png',
      contentLength: 3,
      body: Buffer.from('img'),
      fileName: null,
    });
  });

  it('keeps cover cache entries isolated by catalog source', async () => {
    await service.writeEbookCover('https://catalog-source.example.test', 'remote-10', 'medium', {
      status: 200,
      contentType: 'image/jpeg',
      contentLength: 3,
      body: Buffer.from('one'),
      fileName: null,
    });

    await expect(service.readEbookCover('https://replacement.example.test', 'remote-10', 'medium')).resolves.toBeNull();
  });

  it('persists audiobook cover bytes in a separate media cache namespace', async () => {
    await service.writeAudiobookCover('https://catalog-source.example.test\nciphertext\nnonce\ntag', 'remote-10', {
      status: 200,
      contentType: 'image/jpeg',
      contentLength: 3,
      body: Buffer.from('aud'),
      fileName: 'upstream-audiobook-cover.jpg',
    });

    await expect(service.readAudiobookCover('https://catalog-source.example.test\nciphertext\nnonce\ntag', 'remote-10')).resolves.toEqual({
      status: 200,
      contentType: 'image/jpeg',
      contentLength: 3,
      body: Buffer.from('aud'),
      fileName: null,
    });
    await expect(service.readEbookCover('https://catalog-source.example.test\nciphertext\nnonce\ntag', 'remote-10', 'cover')).resolves.toBeNull();
  });

  it('does not consume stream-backed covers when the size is unknown', async () => {
    const body = Readable.from([Buffer.from('img')]);
    const response = await service.writeEbookCover('https://catalog-source.example.test', 'remote-10', 'medium', {
      status: 200,
      contentType: 'image/png',
      contentLength: null,
      body,
      fileName: null,
    });

    expect(response.body).toBe(body);
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks).toString('utf8')).toBe('img');
    await expect(service.readEbookCover('https://catalog-source.example.test', 'remote-10', 'medium')).resolves.toBeNull();
  });

  it('returns a safe empty response when a stream exceeds its declared cover size', async () => {
    const response = await service.writeEbookCover('https://catalog-source.example.test', 'remote-10', 'medium', {
      status: 200,
      contentType: 'image/png',
      contentLength: 1,
      body: Readable.from([Buffer.alloc(20 * 1024 * 1024), Buffer.from([1])]),
      fileName: null,
    });

    expect(response).toEqual({
      status: 502,
      contentType: 'application/octet-stream',
      contentLength: 0,
      body: Buffer.alloc(0),
      fileName: null,
    });
    await expect(service.readEbookCover('https://catalog-source.example.test', 'remote-10', 'medium')).resolves.toBeNull();
  });

  it('reports local cover cache status without exposing cache keys', async () => {
    await service.writeEbookCover('source-one', 'remote-ebook', 'medium', {
      status: 200,
      contentType: 'image/png',
      contentLength: 3,
      body: Buffer.from('one'),
      fileName: null,
    });
    await service.writeAudiobookCover('source-two', 'remote-audio', {
      status: 200,
      contentType: 'image/jpeg',
      contentLength: 5,
      body: Buffer.from('three'),
      fileName: null,
    });

    await expect(service.getStatus()).resolves.toEqual({
      covers: {
        totalEntries: 2,
        totalBytes: 8,
        byMediaType: {
          ebook: { entries: 1, bytes: 3 },
          audiobook: { entries: 1, bytes: 5 },
          comic: { entries: 0, bytes: 0 },
        },
      },
    });
  });

  it('does not count corrupted cover cache entries in status totals', async () => {
    await service.writeEbookCover('source-one', 'remote-ebook', 'medium', {
      status: 200,
      contentType: 'image/png',
      contentLength: 3,
      body: Buffer.from('one'),
      fileName: null,
    });
    await fs.writeFile((await findCoverBin(appDataPath))!, Buffer.from('two'));

    await expect(service.getStatus()).resolves.toEqual({
      covers: {
        totalEntries: 0,
        totalBytes: 0,
        byMediaType: {
          ebook: { entries: 0, bytes: 0 },
          audiobook: { entries: 0, bytes: 0 },
          comic: { entries: 0, bytes: 0 },
        },
      },
    });
  });

  it('clears cover cache files and returns aggregate counts', async () => {
    await service.writeEbookCover('source-one', 'remote-ebook', 'medium', {
      status: 200,
      contentType: 'image/png',
      contentLength: 3,
      body: Buffer.from('one'),
      fileName: null,
    });
    await service.writeAudiobookCover('source-two', 'remote-audio', {
      status: 200,
      contentType: 'image/jpeg',
      contentLength: 5,
      body: Buffer.from('three'),
      fileName: null,
    });

    await expect(service.clear()).resolves.toEqual({
      cleared: {
        covers: { entries: 2, bytes: 8 },
      },
      covers: {
        totalEntries: 0,
        totalBytes: 0,
        byMediaType: {
          ebook: { entries: 0, bytes: 0 },
          audiobook: { entries: 0, bytes: 0 },
          comic: { entries: 0, bytes: 0 },
        },
      },
    });
    await expect(service.getStatus()).resolves.toMatchObject({
      covers: {
        totalEntries: 0,
        totalBytes: 0,
      },
    });
  });

  it('returns sanitized cover bytes when a concurrent clear removes the write target', async () => {
    await service.writeEbookCover('source-one', 'remote-ebook', 'medium', {
      status: 200,
      contentType: 'image/png',
      contentLength: 3,
      body: Buffer.from('one'),
      fileName: null,
    });
    const coverBin = (await findCoverBin(appDataPath))!;
    const coverDir = coverBin.slice(0, coverBin.lastIndexOf('/'));
    await fs.rm(coverBin, { force: true });
    await fs.rm(join(coverDir, 'metadata.json'), { force: true });
    await fs.chmod(coverDir, 0o500);

    try {
      await expect(
        service.writeEbookCover('source-one', 'remote-ebook', 'medium', {
          status: 200,
          contentType: 'image/png',
          contentLength: 3,
          body: Buffer.from('one'),
          fileName: 'remote-cover.png',
        }),
      ).resolves.toEqual({
        status: 200,
        contentType: 'image/png',
        contentLength: 3,
        body: Buffer.from('one'),
        fileName: null,
      });
    } finally {
      await fs.chmod(coverDir, 0o700);
    }
  });
});

async function findCoverBin(dir: string): Promise<string | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const match = await findCoverBin(entryPath);
      if (match) {
        return match;
      }
    } else if (entry.isFile() && entry.name === 'cover.bin') {
      return entryPath;
    }
  }
  return null;
}
