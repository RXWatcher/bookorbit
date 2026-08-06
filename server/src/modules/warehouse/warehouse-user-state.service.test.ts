import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { WarehouseMediaType, WarehouseUserCatalogStatePatch, WarehouseUserReadStatus } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { ACHIEVEMENT_EVENT_BACKFILL, AchievementEventsService } from '../achievement/achievement-events.service';

import {
  WarehouseRepository,
  type WarehouseCatalogAnnotationRow,
  type WarehouseCatalogBookmarkRow,
  type WarehouseUserCatalogStateRow,
} from './warehouse.repository';
import { WarehouseUserStateService } from './warehouse-user-state.service';

const USER = { id: 42 } as RequestUser;
const UPDATED_AT = new Date('2026-06-03T14:15:16.000Z');

function makeStateRow(overrides: Partial<WarehouseUserCatalogStateRow> = {}): WarehouseUserCatalogStateRow {
  return {
    mediaType: 'ebook',
    remoteId: 'remote-7',
    inLibrary: false,
    favorite: false,
    rating: null,
    readStatus: null,
    progressPercent: null,
    positionSeconds: null,
    finishedAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function makeRepository(): jest.Mocked<WarehouseRepository> {
  return {
    findCatalogItem: vi.fn().mockResolvedValue({ id: 7 }),
    getUserCatalogState: vi.fn().mockResolvedValue(makeStateRow()),
    upsertUserCatalogState: vi.fn().mockResolvedValue(makeStateRow({ updatedAt: UPDATED_AT })),
    findCatalogBookmarks: vi.fn().mockResolvedValue([]),
    findExistingCatalogBookmarkByLocation: vi.fn().mockResolvedValue(null),
    createCatalogBookmark: vi.fn(),
    deleteCatalogBookmark: vi.fn(),
    findCatalogAnnotations: vi.fn().mockResolvedValue([]),
    createCatalogAnnotation: vi.fn(),
    updateCatalogAnnotationNote: vi.fn(),
    deleteCatalogAnnotation: vi.fn(),
    saveCatalogReadingSession: vi.fn().mockResolvedValue({ kind: 'saved' }),
  } as unknown as jest.Mocked<WarehouseRepository>;
}

function makeBookmarkRow(overrides: Partial<WarehouseCatalogBookmarkRow> = {}): WarehouseCatalogBookmarkRow {
  return {
    id: 17,
    userId: USER.id,
    mediaType: 'ebook',
    remoteId: 'remote-7',
    cfi: 'epubcfi(/6/8)',
    title: 'Chapter 2',
    positionSeconds: null,
    createdAt: new Date('2026-06-03T15:30:00.000Z'),
    ...overrides,
  };
}

function makeAnnotationRow(overrides: Partial<WarehouseCatalogAnnotationRow> = {}): WarehouseCatalogAnnotationRow {
  return {
    id: 27,
    userId: USER.id,
    mediaType: 'ebook',
    remoteId: 'remote-7',
    cfi: 'epubcfi(/6/12)',
    text: 'Highlighted text',
    color: '#FACC15',
    style: 'highlight',
    note: null,
    chapterTitle: 'Chapter 3',
    createdAt: new Date('2026-06-04T04:30:00.000Z'),
    updatedAt: new Date('2026-06-04T04:31:00.000Z'),
    ...overrides,
  };
}

function makeService() {
  const repository = makeRepository();
  const achievementEvents = { emit: vi.fn() } as unknown as AchievementEventsService;

  return {
    achievementEvents,
    repository,
    service: new WarehouseUserStateService(repository, achievementEvents),
  };
}

describe('WarehouseUserStateService', () => {
  it('returns default state for an existing catalog item with no user rows', async () => {
    const { repository, service } = makeService();
    repository.getUserCatalogState.mockResolvedValue(makeStateRow());

    await expect(service.getState(USER, 'ebook', 'remote-7')).resolves.toEqual({
      mediaType: 'ebook',
      remoteId: 'remote-7',
      inLibrary: false,
      favorite: false,
      rating: null,
      readStatus: null,
      progressPercent: null,
      positionSeconds: null,
      finishedAt: null,
      updatedAt: null,
    });
    expect(repository.findCatalogItem).toHaveBeenCalledWith('ebook', 'remote-7');
    expect(repository.getUserCatalogState).toHaveBeenCalledWith(USER.id, 'ebook', 'remote-7');
  });

  it('rejects a missing catalog item before writing state', async () => {
    const { repository, service } = makeService();
    repository.findCatalogItem.mockResolvedValue(null);

    await expect(service.patchState(USER, 'ebook', 'missing-id', { favorite: true })).rejects.toThrow(NotFoundException);
    await expect(service.patchState(USER, 'ebook', 'missing-id', { favorite: true })).rejects.toThrow('Library item is not available.');
    expect(repository.upsertUserCatalogState).not.toHaveBeenCalled();
  });

  it('returns 404 for missing catalog items on reads', async () => {
    const { repository, service } = makeService();
    repository.findCatalogItem.mockResolvedValue(null);

    await expect(service.getState(USER, 'ebook', 'missing-id')).rejects.toThrow(NotFoundException);
    await expect(service.getState(USER, 'ebook', 'missing-id')).rejects.toThrow('Library item is not available.');
    expect(repository.getUserCatalogState).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid media type', 'magazine' as WarehouseMediaType, 'remote-7', {}, 'mediaType'],
    ['blank remote ID', 'ebook', '   ', {}, 'remoteId'],
    ['rating below 1', 'ebook', 'remote-7', { rating: 0 }, 'rating'],
    ['rating above 5', 'ebook', 'remote-7', { rating: 6 }, 'rating'],
    ['fractional rating', 'ebook', 'remote-7', { rating: 4.9 }, 'rating'],
    ['progress below 0', 'ebook', 'remote-7', { progressPercent: -1 }, 'progressPercent'],
    ['progress above 100', 'ebook', 'remote-7', { progressPercent: 101 }, 'progressPercent'],
    ['position below 0', 'ebook', 'remote-7', { positionSeconds: -1 }, 'positionSeconds'],
    ['read status outside allowed set', 'ebook', 'remote-7', { readStatus: 'started' as WarehouseUserReadStatus }, 'readStatus'],
  ])('rejects %s with a safe field message', async (_label, mediaType, remoteId, patch, messageField) => {
    const { repository, service } = makeService();

    await expect(service.patchState(USER, mediaType, remoteId, patch as WarehouseUserCatalogStatePatch)).rejects.toThrow(BadRequestException);
    await expect(service.patchState(USER, mediaType, remoteId, patch as WarehouseUserCatalogStatePatch)).rejects.toThrow(messageField);
    expect(repository.findCatalogItem).not.toHaveBeenCalled();
    expect(repository.upsertUserCatalogState).not.toHaveBeenCalled();
  });

  it.each([
    ['null patch', null],
    ['primitive patch', 4],
    ['array patch', []],
    ['omitted patch', undefined],
  ])('rejects malformed direct patch input: %s', async (_label, patch) => {
    const { repository, service } = makeService();

    await expect(service.patchState(USER, 'ebook', 'remote-7', patch as never)).rejects.toThrow(BadRequestException);
    await expect(service.patchState(USER, 'ebook', 'remote-7', patch as never)).rejects.toThrow('State update must be an object.');
    expect(repository.findCatalogItem).not.toHaveBeenCalled();
    expect(repository.upsertUserCatalogState).not.toHaveBeenCalled();
  });

  it('writes only through repository user-state methods using the current user id', async () => {
    const { repository, service } = makeService();
    const patch: WarehouseUserCatalogStatePatch = {
      inLibrary: true,
      favorite: true,
      rating: 5,
      readStatus: 'read',
      progressPercent: 100,
      positionSeconds: 3600,
    };

    await expect(service.patchState(USER, 'audiobook', 'audio-9', patch)).resolves.toEqual({
      ...makeStateRow({ updatedAt: UPDATED_AT }),
      updatedAt: '2026-06-03T14:15:16.000Z',
    });
    expect(repository.findCatalogItem).toHaveBeenCalledWith('audiobook', 'audio-9');
    expect(repository.getUserCatalogState).toHaveBeenCalledWith(USER.id, 'audiobook', 'audio-9');
    expect(repository.upsertUserCatalogState).toHaveBeenCalledWith(USER.id, 'audiobook', 'audio-9', patch);
  });

  it('writes Comic Library state through the same normal user-state path as other source-backed libraries', async () => {
    const { repository, service } = makeService();
    repository.upsertUserCatalogState.mockResolvedValue(
      makeStateRow({
        mediaType: 'comic',
        remoteId: 'comic-9',
        favorite: true,
        readStatus: 'reading',
        progressPercent: 25,
        updatedAt: UPDATED_AT,
      }),
    );

    await expect(
      service.patchState(USER, 'comic', 'comic-9', {
        favorite: true,
        readStatus: 'reading',
        progressPercent: 25,
      }),
    ).resolves.toMatchObject({
      mediaType: 'comic',
      remoteId: 'comic-9',
      favorite: true,
      readStatus: 'reading',
      progressPercent: 25,
      updatedAt: '2026-06-03T14:15:16.000Z',
    });
    expect(repository.findCatalogItem).toHaveBeenCalledWith('comic', 'comic-9');
    expect(repository.upsertUserCatalogState).toHaveBeenCalledWith(USER.id, 'comic', 'comic-9', {
      favorite: true,
      readStatus: 'reading',
      progressPercent: 25,
    });
  });

  it('queues achievement evaluation when a source-backed item is marked complete', async () => {
    const { achievementEvents, service } = makeService();

    await service.patchState(USER, 'ebook', 'remote-7', { readStatus: 'read' });

    expect(achievementEvents.emit).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_BACKFILL, { userId: USER.id });
  });

  it('does not queue achievement evaluation for no-op or non-read source-backed status patches', async () => {
    const { achievementEvents, repository, service } = makeService();

    repository.getUserCatalogState
      .mockResolvedValueOnce(makeStateRow({ readStatus: 'read' }))
      .mockResolvedValueOnce(makeStateRow({ readStatus: null }));

    await service.patchState(USER, 'ebook', 'remote-7', { readStatus: 'read' });
    await service.patchState(USER, 'ebook', 'remote-7', { readStatus: 'skimmed' });

    expect(achievementEvents.emit).not.toHaveBeenCalled();
  });

  it('maps Date updatedAt values to ISO strings and preserves null updatedAt values', async () => {
    const { repository, service } = makeService();
    repository.getUserCatalogState.mockResolvedValueOnce(makeStateRow({ finishedAt: new Date('2026-06-02T10:00:00.000Z'), updatedAt: UPDATED_AT }));
    repository.upsertUserCatalogState.mockResolvedValueOnce(makeStateRow({ updatedAt: null }));

    await expect(service.getState(USER, 'ebook', 'remote-7')).resolves.toMatchObject({
      finishedAt: '2026-06-02T10:00:00.000Z',
      updatedAt: '2026-06-03T14:15:16.000Z',
    });
    await expect(service.patchState(USER, 'ebook', 'remote-7', { favorite: false })).resolves.toMatchObject({
      finishedAt: null,
      updatedAt: null,
    });
  });

  describe('catalog bookmarks', () => {
    it('lists native bookmark rows for an available source-backed item', async () => {
      const { repository, service } = makeService();
      repository.findCatalogBookmarks.mockResolvedValue([makeBookmarkRow()]);

      await expect(service.getBookmarks(USER, 'ebook', 'remote-7')).resolves.toEqual([
        {
          id: 17,
          mediaType: 'ebook',
          remoteId: 'remote-7',
          cfi: 'epubcfi(/6/8)',
          title: 'Chapter 2',
          positionSeconds: null,
          createdAt: '2026-06-03T15:30:00.000Z',
        },
      ]);
      expect(repository.findCatalogItem).toHaveBeenCalledWith('ebook', 'remote-7');
      expect(repository.findCatalogBookmarks).toHaveBeenCalledWith(USER.id, 'ebook', 'remote-7');
    });

    it('returns an existing bookmark when a catalog CFI is already saved', async () => {
      const { repository, service } = makeService();
      const existing = makeBookmarkRow({ id: 22 });
      repository.findExistingCatalogBookmarkByLocation.mockResolvedValue(existing);

      await expect(service.createBookmark(USER, 'ebook', 'remote-7', { cfi: 'epubcfi(/6/8)', title: 'Chapter 2' })).resolves.toMatchObject({
        id: 22,
        mediaType: 'ebook',
        remoteId: 'remote-7',
        cfi: 'epubcfi(/6/8)',
      });
      expect(repository.findExistingCatalogBookmarkByLocation).toHaveBeenCalledWith(USER.id, 'ebook', 'remote-7', {
        cfi: 'epubcfi(/6/8)',
        positionSeconds: null,
      });
      expect(repository.createCatalogBookmark).not.toHaveBeenCalled();
    });

    it('creates catalog bookmarks through the current user scope only', async () => {
      const { repository, service } = makeService();
      const created = makeBookmarkRow({ id: 23, mediaType: 'audiobook', remoteId: 'audio-9', cfi: null, positionSeconds: 91.5, title: '00:01:31' });
      repository.createCatalogBookmark.mockResolvedValue(created);

      await expect(service.createBookmark(USER, 'audiobook', 'audio-9', { title: '00:01:31', positionSeconds: 91.5 })).resolves.toMatchObject({
        id: 23,
        mediaType: 'audiobook',
        remoteId: 'audio-9',
        cfi: null,
        positionSeconds: 91.5,
      });
      expect(repository.findCatalogItem).toHaveBeenCalledWith('audiobook', 'audio-9');
      expect(repository.createCatalogBookmark).toHaveBeenCalledWith(USER.id, 'audiobook', 'audio-9', {
        cfi: null,
        title: '00:01:31',
        positionSeconds: 91.5,
      });
    });

    it('rejects catalog bookmark writes for missing catalog items', async () => {
      const { repository, service } = makeService();
      repository.findCatalogItem.mockResolvedValue(null);

      await expect(service.createBookmark(USER, 'ebook', 'missing-id', { cfi: 'epubcfi(/6/2)', title: 'Start' })).rejects.toThrow(NotFoundException);
      expect(repository.createCatalogBookmark).not.toHaveBeenCalled();
    });

    it('rejects catalog bookmark payloads without a CFI or position', async () => {
      const { repository, service } = makeService();

      await expect(service.createBookmark(USER, 'ebook', 'remote-7', { title: 'Start' })).rejects.toThrow(BadRequestException);
      await expect(service.createBookmark(USER, 'ebook', 'remote-7', { title: 'Start' })).rejects.toThrow(
        'Either cfi or positionSeconds must be provided.',
      );
      expect(repository.findCatalogItem).not.toHaveBeenCalled();
    });

    it('deletes catalog bookmarks by user, media type, remote id, and bookmark id', async () => {
      const { repository, service } = makeService();
      repository.deleteCatalogBookmark.mockResolvedValue(true);

      await expect(service.deleteBookmark(USER, 'ebook', 'remote-7', 17)).resolves.toBeUndefined();
      expect(repository.findCatalogItem).toHaveBeenCalledWith('ebook', 'remote-7');
      expect(repository.deleteCatalogBookmark).toHaveBeenCalledWith(USER.id, 'ebook', 'remote-7', 17);
    });

    it('uses native library item copy when a bookmark is missing', async () => {
      const { repository, service } = makeService();
      repository.deleteCatalogBookmark.mockResolvedValue(false);

      await expect(service.deleteBookmark(USER, 'ebook', 'remote-7', 17)).rejects.toThrow(NotFoundException);
      await expect(service.deleteBookmark(USER, 'ebook', 'remote-7', 17)).rejects.toThrow('Bookmark 17 not found for library item.');
    });
  });

  describe('catalog annotations', () => {
    it('lists native annotation rows for an available source-backed ebook', async () => {
      const { repository, service } = makeService();
      repository.findCatalogAnnotations.mockResolvedValue([makeAnnotationRow()]);

      await expect(service.getAnnotations(USER, 'ebook', 'remote-7')).resolves.toEqual([
        {
          id: 27,
          mediaType: 'ebook',
          remoteId: 'remote-7',
          cfi: 'epubcfi(/6/12)',
          text: 'Highlighted text',
          color: '#FACC15',
          style: 'highlight',
          note: null,
          chapterTitle: 'Chapter 3',
          createdAt: '2026-06-04T04:30:00.000Z',
          updatedAt: '2026-06-04T04:31:00.000Z',
        },
      ]);
      expect(repository.findCatalogItem).toHaveBeenCalledWith('ebook', 'remote-7');
      expect(repository.findCatalogAnnotations).toHaveBeenCalledWith(USER.id, 'ebook', 'remote-7');
    });

    it('creates catalog annotations through the current user scope only', async () => {
      const { repository, service } = makeService();
      repository.createCatalogAnnotation.mockResolvedValue(makeAnnotationRow());

      await expect(
        service.createAnnotation(USER, 'ebook', 'remote-7', {
          cfi: 'epubcfi(/6/12)',
          text: 'Highlighted text',
          color: '#FACC15',
          style: 'highlight',
          chapterTitle: 'Chapter 3',
        }),
      ).resolves.toMatchObject({ id: 27, mediaType: 'ebook', remoteId: 'remote-7' });
      expect(repository.createCatalogAnnotation).toHaveBeenCalledWith(USER.id, 'ebook', 'remote-7', {
        cfi: 'epubcfi(/6/12)',
        text: 'Highlighted text',
        color: '#FACC15',
        style: 'highlight',
        note: null,
        chapterTitle: 'Chapter 3',
      });
    });

    it('updates and deletes catalog annotations inside the current user scope', async () => {
      const { repository, service } = makeService();
      repository.updateCatalogAnnotationNote.mockResolvedValue(makeAnnotationRow({ note: 'Remember this' }));
      repository.deleteCatalogAnnotation.mockResolvedValue(true);

      await expect(service.updateAnnotation(USER, 'ebook', 'remote-7', 27, { note: 'Remember this' })).resolves.toMatchObject({
        id: 27,
        note: 'Remember this',
      });
      await expect(service.deleteAnnotation(USER, 'ebook', 'remote-7', 27)).resolves.toBeUndefined();

      expect(repository.updateCatalogAnnotationNote).toHaveBeenCalledWith(USER.id, 'ebook', 'remote-7', 27, 'Remember this');
      expect(repository.deleteCatalogAnnotation).toHaveBeenCalledWith(USER.id, 'ebook', 'remote-7', 27);
    });

    it('uses native library item copy when an annotation is missing', async () => {
      const { repository, service } = makeService();
      repository.updateCatalogAnnotationNote.mockResolvedValue(null);
      repository.deleteCatalogAnnotation.mockResolvedValue(false);

      await expect(service.updateAnnotation(USER, 'ebook', 'remote-7', 27, { note: 'Remember this' })).rejects.toThrow(
        'Annotation 27 not found for library item.',
      );
      await expect(service.deleteAnnotation(USER, 'ebook', 'remote-7', 27)).rejects.toThrow('Annotation 27 not found for library item.');
    });

    it('rejects catalog annotations for non-ebook media and invalid styles', async () => {
      const { repository, service } = makeService();

      await expect(
        service.createAnnotation(USER, 'audiobook', 'audio-9', { cfi: 'epubcfi(/6/2)', text: 'x', color: '#fff', style: 'highlight' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createAnnotation(USER, 'audiobook', 'audio-9', { cfi: 'epubcfi(/6/2)', text: 'x', color: '#fff', style: 'highlight' }),
      ).rejects.toThrow('Annotations are only supported for ebook library items.');
      await expect(
        service.createAnnotation(USER, 'ebook', 'remote-7', { cfi: 'epubcfi(/6/2)', text: 'x', color: '#fff', style: 'sparkle' }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.createCatalogAnnotation).not.toHaveBeenCalled();
    });
  });

  describe('reading sessions', () => {
    it('records catalog reading sessions through the current user scope', async () => {
      const { repository, service } = makeService();

      await expect(
        service.saveReadingSession(USER, ' ebook ', ' remote-7 ', {
          sessionId: 'session-1',
          startedAt: '2026-06-15T12:00:00.000Z',
          endedAt: '2026-06-15T12:05:00.000Z',
          durationSeconds: 400,
          progressDelta: 12.5,
          endProgress: 42,
        }),
      ).resolves.toBeUndefined();

      expect(repository.findCatalogItem).toHaveBeenCalledWith('ebook', 'remote-7');
      expect(repository.saveCatalogReadingSession).toHaveBeenCalledWith(
        USER.id,
        'ebook',
        'remote-7',
        'session-1',
        new Date('2026-06-15T12:00:00.000Z'),
        new Date('2026-06-15T12:05:00.000Z'),
        300,
        12.5,
        42,
      );
    });

    it('rejects invalid catalog reading session timestamps before writing', async () => {
      const { repository, service } = makeService();

      await expect(
        service.saveReadingSession(USER, 'ebook', 'remote-7', {
          sessionId: 'session-1',
          startedAt: '2026-06-15T12:05:00.000Z',
          endedAt: '2026-06-15T12:00:00.000Z',
          durationSeconds: 60,
          progressDelta: 1,
          endProgress: 2,
        }),
      ).rejects.toThrow('endedAt must be greater than or equal to startedAt');

      expect(repository.saveCatalogReadingSession).not.toHaveBeenCalled();
    });
  });
});
