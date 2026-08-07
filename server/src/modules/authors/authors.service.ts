import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Observable } from 'rxjs';

import type {
  AuthorBooksPage,
  AuthorDetail,
  AuthorLibraryItem,
  AuthorMetadataCandidate,
  AuthorMetadataProviderInfo,
  AuthorSummary,
  AuthorsPage,
  ContentFilterRules,
  MergeAuthorsResult,
  WarehouseMediaType,
} from '@bookorbit/types';
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types';
import { assembleBookCards } from '../book/utils/assemble-book-cards';
import { MAX_OFFSET_ROWS, isOffsetWithinLimit } from '../../common/constants/pagination.constants';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { normalizeMetadataText } from '../../common/utils/metadata-text-normalize.utils';
import type { RequestUser } from '../../common/types/request-user';
import { BookReadService } from '../book/book-read.service';
import { LibraryService } from '../library/library.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { MetadataScoreService } from '../metadata-score/metadata-score.service';
import { AuthorImageStorageError, AuthorImageStorageService } from './author-image-storage.service';
import { AUTHOR_ENRICHMENT_REASONS } from './author-enrichment-reasons';
import { AuthorEnrichmentExecutorService } from './author-enrichment-executor.service';
import { AuthorEnrichmentOrchestratorService } from './author-enrichment-orchestrator.service';
import { AuthorsRepository } from './authors.repository';
import { ListAuthorBooksDto } from './dto/list-author-books.dto';
import { DeleteAuthorsDto } from './dto/delete-authors.dto';
import { ListAuthorMetadataDto } from './dto/list-author-metadata.dto';
import { ListAuthorsDto } from './dto/list-authors.dto';
import { LookupAuthorMetadataDto } from './dto/lookup-author-metadata.dto';
import { MergeAuthorsDto } from './dto/merge-authors.dto';
import { UpdateAuthorDto } from './dto/update-author.dto';
import { AuthorMetadataFetchService } from './metadata/author-metadata-fetch.service';
import { WarehouseCatalogService } from '../warehouse/warehouse-catalog.service';

type AuthorSummarySourceRow = {
  id: number;
  name: string;
  sortName: string | null;
  description: string | null;
  bookCount: number;
  lastAddedAt: Date | string | null;
};

type ResolvedReadableLibraryScope = {
  localLibraryIds: number[];
  includeWarehouse: boolean;
  warehouseMediaType?: WarehouseMediaType;
};

@Injectable()
export class AuthorsService {
  static readonly MAX_AUTHOR_IMAGE_BYTES = 20 * 1024 * 1024;
  private static readonly BULK_AUDNEXUS_DELAY_MIN_MS = 250;
  private static readonly BULK_AUDNEXUS_DELAY_MAX_MS = 1_000;
  private readonly logger = new Logger(AuthorsService.name);

  constructor(
    private readonly authorsRepo: AuthorsRepository,
    private readonly bookReadService: BookReadService,
    private readonly libraryService: LibraryService,
    private readonly appSettings: AppSettingsService,
    private readonly authorMetadataFetchService: AuthorMetadataFetchService,
    private readonly authorImageStorage: AuthorImageStorageService,
    private readonly enrichmentExecutor: AuthorEnrichmentExecutorService,
    private readonly enrichmentOrchestrator: AuthorEnrichmentOrchestratorService,
    private readonly warehouseCatalogService: WarehouseCatalogService,
    private readonly metadataScoreService: MetadataScoreService,
  ) {}

  private assertPaginationWindow(page: number, size: number): void {
    if (!isOffsetWithinLimit(page * size)) {
      throw new BadRequestException(`pagination window is too deep; page * size must be <= ${MAX_OFFSET_ROWS}`);
    }
  }

