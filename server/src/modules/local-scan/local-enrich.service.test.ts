import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const cbzMocks = vi.hoisted(() => ({
  readCbzZipIndex: vi.fn<(path: string) => Promise<{ entries: Array<{ fileName: string }> } | null>>(),
  extractCbzZipEntry: vi.fn<() => Promise<Buffer | null>>(),
}));
vi.mock('../../common/cbz-zip-reader', () => cbzMocks);

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

function makeRepository(rows: Array<{ id: number; localPath: string | null; mediaType?: string }>) {
  const applied = new Map<number, Record<string, unknown>>();
  const repository = {
    streamLocalItemsNeedingEnrichment: vi.fn().mockImplementation(async function* () {
      await Promise.resolve();
      yield rows;
    }),
    applyEnrichmentBatch: vi.fn().mockImplementation((updates: Array<{ id: number; values: Record<string, unknown> }>) => {
      for (const update of updates) applied.set(update.id, update.values);
      return Promise.resolve(updates.length);
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
  describe('comics', () => {
    const COMIC_XML =
      '<ComicInfo><Title>The Dark Knight</Title><Series>Batman, Incorporated</Series>' +
      '<Number>13</Number><Writer>Grant Morrison</Writer><Publisher>DC Comics</Publisher><Year>2013</Year></ComicInfo>';
    const COMIC_PATH = '/comics/English/Batman (2012)/Batman #13 (2012).cbz';

    beforeEach(() => {
      cbzMocks.readCbzZipIndex.mockReset();
      cbzMocks.extractCbzZipEntry.mockReset();
    });

    it('prefers an embedded ComicInfo.xml', async () => {
      cbzMocks.readCbzZipIndex.mockResolvedValue({ entries: [{ fileName: 'ComicInfo.xml' }] });
      cbzMocks.extractCbzZipEntry.mockResolvedValue(Buffer.from(COMIC_XML, 'utf8'));
      const { repository, applied } = makeRepository([{ id: 1, localPath: COMIC_PATH, mediaType: 'comic' }]);

      const summary = await new LocalEnrichService(repository as never).enrichAll();

      expect(summary.comicInfoRead).toBe(1);
      expect(applied.get(1)).toMatchObject({
        title: 'The Dark Knight',
        series: 'Batman, Incorporated',
        seriesIndex: 13,
        authors: ['Grant Morrison'],
        publisher: 'DC Comics',
        publishedYear: 2013,
      });
    });

    // The Calibre fallback reads the parent directory as the author, which for a comic is
    // the language folder. That would stamp "English" on every comic in the library.
    it('never invents an author from the folder when there is no ComicInfo', async () => {
      cbzMocks.readCbzZipIndex.mockResolvedValue(null);
      const { repository, applied } = makeRepository([{ id: 1, localPath: COMIC_PATH, mediaType: 'comic' }]);

      const summary = await new LocalEnrichService(repository as never).enrichAll();

      const values = applied.get(1)!;
      expect(summary.comicInfoRead).toBe(0);
      expect(values.authors).toBeUndefined();
      expect(values).toMatchObject({ title: 'Batman #13 (2012)', series: 'Batman', seriesIndex: 13 });
    });

    it('falls back to the filename when the archive cannot be read', async () => {
      cbzMocks.readCbzZipIndex.mockRejectedValue(new Error('corrupt'));
      const { repository, applied } = makeRepository([{ id: 1, localPath: COMIC_PATH, mediaType: 'comic' }]);

      await new LocalEnrichService(repository as never).enrichAll();

      expect(applied.get(1)).toMatchObject({ series: 'Batman', seriesIndex: 13 });
    });
  });
});
