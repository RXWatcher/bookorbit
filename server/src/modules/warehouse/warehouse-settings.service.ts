import { BadRequestException, Injectable } from '@nestjs/common';

import type { WarehouseSettingRow } from '../../db/schema';
import type { UpsertWarehouseAdminSettingsDto } from './dto';
import { WarehouseClientService, type WarehouseConnectionTestResult } from './warehouse-client.service';
import { WarehouseRepository } from './warehouse.repository';
import { WarehouseSecretService, type EncryptedWarehouseSecret } from './warehouse-secret.service';
import type { WarehouseMediaType, WarehouseSourceBackedLibraryIcons } from '@bookorbit/types';

const DEFAULT_BASE_URL = '';
const DEFAULT_SYNC_CADENCE_MINUTES = 360;
const DEFAULT_SOURCE_BACKED_LIBRARY_ICONS: WarehouseSourceBackedLibraryIcons = {
  ebook: 'BookOpen',
  audiobook: 'Headphones',
  comic: 'PanelsTopLeft',
};
const CONNECTION_TEST_FAILURE_MESSAGE = 'Unable to connect to Book Warehouse. Check the configuration and try again.';
const UNREADABLE_API_KEY_MESSAGE = 'The stored Book Warehouse API key could not be decrypted. Save a new Book Warehouse API key and try again.';

type WarehouseConnectionStatus = 'untested' | 'ok' | 'error';

export interface WarehouseAdminSettings {
  enabled: boolean;
  baseUrl: string;
  apiKeyConfigured: boolean;
  apiKeyPreview: string | null;
  syncCadenceMinutes: number;
  sourceBackedLibraryIcons: WarehouseSourceBackedLibraryIcons;
  lastConnectionStatus: WarehouseConnectionStatus;
  lastConnectionCheckedAt: string | null;
  lastConnectionError: string | null;
}

export type UpsertWarehouseAdminSettingsPayload = UpsertWarehouseAdminSettingsDto;

@Injectable()
export class WarehouseSettingsService {
  constructor(
    private readonly repository: WarehouseRepository,
    private readonly secret: WarehouseSecretService,
    private readonly client: WarehouseClientService,
  ) {}

  async getAdminSettings(): Promise<WarehouseAdminSettings> {
    const row = await this.repository.findSettings();
    if (!row) {
      return this.defaultAdminSettings();
    }

    const encryptedSecret = this.encryptedSecretFromRow(row);
    const apiKeyPreview = this.safeApiKeyPreview(encryptedSecret);

    return {
      enabled: row.enabled,
      baseUrl: row.baseUrl,
      apiKeyConfigured: encryptedSecret !== null,
      apiKeyPreview,
      syncCadenceMinutes: row.syncCadenceMinutes,
      sourceBackedLibraryIcons: this.sourceBackedLibraryIconsFromRow(row),
      lastConnectionStatus: this.normalizeConnectionStatus(row.lastConnectionStatus),
      lastConnectionCheckedAt: row.lastConnectionCheckedAt?.toISOString() ?? null,
      lastConnectionError: row.lastConnectionError,
    };
  }

  async upsertAdminSettings(payload: UpsertWarehouseAdminSettingsPayload): Promise<WarehouseAdminSettings> {
    const existing = await this.repository.findSettings();
    const trimmedApiKey = payload.apiKey?.trim();
    const encryptedSecret = trimmedApiKey ? this.secret.encrypt(trimmedApiKey) : this.encryptedSecretFromRow(existing);
    const enabled = payload.enabled ?? existing?.enabled ?? false;
    const baseUrl = this.normalizeBaseUrl(payload.baseUrl ?? existing?.baseUrl ?? DEFAULT_BASE_URL);
    const existingBaseUrl = existing ? this.normalizeBaseUrl(existing.baseUrl) : null;
    const connectionInputsChanged = Boolean(existing && (baseUrl !== existingBaseUrl || trimmedApiKey));
    const sourceBackedLibraryIcons = this.normalizeSourceBackedLibraryIcons(payload.sourceBackedLibraryIcons, existing);

    if (enabled && !encryptedSecret) {
      throw new BadRequestException('A Book Warehouse API key is required before enabling Book Warehouse');
    }

    await this.repository.upsertSettings({
      enabled,
      baseUrl,
      apiKeyEncrypted: encryptedSecret?.ciphertext ?? null,
      apiKeyNonce: encryptedSecret?.nonce ?? null,
      apiKeyTag: encryptedSecret?.tag ?? null,
      syncCadenceMinutes: payload.syncCadenceMinutes ?? existing?.syncCadenceMinutes ?? DEFAULT_SYNC_CADENCE_MINUTES,
      ebookLibraryIcon: sourceBackedLibraryIcons.ebook,
      audiobookLibraryIcon: sourceBackedLibraryIcons.audiobook,
      comicLibraryIcon: sourceBackedLibraryIcons.comic,
      lastConnectionStatus: connectionInputsChanged ? 'untested' : this.normalizeConnectionStatus(existing?.lastConnectionStatus ?? 'untested'),
      lastConnectionCheckedAt: connectionInputsChanged ? null : (existing?.lastConnectionCheckedAt ?? null),
      lastConnectionError: connectionInputsChanged ? null : (existing?.lastConnectionError ?? null),
    });

    return this.getAdminSettings();
  }

