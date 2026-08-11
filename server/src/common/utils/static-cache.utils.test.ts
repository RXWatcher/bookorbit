import { describe, expect, it } from 'vitest';

import { cacheControlForStaticPath } from './static-cache.utils';

describe('cacheControlForStaticPath', () => {
  it('caches content-hashed assets indefinitely', () => {
    expect(cacheControlForStaticPath('/app/public/assets/index-BKSj63dr.js')).toBe('public, max-age=31536000, immutable');
    expect(cacheControlForStaticPath('/app/public/assets/DashboardView-DquxsAZ1.js')).toBe('public, max-age=31536000, immutable');
    expect(cacheControlForStaticPath('/app/public/assets/BookCoverCard-HXH2f86S.css')).toBe('public, max-age=31536000, immutable');
  });

  it('always revalidates index.html, because it names the hashed chunks', () => {
    expect(cacheControlForStaticPath('/app/public/index.html')).toBe('no-cache');
  });

  it('revalidates anything else served from the client build', () => {
    expect(cacheControlForStaticPath('/app/public/favicon.ico')).toBe('no-cache');
    expect(cacheControlForStaticPath('/app/public/manifest.webmanifest')).toBe('no-cache');
  });

  it('treats windows separators the same way', () => {
    expect(cacheControlForStaticPath('C:\\app\\public\\assets\\index-BKSj63dr.js')).toBe('public, max-age=31536000, immutable');
    expect(cacheControlForStaticPath('C:\\app\\public\\index.html')).toBe('no-cache');
  });
});
