import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Readable } from 'stream';
import { readFile } from 'fs/promises';
import { createInflateRaw } from 'zlib';
import { createExtractorFromData, UnrarError } from 'node-unrar-js';
import { getSevenZip } from '../../../common/sevenzip';
import { imageContentTypeFromPath } from '../../../common/image-content-type';
import { detectComicContainerFormat } from '../../../common/comic-format-detect';
import { createCbzZipEntryReadStream, readCbzZipIndex, type CbzZipEntry } from '../../../common/cbz-zip-reader';

import type { RequestUser } from '../../../common/types/request-user';
import { BookService } from '../../book/book.service';
import { WarehouseCatalogService } from '../../warehouse/warehouse-catalog.service';
import type { WarehouseBinaryResponse } from '../../warehouse/warehouse-client.service';

// ── Shared helpers ─────────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);

function isImage(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot !== -1 && IMAGE_EXTS.has(name.substring(dot).toLowerCase());
}

function isHidden(name: string): boolean {
  return name.split('/').some((p) => p.startsWith('.'));
}

function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function mimeForExt(name: string): string {
  return imageContentTypeFromPath(name);
}

// ── CBZ: ZIP byte-offset scan for in-memory catalog archives ───────────────────

const LFH_SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const DD_SIG = Buffer.from([0x50, 0x4b, 0x07, 0x08]);

interface ZipEntry {
  name: string;
  dataStart: number;
  compressedSize: number;
  compression: number;
}

function buildZipIndex(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let pos = 0;

  while (pos < buf.length - 30) {
    const sigPos = buf.indexOf(LFH_SIG, pos);
    if (sigPos === -1) break;

    const flags = buf.readUInt16LE(sigPos + 6);
    const compression = buf.readUInt16LE(sigPos + 8);
    let compressedSize = buf.readUInt32LE(sigPos + 18);
    const fileNameLen = buf.readUInt16LE(sigPos + 26);
    const extraLen = buf.readUInt16LE(sigPos + 28);
    const dataStart = sigPos + 30 + fileNameLen + extraLen;
    const fileName = buf.subarray(sigPos + 30, sigPos + 30 + fileNameLen).toString('utf-8');

    if ((flags & 0x0008) !== 0 && compressedSize === 0) {
      compressedSize = resolveDataDescriptorSize(buf, dataStart);
    }

    if (!fileName.endsWith('/') && !isHidden(fileName) && isImage(fileName) && (compression === 0 || compression === 8) && compressedSize > 0) {
      entries.push({ name: fileName, dataStart, compressedSize, compression });
    }

    pos = compressedSize > 0 ? dataStart + compressedSize : sigPos + 4;
  }

  entries.sort((a, b) => naturalSort(a.name, b.name));
  return entries;
}

function resolveDataDescriptorSize(buf: Buffer, dataStart: number): number {
  let search = dataStart;
  while (search < buf.length - 16) {
    const idx = buf.indexOf(DD_SIG, search);
    if (idx === -1) break;
    const compressedSize = buf.readUInt32LE(idx + 8);
    if (idx === dataStart + compressedSize) return compressedSize;
    search = idx + 1;
  }
  return 0;
}

// ── CBR: node-unrar-js ─────────────────────────────────────────────────────────

function isUnrarError(err: unknown): err is Error {
  if (typeof UnrarError === 'function' && err instanceof UnrarError) return true;
  if (!(err instanceof Error)) return false;
  const reason = (err as Error & { reason?: unknown }).reason;
  return typeof reason === 'string' && reason.startsWith('ERAR_');
}

function unreadableCbrArchive(err: Error): UnprocessableEntityException {
  return new UnprocessableEntityException(`CBR archive is unreadable: ${err.message}`);
}

function unreadableCbrPage(err: Error): UnprocessableEntityException {
  return new UnprocessableEntityException(`CBR page is unreadable: ${err.message}`);
}

// Buffer.buffer is a shared pool; slice out only the bytes for this buffer.
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// ── Service ────────────────────────────────────────────────────────────────────

interface RarCache {
  buffer: ArrayBuffer;
  pages: string[];
}

