import { BadRequestException } from '@nestjs/common';
import type { Mock } from 'vitest';

import { CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types';
import { LibraryController } from './library.controller';

describe('LibraryController', () => {
  const libraryService = {
    findAll: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    prescan: vi.fn(),
    reorder: vi.fn(),
    getStats: vi.fn(),
    getAccess: vi.fn(),
    grantAccess: vi.fn(),
    updateAccess: vi.fn(),
    revokeAccess: vi.fn(),
    writeMetadataToFiles: vi.fn(),
    querySourceBackedCatalogItems: vi.fn(),
    querySourceBackedLibraryBooks: vi.fn(),
    querySourceBackedLibraryJumpBuckets: vi.fn(),
  };

  const bookService = { queryForLibrary: vi.fn(), queryJumpBucketsForLibrary: vi.fn() };

  const bulkRenameService = {
    getPreview: vi.fn(),
    isRunning: vi.fn(),
    execute: vi.fn(),
  };

  const controller = new LibraryController(libraryService as any, bookService as any, bulkRenameService as any);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('passes the source-backed library opt-in flag to findAll', () => {
    const user = { id: 7, isSuperuser: false } as any;

    void controller.findAll(user, 'true');

    expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
  });

  it('includes source-backed libraries by default for app-visible library lists', () => {
    const user = { id: 7, isSuperuser: false } as any;

    void controller.findAll(user, undefined);

    expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
  });

  it('keeps findAll filesystem-only when source-backed libraries are explicitly disabled', () => {
    const user = { id: 7, isSuperuser: false } as any;

    void controller.findAll(user, 'false');

    expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: false });
  });

  it('queries source-backed catalog items through the library service', () => {
    const user = { id: 7, isSuperuser: false } as any;
    const query = { sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 0, size: 50 } } as any;
    const page = { items: [], total: 0, page: 0, limit: 50 };
    libraryService.querySourceBackedCatalogItems.mockReturnValue(page);

    expect(controller.queryCatalogItems(-1, query, user)).toBe(page);
    expect(libraryService.querySourceBackedCatalogItems).toHaveBeenCalledWith(user, -1, query);
  });

  it('routes source-backed library book queries through the native source-backed library service', () => {
    const user = { id: 7, isSuperuser: false } as any;
    const query = { sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 0, size: 50 } } as any;
    const page = { items: [{ type: 'catalog-item', remoteId: 'ebook-1' }], total: 1, page: 0, size: 50 };
    libraryService.querySourceBackedLibraryBooks.mockReturnValue(page);

    expect(controller.queryBooks(CLOUD_EBOOK_LIBRARY_ID, query, user)).toBe(page);
    expect(libraryService.querySourceBackedLibraryBooks).toHaveBeenCalledWith(user, CLOUD_EBOOK_LIBRARY_ID, query);
    expect(libraryService.querySourceBackedCatalogItems).not.toHaveBeenCalled();
    expect(bookService.queryForLibrary).not.toHaveBeenCalled();
  });

  it('routes source-backed library jump buckets through the native source-backed library service', () => {
    const user = { id: 7, isSuperuser: false } as any;
    const query = { sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 0, size: 50 } } as any;
    const buckets = { buckets: [{ key: 'A', label: 'A', index: 0 }], total: 42 };
    libraryService.querySourceBackedLibraryJumpBuckets.mockReturnValue(buckets);

    expect(controller.queryJumpBuckets(CLOUD_COMIC_LIBRARY_ID, query, user)).toBe(buckets);
    expect(libraryService.querySourceBackedLibraryJumpBuckets).toHaveBeenCalledWith(user, CLOUD_COMIC_LIBRARY_ID, query);
    expect(bookService.queryJumpBucketsForLibrary).not.toHaveBeenCalled();
  });

  it('keeps filesystem library book queries on the book service', () => {
    const user = { id: 7, isSuperuser: false } as any;
    const query = { sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 0, size: 50 } } as any;
    const page = { items: [{ id: 123 }], total: 1, page: 0, size: 50 };
    bookService.queryForLibrary.mockReturnValue(page);

    expect(controller.queryBooks(12, query, user)).toBe(page);
    expect(bookService.queryForLibrary).toHaveBeenCalledWith(user, 12, query);
    expect(libraryService.querySourceBackedLibraryBooks).not.toHaveBeenCalled();
    expect(libraryService.querySourceBackedCatalogItems).not.toHaveBeenCalled();
  });

  it('writeMetadataToFiles blocks non-dry-run when file write is disabled', async () => {
    libraryService.writeMetadataToFiles.mockRejectedValue(new BadRequestException('disabled'));
    const reply = {
      raw: {
        writeHead: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        writableEnded: false,
        destroyed: false,
      },
    };

    await expect(controller.writeMetadataToFiles(1, undefined, { id: 1, isSuperuser: true } as any, reply as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('writeMetadataToFiles streams progress and final done event with counters', async () => {
    libraryService.writeMetadataToFiles.mockImplementation(
      (_libraryId: number, _userId: number, _dryRun: boolean, options: { onProgress?: (event: unknown) => void }) => {
        options.onProgress?.({ bookId: 1, status: 'success' });
        options.onProgress?.({ bookId: 2, status: 'failed', reason: 'write failed' });
        options.onProgress?.({ bookId: 3, status: 'skipped', reason: 'no changes' });
        return Promise.resolve({ processed: 3, succeeded: 1, failed: 1, skipped: 1 });
      },
    );

    const reply = {
      raw: {
        writeHead: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        writableEnded: false,
        destroyed: false,
      },
    };

    await controller.writeMetadataToFiles(1, 'false', { id: 7, isSuperuser: false } as any, reply as any);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'text/event-stream' }));
    expect(reply.raw.write).toHaveBeenCalledTimes(4);
    expect(reply.raw.off).toHaveBeenCalledWith('close', expect.any(Function));
    expect(reply.raw.off).toHaveBeenCalledWith('aborted', expect.any(Function));

    const doneLine = (reply.raw.write as Mock).mock.calls[3][0] as string;
    const donePayload = JSON.parse(doneLine.replace(/^data:\s*/, '').trim());
    expect(donePayload).toEqual(expect.objectContaining({ done: true, processed: 3, succeeded: 1, failed: 1, skipped: 1 }));
    expect(reply.raw.end).toHaveBeenCalled();
  });

  it('writeMetadataToFiles does not emit done event when disconnected mid-stream', async () => {
    let disconnect: (() => void) | undefined;
    libraryService.writeMetadataToFiles.mockImplementation(
      (_libraryId: number, _userId: number, _dryRun: boolean, options: { onProgress?: (event: unknown) => void }) => {
        options.onProgress?.({ bookId: 1, status: 'success' });
        disconnect?.();
        options.onProgress?.({ bookId: 2, status: 'success' });
        return Promise.resolve({ processed: 2, succeeded: 2, failed: 0, skipped: 0 });
      },
    );
    const reply = {
      raw: {
        writeHead: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn((event: string, handler: () => void) => {
          if (event === 'close') disconnect = handler;
        }),
        off: vi.fn(),
        writableEnded: false,
        destroyed: false,
      },
    };

    await controller.writeMetadataToFiles(1, 'true', { id: 1, isSuperuser: true } as any, reply as any);

    expect(reply.raw.write).toHaveBeenCalledTimes(1);
    expect(reply.raw.end).toHaveBeenCalled();
  });

  it('queryBooks and queryJumpBuckets delegate to the book service', async () => {
    const user = { id: 4, isSuperuser: false } as any;
    const query = { sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 0, size: 50 } } as any;

    await controller.queryBooks(7, query, user);
    await controller.queryJumpBuckets(7, query, user);

    expect(bookService.queryForLibrary).toHaveBeenCalledWith(user, 7, query);
    expect(bookService.queryJumpBucketsForLibrary).toHaveBeenCalledWith(user, 7, query);
  });
});
