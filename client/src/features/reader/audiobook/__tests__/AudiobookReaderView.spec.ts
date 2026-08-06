import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WarehouseAudiobookDetail, WarehouseUserCatalogState } from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(),
  fetchCatalogSourceAudiobook: vi.fn<(remoteId: string) => Promise<WarehouseAudiobookDetail | null>>(),
  fetchCatalogSourceBookmarks: vi.fn<() => Promise<[]>>(),
  fetchCatalogSourceUserState: vi.fn<() => Promise<WarehouseUserCatalogState>>(),
  patchCatalogSourceUserState: vi.fn<() => Promise<WarehouseUserCatalogState>>(),
  saveCatalogSourceReadingSession: vi.fn<() => Promise<void>>(),
  createCatalogSourceBookmark: vi.fn<() => Promise<never>>(),
  deleteCatalogSourceBookmark: vi.fn<() => Promise<void>>(),
  readingSessionOptions: null as null | { saveSession?: (payload: never, options: { useBeacon: boolean }) => Promise<void> | void },
  useAudioQueue: vi.fn<(files: unknown[]) => unknown>(),
  queueGoToFile: vi.fn<(fileId: number | string, positionSeconds?: number) => void>(),
  audioProgressOptions: null as null | {
    loadProgress?: () => Promise<{ currentFileId: number | string | null; positionSeconds: number } | null>
    saveProgress?: (payload: { percentage: number; currentFileId: number | string; positionSeconds: number }) => Promise<void> | void
  },
  queueFiles: [] as unknown[],
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {}, params: {} }),
  useRouter: () => ({ back: vi.fn<() => void>(), replace: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }),
}))

vi.mock('@/lib/api', () => ({
  api: mocks.api,
}))

vi.mock('@/features/book/components/BookCoverPlaceholder.vue', () => ({
  default: defineComponent({
    name: 'BookCoverPlaceholder',
    template: '<div data-testid="cover-placeholder" />',
  }),
}))

vi.mock('@/features/warehouse/api/catalog-source.api', () => ({
  catalogSourceAudiobookCoverUrl: (remoteId: string) => `/api/v1/catalog/audiobooks/${encodeURIComponent(remoteId)}/cover`,
  catalogSourceAudiobookStreamUrl: (remoteId: string) => `/api/v1/libraries/audiobooks/items/${encodeURIComponent(remoteId)}/stream`,
  createCatalogSourceBookmark: mocks.createCatalogSourceBookmark,
  deleteCatalogSourceBookmark: mocks.deleteCatalogSourceBookmark,
  fetchCatalogSourceAudiobook: mocks.fetchCatalogSourceAudiobook,
  fetchCatalogSourceBookmarks: mocks.fetchCatalogSourceBookmarks,
  fetchCatalogSourceUserState: mocks.fetchCatalogSourceUserState,
  patchCatalogSourceUserState: mocks.patchCatalogSourceUserState,
  saveCatalogSourceReadingSession: mocks.saveCatalogSourceReadingSession,
}))

vi.mock('../composables/useAudioQueue', () => ({
  useAudioQueue: mocks.useAudioQueue,
}))

vi.mock('../composables/useAudioProgress', () => ({
  useAudioProgress: (_bookId: number, options: NonNullable<typeof mocks.audioProgressOptions> = {}) => {
    mocks.audioProgressOptions = options
    const resumeFileId = ref<number | string | null>(null)
    const resumePosition = ref(0)
    const loaded = ref(false)
    return {
      resumeFileId,
      resumePosition,
      loaded,
      load: vi.fn<() => Promise<void>>().mockImplementation(async () => {
        const data = await options.loadProgress?.()
        resumeFileId.value = data?.currentFileId ?? null
        resumePosition.value = data?.positionSeconds ?? 0
        loaded.value = true
      }),
      update: vi.fn<(currentFileId: number | string, positionSeconds: number, percentage: number) => Promise<void> | void>(
        (currentFileId: number | string, positionSeconds: number, percentage: number) =>
          options.saveProgress?.({ currentFileId, positionSeconds, percentage }),
      ),
      flush: vi.fn<() => void>(),
    }
  },
}))

vi.mock('../composables/useAudioBookmarks', () => ({
  useAudioBookmarks: () => ({
    bookmarks: ref([]),
    load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    add: vi.fn<() => Promise<null>>().mockResolvedValue(null),
    remove: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }),
}))

vi.mock('../composables/useAudioSettings', () => ({
  useAudioSettings: () => ({
    playbackSpeed: ref(1),
    volume: ref(1),
    skipBackSeconds: ref(30),
    skipForwardSeconds: ref(30),
    init: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    setPlaybackSpeed: vi.fn<(speed: number) => void>(),
    setVolume: vi.fn<(volume: number) => void>(),
  }),
}))