  async findAll(user: RequestUser, dto: ListAuthorsDto): Promise<AuthorsPage> {
    const page = dto.page ?? 0;
    const size = dto.size ?? 50;
    this.assertPaginationWindow(page, size);
    const libraryScope = this.resolveLibraryScope(dto.libraryId);
    const readableScope = await this.resolveReadableLibraryScope(user, libraryScope);
    const libraryIds = readableScope.localLibraryIds;
    const includeWarehouseLibraries = readableScope.includeWarehouse;
    if (libraryIds.length === 0 && !includeWarehouseLibraries) {
      return { items: [], total: 0, page, size };
    }

    const contentFilters = user.isSuperuser ? undefined : user.contentFilters;

    if (includeWarehouseLibraries) {
      if (libraryIds.length === 0) {
        if (dto.hasPhoto === true) {
          return { items: [], total: 0, page, size };
        }

        const warehousePage = await this.warehouseCatalogService.listAuthorSummaryPage({
          userId: user.id,
          q: dto.q,
          contentFilters,
          mediaType: readableScope.warehouseMediaType,
          page,
          size,
          sort: dto.sort ?? 'name',
          order: dto.order ?? 'asc',
          minBookCount: dto.minBookCount,
        });

        return {
          items: await this.withAuthorImageUrls(warehousePage.rows.map((item) => this.mapAuthorSummary(item))),
          total: warehousePage.total,
          page,
          size,
        };
      }

      const [localRows, warehouseRows] = await Promise.all([
        libraryIds.length > 0
          ? this.authorsRepo.findSummaries({
              q: dto.q,
              libraryIds,
              hasPhoto: dto.hasPhoto,
              contentFilters,
            })
          : [],
        dto.hasPhoto === true
          ? []
          : this.warehouseCatalogService.listAuthorSummaries({
              userId: user.id,
              q: dto.q,
              contentFilters,
              mediaType: readableScope.warehouseMediaType,
            }),
      ]);
      const merged = this.mergeAuthorSummaries([...localRows, ...warehouseRows])
        .filter((row) => dto.minBookCount === undefined || row.bookCount >= dto.minBookCount)
        .sort((a, b) => this.compareAuthorRows(a, b, dto.sort ?? 'name', dto.order ?? 'asc'));
      const items = merged.slice(page * size, page * size + size).map((item) => this.mapAuthorSummary(item));

      return {
        items: await this.withAuthorImageUrls(items),
        total: merged.length,
        page,
        size,
      };
    }

    const authorPage = await this.authorsRepo.findPage({
      q: dto.q,
      page,
      size,
      sort: dto.sort ?? 'name',
      order: dto.order ?? 'asc',
      libraryIds,
      hasPhoto: dto.hasPhoto,
      minBookCount: dto.minBookCount,
      contentFilters,
    });

    const mapped = authorPage.items.map((item) => this.mapAuthorSummary(item));
    return {
      ...authorPage,
      items: await this.withAuthorImageUrls(mapped),
    };
  }

  /** Total authors the user can browse; matches the unfiltered total of {@link findAll}. */
  async countAll(user: RequestUser): Promise<number> {
    const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    if (libraryIds.length === 0) return 0;
    return this.authorsRepo.countAuthors({ libraryIds, contentFilters: user.isSuperuser ? undefined : user.contentFilters });
  }

  async findOne(user: RequestUser, authorId: number): Promise<AuthorDetail> {
    if (this.isWarehouseAuthorId(authorId)) {
      const readableScope = await this.resolveReadableLibraryScope(user, this.resolveLibraryScope());
      if (!readableScope.includeWarehouse) throw new NotFoundException('Author not found');
      const row = await this.warehouseCatalogService.findAuthorSummaryById(authorId, user.id, user.isSuperuser ? undefined : user.contentFilters);
      if (!row) throw new NotFoundException('Author not found');
      return this.withAuthorImageUrl(this.mapAuthorSummary(row) as AuthorDetail, 'full');
    }

    const readableScope = await this.resolveReadableLibraryScope(user, this.resolveLibraryScope());
    const contentFilters = user.isSuperuser ? undefined : user.contentFilters;
    const row = await this.authorsRepo.findById(authorId, readableScope.localLibraryIds, contentFilters);
    if (!row) throw new NotFoundException('Author not found');
    const mergedRow = await this.mergeSourceBackedAuthorSummaryIntoLocalDetail(user, row, readableScope, contentFilters);
    return this.withAuthorImageUrl(this.mapAuthorSummary(mergedRow) as AuthorDetail, 'full');
  }

