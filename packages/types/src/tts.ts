// Admin provider configuration stored in app_settings

export interface TtsOpenAiProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TtsEdgeTtsConfig {
  enabled: boolean;
  /** Curated shortName list. Empty array means all voices are available. */
  enabledVoices: string[];
}

export interface TtsProviderConfiguration {
  edgeTts: TtsEdgeTtsConfig;
  providers: TtsOpenAiProvider[];
}

// Voice representation

export interface TtsVoice {
  id: string;
  name: string;
  shortName: string;
  language: string;
  locale: string;
  gender: string;
  providerId: string;
  providerName: string;
}

// User preferences

export interface TtsUserPreferences {
  providerId: string | null;
  voiceId: string | null;
  speed: number;
}

export interface TtsBookPreferences {
  providerId: string | null;
  voiceId: string | null;
  speed: number | null;
  bookId: number;
}

export interface TtsEffectivePreferences {
  providerId: string | null;
  voiceId: string | null;
  speed: number;
  isBookOverride: boolean;
}

// Playback state

export type TtsPlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

// Position persistence

export interface TtsPosition {
  cfi: string;
  chapterIndex: number | null;
}

// Synthesis

export interface TtsSynthesisRequest {
  text: string;
  voiceId: string;
  providerId: string;
  speed: number;
  format?: string;
}

// Provider status (for admin UI)

export interface TtsProviderStatus {
  id: string;
  name: string;
  connected: boolean;
  voiceCount: number;
  error?: string;
}

// Server-side chapter text extraction

export interface TtsChapterSentence {
  text: string;
  index: number;
}

export interface TtsChapterText {
  chapterIndex: number;
  sentences: TtsChapterSentence[];
}

// Provider info exposed to users (no secrets)

export interface TtsProviderInfo {
  id: string;
  name: string;
  type: 'edge' | 'openai-compatible';
}
