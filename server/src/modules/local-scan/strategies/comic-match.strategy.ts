import type { WarehouseMediaType } from '@bookorbit/types';

import type { CatalogKeyRow, LocalCandidate, LocalMatchStrategy } from '../local-scan.types';

/** `<series> #<issue>` with an optional variant letter, e.g. "Batman Vol.1940 #616a". */
const FILENAME_ISSUE = /^(?<series>.+?)\s*#\s*(?<issue>\d{1,5}(?:\.\d+)?[a-z]?)/i;

/**
 * Catalogue comic titles are the STORY title ("Trigon-Ometry"), never the series, so the
 * series name has to come from the seriesId lookup. Disk filenames carry the series and
 * an issue, so that pair is the only identity both sides share.
 */
function normaliseSeries(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/\(\s*\d{4}\s*\)/g, ' ')
      // Filenames carry "Batman Vol.1940 #616a" while the catalogue has plain "Batman".
      // Stripping this is worth more than every other rule combined: on CT139 it moved the
      // match rate from 3.1% to 97.5%. Two digits minimum, so a real "Vol 3" in a series
      // name is left alone rather than collapsing two distinct volumes onto one key.
      .replace(/\bvol\.?\s*\d{2,4}\b/g, ' ')
      .replace(/\bv\d{4}\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  );
}

/** Leading zeros are cosmetic ("#05"), variants are not ("#2B"), and "23.2" is real. */
function normaliseIssue(value: string): string | null {
  const trimmed = value.trim().replace(/^#/, '');
  const match = /^0*(\d+(?:\.\d+)?)([a-z]?)$/i.exec(trimmed);
  if (!match) return null;
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) return null;
  return `${numeric}${match[2]?.toLowerCase() ?? ''}`;
}

function buildKey(series: string, issue: string): string | null {
  const normalisedSeries = normaliseSeries(series);
  if (normalisedSeries.length === 0) return null;
  return `${normalisedSeries}|${issue}`;
}

/**
 * A slash is illegal in a filename, so "Convergence: Nightwing/Oracle" reaches disk as
 * "...NightwingOracle" and loses the word boundary the primary key relies on. Comparing a
 * space-stripped variant recovers those; on CT139 it was worth 89 more files.
 */
function squash(key: string): string {
  const [series, issue] = key.split('|');
  return `${(series ?? '').replace(/ /g, '')}|${issue ?? ''}`;
}

export class ComicMatchStrategy implements LocalMatchStrategy {
  readonly mediaType: WarehouseMediaType = 'comic';

  /**
   * seriesId -> series title, from the warehouse `/comics/series` listing. An empty map
   * would key nothing and silently insert a duplicate row for every comic on disk, so the
   * caller must fail the scan rather than construct this strategy without it.
   */
  constructor(private readonly seriesTitles: ReadonlyMap<string, string>) {}

  private catalogParts(row: CatalogKeyRow): string | null {
    const seriesId = row.rawPayload.seriesId;
    const issue = row.rawPayload.issueNumber;
    if (typeof seriesId !== 'string' || typeof issue !== 'string') return null;

    const seriesTitle = this.seriesTitles.get(seriesId);
    if (!seriesTitle) return null;

    const normalisedIssue = normaliseIssue(issue);
    if (!normalisedIssue) return null;

    return buildKey(seriesTitle, normalisedIssue);
  }

  private diskParts(candidate: LocalCandidate): string | null {
    const base = candidate.fileName.replace(/\.[^.]+$/, '');
    const match = FILENAME_ISSUE.exec(base.trim());
    const series = match?.groups?.series;
    const issue = match?.groups?.issue;
    if (!series || !issue) return null;

    const normalisedIssue = normaliseIssue(issue);
    if (!normalisedIssue) return null;

    return buildKey(series, normalisedIssue);
  }

  catalogKey(row: CatalogKeyRow): string | null {
    return this.catalogParts(row);
  }

  diskKey(candidate: LocalCandidate): string | null {
    return this.diskParts(candidate);
  }

  fallbackCatalogKey(row: CatalogKeyRow): string | null {
    const key = this.catalogParts(row);
    return key ? squash(key) : null;
  }

  fallbackDiskKey(candidate: LocalCandidate): string | null {
    const key = this.diskParts(candidate);
    return key ? squash(key) : null;
  }

  titleFor(candidate: LocalCandidate): string {
    return candidate.fileName.replace(/\.[^.]+$/, '');
  }
}
