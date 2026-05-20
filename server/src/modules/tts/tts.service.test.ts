import { NotFoundException } from '@nestjs/common';

import type { TtsChapterText, TtsEffectivePreferences } from '@bookorbit/types';
import { TtsService } from './tts.service';
import type { TtsRepository } from './tts.repository';
import type { TtsAdminService } from './tts-admin.service';
import type { TtsSynthesisService } from './tts-synthesis.service';
import type { TtsProviderFactory } from './providers/tts-provider.factory';
import type { BookService } from '../book/book.service';
import type { TtsTextExtractorService } from './tts-text-extractor.service';
import type { RequestUser } from '../../common/types/request-user';
import { EDGE_PROVIDER_ID } from './providers/tts-provider.factory';

const USER: RequestUser = { id: 42, isSuperuser: false, permissions: [], username: 'alice' };

function makeRepo() {
  return {
    findUserPreferences: vi.fn().mockResolvedValue(null),
    upsertUserPreferences: vi.fn().mockResolvedValue({ providerId: null, voiceId: null, speed: 1.0 }),
    findBookPreferences: vi.fn().mockResolvedValue(null),
    upsertBookPreferences: vi.fn().mockResolvedValue(undefined),
    deleteBookPreferences: vi.fn().mockResolvedValue(undefined),
    findPosition: vi.fn().mockResolvedValue(null),
    upsertPosition: vi.fn().mockResolvedValue(undefined),
    deletePosition: vi.fn().mockResolvedValue(undefined),
    findProviderById: vi.fn().mockResolvedValue(null),
    findEnabledProviders: vi.fn().mockResolvedValue([]),
  } as unknown as TtsRepository;
}

function makeAdmin() {
  return {
    getEdgeConfig: vi.fn().mockResolvedValue({ enabled: true, enabledVoices: [] }),
  } as unknown as TtsAdminService;
}

function makeSynthesis() {
  return {
    synthesize: vi.fn().mockResolvedValue(Buffer.from('audio')),
    previewVoice: vi.fn().mockResolvedValue(Buffer.from('preview')),
  } as unknown as TtsSynthesisService;
}

const EDGE_PROVIDER_MOCK = {
  synthesize: vi.fn().mockResolvedValue(Buffer.from('edge-audio')),
  listVoices: vi.fn().mockResolvedValue([
    {
      id: 'en-US-JennyNeural',
      name: 'Jenny',
      locale: 'en-US',
      gender: 'Female',
      language: 'English (United States)',
      shortName: 'en-US-JennyNeural',
      providerId: 'edge',
      providerName: 'Edge TTS',
    },
  ]),
  testConnection: vi.fn().mockResolvedValue({ connected: true }),
};

const OPENAI_PROVIDER_MOCK = {
  synthesize: vi.fn().mockResolvedValue(Buffer.from('openai-audio')),
  listVoices: vi.fn().mockResolvedValue([
    {
      id: 'alloy',
      name: 'Alloy',
      locale: 'en-US',
      gender: 'Neutral',
      language: 'English',
      shortName: 'alloy',
      providerId: '1',
      providerName: 'Kokoro',
    },
  ]),
  testConnection: vi.fn().mockResolvedValue({ connected: true }),
};

function makeFactory() {
  return {
    getEdgeProvider: vi.fn().mockReturnValue(EDGE_PROVIDER_MOCK),
    getOpenAiProvider: vi.fn().mockReturnValue(OPENAI_PROVIDER_MOCK),
    invalidateCache: vi.fn(),
  } as unknown as TtsProviderFactory;
}

function makeBookService() {
  return {
    verifyBookAccess: vi.fn().mockResolvedValue(undefined),
    verifyFileAccess: vi.fn().mockResolvedValue(undefined),
  } as unknown as BookService;
}

const CHAPTER_TEXT: TtsChapterText = { chapterIndex: 0, sentences: [{ text: 'Hello world', index: 0 }] };

function makeTextExtractor() {
  return {
    extractChapterText: vi.fn().mockResolvedValue(CHAPTER_TEXT),
  } as unknown as TtsTextExtractorService;
}

