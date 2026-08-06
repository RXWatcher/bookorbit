import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as unzipper from 'unzipper';
import { XMLParser } from 'fast-xml-parser';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFileChapters, bookFiles } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const EXTRACT_EVENT = 'koreader.chapter_extract';

interface SpineChapter {
  index: number;
  href: string | null;
  title: string | null;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
});

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function getText(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (v != null && typeof v === 'object') {
    const text = (v as Record<string, unknown>)['#text'];
    if (typeof text === 'string') return text.trim() || null;
    if (typeof text === 'number') return String(text);
  }
  return null;
}

function normalizeZipPath(path: string): string {
  const clean = (path ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = clean.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (resolved.length > 0) resolved.pop();
      continue;
    }
    resolved.push(part);
  }
  return resolved.join('/');
}

function resolveHref(href: string, basePath: string): string {
  if (!href || /^[a-z][a-z\d+.-]*:/i.test(href)) return href;
  const path = href.split('#')[0].split('?')[0];
  return path.startsWith('/') ? normalizeZipPath(path) : normalizeZipPath(basePath + path);
}

function findInZip(files: unzipper.File[], path: string): unzipper.File | undefined {
  const clean = normalizeZipPath(path);
  const cleanLower = clean.toLowerCase();
  let ciMatch: unzipper.File | undefined;
  for (const file of files) {
    const fp = normalizeZipPath(file.path);
    if (fp === clean) return file;
    if (!ciMatch && fp.toLowerCase() === cleanLower) ciMatch = file;
  }
  return ciMatch;
}

@Injectable()
export class KoreaderChapterExtractorService {
  private readonly logger = new Logger(KoreaderChapterExtractorService.name);
  private readonly extractionInProgress = new Set<number>();

  constructor(@Inject(DB) private readonly db: Db) {}

  async extractAndStoreChapters(bookFileId: number): Promise<SpineChapter[]> {
    const start = Date.now();

    const [file] = await this.db
      .select({ absolutePath: bookFiles.absolutePath, format: bookFiles.format })
      .from(bookFiles)
      .where(eq(bookFiles.id, bookFileId))
      .limit(1);

    if (!file || file.format !== 'epub') {
      return [];
    }

    if (this.extractionInProgress.has(bookFileId)) {
      return this.getStoredChapters(bookFileId);
    }

    this.extractionInProgress.add(bookFileId);

    try {
      const existing = await this.db
        .select({ chapterIndex: bookFileChapters.chapterIndex })
        .from(bookFileChapters)
        .where(eq(bookFileChapters.bookFileId, bookFileId))
        .limit(1);

      if (existing.length > 0) {
        return this.getStoredChapters(bookFileId);
      }

      this.logger.log(`[${EXTRACT_EVENT}] [start] bookFileId=${bookFileId} path="${file.absolutePath}" - extracting chapters`);
      const chapters = await this.extractChaptersFromEpub(file.absolutePath);

      if (chapters.length > 0) {
        await this.db.insert(bookFileChapters).values(
          chapters.map((ch) => ({
            bookFileId,
            chapterIndex: ch.index,
            href: ch.href,
            title: ch.title,
          })),
        );
      }

      const durationMs = Date.now() - start;
      this.logger.log(
        `[${EXTRACT_EVENT}] [end] bookFileId=${bookFileId} chapterCount=${chapters.length} durationMs=${durationMs} - chapters extracted`,
      );

      return chapters;
    } catch (error: unknown) {
      const durationMs = Date.now() - start;
      const errorClass = error instanceof Error ? error.constructor.name : 'Unknown';
      const errorMsg = error instanceof Error ? error.message.slice(0, 100) : 'unknown error';
      this.logger.warn(
        `[${EXTRACT_EVENT}] [fail] bookFileId=${bookFileId} durationMs=${durationMs} errorClass=${errorClass} error="${errorMsg}" - chapter extraction failed`,
      );
      return [];
    } finally {
      this.extractionInProgress.delete(bookFileId);
    }
  }

  async getStoredChapters(bookFileId: number): Promise<SpineChapter[]> {
    const rows = await this.db
      .select({
        index: bookFileChapters.chapterIndex,
        href: bookFileChapters.href,
        title: bookFileChapters.title,
      })
      .from(bookFileChapters)
      .where(eq(bookFileChapters.bookFileId, bookFileId))
      .orderBy(bookFileChapters.chapterIndex);

    return rows;
  }

  async invalidateChapters(bookFileId: number): Promise<void> {
    await this.db.delete(bookFileChapters).where(eq(bookFileChapters.bookFileId, bookFileId));
  }

