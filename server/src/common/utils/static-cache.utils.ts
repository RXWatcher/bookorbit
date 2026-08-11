const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const REVALIDATE_CACHE_CONTROL = 'no-cache';

/**
 * The client build emits content-hashed filenames under `assets/`, so a given
 * URL there never changes meaning and can be cached indefinitely. `index.html`
 * is the opposite: it names those hashes, so a cached copy pins the browser to
 * the previous deploy's chunks. It must be revalidated on every load.
 *
 * Both were served as `max-age=0`, which re-fetched every immutable chunk on
 * each load while leaving the one file that must stay fresh merely revalidated.
 */
export function cacheControlForStaticPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const isHashedAsset = normalized.includes('/assets/') && !normalized.endsWith('/index.html');
  return isHashedAsset ? IMMUTABLE_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL;
}
