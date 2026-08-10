import { XMLParser } from 'fast-xml-parser';

export interface OpfSidecarMetadata {
  title: string | null;
  authors: string[];
  series: string | null;
  seriesIndex: number | null;
  publisher: string | null;
  language: string | null;
  tags: string[];
  publishedYear: number | null;
  identifiers: Record<string, string>;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => ['dc:creator', 'dc:identifier', 'dc:subject', 'dc:title', 'meta'].includes(name),
});

function toText(node: unknown): string | null {
  if (typeof node === 'string') return node.trim() || null;
  if (typeof node === 'number') return String(node);
  if (node && typeof node === 'object' && '#text' in node) {
    const text = (node as { '#text': unknown })['#text'];
    if (typeof text === 'string') return text.trim() || null;
    if (typeof text === 'number') return String(text);
  }
  return null;
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Calibre writes dates as 0101-01-01 when it has none, so a year below this is not real. */
const MIN_PLAUSIBLE_YEAR = 1000;

function parseYear(node: unknown): number | null {
  const raw = toText(node);
  if (!raw) return null;
  const match = /^(\d{3,4})/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  if (!Number.isFinite(year) || year < MIN_PLAUSIBLE_YEAR || year > 2999) return null;
  return year;
}

export function parseOpfSidecar(xml: string): OpfSidecarMetadata | null {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return null;
  }

  const pkg = (doc.package ?? doc['opf:package']) as Record<string, unknown> | undefined;
  const metadata = (pkg?.metadata ?? pkg?.['opf:metadata']) as Record<string, unknown> | undefined;
  if (!metadata) return null;

  const identifiers: Record<string, string> = {};
  for (const node of toArray(metadata['dc:identifier'])) {
    const value = toText(node);
    if (!value) continue;
    const scheme = (node as Record<string, unknown>)?.['@_opf:scheme'];
    const key = typeof scheme === 'string' && scheme.trim() ? scheme.trim().toLowerCase() : 'unknown';
    // An ISBN can arrive as urn:isbn:9780123456789 rather than a scheme attribute.
    const urn = /^urn:([a-z0-9]+):(.+)$/i.exec(value);
    if (urn) {
      identifiers[urn[1].toLowerCase()] ??= urn[2];
    } else if (key !== 'unknown') {
      identifiers[key] ??= value;
    }
  }

  const authors = toArray(metadata['dc:creator'])
    .filter((node) => {
      const role = (node as Record<string, unknown>)?.['@_opf:role'];
      return role === undefined || role === 'aut';
    })
    .map(toText)
    .filter((value): value is string => !!value);

  const tags = toArray(metadata['dc:subject'])
    .map(toText)
    .filter((value): value is string => !!value);

  let series: string | null = null;
  let seriesIndex: number | null = null;
  for (const meta of toArray(metadata.meta)) {
    const name = (meta as Record<string, unknown>)?.['@_name'];
    const content = (meta as Record<string, unknown>)?.['@_content'];
    if (name === 'calibre:series' && typeof content === 'string') series = content.trim() || null;
    if (name === 'calibre:series_index' && typeof content === 'string') {
      const parsed = Number(content);
      seriesIndex = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }
  }

  return {
    title: toText(toArray(metadata['dc:title'])[0]),
    authors,
    series,
    seriesIndex,
    publisher: toText(metadata['dc:publisher']),
    language: toText(metadata['dc:language']),
    tags,
    publishedYear: parseYear(metadata['dc:date']),
    identifiers,
  };
}
