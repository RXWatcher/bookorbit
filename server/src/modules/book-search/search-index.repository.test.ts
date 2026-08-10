import { SearchIndexRepository } from './search-index.repository';

function makeDb() {
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values });
  return { db: { insert } as never, insert, values };
}

describe('SearchIndexRepository', () => {
  it('enqueues one row per change', async () => {
    const { db, values } = makeDb();

    await new SearchIndexRepository(db).enqueue([
      {
        entityType: 'catalog_item',
        entityId: 'catalog:ebook:1',
        operation: 'upsert',
      },
      { entityType: 'native_book', entityId: 'native:2', operation: 'delete' },
    ]);

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        entityType: 'catalog_item',
        entityId: 'catalog:ebook:1',
        operation: 'upsert',
      }),
      expect.objectContaining({
        entityType: 'native_book',
        entityId: 'native:2',
        operation: 'delete',
      }),
    ]);
  });

  it('does nothing for an empty batch', async () => {
    const { db, insert } = makeDb();

    await new SearchIndexRepository(db).enqueue([]);

    expect(insert).not.toHaveBeenCalled();
  });

  it('writes through a supplied transaction so the event shares the caller commit', async () => {
    const { db } = makeDb();
    const txValues = vi.fn().mockResolvedValue(undefined);
    const tx = { insert: vi.fn().mockReturnValue({ values: txValues }) };

    await new SearchIndexRepository(db).enqueue(
      [
        {
          entityType: 'catalog_item',
          entityId: 'catalog:ebook:1',
          operation: 'upsert',
        },
      ],
      tx,
    );

    expect(txValues).toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});
