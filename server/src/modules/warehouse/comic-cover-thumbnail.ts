import { Readable } from 'stream';
import sharp from 'sharp';

import type { WarehouseBinaryResponse } from './warehouse-client.service';

/**
 * A comic cover is page one of the archive, which the warehouse serves at full print
 * resolution: roughly 2MB per image on CT139. A grid of forty posters therefore pulled
 * about 80MB before this, so covers are downscaled here and cached.
 */
export const COMIC_COVER_THUMBNAIL_WIDTH_PX = 400;

/** Guards against decoding a hostile or absurd image into memory. */
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;

export async function readBoundedBody(body: WarehouseBinaryResponse['body']): Promise<Buffer | null> {
  if (Buffer.isBuffer(body)) return body.length > MAX_SOURCE_BYTES ? null : body;
  if (!(body instanceof Readable)) return null;

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Buffer);
    total += buffer.length;
    if (total > MAX_SOURCE_BYTES) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Returns the original response untouched when the image cannot be decoded, so an
 * unexpected format degrades to a heavy cover rather than a broken one.
 */
export async function toComicCoverThumbnail(response: WarehouseBinaryResponse): Promise<WarehouseBinaryResponse> {
  const source = await readBoundedBody(response.body);
  if (!source || source.length === 0) return response;

  try {
    const body = await sharp(source)
      .rotate()
      // withoutEnlargement: a page already narrower than the target must not be upscaled
      // into a bigger file than it started as.
      .resize({ width: COMIC_COVER_THUMBNAIL_WIDTH_PX, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    return {
      status: 200,
      contentType: 'image/webp',
      contentLength: body.length,
      body,
      fileName: null,
    };
  } catch {
    return { ...response, body: source, contentLength: source.length };
  }
}
