import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { WarehouseSecretService, type EncryptedWarehouseSecret } from '../warehouse/warehouse-secret.service';

type Db = NodePgDatabase<typeof schema>;

const SETTINGS_KEY = 'book_search_config';
export const DEFAULT_BOOK_SEARCH_INDEX = 'bookorbit_books';

interface StoredConfig {
  enabled: boolean;
  url: string;
  activeIndex: string;
  apiKey: EncryptedWarehouseSecret | null;
}

export interface BookSearchSettings {
  enabled: boolean;
  url: string;
  activeIndex: string;
  hasApiKey: boolean;
}

@Injectable()
export class BookSearchSettingsService {
  private readonly logger = new Logger(BookSearchSettingsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly secret: WarehouseSecretService,
  ) {}

  private async read(): Promise<StoredConfig> {
    const startedAt = Date.now();
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, SETTINGS_KEY),
    });
    if (!row?.value) return { enabled: false, url: '', activeIndex: DEFAULT_BOOK_SEARCH_INDEX, apiKey: null };

    try {
      const parsed = JSON.parse(row.value) as Partial<StoredConfig>;
      return {
        enabled: parsed.enabled === true,
        url: typeof parsed.url === 'string' ? parsed.url : '',
        activeIndex: typeof parsed.activeIndex === 'string' && parsed.activeIndex ? parsed.activeIndex : DEFAULT_BOOK_SEARCH_INDEX,
        apiKey: parsed.apiKey ?? null,
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[book_search.settings_parse] [fail] key=${SETTINGS_KEY} durationMs=${durationMs} errorClass=${errorClass} error="${errorMessage}" - failed to parse persisted book search settings, using defaults`,
      );
      return { enabled: false, url: '', activeIndex: DEFAULT_BOOK_SEARCH_INDEX, apiKey: null };
    }
  }

  async get(): Promise<BookSearchSettings> {
    const config = await this.read();
    return {
      enabled: config.enabled,
      url: config.url,
      activeIndex: config.activeIndex,
      hasApiKey: config.apiKey !== null,
    };
  }

  async getApiKey(): Promise<string | null> {
    const config = await this.read();
    if (!config.apiKey) return null;

    const startedAt = Date.now();
    try {
      return this.secret.decrypt(config.apiKey);
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[book_search.settings_decrypt] [fail] key=${SETTINGS_KEY} durationMs=${durationMs} errorClass=${errorClass} error="${errorMessage}" - failed to decrypt book search api key, returning null`,
      );
      return null;
    }
  }

  async save(input: { enabled?: boolean; url?: string; activeIndex?: string; apiKey?: string }): Promise<void> {
    const current = await this.read();
    const next: StoredConfig = {
      enabled: input.enabled ?? current.enabled,
      url: input.url ?? current.url,
      activeIndex: input.activeIndex ?? current.activeIndex,
      apiKey: input.apiKey ? this.secret.encrypt(input.apiKey) : current.apiKey,
    };

    await this.db
      .insert(schema.appSettings)
      .values({ key: SETTINGS_KEY, value: JSON.stringify(next) })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: { value: JSON.stringify(next) },
      });
  }
}
