import { Readable } from 'stream';
import sharp from 'sharp';

import { COMIC_COVER_THUMBNAIL_WIDTH_PX, toComicCoverThumbnail } from './comic-cover-thumbnail';

/** A real encoded image, so sharp is exercised rather than mocked. */
async function jpegPage(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

function response(body: Buffer | Readable, contentType = 'image/jpeg') {
  return { status: 200, contentType, contentLength: Buffer.isBuffer(body) ? body.length : null, body, fileName: null };
}

describe('toComicCoverThumbnail', () => {
  it('downscales a full resolution page and reports webp', async () => {
    const page = await jpegPage(1600, 2400);
    const result = await toComicCoverThumbnail(response(page));

    expect(result.contentType).toBe('image/webp');
    const meta = await sharp(result.body as Buffer).metadata();
    expect(meta.width).toBe(COMIC_COVER_THUMBNAIL_WIDTH_PX);
    expect(meta.height).toBe(600);
  });

  it('makes the cover dramatically smaller than the source page', async () => {
    const page = await jpegPage(1600, 2400);
    const result = await toComicCoverThumbnail(response(page));

    expect(result.contentLength).toBeLessThan(page.length / 2);
    expect(result.contentLength).toBe((result.body as Buffer).length);
  });

  it('does not upscale a page narrower than the target', async () => {
    const page = await jpegPage(120, 180);
    const result = await toComicCoverThumbnail(response(page));

    const meta = await sharp(result.body as Buffer).metadata();
    expect(meta.width).toBe(120);
  });

  it('accepts a streamed body', async () => {
    const page = await jpegPage(800, 1200);
    const result = await toComicCoverThumbnail(response(Readable.from([page])));

    expect(result.contentType).toBe('image/webp');
    expect((result.body as Buffer).length).toBeGreaterThan(0);
  });

  // A page that cannot be decoded must still render as a cover rather than break the grid.
  it('returns the original bytes when the image cannot be decoded', async () => {
    const junk = Buffer.from('not an image at all');
    const result = await toComicCoverThumbnail(response(junk));

    expect(result.body).toEqual(junk);
    expect(result.contentType).toBe('image/jpeg');
  });

  it('returns the response untouched when the body is empty', async () => {
    const result = await toComicCoverThumbnail(response(Buffer.alloc(0)));
    expect(result.contentLength).toBe(0);
  });
});
