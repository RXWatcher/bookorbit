import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types';
import type { BookRecommendation, DashboardCatalogItem, GroupRule, SeriesBookRecommendation, WarehouseMediaType } from '@bookorbit/types';
import { normalizeCoverAspectRatio } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import type { WarehouseCatalogItemRow } from '../../db/schema';
import { BookEmbedderService } from '../embedding/book-embedder.service';
import { BookReadService } from '../book/book-read.service';
import { LibraryService } from '../library/library.service';
import { WarehouseRepository } from '../warehouse/warehouse.repository';
import { catalogAuthorRefs, catalogSeriesRef } from '../warehouse/catalog-link-refs';
import { AnnCandidate, CandidateMetadata, RecommendationRepository, TargetBookData } from './recommendation.repository';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';

const RECOMMENDATION_EVENT = 'book.recommendations';
const SERIES_BOOKS_EVENT = 'book.series_books';
const AUTHOR_BOOKS_EVENT = 'book.author_books';
const MAX_RECOMMENDATIONS = 25;
const MAX_CATALOG_RECOMMENDATIONS = 12;
const DEFAULT_RATING_PROXIMITY = 0.5;
const RATING_PROXIMITY_RANGE = 4;
const SCORE_WEIGHTS = {
  cosineSim: 0.5,
  authorSim: 0.1,
  genreTagSim: 0.25,
  seriesBonus: 0.1,
  ratingProximity: 0.05,
} as const;

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);

  constructor(
    private readonly recRepo: RecommendationRepository,
    private readonly bookReadService: BookReadService,
    private readonly libraryService: LibraryService,
    private readonly embedder: BookEmbedderService,
    private readonly warehouseRepo: WarehouseRepository,
  ) {}

  async getRecommendations(bookId: number, user: RequestUser): Promise<BookRecommendation[]> {
    const startedAt = Date.now();
    this.logger.log(
      `[${RECOMMENDATION_EVENT}] [start] bookId=${bookId} userId=${user.id} isSuperuser=${user.isSuperuser} - recommendation lookup started`,
    );

    try {
      const libraryId = await this.bookReadService.findLibraryIdByBookId(bookId);
      if (libraryId === null) throw new NotFoundException(`Book ${bookId} not found`);
      await this.libraryService.verifyUserAccess(user.id, libraryId, user.isSuperuser);

      const target = (await this.recRepo.getTargetBookData(bookId)) ?? this.createFallbackTarget();
      const embedding = target.embedding ?? (await this.embedder.embedBook(bookId));
      if (!this.isValidEmbedding(embedding)) {
        this.logger.log(
          `[${RECOMMENDATION_EVENT}] [end] bookId=${bookId} userId=${user.id} libraryId=${libraryId} durationMs=${Date.now() - startedAt} reason=invalid_embedding - recommendation lookup completed`,
        );
        return [];
      }

      const accessibleLibraries = await this.libraryService.findAll(user);
      const accessibleLibraryIds = accessibleLibraries.map((library) => library.id);

      const candidates = await this.recRepo.findAnnCandidates(
        embedding,
        bookId,
        accessibleLibraryIds,
        user.isSuperuser ? undefined : user.contentFilters,
      );
      if (candidates.length === 0) {
        this.logger.log(
          `[${RECOMMENDATION_EVENT}] [end] bookId=${bookId} userId=${user.id} libraryId=${libraryId} durationMs=${Date.now() - startedAt} accessibleLibraryCount=${accessibleLibraryIds.length} candidateCount=0 resultCount=0 - recommendation lookup completed`,
        );
        return [];
      }

      const candidateMetadata = await this.recRepo.getCandidateMetadata(candidates.map((c) => c.bookId));
      const metaMap = new Map(candidateMetadata.map((m) => [m.bookId, m]));

      const rescored = candidates
        .map((candidate) => ({
          bookId: candidate.bookId,
          score: this.rescore(candidate, target, metaMap.get(candidate.bookId) ?? null),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_RECOMMENDATIONS);

      if (rescored.length === 0) {
        this.logger.log(
          `[${RECOMMENDATION_EVENT}] [end] bookId=${bookId} userId=${user.id} libraryId=${libraryId} durationMs=${Date.now() - startedAt} accessibleLibraryCount=${accessibleLibraryIds.length} candidateCount=${candidates.length} rescoredCount=0 resultCount=0 - recommendation lookup completed`,
        );
        return [];
      }

      const topIds = rescored.map((row) => row.bookId);
      const rows = await this.bookReadService.findRecommendationTitlesByBookIds(topIds);
      const rowMap = new Map(rows.map((row) => [row.id, row]));
      const recommendations = rescored
        .map((rescoredCandidate) => rowMap.get(rescoredCandidate.bookId))
        .filter((row): row is BookRecommendation => row != null);

      this.logger.log(
        `[${RECOMMENDATION_EVENT}] [end] bookId=${bookId} userId=${user.id} libraryId=${libraryId} durationMs=${Date.now() - startedAt} accessibleLibraryCount=${accessibleLibraryIds.length} candidateCount=${candidates.length} rescoredCount=${rescored.length} resultCount=${recommendations.length} - recommendation lookup completed`,
      );

      return recommendations;
    } catch (err) {
      const { errorClass, errorMessage } = this.parseError(err);
      this.logger.error(
        `[${RECOMMENDATION_EVENT}] [fail] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - recommendation lookup failed`,
      );
      throw err;
    }
  }

  async getCatalogRecommendations(bookId: number, user: RequestUser): Promise<DashboardCatalogItem[]> {
    const libraryId = await this.bookReadService.findLibraryIdByBookId(bookId);
    if (libraryId === null) throw new NotFoundException(`Book ${bookId} not found`);
    await this.libraryService.verifyUserAccess(user.id, libraryId, user.isSuperuser);

    const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
    const sourceBackedMediaTypes = sourceBackedMediaTypesForLibraryIds(libraries.map((library) => library.id));
    if (sourceBackedMediaTypes.length === 0) return [];

    const target = (await this.recRepo.getTargetBookData(bookId)) ?? this.createFallbackTarget();
    const filter = this.buildCatalogRecommendationFilter(target);
    if (!filter) return [];

    const result = await this.warehouseRepo.queryUserCatalogItems(user.id, {
      includeAllCatalogItems: true,
      filter,
      page: 0,
      limit: MAX_CATALOG_RECOMMENDATIONS,
      ...(sourceBackedMediaTypes.length === 1 ? { mediaType: sourceBackedMediaTypes[0] } : {}),
      contentFilters: user.isSuperuser ? undefined : user.contentFilters,
    });

    return result.rows.map(mapCatalogRecommendation);
  }

  async getSeriesBooks(bookId: number, user: RequestUser): Promise<SeriesBookRecommendation[]> {
    const startedAt = Date.now();
    this.logger.log(`[${SERIES_BOOKS_EVENT}] [start] bookId=${bookId} userId=${user.id} - series books lookup started`);

    try {
      const libraryId = await this.bookReadService.findLibraryIdByBookId(bookId);
      if (libraryId === null) throw new NotFoundException(`Book ${bookId} not found`);
      await this.libraryService.verifyUserAccess(user.id, libraryId, user.isSuperuser);

      const series = await this.recRepo.getSeriesIdentity(bookId);
      if (!series) {
        this.logger.log(
          `[${SERIES_BOOKS_EVENT}] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} reason=no_series - series books lookup completed`,
        );
        return [];
      }

      const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
      const rows = await this.recRepo.findSeriesBooks(series.id, libraryIds, user.isSuperuser ? undefined : user.contentFilters);

      this.logger.log(
        `[${SERIES_BOOKS_EVENT}] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} seriesId=${series.id} seriesName="${sanitizeLogValue(series.name ?? '')}" resultCount=${rows.length} - series books lookup completed`,
      );

      return rows.map((r) => ({
        id: r.bookId,
        title: r.title,
        coverAspectRatio: normalizeCoverAspectRatio(r.coverAspectRatio),
        updatedAt: r.updatedAt?.toISOString() ?? null,
        seriesIndex: r.seriesIndex,
        hasCover: r.coverSource !== null,
        authors: r.authorNames,
        isAudiobook: r.isAudiobook,
        isComic: r.isComic,
      }));
    } catch (err) {
      const { errorClass, errorMessage } = this.parseError(err);
      this.logger.error(
        `[${SERIES_BOOKS_EVENT}] [fail] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - series books lookup failed`,
      );
      throw err;
    }
  }

  async getAuthorBooks(bookId: number, user: RequestUser): Promise<BookRecommendation[]> {
    const startedAt = Date.now();
    this.logger.log(`[${AUTHOR_BOOKS_EVENT}] [start] bookId=${bookId} userId=${user.id} - author books lookup started`);

    try {
      const libraryId = await this.bookReadService.findLibraryIdByBookId(bookId);
      if (libraryId === null) throw new NotFoundException(`Book ${bookId} not found`);
      await this.libraryService.verifyUserAccess(user.id, libraryId, user.isSuperuser);

      const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
      const rows = await this.recRepo.findAuthorBooks(bookId, libraryIds, user.isSuperuser ? undefined : user.contentFilters);

      this.logger.log(
        `[${AUTHOR_BOOKS_EVENT}] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} resultCount=${rows.length} - author books lookup completed`,
      );

      return rows.map((r) => ({
        id: r.bookId,
        title: r.title,
        coverAspectRatio: normalizeCoverAspectRatio(r.coverAspectRatio),
        updatedAt: r.updatedAt?.toISOString() ?? null,
        hasCover: r.coverSource !== null,
        authors: r.authorNames,
        isAudiobook: r.isAudiobook,
        isComic: r.isComic,
      }));
    } catch (err) {
      const { errorClass, errorMessage } = this.parseError(err);
      this.logger.error(
        `[${AUTHOR_BOOKS_EVENT}] [fail] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - author books lookup failed`,
      );
      throw err;
    }
  }

  private rescore(candidate: AnnCandidate, target: TargetBookData, meta: CandidateMetadata | null): number {
    const cosineSim = this.clamp01(candidate.cosineSim);

    const authorSim = meta ? this.jaccard(this.toNormalizedSet(target.authorNames), this.toNormalizedSet(meta.authorNames)) : 0;
    const genreTagSim = meta ? this.jaccard(this.toNormalizedSet(target.genreTagNames), this.toNormalizedSet(meta.genreTagNames)) : 0;

    const seriesBonus = target.seriesId != null && candidate.seriesId === target.seriesId ? 1.0 : 0.0;

    let ratingProximity = DEFAULT_RATING_PROXIMITY;
    if (target.rating != null && candidate.rating != null) {
      ratingProximity = this.clamp01(1 - Math.abs(target.rating - candidate.rating) / RATING_PROXIMITY_RANGE);
    }

    return (
      SCORE_WEIGHTS.cosineSim * cosineSim +
      SCORE_WEIGHTS.authorSim * authorSim +
      SCORE_WEIGHTS.genreTagSim * genreTagSim +
      SCORE_WEIGHTS.seriesBonus * seriesBonus +
      SCORE_WEIGHTS.ratingProximity * ratingProximity
    );
  }

  private jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 0;
    let intersection = 0;
    for (const x of a) if (b.has(x)) intersection++;
    return intersection / (a.size + b.size - intersection);
  }

  private isValidEmbedding(embedding: number[] | null): embedding is number[] {
    return Array.isArray(embedding) && embedding.length > 0 && embedding.every((v) => Number.isFinite(v));
  }

  private toNormalizedSet(values: string[]): Set<string> {
    return new Set(values.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0));
  }

  private createFallbackTarget(): TargetBookData {
    return {
      embedding: null,
      seriesId: null,
      seriesName: null,
      rating: null,
      authorNames: [],
      genreTagNames: [],
    };
  }

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private normalizeSeries(seriesName: string | null): string | null {
    if (!seriesName) return null;
    const normalized = seriesName.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }

  private buildCatalogRecommendationFilter(target: TargetBookData): GroupRule | null {
    const rules: GroupRule['rules'] = [];
    const seriesName = target.seriesName?.trim();
    const authorNames = [...new Set(target.authorNames.map((name) => name.trim()).filter((name) => name.length > 0))].slice(0, 5);

    if (seriesName) {
      rules.push({ type: 'rule', field: 'series', operator: 'contains', value: seriesName });
    }

    if (authorNames.length > 0) {
      rules.push({ type: 'rule', field: 'author', operator: 'includesAny', value: authorNames });
    }

    return rules.length > 0 ? { type: 'group', join: 'OR', rules } : null;
  }

  private parseError(err: unknown): { errorClass: string; errorMessage: string } {
    if (err instanceof Error) {
      return { errorClass: err.constructor.name, errorMessage: sanitizeLogValue(err.message).slice(0, 200) };
    }
    return { errorClass: 'UnknownError', errorMessage: sanitizeLogValue(String(err)).slice(0, 200) };
  }
}

