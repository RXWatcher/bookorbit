import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { LocalContentService } from './local-content.service';

function makeRepository(roots: string[]) {
  return { findAllRootPaths: vi.fn().mockResolvedValue(roots) };
}

async function readStream(body: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

describe('LocalContentService', () => {
  let root: string;
  let bookDir: string;
  let bookPath: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'bookorbit-content-'));
    bookDir = join(root, 'Author', 'Book (1)');
    await fs.mkdir(bookDir, { recursive: true });
    bookPath = join(bookDir, 'book.epub');
    await fs.writeFile(bookPath, 'ABCDEFGHIJ');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('streams a whole file with its content type', async () => {
    const service = new LocalContentService(makeRepository([root]) as never);

    const response = await service.getFile(bookPath);

    expect(response.status).toBe(200);
    expect(response.contentType).toBe('application/epub+zip');
    expect(response.contentLength).toBe(10);
    expect(response.acceptRanges).toBe('bytes');
    await expect(readStream(response.body)).resolves.toBe('ABCDEFGHIJ');
  });

  it('serves a byte range as 206 with a content range header', async () => {
    const service = new LocalContentService(makeRepository([root]) as never);

    const response = await service.getFile(bookPath, 'bytes=2-5');

    expect(response.status).toBe(206);
    expect(response.contentRange).toBe('bytes 2-5/10');
    expect(response.contentLength).toBe(4);
    await expect(readStream(response.body)).resolves.toBe('CDEF');
  });

  it('serves an open ended range to the end of the file', async () => {
    const service = new LocalContentService(makeRepository([root]) as never);

    const response = await service.getFile(bookPath, 'bytes=7-');

    expect(response.status).toBe(206);
    expect(response.contentRange).toBe('bytes 7-9/10');
    await expect(readStream(response.body)).resolves.toBe('HIJ');
  });

  it('serves a suffix range as the final bytes', async () => {
    const service = new LocalContentService(makeRepository([root]) as never);

    const response = await service.getFile(bookPath, 'bytes=-3');

    expect(response.status).toBe(206);
    expect(response.contentRange).toBe('bytes 7-9/10');
  });

  it('answers 416 when the range starts past the end of the file', async () => {
    const service = new LocalContentService(makeRepository([root]) as never);

    const response = await service.getFile(bookPath, 'bytes=99-200');

    expect(response.status).toBe(416);
    expect(response.contentRange).toBe('bytes */10');
  });

  it('refuses a path that escapes every configured root', async () => {
    const outside = await fs.mkdtemp(join(tmpdir(), 'bookorbit-outside-'));
    const secret = join(outside, 'secret.epub');
    await fs.writeFile(secret, 'nope');
    const service = new LocalContentService(makeRepository([root]) as never);

    try {
      await expect(service.getFile(secret)).rejects.toThrow('not available');
      await expect(service.getFile(join(root, '..', 'escape.epub'))).rejects.toThrow('not available');
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('reports a bad gateway when the file is gone, so a lost mount is distinguishable', async () => {
    const service = new LocalContentService(makeRepository([root]) as never);

    await expect(service.getFile(join(bookDir, 'missing.epub'))).rejects.toThrow('mount may be unavailable');
  });

  it('serves the sibling cover file', async () => {
    await fs.writeFile(join(bookDir, 'cover.jpg'), 'img');
    const service = new LocalContentService(makeRepository([root]) as never);

    const response = await service.getCover(bookPath);

    expect(response.contentType).toBe('image/jpeg');
    await expect(readStream(response.body)).resolves.toBe('img');
  });

  it('reports a missing cover as not found', async () => {
    const service = new LocalContentService(makeRepository([root]) as never);

    await expect(service.getCover(bookPath)).rejects.toThrow('not available');
  });
});
