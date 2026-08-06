import { ForbiddenException, NotFoundException } from '@nestjs/common';

import * as schema from '../../../db/schema';
import { KoboBookAccessService } from './kobo-book-access.service';

describe('KoboBookAccessService', () => {
  function createService(options: {
    user?: { isSuperuser: boolean } | undefined;
    accessRows?: Array<{ libraryId: number }>;
    selectRows?: unknown[];
    book?: { id: number; libraryId: number } | undefined;
  }) {
    const selectRows = options.selectRows ?? options.accessRows ?? [];
    const selectChain = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
      then: (onFulfilled: (value: unknown[]) => unknown, onRejected?: (error: unknown) => unknown) =>
        Promise.resolve(selectRows).then(onFulfilled, onRejected),
      catch: (onRejected: (error: unknown) => unknown) => Promise.resolve(selectRows).catch(onRejected),
    };
    selectChain.from.mockReturnValue(selectChain);
    selectChain.innerJoin.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
    selectChain.limit.mockResolvedValue(selectRows);

    const db = {
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue(options.user),
        },
        books: {
          findFirst: vi.fn().mockResolvedValue(options.book),
        },
      },
      select: vi.fn().mockReturnValue(selectChain),
    };

    const contentFilterRepository = {
      findByUserId: vi.fn().mockResolvedValue({
        includeTagIds: [],
        excludeTagIds: [],
        includeGenreIds: [],
        excludeGenreIds: [],
      }),
    };

    return {
      service: new KoboBookAccessService(db as never, contentFilterRepository as never),
      db,
      selectChain,
      contentFilterRepository,
    };
  }

  it('throws not found when the book does not exist', async () => {
    const { service } = createService({
      user: { isSuperuser: false },
      book: undefined,
    });

    await expect(service.assertBookAccessible(7, 99)).rejects.toThrow(NotFoundException);
  });

  it('returns null accessible library ids for superusers and scoped ids for regular users', async () => {
    const superuser = createService({
      user: { isSuperuser: true },
      accessRows: [{ libraryId: 10 }],
      book: { id: 42, libraryId: 10 },
    });
    await expect(superuser.service.getAccessibleLibraryIds(7)).resolves.toBeNull();

    const regular = createService({
      user: { isSuperuser: false },
      accessRows: [{ libraryId: 2 }, { libraryId: 4 }],
      book: { id: 42, libraryId: 2 },
    });
    await expect(regular.service.getAccessibleLibraryIds(7)).resolves.toEqual([2, 4]);
  });

  it('throws forbidden when the user lacks access to the book library', async () => {
    const { service } = createService({
      user: { isSuperuser: false },
      accessRows: [{ libraryId: 1 }],
      book: { id: 42, libraryId: 2 },
    });

    await expect(service.assertBookAccessible(7, 42)).rejects.toThrow(ForbiddenException);
  });

  it('allows access when the user can reach the book library', async () => {
    const { service } = createService({
      user: { isSuperuser: false },
      accessRows: [{ libraryId: 2 }],
      book: { id: 42, libraryId: 2 },
    });

    await expect(service.assertBookAccessible(7, 42)).resolves.toBeUndefined();
  });

  it('resolves catalog ebook remote ids from cached ebook rows without user ownership rows', async () => {
    const { service, selectChain } = createService({
      selectRows: [{ remoteId: 'remote/book-42' }],
    });

    await expect(service.resolveCatalogEbookRemoteId(7, 42)).resolves.toBe('remote/book-42');

    expect(selectChain.from).toHaveBeenCalledWith(schema.warehouseCatalogItems);
    expect(selectChain.innerJoin).not.toHaveBeenCalledWith(schema.warehouseUserItems, expect.anything());
  });
});
