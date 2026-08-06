import { collectWarehouseMigrationLedgerSeeds, WAREHOUSE_MIGRATIONS_TABLE } from './migrate';

describe('runtime migration runner', () => {
  it('uses a separate table for warehouse migrations', () => {
    expect(WAREHOUSE_MIGRATIONS_TABLE).toBe('__drizzle_warehouse_migrations');
  });

  it('seeds the warehouse ledger from warehouse migrations already recorded in the main ledger', () => {
    const seeds = collectWarehouseMigrationLedgerSeeds({
      warehouseMigrations: [
        { createdAt: 1780441770800, hash: 'warehouse-foundation' },
        { createdAt: 1780457629340, hash: 'warehouse-duration' },
        { createdAt: 1782421105748, hash: 'warehouse-indexes' },
      ],
      mainLedgerCreatedAts: new Set([1780441770800, 1782421105748]),
      warehouseLedgerCreatedAts: new Set([1780441770800]),
    });

    expect(seeds).toEqual([{ createdAt: 1782421105748, hash: 'warehouse-indexes' }]);
  });
});
