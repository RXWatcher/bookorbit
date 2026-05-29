import { Injectable, Logger } from '@nestjs/common';

import type { TtsVoice } from '@bookorbit/types';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import type { ITtsProvider } from './tts-provider.interface';

interface OpenAiVoiceRaw {
  voice_id?: string;
  id?: string;
  name?: string;
  display_name?: string;
}

interface OpenAiSpeechRequest {
  model: string;
  input: string;
  voice: string;
  speed: number;
  response_format: string;
}

export interface StaticVoiceConfig {
  id: string;
  name: string;
  shortName: string;
  language: string;
  locale: string;
  gender: string;
}

export interface OpenAiCompatibleConfig {
  providerId: string;
  providerName: string;
  baseUrl: string;
  apiKey: string;
  defaultModel?: string | null;
  staticVoices?: StaticVoiceConfig[] | null;
}

@Injectable()
export class OpenAiCompatibleProvider implements ITtsProvider {
  private readonly logger = new Logger(OpenAiCompatibleProvider.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly providerId: string;
  private readonly providerName: string;
  private readonly defaultModel: string;
  private readonly staticVoices: StaticVoiceConfig[] | null;

  constructor(config: OpenAiCompatibleConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.providerId = config.providerId;
    this.providerName = config.providerName;
    this.defaultModel = config.defaultModel || 'tts-1';
    this.staticVoices = config.staticVoices ?? null;
  }

  async synthesize(text: string, voiceId: string, speed: number, format: string): Promise<Buffer> {
    const event = 'tts.openai.synthesize';
    const startMs = Date.now();
    this.logger.log(
      `[${event}] [start] providerId=${this.providerId} voiceId=${voiceId} speed=${speed} textLen=${text.length} - openai-compatible tts synthesis started`,
    );
    try {
      const body: OpenAiSpeechRequest = {
        model: this.defaultModel,
        input: text,
        voice: voiceId,
        speed: Math.min(4.0, Math.max(0.25, speed)),
        response_format: format === 'mp3' ? 'mp3' : format,
      };
      const response = await fetch(`${this.baseUrl}/audio/speech`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`TTS API error ${response.status}: ${errText.slice(0, 200)}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const result = Buffer.from(arrayBuffer);
      this.logger.log(
        `[${event}] [end] providerId=${this.providerId} voiceId=${voiceId} durationMs=${Date.now() - startMs} bytes=${result.length} - openai-compatible synthesis completed`,
      );
      return result;
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = err instanceof Error ? sanitizeLogValue(err.message) : 'unknown';
      this.logger.error(
        `[${event}] [fail] providerId=${this.providerId} voiceId=${voiceId} durationMs=${Date.now() - startMs} errorClass=${errorClass} error="${error}" - openai-compatible synthesis failed`,
      );
      throw err;
    }
  }

  async listVoices(): Promise<TtsVoice[]> {
    const event = 'tts.openai.list_voices';
    const startMs = Date.now();
    this.logger.log(`[${event}] [start] providerId=${this.providerId} - listing voices`);
    try {
      const response = await fetch(`${this.baseUrl}/audio/voices`, {
        headers: this.buildHeaders(),
      });
      if (!response.ok) {
        if (response.status === 404) {
          if (this.staticVoices && this.staticVoices.length > 0) {
            const voices = this.mapStaticVoices();
            this.logger.log(
              `[${event}] [end] providerId=${this.providerId} durationMs=${Date.now() - startMs} count=${voices.length} source=static - using configured static voices`,
            );
            return voices;
          }
          this.logger.warn(`[${event}] provider ${this.providerId} does not expose /audio/voices - returning empty list`);
          return [];
        }
        const errText = await response.text().catch(() => '');
        throw new Error(`Voice list API error ${response.status}: ${errText.slice(0, 200)}`);
      }
      const data = (await response.json()) as { voices?: OpenAiVoiceRaw[] } | OpenAiVoiceRaw[];
      const rawVoices = Array.isArray(data) ? data : ((data as { voices?: OpenAiVoiceRaw[] }).voices ?? []);
      const voices: TtsVoice[] = rawVoices.map((v) => {
        const id = v.voice_id ?? v.id ?? '';
        return {
          id,
          name: v.display_name ?? v.name ?? id,
          shortName: id,
          language: '',
          locale: '',
          gender: 'Unknown',
          providerId: this.providerId,
          providerName: this.providerName,
        };
      });
      this.logger.log(`[${event}] [end] providerId=${this.providerId} durationMs=${Date.now() - startMs} count=${voices.length} - voices listed`);
      return voices;
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = err instanceof Error ? sanitizeLogValue(err.message) : 'unknown';
      if (this.staticVoices && this.staticVoices.length > 0) {
        this.logger.warn(
          `[${event}] providerId=${this.providerId} durationMs=${Date.now() - startMs} errorClass=${errorClass} error="${error}" - voice list fetch failed, using static voices`,
        );
        return this.mapStaticVoices();
      }
      this.logger.error(
        `[${event}] [fail] providerId=${this.providerId} durationMs=${Date.now() - startMs} errorClass=${errorClass} error="${error}" - voice list failed`,
      );
      throw err;
    }
  }

  async testConnection(): Promise<{ connected: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.buildHeaders(),
      });
      if (!response.ok) {
        await this.listVoices();
      }
      return { connected: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { connected: false, error: message };
    }
  }

  async discoverVoicesLive(): Promise<TtsVoice[] | null> {
    const response = await fetch(`${this.baseUrl}/audio/voices`, {
      headers: this.buildHeaders(),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Voice discovery API error ${response.status}: ${errText.slice(0, 200)}`);
    }
    const data = (await response.json()) as { voices?: OpenAiVoiceRaw[] } | OpenAiVoiceRaw[];
    const rawVoices = Array.isArray(data) ? data : ((data as { voices?: OpenAiVoiceRaw[] }).voices ?? []);
    return rawVoices.map((v) => {
      const id = v.voice_id ?? v.id ?? '';
      return {
        id,
        name: v.display_name ?? v.name ?? id,
        shortName: id,
        language: '',
        locale: '',
        gender: 'Unknown',
        providerId: this.providerId,
        providerName: this.providerName,
      };
    });
  }

  private mapStaticVoices(): TtsVoice[] {
    return (this.staticVoices ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      shortName: v.shortName,
      language: v.language,
      locale: v.locale,
      gender: v.gender,
      providerId: this.providerId,
      providerName: this.providerName,
    }));
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }
}
