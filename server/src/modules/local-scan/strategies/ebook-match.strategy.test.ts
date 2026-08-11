import { EbookMatchStrategy } from './ebook-match.strategy';

describe('EbookMatchStrategy', () => {
  const strategy = new EbookMatchStrategy();

  it('keys catalogue rows on calibre_path', () => {
    expect(
      strategy.catalogKey({
        remoteId: 'abc',
        title: 'Joy and Jealousy',
        rawPayload: { calibre_path: 'Diana Xarissa/Joy and Jealousy (17937)' },
      }),
    ).toBe('Diana Xarissa/Joy and Jealousy (17937)');
  });

  it('strips leading slashes so both sides agree', () => {
    expect(
      strategy.catalogKey({
        remoteId: 'a',
        title: 't',
        rawPayload: { calibre_path: '/Author/Book (1)' },
      }),
    ).toBe('Author/Book (1)');
  });

  it('returns null when the row carries no calibre_path', () => {
    expect(strategy.catalogKey({ remoteId: 'a', title: 't', rawPayload: {} })).toBeNull();
  });

  it('keys disk candidates on the book directory', () => {
    expect(
      strategy.diskKey({
        absolutePath: '/mnt/books/Diana Xarissa/Joy and Jealousy (17937)/Joy and Jealousy - Diana Xarissa.epub',
        relativePath: 'Diana Xarissa/Joy and Jealousy (17937)/Joy and Jealousy - Diana Xarissa.epub',
        fileName: 'Joy and Jealousy - Diana Xarissa.epub',
      }),
    ).toBe('Diana Xarissa/Joy and Jealousy (17937)');
  });

  it('ignores calibre internal directories', () => {
    expect(
      strategy.diskKey({
        absolutePath: '/mnt/books/.caltrash/b/x.epub',
        relativePath: '.caltrash/b/x.epub',
        fileName: 'x.epub',
      }),
    ).toBeNull();
    expect(
      strategy.diskKey({
        absolutePath: '/mnt/books/.calnotes/backup/x.epub',
        relativePath: '.calnotes/backup/x.epub',
        fileName: 'x.epub',
      }),
    ).toBeNull();
  });

  it('derives a title from the book directory', () => {
    expect(
      strategy.titleFor({
        absolutePath: '/mnt/books/Diana Xarissa/Joy and Jealousy (17937)/x.epub',
        relativePath: 'Diana Xarissa/Joy and Jealousy (17937)/x.epub',
        fileName: 'x.epub',
      }),
    ).toBe('Joy and Jealousy');
  });
});
