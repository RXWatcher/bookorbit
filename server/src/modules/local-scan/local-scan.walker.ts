import { opendir, stat } from 'fs/promises';
import { join, relative, sep } from 'path';

import type { LocalCandidate, WalkStats } from './local-scan.types';

interface WalkOptions {
  extensions: string[];
  excludePatterns: string[];
  /** Mutated as the walk proceeds so the caller can report what the walk could not see. */
  stats: WalkStats;
}

function toPosix(value: string): string {
  return sep === '/' ? value : value.split(sep).join('/');
}

export async function* walkFiles(root: string, options: WalkOptions): AsyncGenerator<LocalCandidate> {
  const extensions = options.extensions.map((extension) => extension.toLowerCase());
  const excluded = new Set(options.excludePatterns);
  const pending: string[] = [root];

  while (pending.length > 0) {
    const directory = pending.pop() as string;
    let handle;

    try {
      handle = await opendir(directory);
    } catch {
      options.stats.unreadableDirs += 1;
      continue;
    }

    for await (const entry of handle) {
      const absolutePath = join(directory, entry.name);

      // Dirent reports neither isFile nor isDirectory for a symlink. Descending
      // through one risks cycles, so a symlinked directory is skipped and counted
      // rather than silently ignored, while a symlinked file is resolved.
      if (entry.isSymbolicLink()) {
        let target;
        try {
          target = await stat(absolutePath);
        } catch {
          options.stats.symlinksSkipped += 1;
          continue;
        }
        if (!target.isFile()) {
          options.stats.symlinksSkipped += 1;
          continue;
        }
      } else if (entry.isDirectory()) {
        if (excluded.has(entry.name)) continue;
        pending.push(absolutePath);
        continue;
      } else if (!entry.isFile()) {
        continue;
      }

      const lowerName = entry.name.toLowerCase();
      if (!extensions.some((extension) => lowerName.endsWith(extension))) continue;

      yield {
        absolutePath,
        relativePath: toPosix(relative(root, absolutePath)),
        fileName: entry.name,
      };
    }
  }
}
