import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common';

import type { BookSearchDocument } from './book-search.types';

interface MeilisearchClientOptions {
  url: string;
  apiKey: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_TASK_TIMEOUT_MS = 60_000;
const TASK_POLL_INTERVAL_MS = 500;

/** The catalogue is over 400,000 rows and Meilisearch answers 1000 by default, which would
 *  leave every page past hit 1000 blank while the reported total claimed hundreds of
 *  thousands. Matched to MAX_BOOK_QUERY_OFFSET_ROWS, the app's own pagination ceiling. */
const MAX_TOTAL_HITS = 1_000_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
        pagination: { maxTotalHits: MAX_TOTAL_HITS },
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

  /** Writes are asynchronous: Meilisearch answers 202 with a task id and applies the change
   *  later, so the returned id is what a caller needs to confirm the write actually landed. */
  async addDocuments(index: string, documents: BookSearchDocument[]): Promise<number | null> {
    const body = await this.request<{ taskUid?: number }>(`/indexes/${index}/documents`, {
      method: 'PUT',
      body: documents,
    });
    return typeof body?.taskUid === 'number' ? body.taskUid : null;
  }

  async deleteDocuments(index: string, ids: string[]): Promise<number | null> {
    const body = await this.request<{ taskUid?: number }>(`/indexes/${index}/documents/delete-batch`, {
      method: 'POST',
      body: ids,
    });
    return typeof body?.taskUid === 'number' ? body.taskUid : null;
  }

  /** Resolves only when the task succeeded. A failed, cancelled or still running task raises,
   *  so a caller can keep its outbox events and retry rather than record a phantom write. */
  async waitForTask(taskUid: number, timeoutMs: number = DEFAULT_TASK_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const task = await this.request<{ status?: string }>(`/tasks/${taskUid}`, { method: 'GET' });

      if (task?.status === 'succeeded') return;
      if (task?.status === 'failed' || task?.status === 'canceled') {
        throw new BadGatewayException(`Search server task ${taskUid} ${task.status}`);
      }
      if (Date.now() >= deadline) {
        throw new GatewayTimeoutException(`Search server task ${taskUid} did not finish in time`);
      }

      await sleep(TASK_POLL_INTERVAL_MS);
    }
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
