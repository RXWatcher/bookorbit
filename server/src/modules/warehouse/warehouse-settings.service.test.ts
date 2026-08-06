import { BadRequestException } from '@nestjs/common';

import type { WarehouseSettingRow } from '../../db/schema';
import { WarehouseClientService, type WarehouseConnectionTestResult } from './warehouse-client.service';
import { WarehouseRepository } from './warehouse.repository';
import { WarehouseSecretService } from './warehouse-secret.service';
import { WarehouseSettingsService } from './warehouse-settings.service';

const DEFAULT_ADMIN_SETTINGS = {
  enabled: false,
  baseUrl: '',
  apiKeyConfigured: false,
  apiKeyPreview: null,
  syncCadenceMinutes: 360,
  sourceBackedLibraryIcons: {
    ebook: 'BookOpen',
    audiobook: 'Headphones',
    comic: 'PanelsTopLeft',
  },
  lastConnectionStatus: 'untested',
  lastConnectionCheckedAt: null,
  lastConnectionError: null,
};

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-01-02T00:00:00.000Z');

function makeRow(overrides: Partial<WarehouseSettingRow> = {}): WarehouseSettingRow {
  return {
    id: 1,
    profileKey: 'default',
    enabled: false,
    baseUrl: '',
    apiKeyEncrypted: null,
    apiKeyNonce: null,
    apiKeyTag: null,
    syncCadenceMinutes: 360,
    ebookLibraryIcon: 'BookOpen',
    audiobookLibraryIcon: 'Headphones',
    comicLibraryIcon: 'PanelsTopLeft',
    lastConnectionStatus: 'untested',
    lastConnectionCheckedAt: null,
    lastConnectionError: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function makeRepo(): jest.Mocked<WarehouseRepository> {
  return {
    findSettings: vi.fn(),
    upsertSettings: vi.fn().mockResolvedValue(undefined),
    updateConnectionStatus: vi.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<WarehouseRepository>;
}

function makeSecret(): jest.Mocked<WarehouseSecretService> {
  return {
    encrypt: vi.fn().mockReturnValue({ ciphertext: 'encrypted-key', nonce: 'nonce', tag: 'tag' }),
    decrypt: vi.fn().mockReturnValue('plain-api-key'),
    mask: vi.fn().mockReturnValue('pla...key'),
  } as unknown as jest.Mocked<WarehouseSecretService>;
}

function makeClient(): jest.Mocked<WarehouseClientService> {
  return {
    testConnection: vi.fn(),
  } as unknown as jest.Mocked<WarehouseClientService>;
}

describe('WarehouseSettingsService', () => {
  let repo: ReturnType<typeof makeRepo>;
  let secret: ReturnType<typeof makeSecret>;
  let client: ReturnType<typeof makeClient>;
  let service: WarehouseSettingsService;

  beforeEach(() => {
    repo = makeRepo();
    secret = makeSecret();
    client = makeClient();
    service = new WarehouseSettingsService(repo, secret, client);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns disabled defaults without exposing an API key when no row exists', async () => {
    repo.findSettings.mockResolvedValue(undefined);

    await expect(service.getAdminSettings()).resolves.toEqual(DEFAULT_ADMIN_SETTINGS);
    expect(secret.decrypt).not.toHaveBeenCalled();
    expect(secret.mask).not.toHaveBeenCalled();
  });

  it('leaves the Book Warehouse URL blank when creating settings without a base URL', async () => {
    let persisted: WarehouseSettingRow | undefined;
    repo.findSettings.mockImplementation(() => Promise.resolve(persisted));
    repo.upsertSettings.mockImplementation((data) => {
      persisted = makeRow(data);
      return Promise.resolve();
    });

    await service.upsertAdminSettings({ syncCadenceMinutes: 480 });

    expect(repo.upsertSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: '',
      }),
    );
  });

  it('returns stored settings without preview when the encrypted API key cannot be decrypted', async () => {
    repo.findSettings.mockResolvedValue(
      makeRow({
        enabled: true,
        baseUrl: 'https://catalog-source.example.test',
        apiKeyEncrypted: 'ciphertext',
        apiKeyNonce: 'nonce',
        apiKeyTag: 'tag',
        syncCadenceMinutes: 120,
        ebookLibraryIcon: 'Book',
        audiobookLibraryIcon: 'AudioLines',
        comicLibraryIcon: 'PanelTop',
        lastConnectionStatus: 'error',
        lastConnectionCheckedAt: new Date('2026-03-04T05:06:07.000Z'),
        lastConnectionError: 'Connection failed',
      }),
    );
    secret.decrypt.mockImplementation(() => {
      throw new Error('unable to decrypt');
    });

    await expect(service.getAdminSettings()).resolves.toEqual({
      enabled: true,
      baseUrl: 'https://catalog-source.example.test',
      apiKeyConfigured: true,
      apiKeyPreview: null,
      syncCadenceMinutes: 120,
      sourceBackedLibraryIcons: {
        ebook: 'Book',
        audiobook: 'AudioLines',
        comic: 'PanelTop',
      },
      lastConnectionStatus: 'error',
      lastConnectionCheckedAt: '2026-03-04T05:06:07.000Z',
      lastConnectionError: 'Connection failed',
    });
    expect(secret.mask).not.toHaveBeenCalled();
  });

  it('encrypts a new API key and normalizes a trailing-slash base URL', async () => {
    let persisted: WarehouseSettingRow | undefined;
    repo.findSettings.mockImplementation(() => Promise.resolve(persisted));
    repo.upsertSettings.mockImplementation((data) => {
      persisted = makeRow(data);
      return Promise.resolve();
    });
    secret.encrypt.mockReturnValue({ ciphertext: 'ciphertext', nonce: 'nonce', tag: 'tag' });
    secret.decrypt.mockReturnValue('fresh-api-key');
    secret.mask.mockReturnValue('fre...key');

    const result = await service.upsertAdminSettings({
      enabled: true,
      baseUrl: ' https://catalog-source.local/api/// ',
      apiKey: ' fresh-api-key ',
      syncCadenceMinutes: 120,
    });

    expect(secret.encrypt).toHaveBeenCalledWith('fresh-api-key');
    expect(repo.upsertSettings).toHaveBeenCalledWith({
      enabled: true,
      baseUrl: 'https://catalog-source.local/api',
      apiKeyEncrypted: 'ciphertext',
      apiKeyNonce: 'nonce',
      apiKeyTag: 'tag',
      syncCadenceMinutes: 120,
      ebookLibraryIcon: 'BookOpen',
      audiobookLibraryIcon: 'Headphones',
      comicLibraryIcon: 'PanelsTopLeft',
      lastConnectionStatus: 'untested',
      lastConnectionCheckedAt: null,
      lastConnectionError: null,
    });
    expect(result).toEqual({
      ...DEFAULT_ADMIN_SETTINGS,
      enabled: true,
      baseUrl: 'https://catalog-source.local/api',
      apiKeyConfigured: true,
      apiKeyPreview: 'fre...key',
      syncCadenceMinutes: 120,
    });
  });

  it('preserves an existing encrypted API key when the payload omits apiKey', async () => {
    const existing = makeRow({
      enabled: false,
      baseUrl: 'https://old.example.test',
      apiKeyEncrypted: 'existing-ciphertext',
      apiKeyNonce: 'existing-nonce',
      apiKeyTag: 'existing-tag',
      syncCadenceMinutes: 360,
    });
    let persisted = existing;
    repo.findSettings.mockImplementation(() => Promise.resolve(persisted));
    repo.upsertSettings.mockImplementation((data) => {
      persisted = makeRow(data);
      return Promise.resolve();
    });

    await service.upsertAdminSettings({ enabled: true, syncCadenceMinutes: 720 });

    expect(secret.encrypt).not.toHaveBeenCalled();
    expect(repo.upsertSettings).toHaveBeenCalledWith({
      enabled: true,
      baseUrl: 'https://old.example.test',
      apiKeyEncrypted: 'existing-ciphertext',
      apiKeyNonce: 'existing-nonce',
      apiKeyTag: 'existing-tag',
      syncCadenceMinutes: 720,
      ebookLibraryIcon: 'BookOpen',
      audiobookLibraryIcon: 'Headphones',
      comicLibraryIcon: 'PanelsTopLeft',
      lastConnectionStatus: 'untested',
      lastConnectionCheckedAt: null,
      lastConnectionError: null,
    });
  });

  it('preserves an existing encrypted API key when the payload provides a blank apiKey', async () => {
    const existing = makeRow({
      apiKeyEncrypted: 'existing-ciphertext',
      apiKeyNonce: 'existing-nonce',
      apiKeyTag: 'existing-tag',
    });
    repo.findSettings.mockResolvedValue(existing);

    await service.upsertAdminSettings({ apiKey: '   ' });

    expect(secret.encrypt).not.toHaveBeenCalled();
    expect(repo.upsertSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyEncrypted: 'existing-ciphertext',
        apiKeyNonce: 'existing-nonce',
        apiKeyTag: 'existing-tag',
      }),
    );
  });

  it('persists custom source-backed library icons without resetting connection status', async () => {
    const checkedAt = new Date('2026-03-04T05:06:07.000Z');
    const existing = makeRow({
      baseUrl: 'https://catalog-source.example.test',
      apiKeyEncrypted: 'existing-ciphertext',
      apiKeyNonce: 'existing-nonce',
      apiKeyTag: 'existing-tag',
      lastConnectionStatus: 'ok',
      lastConnectionCheckedAt: checkedAt,
      lastConnectionError: null,
    });
    repo.findSettings.mockResolvedValue(existing);

    await service.upsertAdminSettings({
      sourceBackedLibraryIcons: {
        ebook: 'LibraryBig',
        audiobook: 'Radio',
        comic: 'BookImage',
      },
    });

    expect(repo.upsertSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        ebookLibraryIcon: 'LibraryBig',
        audiobookLibraryIcon: 'Radio',
        comicLibraryIcon: 'BookImage',
        lastConnectionStatus: 'ok',
        lastConnectionCheckedAt: checkedAt,
        lastConnectionError: null,
      }),
    );
  });

  it('returns source-backed library icons for library rows', async () => {
    repo.findSettings.mockResolvedValue(
      makeRow({
        ebookLibraryIcon: 'LibraryBig',
        audiobookLibraryIcon: 'Radio',
        comicLibraryIcon: 'BookImage',
      }),
    );

    await expect(service.getSourceBackedLibraryIcons()).resolves.toEqual({
      ebook: 'LibraryBig',
      audiobook: 'Radio',
      comic: 'BookImage',
    });
  });

  it('preserves existing connection status when connection inputs are unchanged', async () => {
    const checkedAt = new Date('2026-03-04T05:06:07.000Z');
    const existing = makeRow({
      baseUrl: 'https://catalog-source.example.test',
      apiKeyEncrypted: 'existing-ciphertext',
      apiKeyNonce: 'existing-nonce',
      apiKeyTag: 'existing-tag',
      lastConnectionStatus: 'ok',
      lastConnectionCheckedAt: checkedAt,
      lastConnectionError: null,
    });
    repo.findSettings.mockResolvedValue(existing);

    await service.upsertAdminSettings({ enabled: true, baseUrl: 'https://catalog-source.example.test/' });

    expect(repo.upsertSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        lastConnectionStatus: 'ok',
        lastConnectionCheckedAt: checkedAt,
        lastConnectionError: null,
      }),
    );
  });

  it('resets connection status when the normalized base URL changes', async () => {
    const existing = makeRow({
      baseUrl: 'https://old-catalog-source.example.test',
      apiKeyEncrypted: 'existing-ciphertext',
      apiKeyNonce: 'existing-nonce',
      apiKeyTag: 'existing-tag',
      lastConnectionStatus: 'ok',
      lastConnectionCheckedAt: new Date('2026-03-04T05:06:07.000Z'),
      lastConnectionError: null,
    });
    repo.findSettings.mockResolvedValue(existing);

    await service.upsertAdminSettings({ baseUrl: 'https://new-catalog-source.example.test///' });

    expect(repo.upsertSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://new-catalog-source.example.test',
        lastConnectionStatus: 'untested',
        lastConnectionCheckedAt: null,
        lastConnectionError: null,
      }),
    );
  });

  it('resets connection status when a new API key is provided', async () => {
    const existing = makeRow({
      baseUrl: 'https://catalog-source.example.test',
      apiKeyEncrypted: 'existing-ciphertext',
      apiKeyNonce: 'existing-nonce',
      apiKeyTag: 'existing-tag',
      lastConnectionStatus: 'error',
      lastConnectionCheckedAt: new Date('2026-03-04T05:06:07.000Z'),
      lastConnectionError: 'Previous failure',
    });
    repo.findSettings.mockResolvedValue(existing);
    secret.encrypt.mockReturnValue({ ciphertext: 'rotated-ciphertext', nonce: 'rotated-nonce', tag: 'rotated-tag' });

    await service.upsertAdminSettings({ apiKey: ' rotated-api-key ' });

    expect(repo.upsertSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyEncrypted: 'rotated-ciphertext',
        apiKeyNonce: 'rotated-nonce',
        apiKeyTag: 'rotated-tag',
        lastConnectionStatus: 'untested',
        lastConnectionCheckedAt: null,
        lastConnectionError: null,
      }),
    );
  });

  it('replaces an undecryptable stored API key when a new API key is provided', async () => {
    const existing = makeRow({
      baseUrl: 'https://catalog-source.example.test',
      apiKeyEncrypted: 'existing-ciphertext',
      apiKeyNonce: 'existing-nonce',
      apiKeyTag: 'existing-tag',
      lastConnectionStatus: 'error',
      lastConnectionCheckedAt: new Date('2026-03-04T05:06:07.000Z'),
      lastConnectionError: 'Previous failure',
    });
    let persisted = existing;
    repo.findSettings.mockImplementation(() => Promise.resolve(persisted));
    repo.upsertSettings.mockImplementation((data) => {
      persisted = makeRow(data);
      return Promise.resolve();
    });
    secret.encrypt.mockReturnValue({ ciphertext: 'rotated-ciphertext', nonce: 'rotated-nonce', tag: 'rotated-tag' });
    secret.decrypt.mockImplementation(({ ciphertext }) => {
      if (ciphertext === 'rotated-ciphertext') {
        return 'rotated-api-key';
      }

      throw new Error('unable to decrypt');
    });
    secret.mask.mockReturnValue('rot...key');

    await expect(service.upsertAdminSettings({ apiKey: ' rotated-api-key ' })).resolves.toEqual({
      ...DEFAULT_ADMIN_SETTINGS,
      baseUrl: 'https://catalog-source.example.test',
      apiKeyConfigured: true,
      apiKeyPreview: 'rot...key',
      lastConnectionStatus: 'untested',
    });
    expect(secret.encrypt).toHaveBeenCalledWith('rotated-api-key');
    expect(repo.upsertSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyEncrypted: 'rotated-ciphertext',
        apiKeyNonce: 'rotated-nonce',
        apiKeyTag: 'rotated-tag',
      }),
    );
  });

  it('rejects enabling without a stored or provided API key using Book Warehouse wording', async () => {
    repo.findSettings.mockResolvedValue(undefined);

    await expect(service.upsertAdminSettings({ enabled: true })).rejects.toThrow(BadRequestException);
    await expect(service.upsertAdminSettings({ enabled: true })).rejects.toThrow(
      'A Book Warehouse API key is required before enabling Book Warehouse',
    );
  });

  it('decrypts the stored key, calls the client, and persists ok connection status', async () => {
    const checkedAt = '2026-02-03T04:05:06.000Z';
    const result: WarehouseConnectionTestResult = {
      ok: true,
      status: 200,
      message: 'Connected',
      checkedAt,
    };
    repo.findSettings.mockResolvedValue(
      makeRow({
        baseUrl: 'https://catalog-source.example.test',
        apiKeyEncrypted: 'ciphertext',
        apiKeyNonce: 'nonce',
        apiKeyTag: 'tag',
      }),
    );
    client.testConnection.mockResolvedValue(result);

    await expect(service.testConnection()).resolves.toEqual(result);
    expect(secret.decrypt).toHaveBeenCalledWith({ ciphertext: 'ciphertext', nonce: 'nonce', tag: 'tag' });
    expect(client.testConnection).toHaveBeenCalledWith('https://catalog-source.example.test', 'plain-api-key');
    expect(repo.updateConnectionStatus).toHaveBeenCalledWith('ok', new Date(checkedAt), null);
  });

  it('propagates persistence errors after a successful client connection test', async () => {
    const checkedAt = '2026-02-03T04:05:06.000Z';
    const result: WarehouseConnectionTestResult = {
      ok: true,
      status: 200,
      message: 'Connected',
      checkedAt,
    };
    const persistenceError = new Error('database write failed');
    repo.findSettings.mockResolvedValue(
      makeRow({
        baseUrl: 'https://catalog-source.example.test',
        apiKeyEncrypted: 'ciphertext',
        apiKeyNonce: 'nonce',
        apiKeyTag: 'tag',
      }),
    );
    client.testConnection.mockResolvedValue(result);
    repo.updateConnectionStatus.mockRejectedValue(persistenceError);

    await expect(service.testConnection()).rejects.toThrow(persistenceError);
    expect(client.testConnection).toHaveBeenCalledWith('https://catalog-source.example.test', 'plain-api-key');
    expect(repo.updateConnectionStatus).toHaveBeenCalledWith('ok', new Date(checkedAt), null);
    expect(repo.updateConnectionStatus).toHaveBeenCalledOnce();
  });

  it('persists error connection status and message when the client check fails', async () => {
    const checkedAt = '2026-02-03T04:05:06.000Z';
    const result: WarehouseConnectionTestResult = {
      ok: false,
      status: 503,
      message: 'Service unavailable',
      checkedAt,
    };
    repo.findSettings.mockResolvedValue(
      makeRow({
        apiKeyEncrypted: 'ciphertext',
        apiKeyNonce: 'nonce',
        apiKeyTag: 'tag',
      }),
    );
    client.testConnection.mockResolvedValue(result);

    await expect(service.testConnection()).resolves.toEqual(result);
    expect(repo.updateConnectionStatus).toHaveBeenCalledWith('error', new Date(checkedAt), 'Service unavailable');
  });

  it('persists an admin-safe error result when the client throws during connection testing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T06:07:08.000Z'));

    repo.findSettings.mockResolvedValue(
      makeRow({
        baseUrl: 'https://catalog-source.example.test',
        apiKeyEncrypted: 'ciphertext',
        apiKeyNonce: 'nonce',
        apiKeyTag: 'tag',
      }),
    );
    client.testConnection.mockRejectedValue(new Error('DNS failed for https://catalog-source.example.test using plain-api-key'));

    const result = await service.testConnection();

    expect(result).toEqual({
      ok: false,
      status: null,
      message: 'Unable to connect to Book Warehouse. Check the configuration and try again.',
      checkedAt: '2026-04-05T06:07:08.000Z',
    });
    expect(repo.updateConnectionStatus).toHaveBeenCalledWith(
      'error',
      new Date('2026-04-05T06:07:08.000Z'),
      'Unable to connect to Book Warehouse. Check the configuration and try again.',
    );
    expect(result.message).not.toContain('plain-api-key');
    expect(result.message).not.toContain('catalog-source.example.test');
  });

  it('rejects testConnection without a stored API key using Book Warehouse wording', async () => {
    repo.findSettings.mockResolvedValue(makeRow());

    await expect(service.testConnection()).rejects.toThrow(BadRequestException);
    await expect(service.testConnection()).rejects.toThrow('A Book Warehouse API key is required before testing the Book Warehouse connection');
  });

  it('rejects testConnection with admin-safe Book Warehouse wording when the stored API key cannot be decrypted', async () => {
    repo.findSettings.mockResolvedValue(
      makeRow({
        baseUrl: 'https://catalog-source.example.test',
        apiKeyEncrypted: 'ciphertext',
        apiKeyNonce: 'nonce',
        apiKeyTag: 'tag',
      }),
    );
    secret.decrypt.mockImplementation(() => {
      throw new Error('unable to decrypt');
    });

    await expect(service.testConnection()).rejects.toThrow(BadRequestException);
    await expect(service.testConnection()).rejects.toThrow(
      'The stored Book Warehouse API key could not be decrypted. Save a new Book Warehouse API key and try again.',
    );
    expect(client.testConnection).not.toHaveBeenCalled();
    expect(repo.updateConnectionStatus).not.toHaveBeenCalled();
  });
});
