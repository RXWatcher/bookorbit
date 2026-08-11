import { ComicMatchStrategy } from './comic-match.strategy';

const SERIES = new Map<string, string>([
  ['s-batman', 'Batman'],
  ['s-nightwing', 'Nightwing'],
  ['s-convergence', 'Convergence: Nightwing/Oracle'],
  ['s-glc', 'Green Lantern Corps'],
]);

const strategy = new ComicMatchStrategy(SERIES);

function disk(fileName: string) {
  return { absolutePath: `/comics/${fileName}`, relativePath: fileName, fileName };
}

function row(seriesId: string, issueNumber: string, title = 'Some Story Title') {
  return { remoteId: 'r', title, rawPayload: { seriesId, issueNumber, title } };
}

describe('ComicMatchStrategy', () => {
  it('keys the catalogue on the resolved series name, not the story title', () => {
    // The catalogue title is the story ("Trigon-Ometry"); only seriesId identifies the series.
    expect(strategy.catalogKey(row('s-nightwing', '15', 'Trigon-Ometry'))).toBe('nightwing|15');
  });

  it('matches a disk filename to the catalogue for the same issue', () => {
    expect(strategy.diskKey(disk('Nightwing #15.cbz'))).toBe(strategy.catalogKey(row('s-nightwing', '15')));
  });

  // The single highest-value rule: filenames carry Vol.YYYY, the catalogue does not.
  it('strips a four digit volume from the filename', () => {
    expect(strategy.diskKey(disk('Batman Vol.1940 #616 (September, 2003).cbz'))).toBe(strategy.catalogKey(row('s-batman', '616')));
  });

  it('keeps a low volume number so two volumes cannot collapse onto one key', () => {
    expect(strategy.diskKey(disk('Green Lantern Corps Vol.3 #19 (2013).cbz'))).not.toBe(strategy.catalogKey(row('s-glc', '19')));
  });

  it.each([
    ['Nightwing #05.cbz', '5'],
    ['Nightwing #5.cbz', '5'],
    ['Nightwing #23.2.cbz', '23.2'],
    ['Nightwing #616a.cbz', '616a'],
  ])('normalises the issue in %s to %s', (fileName, issue) => {
    expect(strategy.diskKey(disk(fileName))).toBe(`nightwing|${issue}`);
  });

  it('treats a variant letter as a distinct issue', () => {
    expect(strategy.diskKey(disk('Nightwing #2A.cbz'))).not.toBe(strategy.diskKey(disk('Nightwing #2B.cbz')));
  });

  it('strips a trailing year in parentheses', () => {
    expect(strategy.diskKey(disk('Nightwing #30 (2014).cbz'))).toBe('nightwing|30');
  });

  // A slash is illegal in a filename, so the disk copy loses the word boundary.
  it('recovers a slash-stripped series name through the fallback key', () => {
    const diskFallback = strategy.fallbackDiskKey(disk('Convergence NightwingOracle #01.cbz'));
    expect(diskFallback).toBe(strategy.fallbackCatalogKey(row('s-convergence', '1')));
    expect(strategy.diskKey(disk('Convergence NightwingOracle #01.cbz'))).not.toBe(strategy.catalogKey(row('s-convergence', '1')));
  });

  it('returns null for a catalogue row whose series is not in the map', () => {
    expect(strategy.catalogKey(row('s-unknown', '1'))).toBeNull();
  });

  it('returns null when the filename carries no issue number', () => {
    expect(strategy.diskKey(disk('Nightwing.cbz'))).toBeNull();
  });

  it('returns null when the catalogue row has no issue number', () => {
    expect(strategy.catalogKey({ remoteId: 'r', title: 't', rawPayload: { seriesId: 's-batman' } })).toBeNull();
  });

  it('derives a title from the filename without the extension', () => {
    expect(strategy.titleFor(disk('Nightwing #15.cbz'))).toBe('Nightwing #15');
  });
});