  private async extractChaptersFromEpub(epubPath: string): Promise<SpineChapter[]> {
    const zip = await unzipper.Open.file(epubPath);

    const containerEntry = findInZip(zip.files, 'META-INF/container.xml');
    if (!containerEntry) throw new Error('Missing META-INF/container.xml');
    const containerDoc = xmlParser.parse(await containerEntry.buffer()) as Record<string, unknown>;

    const container = containerDoc['container'] as Record<string, unknown>;
    const rootfiles = (container?.rootfiles as Record<string, unknown>)?.rootfile;
    const rootfile: unknown = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles;
    const opfPath = (rootfile as Record<string, string>)?.['@_full-path'];
    if (!opfPath) throw new Error('Cannot find OPF path');

    const rootPath = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

    const opfEntry = findInZip(zip.files, opfPath);
    if (!opfEntry) throw new Error(`OPF not found: ${opfPath}`);
    const opfDoc = xmlParser.parse(await opfEntry.buffer()) as Record<string, unknown>;
    const pkg = (opfDoc['package'] ?? opfDoc) as Record<string, unknown>;
    const manifestEl = pkg['manifest'] as Record<string, unknown> | undefined;
    const spineEl = pkg['spine'] as Record<string, unknown> | undefined;

    const manifestById = new Map<string, { href: string; properties?: string[] }>();
    for (const item of toArray(manifestEl?.item as any)) {
      const id = item['@_id'] as string;
      const relHref = item['@_href'] as string;
      const fullHref = normalizeZipPath(resolveHref(relHref, rootPath));
      const propertiesStr = item['@_properties'] as string | undefined;
      const properties = propertiesStr ? propertiesStr.split(/\s+/) : undefined;
      manifestById.set(id, { href: fullHref, properties });
    }

    const spineItems: { href: string }[] = [];
    for (const itemref of toArray(spineEl?.itemref as any)) {
      const idref = itemref['@_idref'] as string;
      const m = manifestById.get(idref);
      if (m) spineItems.push({ href: m.href });
    }

    const tocMap = await this.buildTocMap(zip, manifestById, rootPath);

    return spineItems.map((item, index) => ({
      index,
      href: item.href,
      title: tocMap.get(item.href) ?? tocMap.get(item.href.split('#')[0]) ?? null,
    }));
  }

  private async buildTocMap(
    zip: unzipper.CentralDirectory,
    manifestById: Map<string, { href: string; properties?: string[] }>,
    rootPath: string,
  ): Promise<Map<string, string>> {
    const tocMap = new Map<string, string>();

    const navItem = [...manifestById.values()].find((m) => m.properties?.includes('nav'));
    if (navItem) {
      try {
        const navEntry = findInZip(zip.files, navItem.href);
        if (navEntry) {
          const navDoc = xmlParser.parse(await navEntry.buffer()) as Record<string, unknown>;
          const navDir = navItem.href.includes('/') ? navItem.href.slice(0, navItem.href.lastIndexOf('/') + 1) : rootPath;
          const html = (navDoc['html'] ?? navDoc) as Record<string, unknown>;
          const body = html['body'] as Record<string, unknown> | undefined;
          const navs = toArray(body?.nav as any);
          const tocNav = (navs.find((n: any) => {
            const type = n['@_epub:type'] ?? n['@_type'];
            return typeof type === 'string' && type.split(/\s+/).includes('toc');
          }) ?? navs[0]) as Record<string, unknown> | undefined;
          if (tocNav) {
            const ol = tocNav['ol'] as Record<string, unknown> | undefined;
            if (ol) this.flattenNavOl(ol, navDir, tocMap);
          }
        }
      } catch {
        // fall through to NCX
      }
    }

    if (tocMap.size === 0) {
      const ncxItem = [...manifestById.values()].find((m) => m.href.endsWith('.ncx'));
      if (ncxItem) {
        try {
          const ncxEntry = findInZip(zip.files, ncxItem.href);
          if (ncxEntry) {
            const ncxDoc = xmlParser.parse(await ncxEntry.buffer()) as Record<string, unknown>;
            const ncxDir = ncxItem.href.includes('/') ? ncxItem.href.slice(0, ncxItem.href.lastIndexOf('/') + 1) : rootPath;
            const ncx = (ncxDoc['ncx'] ?? ncxDoc) as Record<string, unknown>;
            const navMap = ncx['navMap'] as Record<string, unknown> | undefined;
            if (navMap) this.flattenNcxNavPoints(navMap, ncxDir, tocMap);
          }
        } catch {
          // TOC unavailable
        }
      }
    }

    return tocMap;
  }

  private flattenNavOl(ol: Record<string, unknown>, basePath: string, map: Map<string, string>): void {
    for (const li of toArray(ol?.li as any)) {
      const a = li?.a as Record<string, unknown> | string | undefined;
      let label = '';
      let href: string | undefined;

      if (typeof a === 'string') {
        label = a.trim();
      } else if (a != null) {
        label = getText(a) ?? getText(a.span) ?? '';
        const rawHref = a['@_href'] as string | undefined;
        if (rawHref && !rawHref.startsWith('http')) href = resolveHref(rawHref, basePath);
      }

      if (label && href) {
        const hrefNoFragment = href.split('#')[0];
        if (!map.has(hrefNoFragment)) {
          map.set(hrefNoFragment, label);
        }
        if (!map.has(href)) {
          map.set(href, label);
        }
      }

      const nestedOl = li?.ol as Record<string, unknown> | undefined;
      if (nestedOl) this.flattenNavOl(nestedOl, basePath, map);
    }
  }

  private flattenNcxNavPoints(parent: Record<string, unknown>, basePath: string, map: Map<string, string>): void {
    for (const np of toArray(parent?.navPoint as any)) {
      const navLabel = np?.navLabel as Record<string, unknown> | undefined;
      const label = getText(navLabel?.text) ?? '';
      const content = np?.content as Record<string, string> | undefined;
      let href = content?.['@_src'];
      if (href && !href.startsWith('http')) href = resolveHref(href, basePath);

      if (label && href) {
        const hrefNoFragment = href.split('#')[0];
        if (!map.has(hrefNoFragment)) {
          map.set(hrefNoFragment, label);
        }
        if (!map.has(href)) {
          map.set(href, label);
        }
      }

      this.flattenNcxNavPoints(np, basePath, map);
    }
  }
}
