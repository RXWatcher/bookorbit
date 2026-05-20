import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { TtsChapterText, TtsEffectivePreferences, TtsUserPreferences, TtsVoice } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import type { UpdateTtsPreferencesDto } from './dto/tts-preferences.dto';
import type { SaveTtsPositionDto } from './dto/tts-position.dto';
import type { SynthesizeDto } from './dto/synthesize.dto';
import type { ITtsProvider } from './providers/tts-provider.interface';
import { EDGE_PROVIDER_ID, TtsProviderFactory } from './providers/tts-provider.factory';
import { TtsAdminService } from './tts-admin.service';
import { TtsRepository } from './tts.repository';
import { TtsSynthesisService } from './tts-synthesis.service';
import { TtsTextExtractorService } from './tts-text-extractor.service';

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);

  constructor(
    private readonly ttsRepo: TtsRepository,
    private readonly ttsAdmin: TtsAdminService,
    private readonly synthesisService: TtsSynthesisService,
    private readonly providerFactory: TtsProviderFactory,
    private readonly bookService: BookService,
    private readonly textExtractor: TtsTextExtractorService,
  ) {}

  // ---- Synthesis ----

  async synthesize(dto: SynthesizeDto): Promise<Buffer> {
    const provider = await this.resolveProvider(dto.providerId);
    const voiceId = await this.resolveSynthesisVoiceId(dto.providerId, dto.voiceId, provider);
    return this.synthesisService.synthesize(provider, dto.providerId, voiceId, dto.speed, dto.text, dto.format ?? 'mp3');
  }

  async previewVoice(providerId: string, voiceId: string): Promise<Buffer> {
    const provider = await this.resolveProvider(providerId);
    if (providerId === EDGE_PROVIDER_ID) {
      await this.assertEdgeVoiceAvailable(voiceId);
    }
    return this.synthesisService.previewVoice(provider, providerId, voiceId);
  }

  // ---- Voice listing ----

  async getVoices(providerId?: string): Promise<TtsVoice[]> {
    if (providerId) {
      return this.getVoicesForProvider(providerId);
    }
    return this.getAllAvailableVoices();
  }

  private async getVoicesForProvider(providerId: string): Promise<TtsVoice[]> {
    if (providerId === EDGE_PROVIDER_ID) {
      return this.getEdgeVoicesFiltered();
    }
    const dbProvider = await this.ttsRepo.findProviderById(Number(providerId));
    if (!dbProvider || !dbProvider.enabled) throw new NotFoundException(`TTS provider ${providerId} not found or disabled`);
    const provider = this.providerFactory.getOpenAiProvider(dbProvider);
    return provider.listVoices();
  }

  private async getAllAvailableVoices(): Promise<TtsVoice[]> {
    const voices: TtsVoice[] = [];
    const edgeConfig = await this.ttsAdmin.getEdgeConfig();
    if (edgeConfig.enabled) {
      voices.push(...(await this.getEdgeVoicesFiltered()));
    }
    const enabledProviders = await this.ttsRepo.findEnabledProviders();
    for (const dbProvider of enabledProviders) {
      const provider = this.providerFactory.getOpenAiProvider(dbProvider);
      const providerVoices = await provider.listVoices().catch((err: Error) => {
        this.logger.warn(`Failed to list voices for provider ${dbProvider.id}: ${err.message}`);
        return [];
      });
      voices.push(...providerVoices);
    }
    return voices;
  }

  private async getEdgeVoicesFiltered(): Promise<TtsVoice[]> {
    const [edgeProvider, edgeConfig] = await Promise.all([Promise.resolve(this.providerFactory.getEdgeProvider()), this.ttsAdmin.getEdgeConfig()]);
    const allVoices = await edgeProvider.listVoices();
    if (edgeConfig.enabledVoices.length === 0) return allVoices;
    const enabledSet = new Set(edgeConfig.enabledVoices);
    return allVoices.filter((v) => enabledSet.has(v.id));
  }

  async getAvailableProviderInfos() {
    const infos: Array<{ id: string; name: string; type: string }> = [];
    const edgeConfig = await this.ttsAdmin.getEdgeConfig();
    if (edgeConfig.enabled) {
      infos.push({ id: EDGE_PROVIDER_ID, name: 'Edge TTS', type: 'edge' });
    }
    const enabledProviders = await this.ttsRepo.findEnabledProviders();
    for (const p of enabledProviders) {
      infos.push({ id: String(p.id), name: p.name, type: p.type });
    }
    return infos;
  }

  // ---- User preferences ----

  async getUserPreferences(userId: number): Promise<TtsUserPreferences | null> {
    const row = await this.ttsRepo.findUserPreferences(userId);
    if (!row) return null;
    const normalized = await this.normalizePreferenceVoiceForProvider(row.providerId != null ? String(row.providerId) : null, row.voiceId ?? null);
    return {
      providerId: normalized.providerId,
      voiceId: normalized.voiceId,
      speed: row.speed,
    };
  }

  async saveUserPreferences(userId: number, dto: UpdateTtsPreferencesDto): Promise<TtsUserPreferences> {
    const row = await this.ttsRepo.upsertUserPreferences(userId, {
      ...(dto.providerId !== undefined && { providerId: this.providerIdToInt(dto.providerId) }),
      ...(dto.voiceId !== undefined && { voiceId: dto.voiceId }),
      ...(dto.speed !== undefined && { speed: dto.speed }),
    });
    return {
      providerId: row.providerId != null ? String(row.providerId) : null,
      voiceId: row.voiceId ?? null,
      speed: row.speed,
    };
  }

  async getEffectiveBookPreferences(userId: number, bookId: number, user: RequestUser): Promise<TtsEffectivePreferences> {
    await this.bookService.verifyBookAccess(bookId, user);
    const [userPrefs, bookPrefs] = await Promise.all([this.ttsRepo.findUserPreferences(userId), this.ttsRepo.findBookPreferences(userId, bookId)]);
    if (bookPrefs) {
      const normalized = await this.normalizePreferenceVoiceForProvider(
        bookPrefs.providerId != null ? String(bookPrefs.providerId) : userPrefs?.providerId != null ? String(userPrefs.providerId) : null,
        bookPrefs.voiceId ?? userPrefs?.voiceId ?? null,
      );
      return {
        providerId: normalized.providerId,
        voiceId: normalized.voiceId,
        speed: bookPrefs.speed ?? userPrefs?.speed ?? 1.0,
        isBookOverride: true,
      };
    }
    const normalized = await this.normalizePreferenceVoiceForProvider(
      userPrefs?.providerId != null ? String(userPrefs.providerId) : null,
      userPrefs?.voiceId ?? null,
    );
    return {
      providerId: normalized.providerId,
      voiceId: normalized.voiceId,
      speed: userPrefs?.speed ?? 1.0,
      isBookOverride: false,
    };
  }

  async saveBookPreferences(userId: number, bookId: number, dto: UpdateTtsPreferencesDto, user: RequestUser) {
    await this.bookService.verifyBookAccess(bookId, user);
    return this.ttsRepo.upsertBookPreferences(userId, bookId, {
      ...(dto.providerId !== undefined && { providerId: this.providerIdToInt(dto.providerId) }),
      ...(dto.voiceId !== undefined && { voiceId: dto.voiceId }),
      ...(dto.speed !== undefined && { speed: dto.speed }),
    });
  }

  async deleteBookPreferences(userId: number, bookId: number, user: RequestUser) {
    await this.bookService.verifyBookAccess(bookId, user);
    await this.ttsRepo.deleteBookPreferences(userId, bookId);
  }

  // ---- TTS position ----

  async getPosition(userId: number, bookFileId: number, user: RequestUser) {
    await this.bookService.verifyFileAccess(bookFileId, user);
    return this.ttsRepo.findPosition(userId, bookFileId);
  }

  async savePosition(userId: number, bookFileId: number, dto: SaveTtsPositionDto, user: RequestUser) {
    await this.bookService.verifyFileAccess(bookFileId, user);
    return this.ttsRepo.upsertPosition(userId, bookFileId, dto.cfi, dto.chapterIndex ?? null);
  }

  async deletePosition(userId: number, bookFileId: number, user: RequestUser) {
    await this.bookService.verifyFileAccess(bookFileId, user);
    await this.ttsRepo.deletePosition(userId, bookFileId);
  }

  async getChapterText(bookFileId: number, chapterIndex: number, user: RequestUser): Promise<TtsChapterText> {
    await this.bookService.verifyFileAccess(bookFileId, user);
    return this.textExtractor.extractChapterText(bookFileId, chapterIndex);
  }

  // ---- Helpers ----

  private async resolveProvider(providerId: string) {
    if (providerId === EDGE_PROVIDER_ID) {
      const config = await this.ttsAdmin.getEdgeConfig();
      if (!config.enabled) throw new NotFoundException('Edge TTS is not enabled');
      return this.providerFactory.getEdgeProvider();
    }
    const numId = Number(providerId);
    if (isNaN(numId)) throw new NotFoundException(`Invalid provider ID: ${providerId}`);
    const dbProvider = await this.ttsRepo.findProviderById(numId);
    if (!dbProvider || !dbProvider.enabled) throw new NotFoundException(`TTS provider ${providerId} not found or disabled`);
    return this.providerFactory.getOpenAiProvider(dbProvider);
  }

  private async resolveSynthesisVoiceId(providerId: string, requestedVoiceId: string | undefined, provider: ITtsProvider): Promise<string> {
    const trimmedVoiceId = requestedVoiceId?.trim();
    if (trimmedVoiceId) {
      if (providerId === EDGE_PROVIDER_ID) {
        await this.assertEdgeVoiceAvailable(trimmedVoiceId);
      }
      return trimmedVoiceId;
    }

    const availableVoices = providerId === EDGE_PROVIDER_ID ? await this.getEdgeVoicesFiltered() : await provider.listVoices();
    const fallbackVoiceId = availableVoices[0]?.id?.trim();
    if (!fallbackVoiceId) {
      throw new NotFoundException(`No voices available for provider ${providerId}`);
    }

    this.logger.warn(`Missing voiceId for provider ${providerId}; falling back to voice ${fallbackVoiceId}`);
    return fallbackVoiceId;
  }

  private async normalizePreferenceVoiceForProvider(
    providerId: string | null,
    voiceId: string | null,
  ): Promise<{ providerId: string | null; voiceId: string | null }> {
    const trimmedVoiceId = voiceId?.trim() || null;
    if (providerId) {
      return { providerId, voiceId: trimmedVoiceId };
    }

    const edgeConfig = await this.ttsAdmin.getEdgeConfig();
    if (!edgeConfig.enabled) {
      return { providerId: null, voiceId: null };
    }

    if (!trimmedVoiceId) {
      return { providerId: null, voiceId: null };
    }

    try {
      const voices = await this.getEdgeVoicesFiltered();
      const isAvailable = voices.some((voice) => voice.id === trimmedVoiceId);
      return { providerId: null, voiceId: isAvailable ? trimmedVoiceId : null };
    } catch {
      // If voice lookup fails, keep the persisted value instead of forcing a reset.
      return { providerId: null, voiceId: trimmedVoiceId };
    }
  }

  private async assertEdgeVoiceAvailable(voiceId: string): Promise<void> {
    const normalizedVoiceId = voiceId.trim();
    const voices = await this.getEdgeVoicesFiltered();
    const isAvailable = voices.some((voice) => voice.id === normalizedVoiceId);
    if (!isAvailable) {
      throw new NotFoundException(`Voice ${normalizedVoiceId} is not available for provider ${EDGE_PROVIDER_ID}`);
    }
  }

  private providerIdToInt(providerId: string | undefined): number | null {
    if (!providerId || providerId === EDGE_PROVIDER_ID) return null;
    const n = Number(providerId);
    return isNaN(n) ? null : n;
  }
}
