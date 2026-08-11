import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common';

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
      let response: Response;
      try {
        response = await fetch(`${this.options.url}${path}`, {
          method: init.method,
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: controller.signal,
        });
      } catch (err) {
        const name = err instanceof Error ? err.name : undefined;
        if (name === 'AbortError') {
          throw new GatewayTimeoutException('Search server request timed out');
        }
        throw new BadGatewayException('Search server request failed');
      }

      if (!response.ok) {
        throw new BadGatewayException(`Search server returned ${response.status}`);
      }

      try {
        return (await response.json()) as T;
      } catch {
        throw new BadGatewayException('Search server returned an invalid response');
      }
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
        filterableAttributes: ['mediaType', 'source', 'language', 'format', 'publishedYear', 'libraryId', 'hasCover', 'tags', 'genres'],
        sortableAttributes: ['sortTitle', 'publishedYear', 'addedAt', 'durationSeconds'],
      },
    });
  }

  async createIndex(index: string): Promise<void> {
    await this.request('/indexes', {
      method: 'POST',
      body: { uid: index, primaryKey: 'id' },
    });
  }

  async deleteIndex(index: string): Promise<void> {
    await this.request(`/indexes/${index}`, { method: 'DELETE' });
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
      hits?: Array<{ id: string }>;
      estimatedTotalHits?: number;
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

    const hits = Array.isArray(body?.hits) ? body.hits : [];

    return {
      ids: hits.map((hit) => hit.id).filter((id): id is string => typeof id === 'string'),
      total: body?.estimatedTotalHits ?? 0,
    };
  }
}
