vi.mock('msedge-tts', () => {
  const MsEdgeTTS = vi.fn();
  return {
    MsEdgeTTS,
    OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'audio-24khz-48kbitrate-mono-mp3' },
  };
});

import { Readable } from 'stream';
import * as msedgeTts from 'msedge-tts';
import { EdgeTtsProvider } from './edge-tts.provider';

const MockMsEdgeTTS = msedgeTts.MsEdgeTTS as any;

function makeEdgeTtsInstance(opts: { audioData?: Buffer; voices?: unknown[]; streamError?: Error; metadataError?: Error }) {
  const audioStream = new Readable({ read() {} });
  const instance = {
    setMetadata: opts.metadataError ? vi.fn().mockRejectedValue(opts.metadataError) : vi.fn().mockResolvedValue(undefined),
    toStream: vi.fn().mockReturnValue({ audioStream }),
    getVoices: vi.fn().mockResolvedValue(
      opts.voices ?? [
        { ShortName: 'en-US-JennyNeural', FriendlyName: 'Jenny', Locale: 'en-US', Gender: 'Female' },
        { ShortName: 'en-GB-SoniaNeural', FriendlyName: 'Sonia', Locale: 'en-GB', Gender: 'Female' },
      ],
    ),
  };
  setTimeout(() => {
    if (opts.streamError) {
      audioStream.destroy(opts.streamError);
    } else {
      const data = opts.audioData ?? Buffer.from('audio-data');
      audioStream.push(data);
      audioStream.push(null);
    }
  }, 0);
  return instance;
}

describe('EdgeTtsProvider', () => {
  let provider: EdgeTtsProvider;

  beforeEach(() => {
    provider = new EdgeTtsProvider();
    vi.clearAllMocks();
  });

  describe('synthesize', () => {
    it('should synthesize text and return audio buffer', async () => {
      const audioData = Buffer.from('synthesized-audio');
      MockMsEdgeTTS.mockImplementation(function () {
        return makeEdgeTtsInstance({ audioData });
      } as any);

      const result = await provider.synthesize('Hello world', 'en-US-JennyNeural', 1.0);

      expect(result).toBeInstanceOf(Buffer);
      expect(result).toEqual(audioData);
    });

    it('should apply speed as rate percentage for fast speed', async () => {
      const instance = makeEdgeTtsInstance({});
      MockMsEdgeTTS.mockImplementation(function () {
        return instance;
      } as any);

      await provider.synthesize('text', 'en-US-JennyNeural', 1.5);

      expect(instance.toStream).toHaveBeenCalledWith(expect.any(String), { rate: '+50%' });
    });

    it('should apply speed as negative rate percentage for slow speed', async () => {
      const instance = makeEdgeTtsInstance({});
      MockMsEdgeTTS.mockImplementation(function () {
        return instance;
      } as any);

      await provider.synthesize('text', 'en-US-JennyNeural', 0.75);

      expect(instance.toStream).toHaveBeenCalledWith(expect.any(String), { rate: '-25%' });
    });

    it('should use +0% rate for speed 1.0', async () => {
      const instance = makeEdgeTtsInstance({});
      MockMsEdgeTTS.mockImplementation(function () {
        return instance;
      } as any);

      await provider.synthesize('text', 'en-US-JennyNeural', 1.0);

      expect(instance.toStream).toHaveBeenCalledWith(expect.any(String), { rate: '+0%' });
    });

    it('should escape XML special chars in text', async () => {
      const instance = makeEdgeTtsInstance({});
      MockMsEdgeTTS.mockImplementation(function () {
        return instance;
      } as any);

      await provider.synthesize('Hello & "world" <test>', 'en-US-JennyNeural', 1.0);

      expect(instance.toStream).toHaveBeenCalledWith(expect.stringContaining('&amp;'), expect.any(Object));
      expect(instance.toStream).toHaveBeenCalledWith(expect.stringContaining('&quot;'), expect.any(Object));
      expect(instance.toStream).toHaveBeenCalledWith(expect.stringContaining('&lt;'), expect.any(Object));
    });

    it('should throw if stream errors', async () => {
      MockMsEdgeTTS.mockImplementation(function () {
        return makeEdgeTtsInstance({ streamError: new Error('stream failed') });
      } as any);

      await expect(provider.synthesize('Hello', 'en-US-JennyNeural', 1.0)).rejects.toThrow('stream failed');
    });
  });

  describe('listVoices', () => {
    it('should return mapped TtsVoice array', async () => {
      const instance = makeEdgeTtsInstance({
        voices: [{ ShortName: 'en-US-JennyNeural', FriendlyName: 'Jenny (US)', Locale: 'en-US', Gender: 'Female' }],
      });
      MockMsEdgeTTS.mockImplementation(function () {
        return instance;
      } as any);

      const voices = await provider.listVoices();

      expect(voices).toHaveLength(1);
      expect(voices[0]).toMatchObject({
        id: 'en-US-JennyNeural',
        shortName: 'en-US-JennyNeural',
        name: 'Jenny (US)',
        locale: 'en-US',
        language: 'en',
        gender: 'Female',
        providerId: 'edge',
        providerName: 'Edge TTS',
      });
    });

    it('should cache voices for 24h', async () => {
      const instance = makeEdgeTtsInstance({});
      MockMsEdgeTTS.mockImplementation(function () {
        return instance;
      } as any);

      await provider.listVoices();
      await provider.listVoices();

      expect(instance.getVoices).toHaveBeenCalledTimes(1);
    });

    it('should re-fetch voices after cache expires', async () => {
      const instance = makeEdgeTtsInstance({});
      MockMsEdgeTTS.mockImplementation(function () {
        return instance;
      } as any);

      await provider.listVoices();
      // expire cache by manipulating internal state
      (provider as any).cacheExpiresAt = Date.now() - 1;
      await provider.listVoices();

      expect(instance.getVoices).toHaveBeenCalledTimes(2);
    });
  });

  describe('testConnection', () => {
    it('should return connected=true if voices fetched', async () => {
      MockMsEdgeTTS.mockImplementation(function () {
        return makeEdgeTtsInstance({});
      } as any);

      const result = await provider.testConnection();

      expect(result.connected).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return connected=false if listing fails', async () => {
      const instance = makeEdgeTtsInstance({});
      instance.getVoices.mockRejectedValue(new Error('network error'));
      MockMsEdgeTTS.mockImplementation(function () {
        return instance;
      } as any);
      (provider as any).cachedVoices = null;
      (provider as any).cacheExpiresAt = 0;

      const result = await provider.testConnection();

      expect(result.connected).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
