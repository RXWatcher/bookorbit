import { readFileSync } from 'fs';
import { join } from 'path';

const REPOSITORY = join(__dirname, 'warehouse.repository.ts');
const SYNC_SERVICE = join(__dirname, 'warehouse-catalog-sync.service.ts');

describe('catalog sync never deletes catalog items', () => {
  it('has no delete against warehouseCatalogItems', () => {
    const sources = [readFileSync(REPOSITORY, 'utf8'), readFileSync(SYNC_SERVICE, 'utf8')];

    for (const source of sources) {
      expect(source).not.toMatch(/delete\(\s*schema\.warehouseCatalogItems\s*\)/);
      expect(source).not.toMatch(/notInArray\([^)]*warehouseCatalogItems/);
    }
  });
});