@Injectable()
export class CbzService {
  // CBZ: byte-offset index per fileId
  private readonly zipIndex = new Map<number, CbzZipEntry[]>();
  private readonly catalogZipIndex = new Map<string, ZipEntry[]>();
  private readonly zipBuffers = new Map<string, Buffer>();
  // CBR: archive ArrayBuffer + sorted page names per fileId
  private readonly rarCache = new Map<string | number, RarCache>();
  // CB7: sorted page names per fileId (extracted files live in WASM VFS)
  private readonly sevenZPages = new Map<string | number, string[]>();
  // Resolved actual format per fileId (magic bytes override stored extension)
  private readonly resolvedFormat = new Map<number, string>();

  constructor(
    private readonly bookService: BookService,
    private readonly warehouseCatalogService: WarehouseCatalogService,
  ) {}

  private async getFile(fileId: number, user: RequestUser) {
    return this.bookService.verifyFileAccess(fileId, user);
  }

  private async resolveFormat(fileId: number, absolutePath: string, storedFmt: string | null): Promise<string> {
    if (!this.resolvedFormat.has(fileId)) {
      let resolved: string;
      if (storedFmt === 'cbz' || storedFmt === 'cbr' || storedFmt === 'cb7') {
        resolved = await detectComicContainerFormat(absolutePath, storedFmt);
      } else {
        resolved = storedFmt ?? '';
      }
      this.resolvedFormat.set(fileId, resolved);
    }
    return this.resolvedFormat.get(fileId)!;
  }

  // ── CBZ ──────────────────────────────────────────────────────────────────────

  private async getCbzIndex(fileId: number, filePath: string): Promise<CbzZipEntry[]> {
    if (!this.zipIndex.has(fileId)) {
      const index = await readCbzZipIndex(filePath);
      const entries =
        index?.entries
          .filter((entry) => !entry.name.endsWith('/') && !isHidden(entry.name) && isImage(entry.name))
          .filter((entry) => (entry.compression === 0 || entry.compression === 8) && entry.compressedSize > 0)
          .sort((a, b) => naturalSort(a.name, b.name)) ?? [];
      this.zipIndex.set(fileId, entries);
    }
    return this.zipIndex.get(fileId)!;
  }

  private getCatalogCbzIndex(cacheKey: string, buffer: Buffer): ZipEntry[] {
    if (!this.catalogZipIndex.has(cacheKey)) {
      this.catalogZipIndex.set(cacheKey, buildZipIndex(buffer));
    }
    return this.catalogZipIndex.get(cacheKey)!;
  }

  // ── CBR ──────────────────────────────────────────────────────────────────────

  private async getRarCache(fileId: number, filePath: string): Promise<RarCache> {
    if (!this.rarCache.has(fileId)) {
      const buf = await readFile(filePath);
      this.rarCache.set(fileId, await this.buildRarCache(buf));
    }
    return this.rarCache.get(fileId)!;
  }

  private async getCatalogRarCache(cacheKey: string, buffer: Buffer): Promise<RarCache> {
    if (!this.rarCache.has(cacheKey)) {
      this.rarCache.set(cacheKey, await this.buildRarCache(buffer));
    }
    return this.rarCache.get(cacheKey)!;
  }

  private async buildRarCache(buf: Buffer): Promise<RarCache> {
    const ab = toArrayBuffer(buf);

    const pages: string[] = [];
    try {
      const extractor = await createExtractorFromData({ data: ab });
      const { fileHeaders } = extractor.getFileList();
      for (const h of fileHeaders) {
        if (!h.flags.directory && isImage(h.name) && !isHidden(h.name)) {
          pages.push(h.name);
        }
      }
    } catch (err) {
      // Some RAR 1.5 archives throw ERAR_BAD_DATA at the end-of-archive
      // marker instead of returning ERAR_END_ARCHIVE. If we already have
      // pages, the archive is readable — accept the partial list.
      if (!isUnrarError(err) || pages.length === 0) {
        throw isUnrarError(err) ? unreadableCbrArchive(err) : err;
      }
    }

    pages.sort(naturalSort);
    return { buffer: ab, pages };
  }

