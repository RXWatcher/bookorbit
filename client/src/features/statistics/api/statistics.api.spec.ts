import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types'

import { fetchFormatDistribution } from './statistics.api'

describe('statistics api', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('serializes source-backed library filters as friendly query aliases', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }))
    globalThis.fetch = fetchMock as never

    await fetchFormatDistribution({
      libraryIds: [CLOUD_EBOOK_LIBRARY_ID, CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, 7],
      booksOverTimeGranularity: 'monthly',
      booksOverTimeRange: 'last-5-years',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/statistics/format-distribution?libraryIds=ebooks&libraryIds=audiobooks&libraryIds=comics&libraryIds=7',
      expect.any(Object),
    )
  })
})
