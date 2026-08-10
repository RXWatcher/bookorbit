import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { LocalEnrichService } from './local-enrich.service';

const OPF = `<?xml version='1.0' encoding='utf-8'?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier opf:scheme="ISBN">9781451684537</dc:identifier>
    <dc:title>Anatomy of a Genocide</dc:title>
    <dc:creator opf:role="aut">Omer Bartov</dc:creator>
    <dc:publisher>Simon &amp; Schuster</dc:publisher>
    <dc:language>eng</dc:language>
    <dc:subject>History</dc:subject>
    <dc:date>2018-01-23T00:00:00+00:00</dc:date>
  </metadata>
</package>`;

function makeRepository(rows: Array<{ id: number; localPath: string | null }>) {
  const applied = new Map<number, Record<string, unknown>>();
  const repository = {
    streamLocalItemsNeedingEnrichment: vi.fn().mockImplementation(async function* () {
      await Promise.resolve();
      yield rows;
    }),
    applyEnrichment: vi.fn().mockImplementation((id: number, values: Record<string, unknown>) => {
      applied.set(id, values);
      return Promise.resolve();
    }),
  };
  return { repository, applied };
}

describe('LocalEnrichService', () => {
  let root: string;
  let bookDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'bookorbit-enrich-'));
    bookDir = join(root, 'Omer Bartov', 'Anatomy of a Genocide (61069)');
    await fs.mkdir(bookDir, { recursive: true });
    await fs.writeFile(join(bookDir, 'book.epub'), 'x');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('populates catalogue fields from the sidecar', async () => {
    await fs.writeFile(join(bookDir, 'metadata.opf'), OPF);
    const { repository, applied } = makeRepository([{ id: 1, localPath: join(bookDir, 'book.epub') }]);

    const summary = await new LocalEnrichService(repository as never).enrichAll();

    expect(summary.enriched).toBe(1);
    const values = applied.get(1);
    expect(values).toMatchObject({
      title: 'Anatomy of a Genocide',
      authors: ['Omer Bartov'],
      publisher: 'Simon & Schuster',
      language: 'eng',
      tags: ['History'],
      publishedYear: 2018,
    });
    expect((values?.identifiers as Record<string, string>).isbn).toBe('9781451684537');
  });

  it('marks has_cover when a cover file sits beside the book', async () => {
    await fs.writeFile(join(bookDir, 'metadata.opf'), OPF);
    await fs.writeFile(join(bookDir, 'cover.jpg'), 'img');
    const { repository, applied } = makeRepository([{ id: 1, localPath: join(bookDir, 'book.epub') }]);

    const summary = await new LocalEnrichService(repository as never).enrichAll();

    expect(summary.coversFound).toBe(1);
    expect(applied.get(1)?.hasCover).toBe(true);
  });

  it('falls back to the author from the path when the sidecar is missing', async () => {
    const { repository, applied } = makeRepository([{ id: 1, localPath: join(bookDir, 'book.epub') }]);

    const summary = await new LocalEnrichService(repository as never).enrichAll();

    expect(summary.noSidecar).toBe(1);
    expect(summary.enriched).toBe(1);
    expect(applied.get(1)).toMatchObject({ title: 'Anatomy of a Genocide', authors: ['Omer Bartov'] });
  });

  it('falls back rather than failing when the sidecar is corrupt', async () => {
    await fs.writeFile(join(bookDir, 'metadata.opf'), 'not xml <<<');
    const { repository, applied } = makeRepository([{ id: 1, localPath: join(bookDir, 'book.epub') }]);

    const summary = await new LocalEnrichService(repository as never).enrichAll();

    expect(summary.unparsable).toBe(1);
    expect(applied.get(1)).toMatchObject({ authors: ['Omer Bartov'] });
  });

  it('skips a row with no local path without writing to it', async () => {
    const { repository, applied } = makeRepository([{ id: 1, localPath: null }]);

    const summary = await new LocalEnrichService(repository as never).enrichAll();

    expect(summary.examined).toBe(1);
    expect(summary.enriched).toBe(0);
    expect(applied.size).toBe(0);
  });
});
