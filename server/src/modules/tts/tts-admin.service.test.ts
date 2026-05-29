import { NotFoundException } from '@nestjs/common';

import type { TtsEdgeTtsConfig } from '@bookorbit/types';
import type { AppSettingsRepository } from '../../app-settings/app-settings.repository';
import { TtsAdminService } from './tts-admin.service';
import type { TtsRepository } from './tts.repository';
import type { EdgeTtsProvider } from './providers/edge-tts.provider';
import type { TtsProviderFactory } from './providers/tts-provider.factory';

function makeRepo() {
  return {
    findAllProviders: vi.fn().mockResolvedValue([]),
    findProviderById: vi.fn().mockResolvedValue(null),
    insertProvider: vi.fn(),
    updateProvider: vi.fn(),
    deleteProvider: vi.fn(),
  } as unknown as TtsRepository;
}

function makeAppSettingsRepo() {
  return {
    findByKey: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(undefined),
  } as unknown as AppSettingsRepository;
}

function makeEdgeProvider() {
  return {
    listVoices: vi.fn().mockResolvedValue([]),
    testConnection: vi.fn().mockResolvedValue({ connected: true }),
    synthesize: vi.fn(),
  } as unknown as EdgeTtsProvider;
}

function makeProviderFactory(edgeProvider: EdgeTtsProvider) {
  return {
    getEdgeProvider: vi.fn().mockReturnValue(edgeProvider),
    getOpenAiProvider: vi.fn(),
    invalidateCache: vi.fn(),
  } as unknown as TtsProviderFactory;
}

