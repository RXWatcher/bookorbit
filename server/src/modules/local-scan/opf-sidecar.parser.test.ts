import { parseOpfSidecar } from './opf-sidecar.parser';

// Trimmed from a real Calibre sidecar on the production share.
const REAL_OPF = `<?xml version='1.0' encoding='utf-8'?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uuid_id" version="2.0">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
        <dc:identifier opf:scheme="calibre" id="calibre_id">61069</dc:identifier>
        <dc:identifier opf:scheme="uuid" id="uuid_id">e7495d33-eff0-4763-86ca-ac451bc7864e</dc:identifier>
        <dc:identifier opf:scheme="ISBN">9781451684537</dc:identifier>
        <dc:title>Anatomy of a Genocide</dc:title>
        <dc:creator opf:file-as="Bartov, Omer" opf:role="aut">Omer Bartov</dc:creator>
        <dc:contributor opf:file-as="calibre" opf:role="bkp">calibre (7.2.0)</dc:contributor>
        <dc:date>2018-01-23T00:00:00+00:00</dc:date>
        <dc:publisher>Simon &amp; Schuster</dc:publisher>
        <dc:language>eng</dc:language>
        <dc:subject>History</dc:subject>
        <dc:subject>Holocaust</dc:subject>
        <dc:description>A fascinating examination.</dc:description>
        <meta name="calibre:series" content="Border Towns"/>
        <meta name="calibre:series_index" content="2"/>
    </metadata>
</package>`;

describe('parseOpfSidecar', () => {
  it('extracts the core fields from a real Calibre sidecar', () => {
    const result = parseOpfSidecar(REAL_OPF);

    expect(result).not.toBeNull();
    expect(result?.title).toBe('Anatomy of a Genocide');
    expect(result?.authors).toEqual(['Omer Bartov']);
    expect(result?.publisher).toBe('Simon & Schuster');
    expect(result?.language).toBe('eng');
    expect(result?.tags).toEqual(['History', 'Holocaust']);
    expect(result?.publishedYear).toBe(2018);
    expect(result?.series).toBe('Border Towns');
    expect(result?.seriesIndex).toBe(2);
  });

  it('collects identifiers keyed by scheme', () => {
    const result = parseOpfSidecar(REAL_OPF);

    expect(result?.identifiers.calibre).toBe('61069');
    expect(result?.identifiers.isbn).toBe('9781451684537');
    expect(result?.identifiers.uuid).toBe('e7495d33-eff0-4763-86ca-ac451bc7864e');
  });

  it('excludes contributors that are not authors', () => {
    expect(parseOpfSidecar(REAL_OPF)?.authors).not.toContain('calibre (7.2.0)');
  });

  it('rejects calibre placeholder dates rather than storing year 101', () => {
    const withPlaceholder = REAL_OPF.replace('2018-01-23T00:00:00+00:00', '0101-01-01T00:00:00+00:00');

    expect(parseOpfSidecar(withPlaceholder)?.publishedYear).toBeNull();
  });

  it('reads an isbn given as a urn instead of a scheme attribute', () => {
    const urnStyle = REAL_OPF.replace(
      '<dc:identifier opf:scheme="ISBN">9781451684537</dc:identifier>',
      '<dc:identifier>urn:isbn:9780000000001</dc:identifier>',
    );

    expect(parseOpfSidecar(urnStyle)?.identifiers.isbn).toBe('9780000000001');
  });

  it('handles a sidecar with only a title', () => {
    const minimal = `<?xml version='1.0' encoding='utf-8'?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Bare</dc:title></metadata>
</package>`;
    const result = parseOpfSidecar(minimal);

    expect(result?.title).toBe('Bare');
    expect(result?.authors).toEqual([]);
    expect(result?.tags).toEqual([]);
    expect(result?.publishedYear).toBeNull();
    expect(result?.series).toBeNull();
  });

  it('returns null for content that is not an opf package', () => {
    expect(parseOpfSidecar('not xml at all <<<')).toBeNull();
    expect(parseOpfSidecar('<html><body>nope</body></html>')).toBeNull();
  });
});