vi.mock('../../shared/composables/useReadingSession', () => ({
  useReadingSession: (_fileId: number, _getProgress: () => unknown, options: NonNullable<typeof mocks.readingSessionOptions> = {}) => {
    mocks.readingSessionOptions = options
    return {
      onActivity: vi.fn<() => void>(),
      elapsedMinutes: ref(0),
    }
  },
}))

function makeAudiobook(): WarehouseAudiobookDetail {
  return {
    id: 42,
    remoteId: 'audio 7',
    title: 'Signal Fires',
    subtitle: null,
    authors: ['Rae Poe'],
    narrators: ['Mira Vale'],
    series: null,
    language: 'en',
    publisher: 'Orbit Audio',
    identifiers: {},
    format: 'mp3',
    durationSeconds: 5400,
    hasCover: true,
    syncedAt: '2026-06-01T12:00:00.000Z',
    source: 'catalog-source',
    chapters: [{ title: 'Opening', startSeconds: 0, endSeconds: 600, durationSeconds: 600 }],
    files: [],
  }
}

describe('AudiobookReaderView catalog source', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queueFiles = []
    mocks.queueGoToFile = vi.fn<(fileId: number | string, positionSeconds?: number) => void>()
    mocks.audioProgressOptions = null
    mocks.readingSessionOptions = null
    mocks.fetchCatalogSourceAudiobook.mockResolvedValue(makeAudiobook())
    mocks.fetchCatalogSourceBookmarks.mockResolvedValue([])
    mocks.saveCatalogSourceReadingSession.mockResolvedValue(undefined)
    mocks.fetchCatalogSourceUserState.mockResolvedValue({
      mediaType: 'audiobook',
      remoteId: 'audio 7',
      inLibrary: true,
      favorite: false,
      rating: null,
      readStatus: 'reading',
      progressPercent: 25,
      positionSeconds: 135,
      finishedAt: null,
      updatedAt: '2026-06-03T12:00:00.000Z',
    })
    mocks.patchCatalogSourceUserState.mockResolvedValue({
      mediaType: 'audiobook',
      remoteId: 'audio 7',
      inLibrary: true,
      favorite: false,
      rating: null,
      readStatus: 'reading',
      progressPercent: 25,
      positionSeconds: 135,
      finishedAt: null,
      updatedAt: '2026-06-03T12:00:00.000Z',
    })
    mocks.useAudioQueue.mockImplementation((files: unknown[]) => {
      mocks.queueFiles = files
      return {
        currentIndex: ref(0),
        isPlaying: ref(false),
        loadError: ref(null),
        goToFile: mocks.queueGoToFile,
        setSpeed: vi.fn<(rate: number) => void>(),
        setVolume: vi.fn<(volume: number) => void>(),
        position: () => 0,
        destroy: vi.fn<() => void>(),
        play: vi.fn<() => void>(),
        pause: vi.fn<() => void>(),
        seek: vi.fn<(seconds: number) => void>(),
        activateIndex: vi.fn<(index: number, positionSeconds?: number) => void>(),
        prevFile: vi.fn<() => void>(),
        nextFile: vi.fn<() => void>(),
      }
    })
  })

  it('loads catalog audiobooks through the warehouse stream instead of the local book API', async () => {
    const { default: AudiobookReaderView } = await import('../AudiobookReaderView.vue')

    mount(AudiobookReaderView, {
      props: {
        bookId: 0,
        fileId: 0,
        catalogMediaType: 'audiobook',
        catalogRemoteId: 'audio 7',
        catalogFormat: 'mp3',
      },
    })

    await flushPromises()

    expect(mocks.fetchCatalogSourceAudiobook).toHaveBeenCalledWith('audio 7')
    expect(mocks.api).not.toHaveBeenCalledWith('/api/v1/books/0')
    expect(mocks.queueFiles).toEqual([
      {
        id: 'audio 7',
        format: 'mp3',
        durationSeconds: 5400,
        src: '/api/v1/libraries/audiobooks/items/audio%207/stream',
      },
    ])
  }, 10000)

  it('renders catalog audiobook cover art from the warehouse cover endpoint', async () => {
    const { default: AudiobookReaderView } = await import('../AudiobookReaderView.vue')

    const wrapper = mount(AudiobookReaderView, {
      props: {
        bookId: 0,
        fileId: 0,
        catalogMediaType: 'audiobook',
        catalogRemoteId: 'audio 7',
        catalogFormat: 'mp3',
      },
    })

    await flushPromises()

    expect(wrapper.get('img[alt="Signal Fires"]').attributes('src')).toBe('/api/v1/catalog/audiobooks/audio%207/cover')
    expect(wrapper.html()).not.toContain('/api/v1/books/0/cover')
  })

  it('uses catalog user state for audiobook reader progress', async () => {
    const { default: AudiobookReaderView } = await import('../AudiobookReaderView.vue')

    mount(AudiobookReaderView, {
      props: {
        bookId: 0,
        fileId: 0,
        catalogMediaType: 'audiobook',
        catalogRemoteId: 'audio 7',
        catalogFormat: 'mp3',
      },
    })

    await flushPromises()

    expect(mocks.fetchCatalogSourceUserState).toHaveBeenCalledWith('audiobook', 'audio 7')

    await mocks.audioProgressOptions?.saveProgress?.({
      currentFileId: 'audio 7',
      positionSeconds: 135,
      percentage: 25,
    })

    expect(mocks.patchCatalogSourceUserState).toHaveBeenCalledWith('audiobook', 'audio 7', {
      progressPercent: 25,
      positionSeconds: 135,
    })
  })

  it('records catalog audiobook reading sessions through the warehouse session endpoint', async () => {
    const { default: AudiobookReaderView } = await import('../AudiobookReaderView.vue')
    const payload = {
      sessionId: 'session-1',
      startedAt: '2026-06-15T12:00:00.000Z',
      endedAt: '2026-06-15T12:05:00.000Z',
      durationSeconds: 300,
      progressDelta: 4,
      endProgress: 29,
    }

    mount(AudiobookReaderView, {
      props: {
        bookId: 0,
        fileId: 0,
        catalogMediaType: 'audiobook',
        catalogRemoteId: 'audio 7',
        catalogFormat: 'mp3',
      },
    })

    await flushPromises()
    await mocks.readingSessionOptions?.saveSession?.(payload as never, { useBeacon: true })

    expect(mocks.saveCatalogSourceReadingSession).toHaveBeenCalledWith('audiobook', 'audio 7', payload, { useBeacon: true })
    expect(mocks.patchCatalogSourceUserState).toHaveBeenCalledWith('audiobook', 'audio 7', {
      progressPercent: 29,
    })
  })

  it('does not overwrite explicit catalog audiobook read status while saving progress', async () => {
    mocks.fetchCatalogSourceUserState.mockResolvedValue({
      mediaType: 'audiobook',
      remoteId: 'audio 7',
      inLibrary: true,
      favorite: false,
      rating: null,
      readStatus: 'read',
      progressPercent: 100,
      positionSeconds: 5400,
      finishedAt: null,
      updatedAt: '2026-06-03T12:00:00.000Z',
    })
    const { default: AudiobookReaderView } = await import('../AudiobookReaderView.vue')

    mount(AudiobookReaderView, {
      props: {
        bookId: 0,
        fileId: 0,
        catalogMediaType: 'audiobook',
        catalogRemoteId: 'audio 7',
        catalogFormat: 'mp3',
      },
    })

    await flushPromises()

    await mocks.audioProgressOptions?.saveProgress?.({
      currentFileId: 'audio 7',
      positionSeconds: 135,
      percentage: 25,
    })

    expect(mocks.patchCatalogSourceUserState).toHaveBeenCalledWith('audiobook', 'audio 7', {
      progressPercent: 25,
      positionSeconds: 135,
    })
  })

  it('does not overwrite explicit catalog audiobook read status at completion', async () => {
    mocks.fetchCatalogSourceUserState.mockResolvedValue({
      mediaType: 'audiobook',
      remoteId: 'audio 7',
      inLibrary: true,
      favorite: false,
      rating: null,
      readStatus: 'abandoned',
      progressPercent: 98,
      positionSeconds: 5292,
      finishedAt: null,
      updatedAt: '2026-06-03T12:00:00.000Z',
    })
    const { default: AudiobookReaderView } = await import('../AudiobookReaderView.vue')

    mount(AudiobookReaderView, {
      props: {
        bookId: 0,
        fileId: 0,
        catalogMediaType: 'audiobook',
        catalogRemoteId: 'audio 7',
        catalogFormat: 'mp3',
      },
    })

    await flushPromises()

    await mocks.audioProgressOptions?.saveProgress?.({
      currentFileId: 'audio 7',
      positionSeconds: 5400,
      percentage: 99,
    })

    expect(mocks.patchCatalogSourceUserState).toHaveBeenCalledWith('audiobook', 'audio 7', {
      progressPercent: 99,
      positionSeconds: 5400,
    })
  })

  it('clamps stale catalog audiobook resume positions to the known duration', async () => {
    mocks.fetchCatalogSourceUserState.mockResolvedValue({
      mediaType: 'audiobook',
      remoteId: 'audio 7',
      inLibrary: true,
      favorite: false,
      rating: null,
      readStatus: 'reading',
      progressPercent: 100,
      positionSeconds: 9999,
      finishedAt: null,
      updatedAt: '2026-06-03T12:00:00.000Z',
    })
    const { default: AudiobookReaderView } = await import('../AudiobookReaderView.vue')

    mount(AudiobookReaderView, {
      props: {
        bookId: 0,
        fileId: 0,
        catalogMediaType: 'audiobook',
        catalogRemoteId: 'audio 7',
        catalogFormat: 'mp3',
      },
    })

    await flushPromises()

    expect(mocks.queueGoToFile).toHaveBeenCalledWith('audio 7', 5399)
  })
})
