import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { walkFiles } from './local-scan.walker';

async function collect(root: string, extensions: string[], excludePatterns: string[] = []): Promise<string[]> {
  const found: string[] = [];
  for await (const candidate of walkFiles(root, { extensions, excludePatterns })) {
    found.push(candidate.relativePath);
  }
  return found.sort();
}

describe('walkFiles', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'bookorbit-walker-'));
    await fs.mkdir(join(root, 'Author', 'Book (1)'), { recursive: true });
    await fs.mkdir(join(root, '.caltrash', 'b'), { recursive: true });
    await fs.writeFile(join(root, 'Author', 'Book (1)', 'book.epub'), 'x');
    await fs.writeFile(join(root, 'Author', 'Book (1)', 'cover.jpg'), 'x');
    await fs.writeFile(join(root, '.caltrash', 'b', 'junk.epub'), 'x');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('yields only files with the requested extensions', async () => {
    await expect(collect(root, ['.epub'])).resolves.toEqual(['.caltrash/b/junk.epub', 'Author/Book (1)/book.epub']);
  });

  it('skips excluded directories', async () => {
    await expect(collect(root, ['.epub'], ['.caltrash'])).resolves.toEqual(['Author/Book (1)/book.epub']);
  });

  it('matches extensions case insensitively', async () => {
    await fs.writeFile(join(root, 'Author', 'Book (1)', 'other.EPUB'), 'x');
    const found = await collect(root, ['.epub'], ['.caltrash']);
    expect(found).toContain('Author/Book (1)/other.EPUB');
  });

  it('yields file level candidates carrying a file name', async () => {
    for await (const candidate of walkFiles(root, { extensions: ['.epub'], excludePatterns: ['.caltrash'] })) {
      expect(candidate.fileName).toBe('book.epub');
      expect(candidate.absolutePath.endsWith(candidate.relativePath)).toBe(true);
    }
  });

  it('does not throw when the root does not exist', async () => {
    await expect(collect(join(root, 'missing'), ['.epub'])).resolves.toEqual([]);
  });
});