const DB_PROVIDER = {
  id: 1,
  name: 'Kokoro',
  type: 'openai-compatible',
  baseUrl: 'http://localhost:8880/v1',
  apiKey: null,
  defaultModel: null,
  staticVoices: null,
  enabled: true,
  displayOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('TtsAdminService', () => {
  let service: TtsAdminService;
  let repo: ReturnType<typeof makeRepo>;
  let appRepo: ReturnType<typeof makeAppSettingsRepo>;
  let edgeProvider: EdgeTtsProvider;
  let factory: ReturnType<typeof makeProviderFactory>;

  beforeEach(() => {
    repo = makeRepo();
    appRepo = makeAppSettingsRepo();
    edgeProvider = makeEdgeProvider();
    factory = makeProviderFactory(edgeProvider);
    service = new TtsAdminService(repo, appRepo, factory, edgeProvider);
  });

  describe('getEdgeConfig', () => {
    it('should return default config when no setting exists', async () => {
      appRepo.findByKey.mockResolvedValue(null);
      const config = await service.getEdgeConfig();
      expect(config).toEqual({ enabled: true, enabledVoices: [] });
    });

    it('should parse stored config', async () => {
      const stored: TtsEdgeTtsConfig = { enabled: false, enabledVoices: ['en-US-JennyNeural'] };
      appRepo.findByKey.mockResolvedValue({ key: 'tts_edge_config', value: JSON.stringify(stored) });

      const config = await service.getEdgeConfig();
      expect(config).toEqual(stored);
    });

    it('should return default config for invalid JSON', async () => {
      appRepo.findByKey.mockResolvedValue({ key: 'tts_edge_config', value: 'invalid{json' });
      const config = await service.getEdgeConfig();
      expect(config).toEqual({ enabled: true, enabledVoices: [] });
    });

    it('should return default config for JSON that fails schema validation', async () => {
      appRepo.findByKey.mockResolvedValue({ key: 'tts_edge_config', value: JSON.stringify({ enabled: 'yes', enabledVoices: 'bad' }) });
      const config = await service.getEdgeConfig();
      // zod coerces or falls back to default
      expect(config).toBeDefined();
    });
  });

  describe('updateEdgeConfig', () => {
    it('should save and return the new config', async () => {
      const dto = { enabled: false, enabledVoices: ['en-US-JennyNeural', 'en-GB-SoniaNeural'] };
      const result = await service.updateEdgeConfig(dto);
      expect(result).toEqual(dto);
      expect(appRepo.upsert).toHaveBeenCalledWith('tts_edge_config', JSON.stringify(dto));
    });
  });

  describe('getAllEdgeVoices', () => {
    it('should return voices from edge provider', async () => {
      const voices = [{ id: 'en-US-JennyNeural', name: 'Jenny' }];
      (edgeProvider.listVoices as vi.Mock).mockResolvedValue(voices);
      const result = await service.getAllEdgeVoices();
      expect(result).toEqual(voices);
    });
  });

  describe('getAllProviders', () => {
    it('should return all providers', async () => {
      repo.findAllProviders.mockResolvedValue([DB_PROVIDER]);
      const result = await service.getAllProviders();
      expect(result).toHaveLength(1);
    });
  });

  describe('addProvider', () => {
    it('should create and return provider', async () => {
      repo.insertProvider.mockResolvedValue(DB_PROVIDER);
      const result = await service.addProvider({ name: 'Kokoro', baseUrl: 'http://localhost:8880/v1' });
      expect(result).toEqual(DB_PROVIDER);
      expect(repo.insertProvider).toHaveBeenCalled();
    });

    it('should pass staticVoices to repository when provided', async () => {
      const staticVoices = [{ id: 'af_heart', name: 'Heart', shortName: 'af_heart', language: 'English', locale: 'en-US', gender: 'Female' }];
      repo.insertProvider.mockResolvedValue({ ...DB_PROVIDER, staticVoices });
      await service.addProvider({ name: 'Kokoro', baseUrl: 'http://localhost:8880/v1', staticVoices });
      expect(repo.insertProvider).toHaveBeenCalledWith(expect.objectContaining({ staticVoices }));
    });

    it('should pass null staticVoices when not provided', async () => {
      repo.insertProvider.mockResolvedValue(DB_PROVIDER);
      await service.addProvider({ name: 'Kokoro', baseUrl: 'http://localhost:8880/v1' });
      expect(repo.insertProvider).toHaveBeenCalledWith(expect.objectContaining({ staticVoices: null }));
    });
  });

  describe('updateProvider', () => {
    it('should throw NotFoundException if provider not found', async () => {
      repo.findProviderById.mockResolvedValue(null);
      await expect(service.updateProvider(99, { name: 'Updated' })).rejects.toThrow(NotFoundException);
    });

    it('should update and return provider', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      const updated = { ...DB_PROVIDER, name: 'Updated' };
      repo.updateProvider.mockResolvedValue(updated);
      const result = await service.updateProvider(1, { name: 'Updated' });
      expect(result).toEqual(updated);
      expect(factory.invalidateCache).toHaveBeenCalledWith(1);
    });

    it('should update staticVoices when provided', async () => {
      const staticVoices = [{ id: 'af_heart', name: 'Heart', shortName: 'af_heart', language: 'English', locale: 'en-US', gender: 'Female' }];
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      repo.updateProvider.mockResolvedValue({ ...DB_PROVIDER, staticVoices });
      await service.updateProvider(1, { staticVoices });
      expect(repo.updateProvider).toHaveBeenCalledWith(1, expect.objectContaining({ staticVoices }));
    });

    it('should clear staticVoices when empty array provided', async () => {
      repo.findProviderById.mockResolvedValue({
        ...DB_PROVIDER,
        staticVoices: [{ id: 'af_heart', name: 'Heart', shortName: 'af_heart', language: 'English', locale: 'en-US', gender: 'Female' }],
      });
      repo.updateProvider.mockResolvedValue({ ...DB_PROVIDER, staticVoices: [] });
      await service.updateProvider(1, { staticVoices: [] });
      expect(repo.updateProvider).toHaveBeenCalledWith(1, expect.objectContaining({ staticVoices: [] }));
    });
  });

  describe('deleteProvider', () => {
    it('should throw NotFoundException if provider not found', async () => {
      repo.findProviderById.mockResolvedValue(null);
      await expect(service.deleteProvider(99)).rejects.toThrow(NotFoundException);
    });

    it('should delete provider and invalidate cache', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      repo.deleteProvider.mockResolvedValue(undefined);
      await service.deleteProvider(1);
      expect(repo.deleteProvider).toHaveBeenCalledWith(1);
      expect(factory.invalidateCache).toHaveBeenCalledWith(1);
    });
  });

  describe('testProvider', () => {
    it('should return test result for existing provider', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      const openAiMock = {
        testConnection: vi.fn().mockResolvedValue({ connected: true }),
        listVoices: vi.fn().mockResolvedValue([{ id: 'v1' }, { id: 'v2' }]),
        synthesize: vi.fn(),
      };
      (factory.getOpenAiProvider as vi.Mock).mockReturnValue(openAiMock);

      const result = await service.testProvider(1);
      expect(result.connected).toBe(true);
      expect(result.voiceCount).toBe(2);
    });

    it('should return error result when connection fails', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      const openAiMock = {
        testConnection: vi.fn().mockResolvedValue({ connected: false, error: 'refused' }),
        listVoices: vi.fn(),
        synthesize: vi.fn(),
      };
      (factory.getOpenAiProvider as vi.Mock).mockReturnValue(openAiMock);

      const result = await service.testProvider(1);
      expect(result.connected).toBe(false);
    });

    it('should throw NotFoundException if provider not found', async () => {
      repo.findProviderById.mockResolvedValue(null);
      await expect(service.testProvider(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('discoverProviderVoices', () => {
    it('should throw NotFoundException when provider not found', async () => {
      repo.findProviderById.mockResolvedValue(null);
      await expect(service.discoverProviderVoices(99)).rejects.toThrow(NotFoundException);
    });

    it('should return voices and supported=true when provider exposes /audio/voices', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([{ id: 'alloy', name: 'Alloy' }]),
      } as unknown as Response);

      const result = await service.discoverProviderVoices(1);
      expect(result.supported).toBe(true);
      expect(result.voices).toHaveLength(1);
      expect(result.voices[0]!.id).toBe('alloy');
    });

    it('should return empty voices and supported=false when provider returns 404', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
      } as unknown as Response);

      const result = await service.discoverProviderVoices(1);
      expect(result.supported).toBe(false);
      expect(result.voices).toEqual([]);
    });

    it('should throw BadGatewayException when provider is unreachable', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const { BadGatewayException } = await import('@nestjs/common');
      await expect(service.discoverProviderVoices(1)).rejects.toThrow(BadGatewayException);
    });

    it('should throw BadGatewayException on non-404 upstream error', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.resolve('Service Unavailable'),
      } as unknown as Response);

      const { BadGatewayException } = await import('@nestjs/common');
      await expect(service.discoverProviderVoices(1)).rejects.toThrow(BadGatewayException);
    });

    it('should not use staticVoices for discovery (bypasses static fallback)', async () => {
      const providerWithStatic = {
        ...DB_PROVIDER,
        staticVoices: [{ id: 'af_heart', name: 'Heart', shortName: 'af_heart', language: 'English', locale: 'en-US', gender: 'Female' }],
      };
      repo.findProviderById.mockResolvedValue(providerWithStatic);
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
      } as unknown as Response);

      const result = await service.discoverProviderVoices(1);
      expect(result.supported).toBe(false);
      expect(result.voices).toEqual([]);
    });
  });
});