  async findBooks(user: RequestUser, authorId: number, dto: ListAuthorBooksDto): Promise<AuthorBooksPage> {
    const page = dto.page ?? 0;
    const size = dto.size ?? 50;
    const pageStart = page * size;
    const pageEnd = pageStart + size;
    const windowSize = pageEnd;
    const emptyBookPage: { bookIds: number[]; total: number; page: number; size: number } = { bookIds: [], total: 0, page: 0, size: windowSize };
    this.assertPaginationWindow(page, size);

    const libraryScope = this.resolveLibraryScope(dto.libraryId);
    const readableScope = await this.resolveReadableLibraryScope(user, libraryScope);
    const contentFilters = user.isSuperuser ? undefined : user.contentFilters;
    if (this.isWarehouseAuthorId(authorId)) {
      const row = await this.warehouseCatalogService.findAuthorSummaryById(authorId, user.id, contentFilters);
      if (!row) throw new NotFoundException('Author not found');
      if (!readableScope.includeWarehouse) {
        return { items: [], total: 0, page, size };
      }
      const warehousePage = await this.warehouseCatalogService.listAuthorBooks({
        authorId,
        userId: user.id,
        page: 0,
        size: windowSize,
        sort: dto.sort ?? 'addedAt',
        order: dto.order ?? 'desc',
        contentFilters,
        mediaType: readableScope.warehouseMediaType,
      });
      return {
        items: warehousePage.items.slice(pageStart, pageEnd),
        total: warehousePage.total,
        page,
        size,
      };
    }

    const visibleLibraryIds = await this.resolveLibraryIds(user);
    const libraryIds = readableScope.localLibraryIds;
    if (visibleLibraryIds.length === 0 && !readableScope.includeWarehouse) {
      return { items: [], total: 0, page, size };
    }
    if (libraryIds.length === 0 && !libraryScope.includeWarehouse) {
      return { items: [], total: 0, page, size };
    }

    const author = await this.authorsRepo.findById(authorId, libraryIds.length > 0 ? libraryIds : visibleLibraryIds, contentFilters);
    if (!author) throw new NotFoundException('Author not found');

    const [localPage, warehousePage] = await Promise.all([
      libraryIds.length > 0
        ? this.authorsRepo.findBookIdsPage({
            authorId,
            page: 0,
            size: windowSize,
            sort: dto.sort ?? 'addedAt',
            order: dto.order ?? 'desc',
            libraryIds,
            contentFilters,
          })
        : emptyBookPage,
      readableScope.includeWarehouse
        ? this.warehouseCatalogService.listAuthorBooks({
            authorName: author.name,
            userId: user.id,
            page: 0,
            size: windowSize,
            sort: dto.sort ?? 'addedAt',
            order: dto.order ?? 'desc',
            contentFilters,
            mediaType: readableScope.warehouseMediaType,
          })
        : Promise.resolve({ items: [] as AuthorLibraryItem[], total: 0 }),
    ]);

    let localItems: AuthorLibraryItem[] = [];
    if (localPage.bookIds.length > 0) {
      const orderMap = new Map(localPage.bookIds.map((id, index) => [id, index]));
      const cardData = await this.bookReadService.findCardsByBookIds(localPage.bookIds, user.id);

      localItems = assembleBookCards(
        cardData.rows,
        cardData.authorRows,
        cardData.fileRows,
        cardData.genreRows,
        cardData.progressRows,
        cardData.statusRows,
        cardData.narratorRows,
        cardData.tagRows,
        cardData.seriesMembershipRows,
      ).sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
    }

    if (warehousePage.items.length === 0) {
      return { items: localItems.slice(pageStart, pageEnd), total: localPage.total, page, size };
    }
    if (localItems.length === 0) {
      return { items: warehousePage.items.slice(pageStart, pageEnd), total: warehousePage.total, page, size };
    }

    const allItems = this.sortAuthorLibraryItems([...localItems, ...warehousePage.items], dto.sort ?? 'addedAt', dto.order ?? 'desc');
    return { items: allItems.slice(pageStart, pageEnd), total: localPage.total + warehousePage.total, page, size };
  }

  listMetadataProviders(): AuthorMetadataProviderInfo[] {
    return this.authorMetadataFetchService.listProviders();
  }

