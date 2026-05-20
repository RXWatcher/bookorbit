import { Injectable } from '@nestjs/common';

import type { TtsProvider } from '../../../db/schema';
import { EdgeTtsProvider } from './edge-tts.provider';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';
import type { ITtsProvider } from './tts-provider.interface';

const EDGE_PROVIDER_ID = 'edge';

@Injectable()
export class TtsProviderFactory {
  private readonly openAiCache = new Map<number, OpenAiCompatibleProvider>();

  constructor(private readonly edgeProvider: EdgeTtsProvider) {}

  getEdgeProvider(): ITtsProvider {
    return this.edgeProvider;
  }

  getOpenAiProvider(dbProvider: TtsProvider): ITtsProvider {
    const cached = this.openAiCache.get(dbProvider.id);
    if (cached) return cached;
    const provider = new OpenAiCompatibleProvider({
      providerId: String(dbProvider.id),
      providerName: dbProvider.name,
      baseUrl: dbProvider.baseUrl ?? '',
      apiKey: dbProvider.apiKey ?? '',
      defaultModel: dbProvider.defaultModel,
    });
    this.openAiCache.set(dbProvider.id, provider);
    return provider;
  }

  invalidateCache(providerId: number): void {
    this.openAiCache.delete(providerId);
  }

  isEdgeId(providerId: string): boolean {
    return providerId === EDGE_PROVIDER_ID;
  }
}

export { EDGE_PROVIDER_ID };
