import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { computeFileHash } from './hash';

const EMPTY_MD5 = 'd41d8cd98f00b204e9800998ecf8427e';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'scanner-hash-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── SMALL FILES ───────────────────────────────────────────────────────────────

describe('computeFileHash - small files', () => {
  it('returns MD5 of empty string for a file with 0 bytes', async () => {
    await writeFile(join(tmpDir, 'empty.epub'), Buffer.alloc(0));
    const hash = await computeFileHash(join(tmpDir, 'empty.epub'));
    expect(hash).toBe(EMPTY_MD5);
  });

  it('returns a non-empty hash for a file smaller than 1024 bytes', async () => {
    await writeFile(join(tmpDir, 'tiny.epub'), Buffer.alloc(512, 'A'));
    const hash = await computeFileHash(join(tmpDir, 'tiny.epub'));
    expect(hash).not.toBe(EMPTY_MD5);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('produces different hashes for different small files', async () => {
    const a = Buffer.alloc(900, 'A');
    const b = Buffer.alloc(900, 'A');
    b.write('Z', 0, 'ascii');

    await writeFile(join(tmpDir, 'a.epub'), a);
    await writeFile(join(tmpDir, 'b.epub'), b);

    const [h1, h2] = await Promise.all([computeFileHash(join(tmpDir, 'a.epub')), computeFileHash(join(tmpDir, 'b.epub'))]);
    expect(h1).not.toBe(h2);
  });
});

// ── LARGE FILES ───────────────────────────────────────────────────────────────

describe('computeFileHash - files large enough for sampling', () => {
  it('returns a 32-char hex string (MD5)', async () => {
    await writeFile(join(tmpDir, 'book.epub'), Buffer.alloc(2048, 'A'));
    const hash = await computeFileHash(join(tmpDir, 'book.epub'));
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('identical content produces identical hash', async () => {
    const content = Buffer.alloc(4096, 'Z');
    await writeFile(join(tmpDir, 'a.epub'), content);
    await writeFile(join(tmpDir, 'b.epub'), content);

    const [h1, h2] = await Promise.all([computeFileHash(join(tmpDir, 'a.epub')), computeFileHash(join(tmpDir, 'b.epub'))]);
    expect(h1).toBe(h2);
  });

  it('includes position 0 (first 1024 bytes) in the hash', async () => {
    // Two files identical except at byte 0. computeFileHash starts at position 0 (i=-1 overflow),
    // so changing byte 0 must produce a different hash.
    const base = Buffer.alloc(4096, 'A');
    const changed = Buffer.from(base);
    changed[0] = 0x5a;

    await writeFile(join(tmpDir, 'base.epub'), base);
    await writeFile(join(tmpDir, 'changed.epub'), changed);

    const [hBase, hChanged] = await Promise.all([computeFileHash(join(tmpDir, 'base.epub')), computeFileHash(join(tmpDir, 'changed.epub'))]);
    expect(hBase).not.toBe(hChanged);
  });

  it('is deterministic across calls', async () => {
    await writeFile(join(tmpDir, 'book.epub'), Buffer.alloc(8192, 'X'));
    const [h1, h2] = await Promise.all([computeFileHash(join(tmpDir, 'book.epub')), computeFileHash(join(tmpDir, 'book.epub'))]);
    expect(h1).toBe(h2);
  });

  it('detects changes at sampled positions beyond position 0', async () => {
    const base = Buffer.alloc(4096, 'A');
    const different = Buffer.from(base);
    different.write('Z', 1024, 'ascii'); // change byte at position 1024 (second sample)

    await writeFile(join(tmpDir, 'a.epub'), base);
    await writeFile(join(tmpDir, 'b.epub'), different);

    const [h1, h2] = await Promise.all([computeFileHash(join(tmpDir, 'a.epub')), computeFileHash(join(tmpDir, 'b.epub'))]);
    expect(h1).not.toBe(h2);
  });
});

// ── ERROR HANDLING ────────────────────────────────────────────────────────────

describe('computeFileHash - error handling', () => {
  it('throws when the file does not exist', async () => {
    await expect(computeFileHash(join(tmpDir, 'nonexistent.epub'))).rejects.toThrow();
  });
});
