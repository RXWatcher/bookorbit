import { readFileSync } from 'fs';
import { join } from 'path';

const WAREHOUSE_REPO = join(__dirname, '..', 'warehouse', 'warehouse.repository.ts');
const LOCAL_SCAN_REPO = join(__dirname, '..', 'local-scan', 'local-scan.repository.ts');

describe('search index enqueue coverage', () => {
  it('enqueues from the catalogue upsert and the facet write back', () => {
    const source = readFileSync(WAREHOUSE_REPO, 'utf8');
    const occurrences = source.split('searchIndexEvents').length - 1;

    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('enqueues from the local scan insert, the enrichment update and the delete', () => {
    const source = readFileSync(LOCAL_SCAN_REPO, 'utf8');
    const occurrences = source.split('searchIndexEvents').length - 1;

    expect(occurrences).toBeGreaterThanOrEqual(3);
  });
});