  private async extractRarPage(buffer: ArrayBuffer, pageName: string): Promise<Uint8Array> {
    // Generators MUST be fully drained to avoid WASM memory leak
    let result: Uint8Array | undefined;
    try {
      const extractor = await createExtractorFromData({ data: buffer });
      // Pass an array so the extractor stops after the first match and never
      // hits the malformed end-of-archive marker present in some RAR 1.5 files.
      const { files } = extractor.extract({ files: [pageName] });
      for (const file of files) {
        if (!file.fileHeader.flags.directory) result = file.extraction;
      }
    } catch (err) {
      if (isUnrarError(err)) {
        throw unreadableCbrPage(err);
      }
      throw err;
    }
    if (result === undefined) throw new NotFoundException(`Page not found in RAR archive`);
    return result;
  }

  // ── CB7 ──────────────────────────────────────────────────────────────────────

  private async getSevenZPages(fileId: number, filePath: string): Promise<string[]> {
    if (!this.sevenZPages.has(fileId)) {
      const buf = await readFile(filePath);
      this.sevenZPages.set(fileId, await this.extractSevenZPages(fileId, buf));
    }
    return this.sevenZPages.get(fileId)!;
  }

  private async getCatalogSevenZPages(cacheKey: string, buffer: Buffer): Promise<string[]> {
    if (!this.sevenZPages.has(cacheKey)) {
      this.sevenZPages.set(cacheKey, await this.extractSevenZPages(cacheKey, buffer));
    }
    return this.sevenZPages.get(cacheKey)!;
  }

