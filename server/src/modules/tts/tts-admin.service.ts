import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { z } from 'zod';

import type { TtsEdgeTtsConfig, TtsProviderStatus, TtsVoice } from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { APP_SETTING_KEYS } from '../../common/constants/app-settings.constants';
import { AppSettingsRepository } from '../app-settings/app-settings.repository';
import type { AddTtsProviderDto, UpdateEdgeTtsConfigDto, UpdateTtsProviderDto } from './dto/tts-admin.dto';
import { EdgeTtsProvider } from './providers/edge-tts.provider';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider';
import { TtsProviderFactory } from './providers/tts-provider.factory';
import { TtsRepository } from './tts.repository';

const EDGE_CONFIG_SCHEMA = z.object({
  enabled: z.boolean().default(true),
  enabledVoices: z.array(z.string()).default([]),
});

const DEFAULT_EDGE_CONFIG: TtsEdgeTtsConfig = { enabled: true, enabledVoices: [] };

@Injectable()
export class TtsAdminService {
  private readonly logger = new Logger(TtsAdminService.name);

  constructor(
    private readonly ttsRepo: TtsRepository,
    private readonly appSettingsRepo: AppSettingsRepository,
    private readonly providerFactory: TtsProviderFactory,
    private readonly edgeTtsProvider: EdgeTtsProvider,
  ) {}

  // ---- Edge TTS config ----

  async getEdgeConfig(): Promise<TtsEdgeTtsConfig> {
    const row = await this.appSettingsRepo.findByKey(APP_SETTING_KEYS.TTS_EDGE_CONFIG);
    if (!row) return { ...DEFAULT_EDGE_CONFIG };
    try {
      const parsed = EDGE_CONFIG_SCHEMA.parse(JSON.parse(row.value));
      return parsed;
    } catch {
      return { ...DEFAULT_EDGE_CONFIG };
    }
  }

  async updateEdgeConfig(dto: UpdateEdgeTtsConfigDto): Promise<TtsEdgeTtsConfig> {
    const config: TtsEdgeTtsConfig = { enabled: dto.enabled, enabledVoices: dto.enabledVoices };
    await this.appSettingsRepo.upsert(APP_SETTING_KEYS.TTS_EDGE_CONFIG, JSON.stringify(config));
    return config;
  }

  async getAllEdgeVoices() {
    return this.edgeTtsProvider.listVoices();
  }

  // ---- OpenAI-compatible providers ----

  async getAllProviders() {
    return this.ttsRepo.findAllProviders();
  }

  async addProvider(dto: AddTtsProviderDto) {
    return this.ttsRepo.insertProvider({
      name: dto.name,
      type: 'openai-compatible',
      baseUrl: dto.baseUrl,
      apiKey: dto.apiKey ?? null,
      defaultModel: dto.defaultModel ?? null,
      staticVoices: dto.staticVoices ?? null,
      enabled: true,
    });
  }

  async updateProvider(id: number, dto: UpdateTtsProviderDto) {
    const existing = await this.ttsRepo.findProviderById(id);
    if (!existing) throw new NotFoundException(`TTS provider ${id} not found`);
    this.providerFactory.invalidateCache(id);
    return this.ttsRepo.updateProvider(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.baseUrl !== undefined && { baseUrl: dto.baseUrl }),
      ...(dto.apiKey !== undefined && { apiKey: dto.apiKey }),
      ...(dto.enabled !== undefined && { enabled: dto.enabled }),
      ...(dto.defaultModel !== undefined && { defaultModel: dto.defaultModel }),
      ...(dto.staticVoices !== undefined && { staticVoices: dto.staticVoices }),
    });
  }

  async deleteProvider(id: number): Promise<void> {
    const existing = await this.ttsRepo.findProviderById(id);
    if (!existing) throw new NotFoundException(`TTS provider ${id} not found`);
    this.providerFactory.invalidateCache(id);
    await this.ttsRepo.deleteProvider(id);
  }

  async discoverProviderVoices(id: number): Promise<{ voices: TtsVoice[]; supported: boolean }> {
    const event = 'tts.admin.discover_voices';
    const startMs = Date.now();
    this.logger.log(`[${event}] [start] providerId=${id} - discovering provider voices`);
    const dbProvider = await this.ttsRepo.findProviderById(id);
    if (!dbProvider) throw new NotFoundException(`TTS provider ${id} not found`);
    const provider = new OpenAiCompatibleProvider({
      providerId: String(dbProvider.id),
      providerName: dbProvider.name,
      baseUrl: dbProvider.baseUrl ?? '',
      apiKey: dbProvider.apiKey ?? '',
      defaultModel: dbProvider.defaultModel,
      staticVoices: null,
    });
    try {
      const voices = await provider.discoverVoicesLive();
      const supported = voices !== null;
      this.logger.log(
        `[${event}] [end] providerId=${id} durationMs=${Date.now() - startMs} supported=${supported} count=${voices?.length ?? 0} - voice discovery completed`,
      );
      return { voices: voices ?? [], supported };
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = err instanceof Error ? sanitizeLogValue(err.message) : 'unknown';
      this.logger.error(
        `[${event}] [fail] providerId=${id} durationMs=${Date.now() - startMs} errorClass=${errorClass} error="${error}" - voice discovery failed`,
      );
      throw new BadGatewayException('Failed to reach TTS provider');
    }
  }

  async testProvider(id: number): Promise<TtsProviderStatus> {
    const event = 'tts.admin.test_provider';
    const startMs = Date.now();
    this.logger.log(`[${event}] [start] providerId=${id} - testing provider connection`);
    try {
      const dbProvider = await this.ttsRepo.findProviderById(id);
      if (!dbProvider) throw new NotFoundException(`TTS provider ${id} not found`);
      const provider = this.providerFactory.getOpenAiProvider(dbProvider);
      const result = await provider.testConnection();
      let voiceCount = 0;
      if (result.connected) {
        const voices = await provider.listVoices().catch(() => []);
        voiceCount = voices.length;
      }
      this.logger.log(
        `[${event}] [end] providerId=${id} durationMs=${Date.now() - startMs} connected=${result.connected} voiceCount=${voiceCount} - provider test completed`,
      );
      return { id: String(id), name: dbProvider.name, connected: result.connected, voiceCount, error: result.error };
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = err instanceof Error ? sanitizeLogValue(err.message) : 'unknown';
      this.logger.error(
        `[${event}] [fail] providerId=${id} durationMs=${Date.now() - startMs} errorClass=${errorClass} error="${error}" - provider test failed`,
      );
      if (err instanceof NotFoundException) throw err;
      return { id: String(id), name: 'Unknown', connected: false, voiceCount: 0, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }
}
