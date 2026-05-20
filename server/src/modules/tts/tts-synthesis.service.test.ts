import { TtsSynthesisService } from './tts-synthesis.service';
import type { ITtsProvider } from './providers/tts-provider.interface';

function makeProvider(): ITtsProvider {
  return {
    synthesize: vi.fn().mockResolvedValue(Buffer.from('audio-data')),
    listVoices: vi.fn().mockResolvedValue([]),
    testConnection: vi.fn().mockResolvedValue({ connected: true }),
  };
}

describe('TtsSynthesisService', () => {
  let service: TtsSynthesisService;
  let provider: ITtsProvider;

  beforeEach(() => {
    service = new TtsSynthesisService();
    provider = makeProvider();
  });

  describe('synthesize', () => {
    it('should call provider.synthesize and return audio buffer', async () => {
      const result = await service.synthesize(provider, 'edge', 'en-US-JennyNeural', 1.0, 'Hello world', 'mp3');
      expect(result).toBeInstanceOf(Buffer);
      expect(provider.synthesize).toHaveBeenCalledWith('Hello world', 'en-US-JennyNeural', 1.0, 'mp3');
    });

    it('should cache the result with provider+voice+speed+text as key', async () => {
      await service.synthesize(provider, 'edge', 'en-US-JennyNeural', 1.0, 'Hello', 'mp3');
      await service.synthesize(provider, 'edge', 'en-US-JennyNeural', 1.0, 'Hello', 'mp3');
      expect(provider.synthesize).toHaveBeenCalledTimes(1);
    });

    it('should not use cache for different text', async () => {
      await service.synthesize(provider, 'edge', 'en-US-JennyNeural', 1.0, 'Hello', 'mp3');
      await service.synthesize(provider, 'edge', 'en-US-JennyNeural', 1.0, 'World', 'mp3');
      expect(provider.synthesize).toHaveBeenCalledTimes(2);
    });

    it('should not use cache for different voice', async () => {
      await service.synthesize(provider, 'edge', 'en-US-JennyNeural', 1.0, 'Hello', 'mp3');
      await service.synthesize(provider, 'edge', 'en-US-AriaNeural', 1.0, 'Hello', 'mp3');
      expect(provider.synthesize).toHaveBeenCalledTimes(2);
    });

    it('should not use cache for different speed', async () => {
      await service.synthesize(provider, 'edge', 'en-US-JennyNeural', 1.0, 'Hello', 'mp3');
      await service.synthesize(provider, 'edge', 'en-US-JennyNeural', 1.5, 'Hello', 'mp3');
      expect(provider.synthesize).toHaveBeenCalledTimes(2);
    });

    it('should propagate provider errors', async () => {
      (provider.synthesize as vi.Mock).mockRejectedValue(new Error('synthesis failed'));
      await expect(service.synthesize(provider, 'edge', 'jenny', 1.0, 'text', 'mp3')).rejects.toThrow('synthesis failed');
    });
  });

  describe('previewVoice', () => {
    it('should synthesize a preview sentence', async () => {
      const result = await service.previewVoice(provider, 'edge', 'en-US-JennyNeural');
      expect(result).toBeInstanceOf(Buffer);
      expect(provider.synthesize).toHaveBeenCalledWith(expect.any(String), 'en-US-JennyNeural', 1.0, 'mp3');
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entry when cache is full', async () => {
      const smallService = new TtsSynthesisService(3);
      const p1 = makeProvider();
      const p2 = makeProvider();
      const p3 = makeProvider();
      const p4 = makeProvider();

      await smallService.synthesize(p1, 'edge', 'jenny', 1.0, 'text-1', 'mp3');
      await smallService.synthesize(p2, 'edge', 'jenny', 1.0, 'text-2', 'mp3');
      await smallService.synthesize(p3, 'edge', 'jenny', 1.0, 'text-3', 'mp3');
      expect(smallService.getCacheSize()).toBe(3);

      await smallService.synthesize(p4, 'edge', 'jenny', 1.0, 'text-4', 'mp3');
      expect(smallService.getCacheSize()).toBe(3);
    });

    it('should clear cache on clearCache()', async () => {
      await service.synthesize(provider, 'edge', 'jenny', 1.0, 'Hello', 'mp3');
      expect(service.getCacheSize()).toBe(1);
      service.clearCache();
      expect(service.getCacheSize()).toBe(0);
    });
  });
});
