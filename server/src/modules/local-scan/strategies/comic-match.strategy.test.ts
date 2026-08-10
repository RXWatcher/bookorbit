import { ComicMatchStrategy } from './comic-match.strategy';

describe('ComicMatchStrategy', () => {
  const strategy = new ComicMatchStrategy();

  it('keys catalogue rows on normalised title and issue', () => {
    expect(
      strategy.catalogKey({
        remoteId: 'abc',
        title: 'Wolverines 13',
        rawPayload: { title: 'Wolverines 13', issueNumber: '13' },
      }),
    ).toBe('wolverines|13');
  });

  it('returns null when the issue number is missing', () => {
    expect(
      strategy.catalogKey({
        remoteId: 'a',
        title: 'Wolverines',
        rawPayload: { title: 'Wolverines' },
      }),
    ).toBeNull();
  });

  it('keys disk candidates parsed from the filename', () => {
    expect(
      strategy.diskKey({
        absolutePath: '/mnt/c/Wolverines 013.cbz',
        relativePath: 'Wolverines 013.cbz',
        fileName: 'Wolverines 013.cbz',
      }),
    ).toBe('wolverines|13');
  });

  it('returns null when the filename carries no trailing issue number', () => {
    expect(
      strategy.diskKey({
        absolutePath: '/mnt/c/Wolverines.cbz',
        relativePath: 'Wolverines.cbz',
        fileName: 'Wolverines.cbz',
      }),
    ).toBeNull();
  });

  it('derives a title from the filename without the extension', () => {
    expect(
      strategy.titleFor({
        absolutePath: '/mnt/c/Wolverines 013.cbz',
        relativePath: 'Wolverines 013.cbz',
        fileName: 'Wolverines 013.cbz',
      }),
    ).toBe('Wolverines 013');
  });
});
