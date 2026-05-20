import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'crypto';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { ITtsProvider } from './providers/tts-provider.interface';

const DEFAULT_MAX_ENTRIES = 500;
const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
const PREVIEW_TEXT = 'Hello, this is a preview of the selected voice.';

export const TTS_SYNTHESIS_MAX_ENTRIES = Symbol('TTS_SYNTHESIS_MAX_ENTRIES');

@Injectable()
export class TtsSynthesisService {
  private readonly logger = new Logger(TtsSynthesisService.name);
  private readonly cache = new Map<string, Buffer>();
  private readonly maxEntries: number;

  constructor(@Optional() @Inject(TTS_SYNTHESIS_MAX_ENTRIES) maxEntries?: number) {
    this.maxEntries = maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  async synthesize(provider: ITtsProvider, providerId: string, voiceId: string, speed: number, text: string, format = 'mp3'): Promise<Buffer> {
    const event = 'tts.synthesis';
    const cacheKey = this.buildCacheKey(providerId, voiceId, speed, text, format);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.logger.debug(`[${event}] cache_hit providerId=${providerId} voiceId=${voiceId} - returning cached audio`);
      return cached;
    }

    const startMs = Date.now();
    this.logger.log(`[${event}] [start] providerId=${providerId} voiceId=${voiceId} speed=${speed} textLen=${text.length} - synthesis started`);
    try {
      const buffer = await provider.synthesize(text, voiceId, speed, format);
      this.logger.log(
        `[${event}] [end] providerId=${providerId} voiceId=${voiceId} durationMs=${Date.now() - startMs} bytes=${buffer.length} - synthesis completed`,
      );
      if (buffer.length <= MAX_ENTRY_BYTES) {
        this.addToCache(cacheKey, buffer);
      }
      return buffer;
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = err instanceof Error ? sanitizeLogValue(err.message) : 'unknown';
      this.logger.error(
        `[${event}] [fail] providerId=${providerId} voiceId=${voiceId} durationMs=${Date.now() - startMs} errorClass=${errorClass} error="${error}" - synthesis failed`,
      );
      throw err;
    }
  }

  async previewVoice(provider: ITtsProvider, providerId: string, voiceId: string): Promise<Buffer> {
    return this.synthesize(provider, providerId, voiceId, 1.0, PREVIEW_TEXT);
  }

  private buildCacheKey(providerId: string, voiceId: string, speed: number, text: string, format: string): string {
    return createHash('sha256').update(`${providerId}|${voiceId}|${speed}|${format}|${text}`).digest('hex');
  }

  private addToCache(key: string, buffer: Buffer): void {
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, buffer);
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
