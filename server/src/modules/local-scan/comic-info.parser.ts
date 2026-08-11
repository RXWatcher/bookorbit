import { XMLParser } from 'fast-xml-parser';

export interface ComicInfoMetadata {
  title: string | null;
  series: string | null;
  issueNumber: number | null;
  authors: string[];
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  identifiers: Record<string, string>;
}

const parser = new XMLParser({ ignoreAttributes: true, textNodeName: '#text' });

/** ComicRack writes 0 or -1 for "no value" in numeric fields rather than omitting them. */
const MIN_PLAUSIBLE_YEAR = 1000;

/** Scrapers record the ComicVine issue id in Notes, e.g. "... [CVDB419954]." */
const COMIC_VINE_ID = /\[CVDB(\d+)\]/i;

function text(node: unknown): string | null {
  if (typeof node === 'string') return node.trim() || null;
  if (typeof node === 'number') return String(node);
  if (node && typeof node === 'object' && '#text' in node) return text((node as { '#text': unknown })['#text']);
  return null;
}

/** Credit fields hold a comma separated list: "Chris Burnham, Grant Morrison". */
function people(node: unknown): string[] {
  const raw = text(node);
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
}

function year(node: unknown): number | null {
  const raw = text(node);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= MIN_PLAUSIBLE_YEAR ? parsed : null;
}

/** Issue numbers are usually integers but "23.2" and "½" both occur; only numerics survive. */
function issueNumber(node: unknown): number | null {
  const raw = text(node);
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseComicInfo(xml: string): ComicInfoMetadata | null {
  let root: unknown;
  try {
    root = parser.parse(xml);
  } catch {
    return null;
  }

  const info = (root as { ComicInfo?: Record<string, unknown> })?.ComicInfo;
  if (!info || typeof info !== 'object') return null;

  const identifiers: Record<string, string> = {};
  const notes = text(info.Notes);
  const comicVine = notes ? COMIC_VINE_ID.exec(notes) : null;
  if (comicVine?.[1]) identifiers.comicvine = comicVine[1];

  // Writer is the closest thing a comic has to an author; artists are credits, not authorship.
  const authors = people(info.Writer);

  const metadata: ComicInfoMetadata = {
    title: text(info.Title),
    series: text(info.Series),
    issueNumber: issueNumber(info.Number),
    authors,
    publisher: text(info.Publisher),
    publishedYear: year(info.Year),
    language: text(info.LanguageISO),
    identifiers,
  };

  // A file with a ComicInfo.xml carrying none of these is not worth preferring over the
  // filename, and treating it as a hit would overwrite a good title with nothing.
  if (!metadata.title && !metadata.series && metadata.authors.length === 0) return null;
  return metadata;
}
