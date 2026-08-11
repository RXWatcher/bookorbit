import type { WarehouseMediaType } from '@bookorbit/types';

import type { CatalogKeyRow, LocalCandidate, LocalMatchStrategy } from '../local-scan.types';

const TRAILING_ISSUE = /^(.*?)[\s_-]+(\d{1,5})$/;

function normaliseTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildKey(title: string, issue: string): string {
  return `${normaliseTitle(title)}|${String(Number(issue))}`;
}

export class ComicMatchStrategy implements LocalMatchStrategy {
  readonly mediaType: WarehouseMediaType = 'comic';

  catalogKey(row: CatalogKeyRow): string | null {
    const issue = row.rawPayload.issueNumber;
    if (typeof issue !== 'string' || issue.length === 0) return null;

    const rawTitle = typeof row.rawPayload.title === 'string' ? row.rawPayload.title : row.title;
    const stripped = TRAILING_ISSUE.exec(rawTitle.trim());
    const seriesTitle = stripped ? stripped[1] : rawTitle;
    return buildKey(seriesTitle, issue);
  }

  diskKey(candidate: LocalCandidate): string | null {
    const base = candidate.fileName.replace(/\.[^.]+$/, '');
    const match = TRAILING_ISSUE.exec(base.trim());
    if (!match) return null;
    return buildKey(match[1], match[2]);
  }

  titleFor(candidate: LocalCandidate): string {
    return candidate.fileName.replace(/\.[^.]+$/, '');
  }
}
