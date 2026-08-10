import { opendir } from 'fs/promises';
import { join, relative, sep } from 'path';

import type { LocalCandidate } from './local-scan.types';

interface WalkOptions {
  extensions: string[];
  excludePatterns: string[];
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
      continue;
    }

    for await (const entry of handle) {
      const absolutePath = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (excluded.has(entry.name)) continue;
        pending.push(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;

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
