import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import type { WalkStats } from './local-scan.types';
import { walkFiles } from './local-scan.walker';

function newStats(): WalkStats {
  return { unreadableDirs: 0, symlinksSkipped: 0 };
}

async function collect(root: string, extensions: string[], excludePatterns: string[] = [], stats: WalkStats = newStats()): Promise<string[]> {
  const found: string[] = [];
  for await (const candidate of walkFiles(root, { extensions, excludePatterns, stats })) {
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
    await expect(collect(root, ['.epub'], ['.caltrash'])).resolves.toContain('Author/Book (1)/other.EPUB');
  });

  it('yields exactly one candidate carrying a usable file name and path', async () => {
    const found: Array<{ fileName: string; absolutePath: string; relativePath: string }> = [];
    for await (const candidate of walkFiles(root, { extensions: ['.epub'], excludePatterns: ['.caltrash'], stats: newStats() })) {
      found.push(candidate);
    }

    expect(found).toHaveLength(1);
    expect(found[0].fileName).toBe('book.epub');
    expect(found[0].absolutePath.endsWith(found[0].relativePath)).toBe(true);
  });

  it('follows a symlinked file', async () => {
    await fs.symlink(join(root, 'Author', 'Book (1)', 'book.epub'), join(root, 'Author', 'Book (1)', 'linked.epub'));
    const stats = newStats();

    const found = await collect(root, ['.epub'], ['.caltrash'], stats);

    expect(found).toContain('Author/Book (1)/linked.epub');
    expect(stats.symlinksSkipped).toBe(0);
  });

  it('counts a symlinked directory instead of descending into it', async () => {
    await fs.symlink(join(root, 'Author'), join(root, 'AuthorLink'));
    const stats = newStats();

    const found = await collect(root, ['.epub'], ['.caltrash'], stats);

    expect(found).toEqual(['Author/Book (1)/book.epub']);
    expect(stats.symlinksSkipped).toBe(1);
  });

  it('counts a directory it cannot open rather than failing silently', async () => {
    const locked = join(root, 'locked');
    await fs.mkdir(locked);
    await fs.writeFile(join(locked, 'hidden.epub'), 'x');
    await fs.chmod(locked, 0o000);
    const stats = newStats();

    try {
      await collect(root, ['.epub'], ['.caltrash'], stats);
      expect(stats.unreadableDirs).toBe(1);
    } finally {
      await fs.chmod(locked, 0o755);
    }
  });

  it('counts the root itself as unreadable when it does not exist', async () => {
    const stats = newStats();

    await expect(collect(join(root, 'missing'), ['.epub'], [], stats)).resolves.toEqual([]);
    expect(stats.unreadableDirs).toBe(1);
  });
});
