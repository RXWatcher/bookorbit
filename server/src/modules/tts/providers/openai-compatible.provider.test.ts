import { vi, describe, it, expect, beforeEach } from 'vitest';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';

function makeProvider(overrides: Partial<{ defaultModel: string | null; apiKey: string; baseUrl: string }> = {}) {
  return new OpenAiCompatibleProvider({
    providerId: '1',
    providerName: 'Test Provider',
    baseUrl: overrides.baseUrl ?? 'http://localhost:8880/v1',
    apiKey: overrides.apiKey ?? '',
    defaultModel: overrides.defaultModel,
  });
}

function mockFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
    text: () => Promise.resolve(typeof body === 'string' ? body : ''),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('OpenAiCompatibleProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('defaultModel', () => {
    it('uses tts-1 when defaultModel is not set', async () => {
      const provider = makeProvider();
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse(null));

      await provider.synthesize('hello', 'alloy', 1.0, 'mp3');

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.model).toBe('tts-1');
    });

    it('uses configured defaultModel in synthesis request', async () => {
      const provider = makeProvider({ defaultModel: 'kokoro' });
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse(null));

      await provider.synthesize('hello', 'af_sky', 1.0, 'mp3');

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.model).toBe('kokoro');
    });

    it('falls back to tts-1 when defaultModel is null', async () => {
      const provider = makeProvider({ defaultModel: null });
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse(null));

      await provider.synthesize('hello', 'alloy', 1.0, 'mp3');

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.model).toBe('tts-1');
    });
  });

  describe('synthesize', () => {
    it('clamps speed to 0.25 minimum', async () => {
      const provider = makeProvider();
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse(null));

      await provider.synthesize('hello', 'alloy', 0.1, 'mp3');

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.speed).toBe(0.25);
    });

    it('clamps speed to 4.0 maximum', async () => {
      const provider = makeProvider();
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse(null));

      await provider.synthesize('hello', 'alloy', 5.0, 'mp3');

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.speed).toBe(4.0);
    });

    it('includes Authorization header when apiKey is set', async () => {
      const provider = makeProvider({ apiKey: 'test-key' });
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse(null));

      await provider.synthesize('hello', 'alloy', 1.0, 'mp3');

      const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-key');
    });

    it('omits Authorization header when apiKey is empty', async () => {
      const provider = makeProvider({ apiKey: '' });
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse(null));

      await provider.synthesize('hello', 'alloy', 1.0, 'mp3');

      const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('throws when API returns non-ok response', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse('Internal Server Error', false, 500));

      await expect(provider.synthesize('hello', 'alloy', 1.0, 'mp3')).rejects.toThrow('TTS API error 500');
    });
  });

  describe('listVoices', () => {
    it('returns empty array when API returns 404', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse('', false, 404));

      const voices = await provider.listVoices();
      expect(voices).toEqual([]);
    });

    it('maps voices array response', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse([{ id: 'alloy', name: 'Alloy' }]));

      const voices = await provider.listVoices();
      expect(voices).toHaveLength(1);
      expect(voices[0]!.id).toBe('alloy');
      expect(voices[0]!.providerId).toBe('1');
    });

    it('maps nested voices object response', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse({ voices: [{ voice_id: 'af_sky', display_name: 'Sky' }] }));

      const voices = await provider.listVoices();
      expect(voices).toHaveLength(1);
      expect(voices[0]!.id).toBe('af_sky');
      expect(voices[0]!.name).toBe('Sky');
    });

    it('strips trailing slash from baseUrl', async () => {
      const provider = makeProvider({ baseUrl: 'http://localhost:8880/v1/' });
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse([]));

      await provider.listVoices();

      const url = fetchSpy.mock.calls[0]![0] as string;
      expect(url).toBe('http://localhost:8880/v1/audio/voices');
    });

    it('throws when API returns non-ok non-404 response', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse('Server error', false, 500));

      await expect(provider.listVoices()).rejects.toThrow('Voice list API error 500');
    });
  });

  describe('testConnection', () => {
    it('returns connected=true when /models succeeds', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockResolvedValue(mockFetchResponse({}));

      const result = await provider.testConnection();
      expect(result.connected).toBe(true);
    });

    it('returns connected=false when both /models and /audio/voices fail', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'));

      const result = await provider.testConnection();
      expect(result.connected).toBe(false);
      expect(result.error).toContain('network error');
    });

    it('returns connected=true when /models fails but /audio/voices succeeds', async () => {
      const provider = makeProvider();
      vi.spyOn(global, 'fetch')
        .mockResolvedValueOnce(mockFetchResponse('not found', false, 404))
        .mockResolvedValueOnce(mockFetchResponse([]));

      const result = await provider.testConnection();
      expect(result.connected).toBe(true);
    });
  });
});
