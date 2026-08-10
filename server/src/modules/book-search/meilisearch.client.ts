import { BadGatewayException } from '@nestjs/common';

import type { BookSearchDocument } from './book-search.types';

interface MeilisearchClientOptions {
  url: string;
  apiKey: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

export class MeilisearchClient {
  constructor(private readonly options: MeilisearchClientOptions) {}

  private async request<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.options.url}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new BadGatewayException(`Search server returned ${response.status}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<boolean> {
    try {
      await this.request<{ status: string }>('/health', { method: 'GET' });
      return true;
    } catch {
      return false;
    }
  }

  /** Attribute order is the ranking lever: a title match outranks a publisher match. */
  async applySettings(index: string): Promise<void> {
    await this.request(`/indexes/${index}/settings`, {
      method: 'PATCH',
      body: {
        searchableAttributes: ['title', 'sortTitle', 'authors', 'series', 'narrators', 'publisher', 'tags', 'genres', 'identifiers'],
        filterableAttributes: ['mediaType', 'source', 'language', 'format', 'publishedYear', 'libraryId', 'hasCover'],
        sortableAttributes: ['sortTitle', 'publishedYear', 'addedAt', 'durationSeconds'],
      },
    });
  }

  async addDocuments(index: string, documents: BookSearchDocument[]): Promise<void> {
    await this.request(`/indexes/${index}/documents`, {
      method: 'PUT',
      body: documents,
    });
  }

  async deleteDocuments(index: string, ids: string[]): Promise<void> {
    await this.request(`/indexes/${index}/documents/delete-batch`, {
      method: 'POST',
      body: ids,
    });
  }

  async search(index: string, params: { q: string; offset: number; limit: number; filter?: string[] }): Promise<{ ids: string[]; total: number }> {
    const body = await this.request<{
      hits: Array<{ id: string }>;
      estimatedTotalHits: number;
    }>(`/indexes/${index}/search`, {
      method: 'POST',
      body: {
        q: params.q,
        offset: params.offset,
        limit: params.limit,
        filter: params.filter,
        attributesToRetrieve: ['id'],
      },
    });

    return {
      ids: body.hits.map((hit) => hit.id),
      total: body.estimatedTotalHits ?? 0,
    };
  }
}