function mapCatalogRecommendation(row: WarehouseCatalogItemRow): DashboardCatalogItem {
  const authorRefs = catalogAuthorRefs(row.authors);
  const seriesRef = catalogSeriesRef(row.series);
  return {
    type: 'catalog-item',
    mediaType: row.mediaType,
    remoteId: row.remoteId,
    title: row.title,
    subtitle: row.subtitle ?? null,
    seriesName: row.series ?? null,
    seriesRef,
    authors: authorRefs.map((author) => author.name),
    authorRefs,
    narrators: safeStringArray(row.narrators),
    libraryName: sourceBackedLibraryName(row.mediaType),
    formats: row.format ? [row.format] : [],
    hasCover: row.hasCover,
  };
}

function sourceBackedMediaTypesForLibraryIds(libraryIds: number[]): WarehouseMediaType[] {
  const mediaTypes: WarehouseMediaType[] = [];
  if (libraryIds.includes(CLOUD_EBOOK_LIBRARY_ID)) mediaTypes.push('ebook');
  if (libraryIds.includes(CLOUD_AUDIO_LIBRARY_ID)) mediaTypes.push('audiobook');
  if (libraryIds.includes(CLOUD_COMIC_LIBRARY_ID)) mediaTypes.push('comic');
  return mediaTypes;
}

function sourceBackedLibraryName(mediaType: WarehouseMediaType): string {
  if (mediaType === 'audiobook') return 'Audiobooks';
  if (mediaType === 'comic') return 'Comics';
  return 'Books';
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
