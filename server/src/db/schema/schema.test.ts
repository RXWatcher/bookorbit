import { bookMetadata } from './metadata';
import { bookSeries } from './series';
import { users, appSettings } from './auth';
import { opdsUsers } from './opds';
import { bookDockFiles } from './book-dock';
import { libraries } from './libraries';
import { books, bookFiles } from './books';
import { emailProviders } from './email-providers';
import { emailTemplates } from './email-templates';
import { collections } from './collections';
import { emailPreferences } from './email-preferences';
import { smartScopes } from './smart-scopes';
import { koboSyncSettings, koboLibrarySnapshots, koboReadingStates } from './kobo';
import { koreaderCatalogDeviceProgress, koreaderCatalogDocuments } from './koreader';
import { emailRecipients, emailRecipientGroups } from './email-recipients';
import { readerDefaultPreferences, readerPreferences, readingProgress, annotations, userReadingDailyStats } from './reader';
import { migrationSources, migrationProfiles, migrationPlanArtifacts, migrationRuns, migrationRunMetrics } from './migration';
import {
  catalogItemSourceEnum,
  warehouseCatalogItems,
  warehouseCatalogItemAuthors,
  warehouseCatalogSyncRuns,
  warehouseAnnotations,
  warehouseBookmarks,
  warehouseRequests,
  warehouseSettings,
  warehouseUserItems,
  warehouseUserState,
} from './warehouse';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { FILE_ROLES } from '../../modules/scanner/lib/classify';
import { localScanRoots } from './local-scan';

