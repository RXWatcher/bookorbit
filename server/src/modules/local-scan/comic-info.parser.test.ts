import { parseComicInfo } from './comic-info.parser';

// Trimmed from a real archive on CT139.
const REAL = `<?xml version="1.0"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Title>The Dark Knight and the Devil's Daughter</Title>
  <Series>Batman, Incorporated</Series>
  <Number>13</Number>
  <Volume>2012</Volume>
  <Notes>Scraped metadata from ComicVine [CVDB419954].</Notes>
  <Year>2013</Year>
  <Writer>Grant Morrison</Writer>
  <Penciller>Chris Burnham</Penciller>
  <CoverArtist>Chris Burnham, Grant Morrison, Nathan Fairbairn</CoverArtist>
  <Publisher>DC Comics</Publisher>
  <PageCount>37</PageCount>
</ComicInfo>`;

describe('parseComicInfo', () => {
  it('reads the fields the catalogue can store', () => {
    expect(parseComicInfo(REAL)).toEqual({
      title: "The Dark Knight and the Devil's Daughter",
      series: 'Batman, Incorporated',
      issueNumber: 13,
      authors: ['Grant Morrison'],
      publisher: 'DC Comics',
      publishedYear: 2013,
      language: null,
      identifiers: { comicvine: '419954' },
    });
  });

  it('treats only the writer as an author, not the art credits', () => {
    expect(parseComicInfo(REAL)?.authors).toEqual(['Grant Morrison']);
  });

  it('splits a multi-writer credit and drops duplicates', () => {
    const xml = '<ComicInfo><Series>S</Series><Writer>A Writer, B Writer, A Writer</Writer></ComicInfo>';
    expect(parseComicInfo(xml)?.authors).toEqual(['A Writer', 'B Writer']);
  });

  it('keeps a decimal issue number', () => {
    expect(parseComicInfo('<ComicInfo><Series>S</Series><Number>23.2</Number></ComicInfo>')?.issueNumber).toBe(23.2);
  });

  it('rejects a non-numeric issue number rather than storing NaN', () => {
    expect(parseComicInfo('<ComicInfo><Series>S</Series><Number>&#189;</Number></ComicInfo>')?.issueNumber).toBeNull();
  });

  // ComicRack writes a placeholder year rather than omitting the element.
  it('ignores an implausible year', () => {
    expect(parseComicInfo('<ComicInfo><Series>S</Series><Year>0</Year></ComicInfo>')?.publishedYear).toBeNull();
  });

  it('returns null for XML that is not ComicInfo', () => {
    expect(parseComicInfo('<package><metadata/></package>')).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(parseComicInfo('not xml at all <<<')).toBeNull();
  });

  // Preferring an empty ComicInfo would overwrite a usable filename title with nothing.
  it('returns null when the file carries no usable identity', () => {
    expect(parseComicInfo('<ComicInfo><PageCount>20</PageCount></ComicInfo>')).toBeNull();
  });
});
