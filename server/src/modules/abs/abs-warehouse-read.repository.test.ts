import type { RequestUser } from '../../common/types/request-user';
import type { WarehouseCatalogService } from '../warehouse/warehouse-catalog.service';
import { decodeWarehouseBookId } from '../warehouse/warehouse-book-card.mapper';
import { AbsWarehouseReadRepository, syntheticNameId, toAbsItemRow } from './abs-warehouse-read.repository';

const CLOUD_AUDIO_LIBRARY_ID = -2;

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    mediaType: 'audiobook' as const,
    title: 'Dune',
    subtitle: null,
    series: 'Dune Chronicles',
    seriesIndex: 1,
    language: 'en',
    publisher: 'Chilton',
    publishedYear: 1965,
    durationSeconds: 1234,
    fileSizeBytes: 999,
    format: 'm4b',
    localPath: null,
    authors: ['Frank Herbert'],
    narrators: ['Scott Brick'],
    identifiers: { isbn13: '9780441013593' },
    upstreamCreatedAt: new Date('2020-01-01T00:00:00Z'),
    upstreamUpdatedAt: new Date('2021-01-01T00:00:00Z'),
    ...overrides,
  };
}

const user = { id: 1, isSuperuser: true } as unknown as RequestUser;

describe('toAbsItemRow', () => {
  it('maps a warehouse row onto the shape the native repository returns', () => {
    const row = toAbsItemRow(makeRow() as never, CLOUD_AUDIO_LIBRARY_ID);
    expect(row).toMatchObject({
      libraryId: CLOUD_AUDIO_LIBRARY_ID,
      title: 'Dune',
      publisher: 'Chilton',
      publishedYear: 1965,
      language: 'en',
      seriesName: 'Dune Chronicles',
      seriesIndex: 1,
      durationSeconds: 1234,
      isbn13: '9780441013593',
    });
  });

  // The id must survive the round trip or every follow-up request (cover, play, progress) 404s.
  it('emits an id that decodes back to the catalogue row', () => {
    const row = toAbsItemRow(makeRow() as never, CLOUD_AUDIO_LIBRARY_ID);
    expect(row.id).toBeLessThan(0);
    expect(decodeWarehouseBookId(row.id)).toEqual({ mediaType: 'audiobook', catalogItemId: 7 });
  });

  it('falls back to the epoch rather than an invalid date when no timestamp is stored', () => {
    const row = toAbsItemRow(
      makeRow({ upstreamCreatedAt: null, upstreamUpdatedAt: null, createdAt: null, updatedAt: null, syncedAt: null }) as never,
      -1,
    );
    expect(row.addedAt.getTime()).toBe(0);
    expect(Number.isNaN(row.updatedAt.getTime())).toBe(false);
  });

  it('tolerates missing or malformed identifiers', () => {
    expect(toAbsItemRow(makeRow({ identifiers: null }) as never, -1).isbn13).toBeNull();
    expect(toAbsItemRow(makeRow({ identifiers: { isbn13: 42 } }) as never, -1).isbn13).toBeNull();
  });
});

describe('AbsWarehouseReadRepository', () => {
  function build(rows: unknown[], total: number | null = null) {
    const catalog = {
      listCatalogRowsForAdapter: vi.fn().mockResolvedValue({ rows, total }),
      findAccessibleCatalogItemById: vi.fn().mockResolvedValue(rows[0] ?? null),
    } as unknown as WarehouseCatalogService;
    return { repo: new AbsWarehouseReadRepository(catalog), catalog };
  }

  it('lists items for the audiobook library', async () => {
    const { repo, catalog } = build([makeRow()], 1);
    const { rows, total } = await repo.listItems(user, CLOUD_AUDIO_LIBRARY_ID, { limit: 10, offset: 0 });
    expect(total).toBe(1);
    expect(rows[0].title).toBe('Dune');
    expect(catalog.listCatalogRowsForAdapter).toHaveBeenCalledWith(user, 'audiobook', expect.objectContaining({ limit: 10, offset: 0 }));
  });

  it('returns nothing for a library id that is not source-backed', async () => {
    const { repo, catalog } = build([makeRow()], 1);
    expect(await repo.listItems(user, 5, { limit: 10, offset: 0 })).toEqual({ rows: [], total: 0 });
    expect(catalog.listCatalogRowsForAdapter).not.toHaveBeenCalled();
  });

  it('falls back to the row count when the query skipped the total', async () => {
    const { repo } = build([makeRow()], null);
    expect((await repo.listItems(user, CLOUD_AUDIO_LIBRARY_ID, { limit: 10, offset: 0 })).total).toBe(1);
  });

  it('degrades to empty rather than throwing when there is no warehouse at all', async () => {
    const repo = new AbsWarehouseReadRepository(undefined);
    expect(repo.available).toBe(false);
    expect(await repo.listItems(user, CLOUD_AUDIO_LIBRARY_ID, { limit: 10, offset: 0 })).toEqual({ rows: [], total: 0 });
    expect(await repo.findItem(user, -1)).toBeNull();
  });

  it('builds relations from the jsonb name arrays without extra queries', async () => {
    const { repo } = build([makeRow()]);
    const bookId = toAbsItemRow(makeRow() as never, CLOUD_AUDIO_LIBRARY_ID).id;
    const relations = await repo.relationsFor(user, [bookId]);
    const entry = relations.get(bookId)!;
    expect(entry.authors).toEqual([{ id: syntheticNameId('Frank Herbert'), name: 'Frank Herbert' }]);
    expect(entry.narrators).toEqual([{ name: 'Scott Brick' }]);
    expect(entry.series).toEqual([{ id: syntheticNameId('Dune Chronicles'), name: 'Dune Chronicles', sequence: 1 }]);
    expect(entry.audioFiles).toHaveLength(1);
  });

  // The item mapper asserts a relations entry exists for every row, so a missing one is a 500.
  it('still returns an entry for an id it cannot resolve', async () => {
    const catalog = {
      listCatalogRowsForAdapter: vi.fn(),
      findAccessibleCatalogItemById: vi.fn().mockResolvedValue(null),
    } as unknown as WarehouseCatalogService;
    const relations = await new AbsWarehouseReadRepository(catalog).relationsFor(user, [-1000007, 42]);
    expect(relations.get(-1000007)).toEqual({ authors: [], narrators: [], series: [], audioFiles: [] });
    expect(relations.get(42)).toEqual({ authors: [], narrators: [], series: [], audioFiles: [] });
  });

  it('exposes no audio file for a non-audiobook', async () => {
    const { repo } = build([makeRow({ mediaType: 'ebook' })]);
    const bookId = toAbsItemRow(makeRow({ mediaType: 'ebook' }) as never, -1).id;
    const relations = await repo.relationsFor(user, [bookId]);
    expect(relations.get(bookId)!.audioFiles).toEqual([]);
  });

  it('gives author ids that are stable across calls and differ per name', () => {
    expect(syntheticNameId('Frank Herbert')).toBe(syntheticNameId('frank herbert '));
    expect(syntheticNameId('Frank Herbert')).not.toBe(syntheticNameId('Scott Brick'));
    expect(syntheticNameId('Frank Herbert')).toBeGreaterThan(0);
  });
});