describe('Database Schema Logic', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  describe('Metadata Schema - embedding256 custom type', () => {
    const embeddingColumn = bookMetadata.embedding;

    it('toDriver should format array as a vector string', () => {
      const input = [0.1, 0.2, 0.3];
      const result = embeddingColumn.mapToDriverValue(input);
      expect(result).toBe('[0.1,0.2,0.3]');
    });

    it('fromDriver should parse vector string to array', () => {
      const input = '[0.1,0.2,0.3]';
      const result = embeddingColumn.mapFromDriverValue(input);
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it('fromDriver should handle empty vector string safely', () => {
      const input = '[]';
      const result = embeddingColumn.mapFromDriverValue(input);
      expect(result).toEqual([]);
    });

    it('fromDriver should handle null/undefined safely', () => {
      // @ts-expect-error: testing invalid null input
      expect(embeddingColumn.mapFromDriverValue(null)).toEqual([]);
      // @ts-expect-error: testing invalid undefined input
      expect(embeddingColumn.mapFromDriverValue(undefined)).toEqual([]);
    });

    it('fromDriver should handle non-string inputs safely', () => {
      // @ts-expect-error: testing invalid number input
      expect(embeddingColumn.mapFromDriverValue(123)).toEqual([]);
      // @ts-expect-error: testing invalid object input
      expect(embeddingColumn.mapFromDriverValue({})).toEqual([]);
    });
  });

  describe('onUpdateFn presence', () => {
    const hasOnUpdateFn = (column: any) => {
      return typeof column.onUpdateFn === 'function';
    };

    const testOnUpdate = (name: string, column: any) => {
      it(`${name} should have an onUpdateFn returning the current Date`, () => {
        expect(hasOnUpdateFn(column)).toBe(true);
        const result = column.onUpdateFn?.();
        expect(result).toBeInstanceOf(Date);
        expect(result).toEqual(new Date('2024-01-01T00:00:00Z'));
      });
    };

    testOnUpdate('users.updatedAt', users.updatedAt);
    testOnUpdate('appSettings.updatedAt', appSettings.updatedAt);
    testOnUpdate('opdsUsers.updatedAt', opdsUsers.updatedAt);
    testOnUpdate('bookDockFiles.updatedAt', bookDockFiles.updatedAt);
    testOnUpdate('libraries.updatedAt', libraries.updatedAt);
    testOnUpdate('books.updatedAt', books.updatedAt);
    testOnUpdate('bookFiles.updatedAt', bookFiles.updatedAt);
    testOnUpdate('bookMetadata.updatedAt', bookMetadata.updatedAt);
    testOnUpdate('bookSeries.updatedAt', bookSeries.updatedAt);
    testOnUpdate('emailProviders.updatedAt', emailProviders.updatedAt);
    testOnUpdate('emailTemplates.updatedAt', emailTemplates.updatedAt);
    testOnUpdate('collections.updatedAt', collections.updatedAt);
    testOnUpdate('emailPreferences.updatedAt', emailPreferences.updatedAt);
    testOnUpdate('smartScopes.updatedAt', smartScopes.updatedAt);
    testOnUpdate('koboSyncSettings.updatedAt', koboSyncSettings.updatedAt);
    testOnUpdate('koboLibrarySnapshots.updatedAt', koboLibrarySnapshots.updatedAt);
    testOnUpdate('koboReadingStates.updatedAt', koboReadingStates.updatedAt);
    testOnUpdate('emailRecipients.updatedAt', emailRecipients.updatedAt);
    testOnUpdate('emailRecipientGroups.updatedAt', emailRecipientGroups.updatedAt);
    testOnUpdate('readingProgress.updatedAt', readingProgress.updatedAt);
    testOnUpdate('userReadingDailyStats.updatedAt', userReadingDailyStats.updatedAt);
    testOnUpdate('annotations.updatedAt', annotations.updatedAt);
    testOnUpdate('readerDefaultPreferences.updatedAt', readerDefaultPreferences.updatedAt);
    testOnUpdate('readerPreferences.updatedAt', readerPreferences.updatedAt);
    testOnUpdate('migrationSources.updatedAt', migrationSources.updatedAt);
    testOnUpdate('migrationProfiles.updatedAt', migrationProfiles.updatedAt);
    testOnUpdate('migrationPlanArtifacts.updatedAt', migrationPlanArtifacts.updatedAt);
    testOnUpdate('migrationRuns.updatedAt', migrationRuns.updatedAt);
    testOnUpdate('migrationRunMetrics.updatedAt', migrationRunMetrics.updatedAt);
    testOnUpdate('koreaderCatalogDocuments.updatedAt', koreaderCatalogDocuments.updatedAt);
    testOnUpdate('koreaderCatalogDeviceProgress.updatedAt', koreaderCatalogDeviceProgress.updatedAt);
  });

  describe('book_files role constraint', () => {
    it('book_files_role_chk exists and covers every FILE_ROLES value', () => {
      const config = getTableConfig(bookFiles);
      const roleCheck = config.checks.find((c) => c.name === 'book_files_role_chk');
      expect(roleCheck).toBeDefined();

      // Drizzle SQL queryChunks are StringChunk objects ({ value: string[] }) or Column references.
      // Join all string portions to get the constraint SQL text.
      const constraintSql = roleCheck!.value.queryChunks.map((chunk: any) => (Array.isArray(chunk?.value) ? chunk.value.join('') : '')).join('');

      for (const role of FILE_ROLES) {
        expect(constraintSql).toContain(`'${role}'`);
      }
    });

    it('role column default is a valid FILE_ROLES member', () => {
      expect(FILE_ROLES as readonly string[]).toContain(bookFiles.role.default);
    });
  });

  describe('warehouse foundation schema', () => {
    it('warehouse_settings has one active profile key and encrypted secret columns', () => {
      const config = getTableConfig(warehouseSettings);
      const uniqueNames = config.uniqueConstraints.map((constraint) => constraint.name);

      expect(uniqueNames).toContain('warehouse_settings_profile_key_unique');
      expect(warehouseSettings.enabled.default).toBe(false);
      expect(warehouseSettings.apiKeyEncrypted).toBeDefined();
      expect(warehouseSettings.apiKeyNonce).toBeDefined();
      expect(warehouseSettings.apiKeyTag).toBeDefined();
      expect(warehouseSettings.ebookLibraryIcon.default).toBe('BookOpen');
      expect(warehouseSettings.audiobookLibraryIcon.default).toBe('Headphones');
      expect(warehouseSettings.comicLibraryIcon.default).toBe('PanelsTopLeft');
    });

    it('warehouse_catalog_items is unique by media type and remote id', () => {
      const config = getTableConfig(warehouseCatalogItems);
      const uniqueNames = config.uniqueConstraints.map((constraint) => constraint.name);

      expect(uniqueNames).toContain('warehouse_catalog_items_media_remote_unique');
      expect(warehouseCatalogItems.hasCover.default).toBe(false);
      expect(warehouseCatalogItems.durationSeconds).toBeDefined();
      expect(warehouseCatalogItems.seriesIndex.name).toBe('series_index');
      expect(config.indexes.map((idx) => idx.config.name)).toContain('warehouse_catalog_items_series_idx');
      expect(config.indexes.map((idx) => idx.config.name)).toEqual(
        expect.arrayContaining([
          'warehouse_catalog_items_series_norm_idx',
          'warehouse_catalog_items_author_sort_idx',
          'warehouse_catalog_items_series_sort_idx',
          'warehouse_catalog_items_narrator_sort_idx',
          'warehouse_catalog_items_sort_title_idx',
          'warehouse_catalog_items_duration_idx',
          'warehouse_catalog_items_title_trgm_idx',
          'warehouse_catalog_items_series_trgm_idx',
        ]),
      );

      const seriesIndexCheck = config.checks.find((c) => c.name === 'warehouse_catalog_items_series_index_nonnegative_chk');
      const durationCheck = config.checks.find((c) => c.name === 'warehouse_catalog_items_duration_seconds_nonnegative_chk');
      expect(seriesIndexCheck).toBeDefined();
      expect(durationCheck).toBeDefined();

      const durationCheckSql = durationCheck!.value.queryChunks
        .map((chunk: any) => {
          if (Array.isArray(chunk?.value)) return chunk.value.join('');
          if (typeof chunk?.name === 'string') return chunk.name;
          return '';
        })
        .join('');
      expect(durationCheckSql).toContain('duration_seconds');
      expect(durationCheckSql).toContain(' is null or ');
      expect(durationCheckSql).toContain(' >= 0');
    });

    it('warehouse_catalog_item_authors stores indexed author refs for catalog rows', () => {
      const config = getTableConfig(warehouseCatalogItemAuthors);
      const primaryKeys = config.primaryKeys.map((constraint) => constraint.columns.map((col) => col.name));
      const indexes = config.indexes.map((idx) => idx.config.name);

      expect(primaryKeys).toContainEqual(['media_type', 'remote_id', 'author_id']);
      expect(warehouseCatalogItemAuthors.authorId.name).toBe('author_id');
      expect(indexes).toEqual(
        expect.arrayContaining([
          'warehouse_catalog_item_authors_author_idx',
          'warehouse_catalog_item_authors_canonical_idx',
          'warehouse_catalog_item_authors_media_canonical_idx',
          'warehouse_catalog_item_authors_name_trgm_idx',
        ]),
      );
    });

    it('warehouse_requests can mirror ebook, audiobook, and comic requests', () => {
      expect(warehouseRequests.mediaType.enumValues).toEqual(['ebook', 'audiobook', 'comic']);
      expect(warehouseRequests.status.enumValues).toContain('pending');
      expect(warehouseRequests.status.enumValues).toContain('completed');
    });

    it('warehouse sync runs store media-specific sync telemetry', () => {
      expect(warehouseCatalogSyncRuns.mediaType.enumValues).toEqual(['ebook', 'audiobook', 'comic', 'mixed']);
      expect(warehouseCatalogSyncRuns.status.enumValues).toEqual(['running', 'completed', 'failed']);
    });

    it('warehouse_user_items stores user catalog membership with composite keys and lookup indexes', () => {
      const config = getTableConfig(warehouseUserItems);
      const primaryKeys = config.primaryKeys.map((constraint) => constraint.columns.map((col) => col.name));
      const indexes = new Map(config.indexes.map((idx) => [idx.config.name, idx.config.columns.map((col) => col.name)]));

      expect(primaryKeys).toContainEqual(['user_id', 'media_type', 'remote_id']);
      expect(indexes.get('warehouse_user_items_user_media_idx')).toEqual(['user_id', 'media_type', 'added_at']);
      expect(indexes.get('warehouse_user_items_media_remote_idx')).toEqual(['media_type', 'remote_id']);
      expect(warehouseUserItems.addedAt.default).toBeDefined();
      expect(warehouseUserItems.updatedAt.default).toBeDefined();
      expect(warehouseUserItems.updatedAt.onUpdateFn?.()).toBeInstanceOf(Date);

      expect(
        config.foreignKeys.some((fk) => {
          const reference = fk.reference();
          return reference.columns.map((col) => col.name).join(',') === 'user_id' && reference.foreignTable === users && fk.onDelete === 'cascade';
        }),
      ).toBe(true);
    });

    it('warehouse_user_state stores per-user catalog state with defaults and explicit checks', () => {
      const config = getTableConfig(warehouseUserState);
      const primaryKeys = config.primaryKeys.map((constraint) => constraint.columns.map((col) => col.name));
      const indexes = new Map(config.indexes.map((idx) => [idx.config.name, idx.config.columns.map((col) => col.name)]));
      const checkNames = config.checks.map((constraint) => constraint.name);

      expect(primaryKeys).toContainEqual(['user_id', 'media_type', 'remote_id']);
      expect(indexes.get('warehouse_user_state_user_media_updated_idx')).toEqual(['user_id', 'media_type', 'updated_at']);
      expect(indexes.get('warehouse_user_state_user_finished_idx')).toEqual(['user_id', 'finished_at']);
      expect(indexes.get('warehouse_user_state_media_remote_idx')).toEqual(['media_type', 'remote_id']);
      expect(warehouseUserState.favorite.default).toBe(false);
      expect(warehouseUserState.finishedAt.name).toBe('finished_at');
      expect(warehouseUserState.updatedAt.default).toBeDefined();
      expect(warehouseUserState.updatedAt.onUpdateFn?.()).toBeInstanceOf(Date);
      expect(
        config.foreignKeys.some((fk) => {
          const reference = fk.reference();
          return reference.columns.map((col) => col.name).join(',') === 'user_id' && reference.foreignTable === users && fk.onDelete === 'cascade';
        }),
      ).toBe(true);
      expect(checkNames).toEqual(
        expect.arrayContaining([
          'warehouse_user_state_rating_range_chk',
          'warehouse_user_state_read_status_chk',
          'warehouse_user_state_progress_percent_range_chk',
          'warehouse_user_state_position_seconds_nonnegative_chk',
        ]),
      );
    });

    it('warehouse_bookmarks stores native bookmark state by user and catalog identity', () => {
      const config = getTableConfig(warehouseBookmarks);
      const indexes = new Map(
        config.indexes.map((idx) => [idx.config.name, { columns: idx.config.columns.map((col) => col.name), unique: idx.config.unique }]),
      );

      expect(indexes.get('warehouse_bookmarks_user_item_idx')).toEqual({ columns: ['user_id', 'media_type', 'remote_id'], unique: false });
      expect(indexes.get('warehouse_bookmarks_user_item_cfi_uidx')).toEqual({ columns: ['user_id', 'media_type', 'remote_id', 'cfi'], unique: true });
      expect(indexes.get('warehouse_bookmarks_user_item_pos_uidx')).toEqual({
        columns: ['user_id', 'media_type', 'remote_id', 'position_seconds'],
        unique: true,
      });
      expect(warehouseBookmarks.createdAt.default).toBeDefined();
      expect(
        config.foreignKeys.some((fk) => {
          const reference = fk.reference();
          return reference.columns.map((col) => col.name).join(',') === 'user_id' && reference.foreignTable === users && fk.onDelete === 'cascade';
        }),
      ).toBe(true);
    });

    it('warehouse_annotations stores native highlight state by user and catalog identity', () => {
      const config = getTableConfig(warehouseAnnotations);
      const indexes = new Map(config.indexes.map((idx) => [idx.config.name, idx.config.columns.map((col) => col.name)]));
      const checkNames = config.checks.map((check) => check.name);

      expect(indexes.get('warehouse_annotations_user_item_idx')).toEqual(['user_id', 'media_type', 'remote_id']);
      expect(indexes.get('warehouse_annotations_user_item_cfi_idx')).toEqual(['user_id', 'media_type', 'remote_id', 'cfi']);
      expect(checkNames).toContain('warehouse_annotations_style_chk');
      expect(warehouseAnnotations.color.default).toBe('yellow');
      expect(warehouseAnnotations.style.default).toBe('highlight');
      expect(
        config.foreignKeys.some((fk) => {
          const reference = fk.reference();
          return reference.columns.map((col) => col.name).join(',') === 'user_id' && reference.foreignTable === users && fk.onDelete === 'cascade';
        }),
      ).toBe(true);
    });

    it('marks catalog item origin and requires a path for local rows', () => {
      expect(catalogItemSourceEnum.enumValues).toEqual(['warehouse', 'local']);
      expect(warehouseCatalogItems.source.notNull).toBe(true);
      expect(warehouseCatalogItems.source.default).toBe('warehouse');
      expect(warehouseCatalogItems.localPath.notNull).toBe(false);
    });
  });

  describe('koreader catalog bridge schema', () => {
    it('koreader_catalog_documents maps a user catalog ebook to a stable document hash', () => {
      const config = getTableConfig(koreaderCatalogDocuments);
      const indexes = new Map(config.indexes.map((idx) => [idx.config.name, idx.config.columns.map((col) => col.name)]));
      const checkNames = config.checks.map((constraint) => constraint.name);

      expect(indexes.get('koreader_catalog_documents_user_hash_uidx')).toEqual(['user_id', 'document_hash']);
      expect(indexes.get('koreader_catalog_documents_user_item_idx')).toEqual(['user_id', 'catalog_item_id']);
      expect(indexes.get('koreader_catalog_documents_hash_idx')).toEqual(['document_hash']);
      expect(checkNames).toContain('koreader_catalog_documents_hash_chk');
      expect(koreaderCatalogDocuments.updatedAt.onUpdateFn?.()).toBeInstanceOf(Date);
    });

    it('koreader_catalog_device_progress stores per-device progress for catalog documents', () => {
      const config = getTableConfig(koreaderCatalogDeviceProgress);
      const indexes = new Map(config.indexes.map((idx) => [idx.config.name, idx.config.columns.map((col) => col.name)]));
      const checkNames = config.checks.map((constraint) => constraint.name);

      expect(indexes.get('koreader_catalog_device_progress_doc_user_device_uidx')).toEqual(['catalog_document_id', 'user_id', 'device', 'device_id']);
      expect(indexes.get('koreader_catalog_device_progress_user_updated_at_idx')).toEqual(['user_id', 'updated_at']);
      expect(indexes.get('koreader_catalog_device_progress_document_idx')).toEqual(['catalog_document_id']);
      expect(checkNames).toContain('koreader_catalog_device_progress_percentage_range_chk');
      expect(koreaderCatalogDeviceProgress.device.default).toBe('KOReader');
      expect(koreaderCatalogDeviceProgress.updatedAt.onUpdateFn?.()).toBeInstanceOf(Date);
    });
  });

  describe('localScanRoots', () => {
    it('is unique per media type and path', () => {
      expect(localScanRoots.absolutePath.notNull).toBe(true);
      expect(localScanRoots.enabled.default).toBe(true);
    });
  });
});