  async searchMetadata(dto: ListAuthorMetadataDto): Promise<AuthorMetadataCandidate[]> {
    const event = 'author.search_metadata';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] query=${JSON.stringify(dto.q)} region=${dto.region ?? 'default'} limit=${dto.limit ?? 0} providerCount=${dto.providers?.length ?? 0} - author metadata search started`,
    );
    try {
      const result = await this.authorMetadataFetchService.search(
        {
          name: dto.q,
          region: dto.region,
          limit: dto.limit,
        },
        { keys: dto.providers },
      );
      this.logger.log(
        `[${event}] [end] query=${JSON.stringify(dto.q)} durationMs=${Date.now() - startedAt} resultCount=${result.length} - author metadata search completed`,
      );
      return result;
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] query=${JSON.stringify(dto.q)} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - author metadata search failed`,
      );
      throw err;
    }
  }

  async lookupMetadata(dto: LookupAuthorMetadataDto): Promise<AuthorMetadataCandidate | null> {
    const event = 'author.lookup_metadata';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] provider=${dto.provider} providerId=${JSON.stringify(dto.id)} region=${dto.region ?? 'default'} - author metadata lookup started`,
    );
    try {
      const result = await this.authorMetadataFetchService.lookupById(dto.provider, dto.id, dto.region);
      this.logger.log(
        `[${event}] [end] provider=${dto.provider} providerId=${JSON.stringify(dto.id)} durationMs=${Date.now() - startedAt} found=${result != null} - author metadata lookup completed`,
      );
      return result;
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] provider=${dto.provider} providerId=${JSON.stringify(dto.id)} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - author metadata lookup failed`,
      );
      throw err;
    }
  }

  streamMetadata(dto: ListAuthorMetadataDto): Observable<AuthorMetadataCandidate> {
    return this.authorMetadataFetchService.stream(
      {
        name: dto.q,
        region: dto.region,
        limit: dto.limit,
      },
      { keys: dto.providers },
    );
  }

  async update(user: RequestUser, authorId: number, dto: UpdateAuthorDto): Promise<AuthorDetail> {
    const event = 'author.update';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] userId=${user.id} authorId=${authorId} - author update started`);
    try {
      await this.assertMutationAccess(user, [authorId]);

      const values: Parameters<AuthorsRepository['updateAuthorById']>[1] = {};

      if ('name' in dto) {
        const name = normalizeMetadataText(dto.name);
        if (!name) throw new BadRequestException('name cannot be empty');
        values.name = name;
      }

      if ('sortName' in dto) {
        values.sortName = normalizeMetadataText(dto.sortName);
      }

      if ('description' in dto) {
        values.description = dto.description?.trim() || null;
      }

      const fieldNames = Object.keys(values);
      if (fieldNames.length === 0) {
        const detail = await this.findOne(user, authorId);
        this.logger.log(
          `[${event}] [end] userId=${user.id} authorId=${authorId} durationMs=${Date.now() - startedAt} fields=none noChange=true - author update completed`,
        );
        return detail;
      }

      const updated = await this.authorsRepo.updateAuthorById(authorId, values);
      if (!updated) throw new NotFoundException('Author not found');
      if (values.name !== undefined) {
        await this.enrichmentOrchestrator.schedule(authorId, AUTHOR_ENRICHMENT_REASONS.AUTHOR_RENAME);
      }
      const detail = await this.findOne(user, authorId);
      this.logger.log(
        `[${event}] [end] userId=${user.id} authorId=${authorId} durationMs=${Date.now() - startedAt} fields=${fieldNames.join(',')} noChange=false - author update completed`,
      );
      return detail;
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] userId=${user.id} authorId=${authorId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - author update failed`,
      );
      throw err;
    }
  }

  async merge(user: RequestUser, dto: MergeAuthorsDto): Promise<MergeAuthorsResult> {
    const event = 'author.merge';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] userId=${user.id} targetAuthorId=${dto.targetAuthorId} sourceCount=${dto.sourceAuthorIds.length} - author merge started`,
    );
    try {
      if (!this.isSuperuser(user)) {
        throw new ForbiddenException('Only superusers can merge authors');
      }

      const uniqueSourceIds = [...new Set(dto.sourceAuthorIds)].filter((id) => id !== dto.targetAuthorId);
      if (uniqueSourceIds.length === 0) {
        throw new BadRequestException('sourceAuthorIds must include at least one author different from targetAuthorId');
      }

      const allAuthorIds = [dto.targetAuthorId, ...uniqueSourceIds];
      await this.assertMutationAccess(user, allAuthorIds);

      const affectedBookIds = await this.authorsRepo.findBookIdsByAuthorIds(uniqueSourceIds);
      await this.authorsRepo.mergeAuthors(dto.targetAuthorId, uniqueSourceIds);
      await this.metadataScoreService.calculateAndSaveMany(affectedBookIds);
      await this.enrichmentOrchestrator.schedule(dto.targetAuthorId, AUTHOR_ENRICHMENT_REASONS.AUTHOR_MERGE_TARGET);
      const target = await this.findOne(user, dto.targetAuthorId);

      this.logger.log(
        `[${event}] [end] userId=${user.id} targetAuthorId=${dto.targetAuthorId} durationMs=${Date.now() - startedAt} mergedCount=${uniqueSourceIds.length} affectedBookCount=${affectedBookIds.length} - author merge completed`,
      );
      return {
        target,
        mergedAuthorIds: uniqueSourceIds,
        affectedBookCount: affectedBookIds.length,
      };
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] userId=${user.id} targetAuthorId=${dto.targetAuthorId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - author merge failed`,
      );
      throw err;
    }
  }

  async delete(user: RequestUser, dto: DeleteAuthorsDto): Promise<{ deletedAuthorIds: number[]; affectedBookCount: number }> {
    const event = 'author.delete';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] userId=${user.id} count=${dto.authorIds.length} - author delete started`);
    try {
      if (!this.isSuperuser(user)) {
        throw new ForbiddenException('Only superusers can delete authors');
      }

      const authorIds = [...new Set(dto.authorIds)];
      await this.assertMutationAccess(user, authorIds);

      const affectedBookIds = await this.authorsRepo.findBookIdsByAuthorIds(authorIds);
      await this.authorsRepo.deleteAuthors(authorIds);
      await this.metadataScoreService.calculateAndSaveMany(affectedBookIds);
      this.logger.log(
        `[${event}] [end] userId=${user.id} durationMs=${Date.now() - startedAt} deletedCount=${authorIds.length} affectedBookCount=${affectedBookIds.length} - author delete completed`,
      );

      return {
        deletedAuthorIds: authorIds,
        affectedBookCount: affectedBookIds.length,
      };
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] userId=${user.id} count=${dto.authorIds.length} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - author delete failed`,
      );
      throw err;
    }
  }

  async refreshEnrichment(user: RequestUser, authorId: number): Promise<AuthorDetail> {
    const event = 'author.refresh_enrichment';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] userId=${user.id} authorId=${authorId} - author enrichment refresh started`);
    try {
      await this.assertMutationAccess(user, [authorId]);

      const result = await this.refreshEnrichmentInternal(authorId);
      const detail = await this.findOne(user, authorId);
      this.logger.log(
        `[${event}] [end] userId=${user.id} authorId=${authorId} durationMs=${Date.now() - startedAt} provider=${result.provider ?? 'none'} descriptionUpdated=${result.descriptionUpdated} imageUpdated=${result.imageUpdated} - author enrichment refresh completed`,
      );
      return detail;
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] userId=${user.id} authorId=${authorId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - author enrichment refresh failed`,
      );
      throw err;
    }
  }

  async getThumbnailPath(user: RequestUser, authorId: number): Promise<string | null> {
    await this.assertAuthorReadable(user, [authorId]);
    return this.authorImageStorage.getThumbnailPath(authorId);
  }

  async getImagePath(user: RequestUser, authorId: number): Promise<string | null> {
    await this.assertAuthorReadable(user, [authorId]);
    return this.authorImageStorage.getImagePath(authorId);
  }

  async uploadImage(user: RequestUser, authorId: number, bytes: Buffer, mimeType: string): Promise<AuthorDetail> {
    const event = 'author.upload_image';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] userId=${user.id} authorId=${authorId} mimeType=${mimeType} bytes=${bytes.length} - author image upload started`,
    );
    try {
      if (!mimeType.startsWith('image/')) {
        throw new BadRequestException('File must be an image');
      }
      if (bytes.length === 0) {
        throw new BadRequestException('File is empty');
      }
      if (bytes.length > AuthorsService.MAX_AUTHOR_IMAGE_BYTES) {
        throw new BadRequestException('Image exceeds 20 MB limit');
      }

      await this.assertMutationAccess(user, [authorId]);

      try {
        await this.authorImageStorage.saveFromBuffer(authorId, bytes);
      } catch (error) {
        if (error instanceof AuthorImageStorageError) {
          if (this.isLikelyInvalidImageError(error)) {
            throw new BadRequestException('Invalid image file');
          }
          throw new ServiceUnavailableException('Failed to persist author image');
        }
        throw error;
      }

      await this.authorsRepo.updateAuthorById(authorId, { hasPhoto: true });
      const detail = await this.findOne(user, authorId);
      this.logger.log(
        `[${event}] [end] userId=${user.id} authorId=${authorId} durationMs=${Date.now() - startedAt} hasPhoto=true - author image upload completed`,
      );
      return detail;
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[${event}] [fail] userId=${user.id} authorId=${authorId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - author image upload failed`,
      );
      throw error;
    }
  }

  async deleteImage(user: RequestUser, authorId: number): Promise<AuthorDetail> {
    const event = 'author.delete_image';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] userId=${user.id} authorId=${authorId} - author image delete started`);
    try {
      await this.assertMutationAccess(user, [authorId]);
      await this.authorImageStorage.deleteAuthorDir(authorId);
      await this.authorsRepo.updateAuthorById(authorId, { hasPhoto: false });
      const detail = await this.findOne(user, authorId);
      this.logger.log(
        `[${event}] [end] userId=${user.id} authorId=${authorId} durationMs=${Date.now() - startedAt} hasPhoto=false - author image delete completed`,
      );
      return detail;
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[${event}] [fail] userId=${user.id} authorId=${authorId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - author image delete failed`,
      );
      throw error;
    }
  }

  async bulkRefreshMetadata(
    authorIds: number[],
    user: RequestUser,
    onProgress?: (event: { authorId: number; updated: boolean; imageUpdated?: boolean; imageUrl?: string | null; error?: string }) => void,
  ): Promise<{ processed: number; failed: number; updated: number }> {
    const event = 'author.bulk_refresh_metadata';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] userId=${user.id} count=${authorIds.length} - bulk author metadata refresh started`);
    try {
      const uniqueAuthorIds = [...new Set(authorIds)];
      if (uniqueAuthorIds.length === 0) {
        this.logger.log(
          `[${event}] [end] userId=${user.id} count=0 durationMs=${Date.now() - startedAt} processed=0 updated=0 failed=0 - bulk author metadata refresh completed`,
        );
        return { processed: 0, failed: 0, updated: 0 };
      }

      await this.assertMutationAccess(user, uniqueAuthorIds);

      let processed = 0;
      let failed = 0;
      let updated = 0;
      let callbackInterrupted = false;

      for (let index = 0; index < uniqueAuthorIds.length; index += 1) {
        const authorId = uniqueAuthorIds[index]!;
        let didUpdate = false;
        let imageUpdated = false;
        let imageUrl: string | null | undefined;
        let errorMessage: string | undefined;

        try {
          const result = await this.refreshEnrichmentInternal(authorId);
          didUpdate = result.descriptionUpdated || result.imageUpdated;
          imageUpdated = result.imageUpdated;
          if (imageUpdated) {
            imageUrl = await this.authorImageStorage.getThumbnailUrlIfExists(authorId);
          }
          if (didUpdate) {
            updated += 1;
          }
        } catch (error) {
          failed += 1;
          const itemErrorClass = error instanceof Error ? error.name : 'Error';
          errorMessage = error instanceof Error ? error.message : 'Failed to refresh metadata';
          const itemError = sanitizeLogValue(errorMessage);
          this.logger.warn(
            `[${event}] [fail] userId=${user.id} authorId=${authorId} durationMs=${Date.now() - startedAt} errorClass=${itemErrorClass} error="${itemError}" - author metadata refresh item failed`,
          );
        }

        processed += 1;
        try {
          onProgress?.({ authorId, updated: didUpdate, imageUpdated, imageUrl, error: errorMessage });
        } catch {
          // callback threw (e.g. client disconnected) - stop the loop
          callbackInterrupted = true;
          break;
        }

        if (index < uniqueAuthorIds.length - 1) {
          await this.sleep(this.getBulkAudnexusDelayMs());
        }
      }

      this.logger.log(
        `[${event}] [end] userId=${user.id} count=${uniqueAuthorIds.length} durationMs=${Date.now() - startedAt} processed=${processed} updated=${updated} failed=${failed} callbackInterrupted=${callbackInterrupted} - bulk author metadata refresh completed`,
      );
      return { processed, failed, updated };
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] userId=${user.id} count=${authorIds.length} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - bulk author metadata refresh failed`,
      );
      throw err;
    }
  }

  private async resolveLibraryIds(user: RequestUser, scopedLibraryId?: number): Promise<number[]> {
    const libraries = await this.libraryService.findAll(user);
    const accessibleIds = libraries.map((library) => library.id);

    if (!scopedLibraryId) return accessibleIds;
    return accessibleIds.includes(scopedLibraryId) ? [scopedLibraryId] : [];
  }

  private async resolveReadableLibraryScope(
    user: RequestUser,
    libraryScope: {
      localLibraryId?: number;
      includeLocal: boolean;
      includeWarehouse: boolean;
      mediaType?: WarehouseMediaType;
    },
  ): Promise<ResolvedReadableLibraryScope> {
    const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
    const accessibleIds = libraries.map((library) => library.id);
    const localLibraryIds = libraryScope.includeLocal
      ? libraryScope.localLibraryId
        ? accessibleIds.includes(libraryScope.localLibraryId)
          ? [libraryScope.localLibraryId]
          : []
        : accessibleIds.filter((id) => id > 0)
      : [];

    const warehouseMediaTypes: WarehouseMediaType[] = [];
    if (libraryScope.includeWarehouse) {
      if (libraryScope.mediaType) {
        const requiredLibraryId = sourceBackedLibraryIdForMediaType(libraryScope.mediaType);
        if (accessibleIds.includes(requiredLibraryId)) warehouseMediaTypes.push(libraryScope.mediaType);
      } else {
        if (accessibleIds.includes(CLOUD_EBOOK_LIBRARY_ID)) warehouseMediaTypes.push('ebook');
        if (accessibleIds.includes(CLOUD_AUDIO_LIBRARY_ID)) warehouseMediaTypes.push('audiobook');
        if (accessibleIds.includes(CLOUD_COMIC_LIBRARY_ID)) warehouseMediaTypes.push('comic');
      }
    }

    return {
      localLibraryIds,
      includeWarehouse: warehouseMediaTypes.length > 0,
      warehouseMediaType: warehouseMediaTypes.length === 1 ? warehouseMediaTypes[0] : undefined,
    };
  }

  private resolveLibraryScope(libraryId?: number): {
    localLibraryId?: number;
    includeLocal: boolean;
    includeWarehouse: boolean;
    mediaType?: WarehouseMediaType;
  } {
    switch (libraryId) {
      case undefined:
        return { includeLocal: true, includeWarehouse: true };
      case CLOUD_EBOOK_LIBRARY_ID:
        return { includeLocal: false, includeWarehouse: true, mediaType: 'ebook' };
      case CLOUD_AUDIO_LIBRARY_ID:
        return { includeLocal: false, includeWarehouse: true, mediaType: 'audiobook' };
      case CLOUD_COMIC_LIBRARY_ID:
        return { includeLocal: false, includeWarehouse: true, mediaType: 'comic' };
      default:
        return { includeLocal: true, includeWarehouse: false, localLibraryId: libraryId };
    }
  }

  private async assertAuthorReadable(user: RequestUser, authorIds: number[]) {
    const libraryIds = await this.resolveLibraryIds(user);
    const visible = await this.authorsRepo.findVisibleAuthorIds(authorIds, libraryIds);
    if (visible.length !== authorIds.length) {
      throw new NotFoundException('Author not found');
    }
  }

  private async assertMutationAccess(user: RequestUser, authorIds: number[]) {
    const libraryIds = await this.resolveLibraryIds(user);
    const [visible, relatedLibraryIds] = await Promise.all([
      this.authorsRepo.findVisibleAuthorIds(authorIds, libraryIds),
      this.authorsRepo.findRelatedLibraryIds(authorIds),
    ]);
    if (visible.length !== authorIds.length) {
      throw new NotFoundException('Author not found');
    }
    const accessibleSet = new Set(libraryIds);
    if (relatedLibraryIds.some((libraryId) => !accessibleSet.has(libraryId))) {
      throw new ForbiddenException('Insufficient library access to mutate one or more selected authors');
    }
  }

  private isSuperuser(user: RequestUser): boolean {
    return user.isSuperuser;
  }

  private mapAuthorSummary(row: AuthorSummarySourceRow): AuthorSummary {
    return {
      id: row.id,
      name: row.name,
      sortName: row.sortName,
      description: row.description,
      bookCount: row.bookCount,
      lastAddedAt: this.serializeLastAddedAt(row.lastAddedAt),
    };
  }

  private async withAuthorImageUrls(items: AuthorSummary[]): Promise<AuthorSummary[]> {
    return Promise.all(items.map((item) => this.withAuthorImageUrl(item)));
  }

  private async withAuthorImageUrl<T extends AuthorSummary>(item: T, size: 'thumbnail' | 'full' = 'thumbnail'): Promise<T> {
    if (this.isWarehouseAuthorId(item.id)) {
      return { ...item, imageUrl: null };
    }

    let imageUrl: string | null;
    if (size === 'full') {
      imageUrl = await this.authorImageStorage.getImageUrlIfExists(item.id);
      if (!imageUrl) {
        imageUrl = await this.authorImageStorage.getThumbnailUrlIfExists(item.id);
      }
    } else {
      imageUrl = await this.authorImageStorage.getThumbnailUrlIfExists(item.id);
    }

    return {
      ...item,
      imageUrl,
    };
  }

  private async mergeSourceBackedAuthorSummaryIntoLocalDetail(
    user: RequestUser,
    row: AuthorSummarySourceRow,
    readableScope: ResolvedReadableLibraryScope,
    contentFilters: ContentFilterRules | undefined,
  ): Promise<AuthorSummarySourceRow> {
    if (!readableScope.includeWarehouse) return row;

    const warehouseRows = await this.warehouseCatalogService.listAuthorSummaries({
      userId: user.id,
      q: undefined,
      contentFilters,
      mediaType: readableScope.warehouseMediaType,
    });
    const localKey = this.normalizeAuthorName(row.name);
    const matches = warehouseRows.filter((warehouseRow) => this.normalizeAuthorName(warehouseRow.name) === localKey);
    if (matches.length === 0) return row;

    return this.mergeAuthorSummaries([row, ...matches]).find((mergedRow) => mergedRow.id === row.id) ?? row;
  }

  private mergeAuthorSummaries(rows: AuthorSummarySourceRow[]): AuthorSummarySourceRow[] {
    const merged = new Map<string, AuthorSummarySourceRow>();

    for (const row of rows) {
      const key = this.normalizeAuthorName(row.name);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...row });
        continue;
      }

      existing.bookCount += row.bookCount;
      existing.lastAddedAt = this.maxLastAddedAt(existing.lastAddedAt, row.lastAddedAt);
      if (existing.id < 0 && row.id > 0) {
        existing.id = row.id;
        existing.sortName = row.sortName;
        existing.description = row.description;
      }
    }

    return [...merged.values()];
  }

  private compareAuthorRows(
    left: AuthorSummarySourceRow,
    right: AuthorSummarySourceRow,
    sort: ListAuthorsDto['sort'],
    order: ListAuthorsDto['order'],
  ): number {
    const direction = order === 'desc' ? -1 : 1;
    const byName = this.compareText(left.name, right.name);
    let result = byName;

    switch (sort) {
      case 'bookCount':
        result = left.bookCount - right.bookCount;
        break;
      case 'lastAddedAt':
        result = this.timestamp(left.lastAddedAt) - this.timestamp(right.lastAddedAt);
        break;
      case 'sortName':
        result = this.compareText(left.sortName ?? left.name, right.sortName ?? right.name);
        break;
      case 'lastEnrichedAt':
      case 'name':
      default:
        break;
    }

    return result === 0 ? byName || left.id - right.id : result * direction;
  }

  private compareText(left: string, right: string): number {
    return left.localeCompare(right, undefined, { sensitivity: 'base' });
  }

  private sortAuthorLibraryItems(
    items: AuthorLibraryItem[],
    sort: ListAuthorBooksDto['sort'],
    order: ListAuthorBooksDto['order'],
  ): AuthorLibraryItem[] {
    const direction = order === 'asc' ? 1 : -1;
    return [...items].sort((left, right) => {
      const titleCompare = this.compareText(this.itemTitle(left), this.itemTitle(right));
      let result = titleCompare;

      switch (sort) {
        case 'addedAt':
          result = this.timestamp(this.itemAddedAt(left)) - this.timestamp(this.itemAddedAt(right));
          break;
        case 'publishedYear':
          result = this.itemPublishedYear(left) - this.itemPublishedYear(right);
          break;
        case 'title':
        default:
          break;
      }

      return result === 0 ? titleCompare : result * direction;
    });
  }

  private itemTitle(item: AuthorLibraryItem): string {
    return item.title ?? '';
  }

  private itemAddedAt(item: AuthorLibraryItem): string | null {
    return item.addedAt;
  }

  private itemPublishedYear(item: AuthorLibraryItem): number {
    return item.publishedYear ?? 0;
  }

  private maxLastAddedAt(left: Date | string | null, right: Date | string | null): Date | string | null {
    return this.timestamp(left) >= this.timestamp(right) ? left : right;
  }

  private serializeLastAddedAt(value: Date | string | null): string | null {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    return value;
  }

  private timestamp(value: Date | string | null): number {
    if (!value) return 0;
    const date = value instanceof Date ? value : new Date(value);
    const time = date.getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  private normalizeAuthorName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return '';
    const commaIndex = trimmed.indexOf(',');
    if (commaIndex <= 0) return trimmed.toLocaleLowerCase();

    const family = trimmed.slice(0, commaIndex).trim();
    const given = trimmed.slice(commaIndex + 1).trim();
    return given && family ? `${given} ${family}`.toLocaleLowerCase() : trimmed.toLocaleLowerCase();
  }

  private isWarehouseAuthorId(authorId: number): boolean {
    return authorId < 0;
  }

  private async refreshEnrichmentInternal(
    authorId: number,
  ): Promise<{ descriptionUpdated: boolean; imageUpdated: boolean; provider: string | null }> {
    const writeMode = await this.appSettings.getAuthorsAutoEnrichmentWriteMode();
    const result = await this.enrichmentExecutor.execute({
      authorId,
      writeMode,
      audnexusEnabled: true,
    });

    if (result.kind === 'skipped' && result.reason === 'author_not_found') {
      throw new NotFoundException('Author not found');
    }

    if (result.kind === 'failed') {
      const provider = result.provider ?? 'unknown';
      throw new ServiceUnavailableException(`Author enrichment failed for provider ${provider}: ${result.message}`);
    }

    return {
      descriptionUpdated: result.descriptionUpdated,
      imageUpdated: result.imageUpdated,
      provider: result.provider,
    };
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private getBulkAudnexusDelayMs(): number {
    const min = AuthorsService.BULK_AUDNEXUS_DELAY_MIN_MS;
    const max = AuthorsService.BULK_AUDNEXUS_DELAY_MAX_MS;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private isLikelyInvalidImageError(error: AuthorImageStorageError): boolean {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('image bytes are empty') ||
      msg.includes('input buffer') ||
      msg.includes('unsupported image format') ||
      msg.includes('vips') ||
      msg.includes('corrupt') ||
      msg.includes('invalid')
    );
  }
}

function sourceBackedLibraryIdForMediaType(mediaType: WarehouseMediaType): number {
  if (mediaType === 'audiobook') return CLOUD_AUDIO_LIBRARY_ID;
  if (mediaType === 'comic') return CLOUD_COMIC_LIBRARY_ID;
  return CLOUD_EBOOK_LIBRARY_ID;
}