const DB_PROVIDER = {
  id: 1,
  name: 'Kokoro',
  type: 'openai-compatible',
  baseUrl: 'http://localhost:8880/v1',
  apiKey: null,
  defaultModel: null,
  enabled: true,
  displayOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('TtsService', () => {
  let service: TtsService;
  let repo: ReturnType<typeof makeRepo>;
  let admin: ReturnType<typeof makeAdmin>;
  let synthesis: ReturnType<typeof makeSynthesis>;
  let factory: ReturnType<typeof makeFactory>;
  let bookService: ReturnType<typeof makeBookService>;
  let textExtractor: ReturnType<typeof makeTextExtractor>;

  beforeEach(() => {
    repo = makeRepo();
    admin = makeAdmin();
    synthesis = makeSynthesis();
    factory = makeFactory();
    bookService = makeBookService();
    textExtractor = makeTextExtractor();
    service = new TtsService(repo, admin, synthesis, factory, bookService, textExtractor);
  });

  describe('synthesize', () => {
    it('should use edge provider for edge providerId', async () => {
      await service.synthesize({ providerId: EDGE_PROVIDER_ID, voiceId: 'en-US-JennyNeural', text: 'Hello', speed: 1.0 });
      expect(factory.getEdgeProvider).toHaveBeenCalled();
      expect(synthesis.synthesize).toHaveBeenCalledWith(EDGE_PROVIDER_MOCK, EDGE_PROVIDER_ID, 'en-US-JennyNeural', 1.0, 'Hello', 'mp3');
    });

    it('should fall back to first edge voice when voiceId is missing', async () => {
      await service.synthesize({ providerId: EDGE_PROVIDER_ID, voiceId: '', text: 'Hello', speed: 1.0 });
      expect(synthesis.synthesize).toHaveBeenCalledWith(EDGE_PROVIDER_MOCK, EDGE_PROVIDER_ID, 'en-US-JennyNeural', 1.0, 'Hello', 'mp3');
    });

    it('should use OpenAI provider for numeric providerId', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      await service.synthesize({ providerId: '1', voiceId: 'alloy', text: 'Hello', speed: 1.0 });
      expect(factory.getOpenAiProvider).toHaveBeenCalledWith(DB_PROVIDER);
      expect(synthesis.synthesize).toHaveBeenCalledWith(OPENAI_PROVIDER_MOCK, '1', 'alloy', 1.0, 'Hello', 'mp3');
    });

    it('should trim voiceId before synthesis', async () => {
      repo.findProviderById.mockResolvedValue(DB_PROVIDER);
      await service.synthesize({ providerId: '1', voiceId: '  alloy  ', text: 'Hello', speed: 1.0 });
      expect(synthesis.synthesize).toHaveBeenCalledWith(OPENAI_PROVIDER_MOCK, '1', 'alloy', 1.0, 'Hello', 'mp3');
    });

    it('should reject curated-out edge voiceId', async () => {
      admin.getEdgeConfig.mockResolvedValue({ enabled: true, enabledVoices: ['en-US-JennyNeural'] });
      await expect(service.synthesize({ providerId: EDGE_PROVIDER_ID, voiceId: 'en-GB-SoniaNeural', text: 'Hello', speed: 1.0 })).rejects.toThrow(
        NotFoundException,
      );
      expect(synthesis.synthesize).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when no fallback voices are available', async () => {
      (factory.getEdgeProvider as vi.Mock).mockReturnValue({
        ...EDGE_PROVIDER_MOCK,
        listVoices: vi.fn().mockResolvedValue([]),
      });
      await expect(service.synthesize({ providerId: EDGE_PROVIDER_ID, voiceId: '', text: 'Hello', speed: 1.0 })).rejects.toThrow(NotFoundException);
      expect(synthesis.synthesize).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for disabled provider', async () => {
      repo.findProviderById.mockResolvedValue({ ...DB_PROVIDER, enabled: false });
      await expect(service.synthesize({ providerId: '1', voiceId: 'alloy', text: 'Hello', speed: 1.0 })).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for unknown provider', async () => {
      repo.findProviderById.mockResolvedValue(null);
      await expect(service.synthesize({ providerId: '999', voiceId: 'alloy', text: 'Hello', speed: 1.0 })).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when edge TTS is disabled', async () => {
      admin.getEdgeConfig.mockResolvedValue({ enabled: false, enabledVoices: [] });
      await expect(service.synthesize({ providerId: EDGE_PROVIDER_ID, voiceId: 'v', text: 'Hello', speed: 1.0 })).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for invalid provider string', async () => {
      await expect(service.synthesize({ providerId: 'bad-id', voiceId: 'v', text: 'Hello', speed: 1.0 })).rejects.toThrow(NotFoundException);
    });
  });

  describe('getVoices', () => {
    it('should return all voices from all enabled providers', async () => {
      repo.findEnabledProviders.mockResolvedValue([DB_PROVIDER]);
      const voices = await service.getVoices();
      expect(voices.length).toBeGreaterThan(0);
    });

    it('should filter edge voices by enabledVoices list', async () => {
      admin.getEdgeConfig.mockResolvedValue({ enabled: true, enabledVoices: ['en-US-JennyNeural'] });
      (factory.getEdgeProvider as vi.Mock).mockReturnValue({
        ...EDGE_PROVIDER_MOCK,
        listVoices: vi.fn().mockResolvedValue([
          { id: 'en-US-JennyNeural', shortName: 'en-US-JennyNeural', name: 'Jenny' },
          { id: 'en-GB-SoniaNeural', shortName: 'en-GB-SoniaNeural', name: 'Sonia' },
        ]),
      });
      const voices = await service.getVoices(EDGE_PROVIDER_ID);
      expect(voices).toHaveLength(1);
      expect(voices[0]!.id).toBe('en-US-JennyNeural');
    });

    it('should exclude edge voices if edge disabled', async () => {
      admin.getEdgeConfig.mockResolvedValue({ enabled: false, enabledVoices: [] });
      const voices = await service.getVoices();
      expect(voices.every((v) => v.providerId !== EDGE_PROVIDER_ID)).toBe(true);
    });

    it('should skip providers that fail to list voices', async () => {
      repo.findEnabledProviders.mockResolvedValue([DB_PROVIDER]);
      (factory.getOpenAiProvider as vi.Mock).mockReturnValue({
        listVoices: vi.fn().mockRejectedValue(new Error('timeout')),
      });
      const voices = await service.getVoices();
      // should not throw, edge voices still returned
      expect(Array.isArray(voices)).toBe(true);
    });
  });

  describe('getEffectiveBookPreferences', () => {
    it('should return user defaults when no book override exists', async () => {
      repo.findUserPreferences.mockResolvedValue({ providerId: null, voiceId: 'en-US-JennyNeural', speed: 1.25 });
      repo.findBookPreferences.mockResolvedValue(null);

      const result: TtsEffectivePreferences = await service.getEffectiveBookPreferences(USER.id, 1, USER);
      expect(result.isBookOverride).toBe(false);
      expect(result.voiceId).toBe('en-US-JennyNeural');
      expect(result.speed).toBe(1.25);
    });

    it('should return book override when it exists', async () => {
      repo.findUserPreferences.mockResolvedValue({ providerId: 1, voiceId: 'default-voice', speed: 1.0 });
      repo.findBookPreferences.mockResolvedValue({ providerId: 1, voiceId: 'book-voice', speed: 1.5 });

      const result: TtsEffectivePreferences = await service.getEffectiveBookPreferences(USER.id, 1, USER);
      expect(result.isBookOverride).toBe(true);
      expect(result.providerId).toBe('1');
      expect(result.voiceId).toBe('book-voice');
      expect(result.speed).toBe(1.5);
    });

    it('should fall back to user provider when book override has null providerId', async () => {
      repo.findUserPreferences.mockResolvedValue({ providerId: 1, voiceId: null, speed: 1.0 });
      repo.findBookPreferences.mockResolvedValue({ providerId: null, voiceId: 'book-voice', speed: 1.0 });

      const result: TtsEffectivePreferences = await service.getEffectiveBookPreferences(USER.id, 1, USER);
      expect(result.providerId).toBe('1');
      expect(result.isBookOverride).toBe(true);
    });

    it('should return null providerId when both book and user have no provider', async () => {
      repo.findUserPreferences.mockResolvedValue({ providerId: null, voiceId: null, speed: 1.0 });
      repo.findBookPreferences.mockResolvedValue(null);

      const result: TtsEffectivePreferences = await service.getEffectiveBookPreferences(USER.id, 1, USER);
      expect(result.providerId).toBeNull();
    });

    it('should return null providerId when userPrefs is undefined (no prefs saved)', async () => {
      repo.findUserPreferences.mockResolvedValue(undefined);
      repo.findBookPreferences.mockResolvedValue(null);

      const result: TtsEffectivePreferences = await service.getEffectiveBookPreferences(USER.id, 1, USER);
      expect(result.providerId).toBeNull();
      expect(result.voiceId).toBeNull();
      expect(result.speed).toBe(1.0);
    });

    it('should return null providerId when book override exists with null providerId and userPrefs is undefined', async () => {
      repo.findUserPreferences.mockResolvedValue(undefined);
      repo.findBookPreferences.mockResolvedValue({ providerId: null, voiceId: 'en-US-JennyNeural', speed: 1.5 });

      const result: TtsEffectivePreferences = await service.getEffectiveBookPreferences(USER.id, 1, USER);
      expect(result.providerId).toBeNull();
      expect(result.voiceId).toBe('en-US-JennyNeural');
      expect(result.isBookOverride).toBe(true);
    });

    it('should clear curated-out edge voice from effective preferences', async () => {
      repo.findUserPreferences.mockResolvedValue({ providerId: null, voiceId: 'en-GB-SoniaNeural', speed: 1.0 });
      repo.findBookPreferences.mockResolvedValue(null);
      admin.getEdgeConfig.mockResolvedValue({ enabled: true, enabledVoices: ['en-US-JennyNeural'] });

      const result: TtsEffectivePreferences = await service.getEffectiveBookPreferences(USER.id, 1, USER);
      expect(result.providerId).toBeNull();
      expect(result.voiceId).toBeNull();
      expect(result.speed).toBe(1.0);
    });

    it('should propagate ForbiddenException from bookService.verifyBookAccess', async () => {
      bookService.verifyBookAccess.mockRejectedValue(new Error('Forbidden'));
      await expect(service.getEffectiveBookPreferences(USER.id, 99, USER)).rejects.toThrow('Forbidden');
    });
  });

  describe('getUserPreferences', () => {
    it('should return null when no preferences exist', async () => {
      repo.findUserPreferences.mockResolvedValue(null);
      const result = await service.getUserPreferences(42);
      expect(result).toBeNull();
    });

    it('should map numeric providerId to string', async () => {
      repo.findUserPreferences.mockResolvedValue({ providerId: 7, voiceId: 'jenny', speed: 1.5 });
      const result = await service.getUserPreferences(42);
      expect(result).toEqual({ providerId: '7', voiceId: 'jenny', speed: 1.5 });
    });

    it('should return null providerId when DB has null', async () => {
      repo.findUserPreferences.mockResolvedValue({ providerId: null, voiceId: null, speed: 1.0 });
      const result = await service.getUserPreferences(42);
      expect(result?.providerId).toBeNull();
    });

    it('should clear curated-out edge voice from user preferences', async () => {
      repo.findUserPreferences.mockResolvedValue({ providerId: null, voiceId: 'en-GB-SoniaNeural', speed: 1.25 });
      admin.getEdgeConfig.mockResolvedValue({ enabled: true, enabledVoices: ['en-US-JennyNeural'] });

      const result = await service.getUserPreferences(42);
      expect(result).toEqual({ providerId: null, voiceId: null, speed: 1.25 });
    });
  });

  describe('saveUserPreferences', () => {
    it('should call repo with correct shape', async () => {
      await service.saveUserPreferences(42, { providerId: EDGE_PROVIDER_ID, voiceId: 'jenny', speed: 1.5 });
      expect(repo.upsertUserPreferences).toHaveBeenCalledWith(42, {
        providerId: null,
        voiceId: 'jenny',
        speed: 1.5,
      });
    });

    it('should handle partial preferences update', async () => {
      await service.saveUserPreferences(42, { speed: 2.0 });
      expect(repo.upsertUserPreferences).toHaveBeenCalledWith(42, { speed: 2.0 });
    });

    it('should return mapped TtsUserPreferences with string providerId', async () => {
      repo.upsertUserPreferences.mockResolvedValue({ providerId: 3, voiceId: 'alloy', speed: 1.25 });
      const result = await service.saveUserPreferences(42, { providerId: '3', voiceId: 'alloy', speed: 1.25 });
      expect(result).toEqual({ providerId: '3', voiceId: 'alloy', speed: 1.25 });
    });
  });

  describe('TTS position', () => {
    it('should save position after verifying file access', async () => {
      await service.savePosition(42, 10, { cfi: 'epubcfi(/6/2!)', chapterIndex: 3 }, USER);
      expect(bookService.verifyFileAccess).toHaveBeenCalledWith(10, USER);
      expect(repo.upsertPosition).toHaveBeenCalledWith(42, 10, 'epubcfi(/6/2!)', 3);
    });

    it('should delete position after verifying file access', async () => {
      await service.deletePosition(42, 10, USER);
      expect(bookService.verifyFileAccess).toHaveBeenCalledWith(10, USER);
      expect(repo.deletePosition).toHaveBeenCalledWith(42, 10);
    });

    it('should get position after verifying file access', async () => {
      repo.findPosition.mockResolvedValue({ cfi: 'epubcfi(/6/2!)', chapterIndex: 3 });
      const result = await service.getPosition(42, 10, USER);
      expect(bookService.verifyFileAccess).toHaveBeenCalledWith(10, USER);
      expect(result).toEqual({ cfi: 'epubcfi(/6/2!)', chapterIndex: 3 });
    });
  });

  describe('getAvailableProviderInfos', () => {
    it('should include edge when enabled', async () => {
      admin.getEdgeConfig.mockResolvedValue({ enabled: true, enabledVoices: [] });
      repo.findEnabledProviders.mockResolvedValue([]);
      const infos = await service.getAvailableProviderInfos();
      expect(infos.some((i) => i.id === EDGE_PROVIDER_ID)).toBe(true);
    });

    it('should exclude edge when disabled', async () => {
      admin.getEdgeConfig.mockResolvedValue({ enabled: false, enabledVoices: [] });
      repo.findEnabledProviders.mockResolvedValue([]);
      const infos = await service.getAvailableProviderInfos();
      expect(infos.some((i) => i.id === EDGE_PROVIDER_ID)).toBe(false);
    });

    it('should include DB providers', async () => {
      admin.getEdgeConfig.mockResolvedValue({ enabled: false, enabledVoices: [] });
      repo.findEnabledProviders.mockResolvedValue([DB_PROVIDER]);
      const infos = await service.getAvailableProviderInfos();
      expect(infos.some((i) => i.id === '1')).toBe(true);
    });
  });

  describe('getChapterText', () => {
    it('should verify file access before extracting text', async () => {
      const result = await service.getChapterText(10, 0, USER);
      expect(bookService.verifyFileAccess).toHaveBeenCalledWith(10, USER);
      expect(textExtractor.extractChapterText).toHaveBeenCalledWith(10, 0);
      expect(result).toEqual(CHAPTER_TEXT);
    });

    it('should propagate ForbiddenException when user does not own the file', async () => {
      const { ForbiddenException } = await import('@nestjs/common');
      bookService.verifyFileAccess.mockRejectedValue(new ForbiddenException());
      await expect(service.getChapterText(10, 0, USER)).rejects.toThrow(ForbiddenException);
      expect(textExtractor.extractChapterText).not.toHaveBeenCalled();
    });

    it('should propagate NotFoundException from extractor when chapter not found', async () => {
      textExtractor.extractChapterText.mockRejectedValue(new NotFoundException('Chapter 99 not found'));
      await expect(service.getChapterText(10, 99, USER)).rejects.toThrow(NotFoundException);
    });
  });
});
