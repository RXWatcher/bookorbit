import { readFile } from 'fs/promises';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const serverRoot = join(process.cwd());

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(join(serverRoot, path), 'utf8')) as T;
}

type NestCliConfig = {
  compilerOptions?: {
    builder?: string;
    typeCheck?: boolean;
    plugins?: Array<{ name?: string }>;
  };
};

type PackageJson = {
  scripts?: Record<string, string>;
};

describe('Nest CLI watch configuration', () => {
  it('keeps dev watch type-checking without generating Swagger metadata', async () => {
    const devConfig = await readJson<NestCliConfig>('nest-cli.dev.json');
    const packageJson = await readJson<PackageJson>('package.json');

    expect(devConfig.compilerOptions?.builder).toBe('swc');
    expect(devConfig.compilerOptions?.typeCheck).toBe(true);
    expect(devConfig.compilerOptions?.plugins).toEqual([]);
    expect(packageJson.scripts?.['start:dev']).toContain('--config nest-cli.dev.json');
    expect(packageJson.scripts?.['start:debug']).toContain('--config nest-cli.dev.json');
  });

  it('keeps the standard build config wired to Swagger metadata generation', async () => {
    const buildConfig = await readJson<NestCliConfig>('nest-cli.json');

    expect(buildConfig.compilerOptions?.builder).toBe('swc');
    expect(buildConfig.compilerOptions?.typeCheck).toBe(true);
    expect(buildConfig.compilerOptions?.plugins).toContainEqual(expect.objectContaining({ name: '@nestjs/swagger' }));
  });
});