  async getSourceBackedLibraryIcons(): Promise<WarehouseSourceBackedLibraryIcons> {
    return this.sourceBackedLibraryIconsFromRow(await this.repository.findSettings());
  }

  async testConnection(): Promise<WarehouseConnectionTestResult> {
    const row = await this.repository.findSettings();
    const encryptedSecret = this.encryptedSecretFromRow(row);

    if (!row || !encryptedSecret) {
      throw new BadRequestException('A Book Warehouse API key is required before testing the Book Warehouse connection');
    }

    let apiKey: string;
    try {
      apiKey = this.secret.decrypt(encryptedSecret);
    } catch {
      throw new BadRequestException(UNREADABLE_API_KEY_MESSAGE);
    }

    let result: WarehouseConnectionTestResult;
    try {
      result = await this.client.testConnection(row.baseUrl, apiKey);
    } catch {
      const checkedAt = new Date();
      const result: WarehouseConnectionTestResult = {
        ok: false,
        status: null,
        message: CONNECTION_TEST_FAILURE_MESSAGE,
        checkedAt: checkedAt.toISOString(),
      };
      await this.repository.updateConnectionStatus('error', checkedAt, result.message);

      return result;
    }

    await this.repository.updateConnectionStatus(result.ok ? 'ok' : 'error', new Date(result.checkedAt), result.ok ? null : result.message);

    return result;
  }

  private defaultAdminSettings(): WarehouseAdminSettings {
    return {
      enabled: false,
      baseUrl: DEFAULT_BASE_URL,
      apiKeyConfigured: false,
      apiKeyPreview: null,
      syncCadenceMinutes: DEFAULT_SYNC_CADENCE_MINUTES,
      sourceBackedLibraryIcons: { ...DEFAULT_SOURCE_BACKED_LIBRARY_ICONS },
      lastConnectionStatus: 'untested',
      lastConnectionCheckedAt: null,
      lastConnectionError: null,
    };
  }

  private encryptedSecretFromRow(row: WarehouseSettingRow | null | undefined): EncryptedWarehouseSecret | null {
    if (!row?.apiKeyEncrypted || !row.apiKeyNonce || !row.apiKeyTag) {
      return null;
    }

    return {
      ciphertext: row.apiKeyEncrypted,
      nonce: row.apiKeyNonce,
      tag: row.apiKeyTag,
    };
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.trim().replace(/\/+$/, '');
  }

  private sourceBackedLibraryIconsFromRow(row: WarehouseSettingRow | null | undefined): WarehouseSourceBackedLibraryIcons {
    return {
      ebook: this.normalizeIcon(row?.ebookLibraryIcon) ?? DEFAULT_SOURCE_BACKED_LIBRARY_ICONS.ebook,
      audiobook: this.normalizeIcon(row?.audiobookLibraryIcon) ?? DEFAULT_SOURCE_BACKED_LIBRARY_ICONS.audiobook,
      comic: this.normalizeIcon(row?.comicLibraryIcon) ?? DEFAULT_SOURCE_BACKED_LIBRARY_ICONS.comic,
    };
  }

  private normalizeSourceBackedLibraryIcons(
    payload: Partial<WarehouseSourceBackedLibraryIcons> | undefined,
    existing: WarehouseSettingRow | null | undefined,
  ): WarehouseSourceBackedLibraryIcons {
    const icons = this.sourceBackedLibraryIconsFromRow(existing);
    if (!payload) return icons;

    for (const mediaType of ['ebook', 'audiobook', 'comic'] satisfies WarehouseMediaType[]) {
      const icon = this.normalizeIcon(payload[mediaType]);
      if (icon) icons[mediaType] = icon;
    }

    return icons;
  }

  private normalizeIcon(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const icon = value.trim();
    return icon.length > 0 ? icon : null;
  }

  private safeApiKeyPreview(encryptedSecret: EncryptedWarehouseSecret | null): string | null {
    if (!encryptedSecret) {
      return null;
    }

    try {
      return this.secret.mask(this.secret.decrypt(encryptedSecret));
    } catch {
      return null;
    }
  }

  private normalizeConnectionStatus(status: string): WarehouseConnectionStatus {
    return status === 'ok' || status === 'error' ? status : 'untested';
  }
}
