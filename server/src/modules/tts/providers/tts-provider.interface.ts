import type { TtsVoice } from '@bookorbit/types';

export interface ITtsProvider {
  synthesize(text: string, voiceId: string, speed: number, format?: string): Promise<Buffer>;
  listVoices(): Promise<TtsVoice[]>;
  testConnection(): Promise<{ connected: boolean; error?: string }>;
}