  private async extractSevenZPages(cacheKey: string | number, buf: Buffer): Promise<string[]> {
    const sz = await getSevenZip();
    const safeKey = this.safeCacheKey(cacheKey);
    const archivePath = `/a${safeKey}`;
    const outDir = `/p${safeKey}`;

    const fd = sz.FS.open(archivePath, 'w+');
    sz.FS.write(fd, buf, 0, buf.length);
    sz.FS.close(fd);

    try {
      sz.FS.mkdir(outDir);
    } catch {
      // already exists from a previous run
    }

    // callMain is synchronous — blocks the event loop while 7z extracts.
    // Acceptable for a local single-user server; revisit with worker_threads if needed.
    sz.callMain(['e', archivePath, `-o${outDir}`, '-y']);

    const files = sz.FS.readdir(outDir);
    return files.filter((f) => f !== '.' && f !== '..' && isImage(f) && !isHidden(f)).sort(naturalSort);
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  async getPageCount(fileId: number, user: RequestUser): Promise<number> {
    const file = await this.getFile(fileId, user);
    const fmt = await this.resolveFormat(fileId, file.absolutePath, file.format);

    if (fmt === 'cbz') return (await this.getCbzIndex(fileId, file.absolutePath)).length;
    if (fmt === 'cbr') return (await this.getRarCache(fileId, file.absolutePath)).pages.length;
    if (fmt === 'cb7') return (await this.getSevenZPages(fileId, file.absolutePath)).length;

    throw new NotFoundException(`Unsupported comic format: ${fmt}`);
  }

  async streamPage(fileId: number, pageIndex: number, user: RequestUser): Promise<{ stream: NodeJS.ReadableStream; mimeType: string }> {
    const file = await this.getFile(fileId, user);
    const fmt = await this.resolveFormat(fileId, file.absolutePath, file.format);

    if (fmt === 'cbz') {
      const entries = await this.getCbzIndex(fileId, file.absolutePath);
      if (pageIndex < 0 || pageIndex >= entries.length) {
        throw new NotFoundException(`Page ${pageIndex} out of range`);
      }
      const entry = entries[pageIndex];
      return { stream: createCbzZipEntryReadStream(file.absolutePath, entry), mimeType: mimeForExt(entry.name) };
    }

    if (fmt === 'cbr') {
      const { buffer, pages } = await this.getRarCache(fileId, file.absolutePath);
      if (pageIndex < 0 || pageIndex >= pages.length) {
        throw new NotFoundException(`Page ${pageIndex} out of range`);
      }
      const data = await this.extractRarPage(buffer, pages[pageIndex]);
      return { stream: Readable.from(Buffer.from(data)), mimeType: mimeForExt(pages[pageIndex]) };
    }

    if (fmt === 'cb7') {
      const pages = await this.getSevenZPages(fileId, file.absolutePath);
      if (pageIndex < 0 || pageIndex >= pages.length) {
        throw new NotFoundException(`Page ${pageIndex} out of range`);
      }
      const sz = await getSevenZip();
      const data = sz.FS.readFile(`/p${this.safeCacheKey(fileId)}/${pages[pageIndex]}`);
      return { stream: Readable.from(Buffer.from(data)), mimeType: mimeForExt(pages[pageIndex]) };
    }

    throw new NotFoundException(`Unsupported comic format: ${fmt}`);
  }

  async getCatalogPageCount(remoteId: string, format: string, user: RequestUser): Promise<number> {
    const { buffer, cacheKey } = await this.getCatalogArchive(remoteId, user);
    const fmt = this.normalizeCatalogFormat(format);

    if (fmt === 'cbz') return this.getCatalogCbzIndex(cacheKey, buffer).length;
    if (fmt === 'cbr') return (await this.getCatalogRarCache(cacheKey, buffer)).pages.length;
    if (fmt === 'cb7') return (await this.getCatalogSevenZPages(cacheKey, buffer)).length;

    throw new NotFoundException(`Unsupported comic format: ${fmt}`);
  }

  async streamCatalogPage(
    remoteId: string,
    format: string,
    pageIndex: number,
    user: RequestUser,
  ): Promise<{ stream: NodeJS.ReadableStream; mimeType: string }> {
    const { buffer, cacheKey } = await this.getCatalogArchive(remoteId, user);
    const fmt = this.normalizeCatalogFormat(format);

    if (fmt === 'cbz') {
      const entries = this.getCatalogCbzIndex(cacheKey, buffer);
      if (pageIndex < 0 || pageIndex >= entries.length) {
        throw new NotFoundException(`Page ${pageIndex} out of range`);
      }
      const entry = entries[pageIndex];
      const raw = Readable.from(buffer.subarray(entry.dataStart, entry.dataStart + entry.compressedSize));
      const stream = entry.compression === 0 ? raw : raw.pipe(createInflateRaw());
      return { stream, mimeType: mimeForExt(entry.name) };
    }

    if (fmt === 'cbr') {
      const { buffer: rarBuffer, pages } = await this.getCatalogRarCache(cacheKey, buffer);
      if (pageIndex < 0 || pageIndex >= pages.length) {
        throw new NotFoundException(`Page ${pageIndex} out of range`);
      }
      const data = await this.extractRarPage(rarBuffer, pages[pageIndex]);
      return { stream: Readable.from(Buffer.from(data)), mimeType: mimeForExt(pages[pageIndex]) };
    }

    if (fmt === 'cb7') {
      const pages = await this.getCatalogSevenZPages(cacheKey, buffer);
      if (pageIndex < 0 || pageIndex >= pages.length) {
        throw new NotFoundException(`Page ${pageIndex} out of range`);
      }
      const sz = await getSevenZip();
      const data = sz.FS.readFile(`/p${this.safeCacheKey(cacheKey)}/${pages[pageIndex]}`);
      return { stream: Readable.from(Buffer.from(data)), mimeType: mimeForExt(pages[pageIndex]) };
    }

    throw new NotFoundException(`Unsupported comic format: ${fmt}`);
  }

  private async getCatalogArchive(remoteId: string, user: RequestUser): Promise<{ buffer: Buffer; cacheKey: string }> {
    const cacheKey = `catalog:${user.id}:${remoteId}`;
    if (!this.zipBuffers.has(cacheKey)) {
      const response = await this.warehouseCatalogService.downloadEbook(user, remoteId);
      this.zipBuffers.set(cacheKey, await this.binaryBodyToBuffer(response));
    }
    return { buffer: this.zipBuffers.get(cacheKey)!, cacheKey };
  }

  private async binaryBodyToBuffer(response: WarehouseBinaryResponse): Promise<Buffer> {
    if (Buffer.isBuffer(response.body)) return response.body;

    const chunks: Buffer[] = [];
    for await (const chunk of response.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private normalizeCatalogFormat(format: string): string {
    const normalized = format.trim().toLowerCase();
    return normalized === 'cbz' || normalized === 'cbr' || normalized === 'cb7' ? normalized : '';
  }

  private safeCacheKey(cacheKey: string | number): string {
    return Buffer.from(String(cacheKey)).toString('base64url');
  }
}
