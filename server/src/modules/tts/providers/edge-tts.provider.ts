import { Injectable, Logger } from '@nestjs/common';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

import type { TtsVoice } from '@bookorbit/types';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import type { ITtsProvider } from './tts-provider.interface';

const PROVIDER_ID = 'edge';
const PROVIDER_NAME = 'Edge TTS';
const VOICE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class EdgeTtsProvider implements ITtsProvider {
  private readonly logger = new Logger(EdgeTtsProvider.name);
  private cachedVoices: TtsVoice[] | null = null;
  private cacheExpiresAt = 0;

  async synthesize(text: string, voiceId: string, speed: number): Promise<Buffer> {
    const event = 'tts.edge.synthesize';
    const startMs = Date.now();
    this.logger.log(`[${event}] [start] voiceId=${voiceId} speed=${speed} textLen=${text.length} - edge tts synthesis started`);
    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const ratePercent = Math.round((speed - 1) * 100);
      const rateStr = ratePercent >= 0 ? `+${ratePercent}%` : `${ratePercent}%`;
      const { audioStream } = tts.toStream(this.escapeXml(text), { rate: rateStr });
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
        audioStream.on('end', resolve);
        audioStream.on('error', reject);
      });
      const result = Buffer.concat(chunks);
      this.logger.log(`[${event}] [end] voiceId=${voiceId} durationMs=${Date.now() - startMs} bytes=${result.length} - edge tts synthesis completed`);
      return result;
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = err instanceof Error ? sanitizeLogValue(err.message) : 'unknown';
      this.logger.error(
        `[${event}] [fail] voiceId=${voiceId} durationMs=${Date.now() - startMs} errorClass=${errorClass} error="${error}" - edge tts synthesis failed`,
      );
      throw err;
    }
  }

  async listVoices(): Promise<TtsVoice[]> {
    if (this.cachedVoices && Date.now() < this.cacheExpiresAt) {
      return this.cachedVoices;
    }
    const event = 'tts.edge.list_voices';
    const startMs = Date.now();
    this.logger.log(`[${event}] [start] - fetching edge tts voice list`);
    try {
      const tts = new MsEdgeTTS();
      const rawVoices = await tts.getVoices();
      const voices: TtsVoice[] = rawVoices.map((v) => ({
        id: v.ShortName,
        name: v.FriendlyName,
        shortName: v.ShortName,
        language: v.Locale.split('-')[0] ?? v.Locale,
        locale: v.Locale,
        gender: v.Gender.toLowerCase() === 'female' ? 'Female' : 'Male',
        providerId: PROVIDER_ID,
        providerName: PROVIDER_NAME,
      }));
      this.cachedVoices = voices;
      this.cacheExpiresAt = Date.now() + VOICE_CACHE_TTL_MS;
      this.logger.log(`[${event}] [end] durationMs=${Date.now() - startMs} count=${voices.length} - edge tts voice list fetched`);
      return voices;
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = err instanceof Error ? sanitizeLogValue(err.message) : 'unknown';
      this.logger.error(
        `[${event}] [fail] durationMs=${Date.now() - startMs} errorClass=${errorClass} error="${error}" - edge tts voice list failed`,
      );
      throw err;
    }
  }

  async testConnection(): Promise<{ connected: boolean; error?: string }> {
    try {
      await this.listVoices();
      return { connected: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { connected: false, error: message };
    }
  }

  private escapeXml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
}
