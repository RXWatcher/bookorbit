import { flushPromises, mount } from '@vue/test-utils'
import type {
  WarehouseCatalogSyncState,
  WarehouseCatalogSyncSummary,
  WarehouseCacheClearResult,
  WarehouseCacheStatus,
  UpsertWarehouseAdminSettingsPayload,
  WarehouseAdminSettings as WarehouseAdminSettingsValue,
  WarehouseConnectionTestResult,
} from '@bookorbit/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WarehouseAdminSettings from '../WarehouseAdminSettings.vue'

const mockState = vi.hoisted(() => ({
  fetchWarehouseAdminSettings: vi.fn<() => Promise<WarehouseAdminSettingsValue>>(),
  fetchWarehouseCatalogSyncState: vi.fn<() => Promise<WarehouseCatalogSyncState>>(),
  fetchWarehouseCacheStatus: vi.fn<() => Promise<WarehouseCacheStatus>>(),
  clearWarehouseCache: vi.fn<() => Promise<WarehouseCacheClearResult>>(),
  syncWarehouseAll: vi.fn<() => Promise<WarehouseCatalogSyncSummary[]>>(),
  syncWarehouseEbooks: vi.fn<() => Promise<WarehouseCatalogSyncSummary>>(),
  syncWarehouseAudiobooks: vi.fn<() => Promise<WarehouseCatalogSyncSummary>>(),
  syncWarehouseComics: vi.fn<() => Promise<WarehouseCatalogSyncSummary>>(),
  updateWarehouseAdminSettings: vi.fn<(payload: UpsertWarehouseAdminSettingsPayload) => Promise<WarehouseAdminSettingsValue>>(),
  testWarehouseConnection: vi.fn<() => Promise<WarehouseConnectionTestResult>>(),
  refreshLibraries: vi.fn<() => Promise<void>>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}))

vi.mock('../../api/warehouse-admin.api', () => ({
  fetchWarehouseAdminSettings: mockState.fetchWarehouseAdminSettings,
  fetchWarehouseCatalogSyncState: mockState.fetchWarehouseCatalogSyncState,
  fetchWarehouseCacheStatus: mockState.fetchWarehouseCacheStatus,
  clearWarehouseCache: mockState.clearWarehouseCache,
  syncWarehouseAll: mockState.syncWarehouseAll,
  syncWarehouseEbooks: mockState.syncWarehouseEbooks,
  syncWarehouseAudiobooks: mockState.syncWarehouseAudiobooks,
  syncWarehouseComics: mockState.syncWarehouseComics,
  updateWarehouseAdminSettings: mockState.updateWarehouseAdminSettings,
  testWarehouseConnection: mockState.testWarehouseConnection,
}))

vi.mock('vue-sonner', () => ({
  toast: {
    success: mockState.toastSuccess,
    error: mockState.toastError,
  },
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    refreshLibraries: mockState.refreshLibraries,
  }),
}))

vi.mock('@/components/IconPicker.vue', () => ({
  default: {
    props: ['modelValue', 'placeholder'],
    emits: ['update:modelValue'],
    template:
      '<input class="icon-picker-stub" :value="modelValue" :placeholder="placeholder" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
}))

function makeSettings(overrides: Partial<WarehouseAdminSettingsValue> = {}): WarehouseAdminSettingsValue {
  return {
    enabled: false,
    baseUrl: '',
    apiKeyConfigured: false,
    apiKeyPreview: null,
    syncCadenceMinutes: 360,
    sourceBackedLibraryIcons: {
      ebook: 'BookOpen',
      audiobook: 'Headphones',
      comic: 'PanelsTopLeft',
    },
    lastConnectionStatus: 'untested',
    lastConnectionCheckedAt: null,
    lastConnectionError: null,
    ...overrides,
  }
}

function makeSyncSummary(overrides: Partial<WarehouseCatalogSyncSummary> = {}): WarehouseCatalogSyncSummary {
  return {
    runId: 17,
    status: 'completed',
    mediaType: 'ebook',
    fetchedCount: 42,
    savedCount: 40,
    totalCount: null,
    errorMessage: null,
    startedAt: '2026-06-02T11:00:00.000Z',
    finishedAt: '2026-06-02T11:03:00.000Z',
    ...overrides,
  }
}

function makeSyncState(overrides: Partial<WarehouseCatalogSyncState> = {}): WarehouseCatalogSyncState {
  const ebook = makeSyncSummary()
  const lastRun = overrides.lastRun === undefined ? ebook : overrides.lastRun
  const lastRuns = overrides.lastRuns ?? {
    ebook: lastRun?.mediaType === 'ebook' ? lastRun : null,
    audiobook: lastRun?.mediaType === 'audiobook' ? lastRun : null,
    comic: lastRun?.mediaType === 'comic' ? lastRun : null,
  }

  return {
    lastRun,
    lastRuns,
    running: false,
    ...overrides,
  }
}

function makeCacheStatus(overrides: Partial<WarehouseCacheStatus> = {}): WarehouseCacheStatus {
  return {
    covers: {
      totalEntries: 3,
      totalBytes: 4096,
      byMediaType: {
        ebook: { entries: 2, bytes: 2048 },
        audiobook: { entries: 1, bytes: 2048 },
        comic: { entries: 0, bytes: 0 },
      },
    },
    ...overrides,
  }
}

function makeCacheClearResult(overrides: Partial<WarehouseCacheClearResult> = {}): WarehouseCacheClearResult {
  return {
    cleared: {
      covers: { entries: 3, bytes: 4096 },
    },
    ...makeCacheStatus({
      covers: {
        totalEntries: 0,
        totalBytes: 0,
        byMediaType: {
          ebook: { entries: 0, bytes: 0 },
          audiobook: { entries: 0, bytes: 0 },
          comic: { entries: 0, bytes: 0 },
        },
      },
    }),
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function mountComponent() {
  const wrapper = mount(WarehouseAdminSettings)
  await flushPromises()
  return wrapper
}

function findButton(wrapper: Awaited<ReturnType<typeof mountComponent>>, label: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().trim() === label)
  if (!button) throw new Error(`Could not find button: ${label}`)
  return button
}

describe('WarehouseAdminSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockState.fetchWarehouseAdminSettings.mockResolvedValue(makeSettings())
    mockState.fetchWarehouseCatalogSyncState.mockResolvedValue(makeSyncState())
    mockState.fetchWarehouseCacheStatus.mockResolvedValue(makeCacheStatus())
    mockState.clearWarehouseCache.mockResolvedValue(makeCacheClearResult())
    mockState.refreshLibraries.mockResolvedValue(undefined)
    mockState.syncWarehouseAll.mockResolvedValue([
      makeSyncSummary({ mediaType: 'ebook' }),
      makeSyncSummary({ mediaType: 'audiobook' }),
      makeSyncSummary({ mediaType: 'comic' }),
    ])
    mockState.updateWarehouseAdminSettings.mockResolvedValue(
      makeSettings({
        enabled: true,
        apiKeyConfigured: true,
        apiKeyPreview: 'abc...xyz',
      }),
    )
    mockState.syncWarehouseEbooks.mockResolvedValue(makeSyncSummary())
    mockState.syncWarehouseAudiobooks.mockResolvedValue(makeSyncSummary({ mediaType: 'audiobook' }))
    mockState.syncWarehouseComics.mockResolvedValue(makeSyncSummary({ mediaType: 'comic' }))
    mockState.testWarehouseConnection.mockResolvedValue({
      ok: true,
      status: 200,
      message: 'Connection verified',
      checkedAt: '2026-06-02T12:00:00.000Z',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders Book Warehouse admin copy', async () => {
    const wrapper = await mountComponent()
    const baseUrlInput = wrapper.get('#catalog-source-base-url')

    expect(mockState.fetchWarehouseAdminSettings).toHaveBeenCalledTimes(1)
    expect(mockState.fetchWarehouseCatalogSyncState).toHaveBeenCalledTimes(1)
    expect(mockState.fetchWarehouseCacheStatus).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Book Warehouse')
    expect(wrapper.text()).toContain('Enable Book Warehouse')
    expect(wrapper.text()).not.toContain('Enable background sync')
    expect(wrapper.text()).toContain('API key')
    expect(wrapper.text()).toContain('Books icon')
    expect(wrapper.text()).toContain('Audiobooks icon')
    expect(wrapper.text()).toContain('Comics icon')
    expect(wrapper.text()).not.toContain('third-party')
    expect(baseUrlInput.attributes('placeholder')).toBe('https://warehouse.example.com')
    expect(baseUrlInput.attributes('placeholder')).not.toBe('https://bookwarehouse.zenterprise.org')
  })

  it('keeps visible copy and placeholders free of third-party language', async () => {
    const wrapper = await mountComponent()
    const forbidden = [/third-party/i, /upstream/i]
    const visibleText = wrapper.text()
    const placeholders = wrapper
      .findAll('input')
      .map((input) => input.attributes('placeholder') ?? '')
      .join(' ')

    for (const pattern of forbidden) {
      expect(visibleText).not.toMatch(pattern)
      expect(placeholders).not.toMatch(pattern)
    }
  })

  it('renders the last ebook sync status, counts, and time with native copy', async () => {
    const wrapper = await mountComponent()

    expect(wrapper.text()).toContain('Last ebook sync')
    expect(wrapper.text()).toContain('Completed')
    expect(wrapper.text()).toContain('Synced 42')
    expect(wrapper.text()).toContain('Saved 40')
    expect(wrapper.text()).toContain(new Date('2026-06-02T11:03:00.000Z').toLocaleString())
    expect(wrapper.text()).not.toContain('third-party')
  })

  it('renders cover cache status with native admin copy', async () => {
    const wrapper = await mountComponent()

    expect(wrapper.text()).toContain('Cover cache')
    expect(wrapper.text()).toContain('3 covers')
    expect(wrapper.text()).toContain('4 KB')
    expect(wrapper.text()).toContain('Ebooks 2')
    expect(wrapper.text()).toContain('Audiobooks 1')
    expect(wrapper.text()).not.toContain('third-party')
    expect(wrapper.text()).not.toContain('upstream')
  })

  it('clears the cover cache and updates the visible status', async () => {
    const wrapper = await mountComponent()

    await findButton(wrapper, 'Clear cover cache').trigger('click')
    await flushPromises()

    expect(mockState.clearWarehouseCache).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('0 covers')
    expect(wrapper.text()).toContain('0 B')
    expect(mockState.toastSuccess).toHaveBeenCalledWith('Cleared 3 cached covers')
  })

  it('disables cover cache clear while a clear request is in flight', async () => {
    const clearRequest = deferred<WarehouseCacheClearResult>()
    mockState.clearWarehouseCache.mockReturnValueOnce(clearRequest.promise)

    const wrapper = await mountComponent()

    await findButton(wrapper, 'Clear cover cache').trigger('click')

    expect(findButton(wrapper, 'Clearing...').attributes('disabled')).toBeDefined()

    clearRequest.resolve(makeCacheClearResult())
    await flushPromises()
  })

  it('renders ebook status from the per-media latest run when audiobook is latest overall', async () => {
    mockState.fetchWarehouseCatalogSyncState.mockResolvedValueOnce(
      makeSyncState({
        lastRun: makeSyncSummary({
          mediaType: 'audiobook',
          fetchedCount: 24,
          savedCount: 23,
          finishedAt: '2026-06-02T12:03:00.000Z',
        }),
        lastRuns: {
          ebook: makeSyncSummary({
            mediaType: 'ebook',
            fetchedCount: 12,
            savedCount: 11,
            totalCount: 24,
            finishedAt: '2026-06-02T10:03:00.000Z',
          }),
          audiobook: makeSyncSummary({
            mediaType: 'audiobook',
            fetchedCount: 24,
            savedCount: 23,
            finishedAt: '2026-06-02T12:03:00.000Z',
          }),
          comic: null,
        },
      }),
    )

    const wrapper = await mountComponent()

    expect(wrapper.text()).toContain('Last ebook sync')
    expect(wrapper.text()).toContain('Synced 12 / 24')
    expect(wrapper.text()).toContain('Saved 11')
    expect(wrapper.text()).not.toContain('No ebook sync has run yet.')
  })

  it('renders the last audiobook sync status, counts, and time with native copy', async () => {
    mockState.fetchWarehouseCatalogSyncState.mockResolvedValueOnce(
      makeSyncState({
        lastRuns: {
          ebook: makeSyncSummary(),
          audiobook: makeSyncSummary({
            mediaType: 'audiobook',
            fetchedCount: 24,
            savedCount: 23,
            finishedAt: '2026-06-02T12:03:00.000Z',
          }),
          comic: null,
        },
      }),
    )

    const wrapper = await mountComponent()

    expect(wrapper.text()).toContain('Last audiobook sync')
    expect(wrapper.text()).toContain('Completed')
    expect(wrapper.text()).toContain('Synced 24')
    expect(wrapper.text()).toContain('Saved 23')
    expect(wrapper.text()).toContain(new Date('2026-06-02T12:03:00.000Z').toLocaleString())
    expect(wrapper.text()).not.toContain('third-party')
  })

  it('renders the last comic sync status, counts, and time with native copy', async () => {
    mockState.fetchWarehouseCatalogSyncState.mockResolvedValueOnce(
      makeSyncState({
        lastRuns: {
          ebook: makeSyncSummary(),
          audiobook: makeSyncSummary({ mediaType: 'audiobook' }),
          comic: makeSyncSummary({
            mediaType: 'comic',
            fetchedCount: 20,
            savedCount: 19,
            finishedAt: '2026-06-10T12:03:00.000Z',
          }),
        },
      }),
    )

    const wrapper = await mountComponent()

    expect(wrapper.text()).toContain('Last comic sync')
    expect(wrapper.text()).toContain('Completed')
    expect(wrapper.text()).toContain('Synced 20')
    expect(wrapper.text()).toContain('Saved 19')
    expect(wrapper.text()).toContain(new Date('2026-06-10T12:03:00.000Z').toLocaleString())
    expect(wrapper.text()).not.toContain('third-party')
  })

  it('enforces the server minimum sync cadence in the input constraints', async () => {
    const wrapper = await mountComponent()

    expect(wrapper.get('#catalog-source-sync-cadence').attributes('min')).toBe('15')
    expect(wrapper.text()).toContain('Requests are checked every 5 minutes')
  })

  it('trims the api key for save, sends it only in the patch payload, and clears the visible input after success', async () => {
    const wrapper = await mountComponent()

    await wrapper.get('#catalog-source-api-key').setValue('  secret-key  ')
    await wrapper.get('#catalog-source-base-url').setValue('https://catalog-source.example.test/catalog')
    await wrapper.get('#catalog-source-sync-cadence').setValue('720')

    await findButton(wrapper, 'Save').trigger('click')
    await flushPromises()

    expect(mockState.updateWarehouseAdminSettings).toHaveBeenCalledWith({
      enabled: false,
      baseUrl: 'https://catalog-source.example.test/catalog',
      apiKey: 'secret-key',
      syncCadenceMinutes: 720,
      sourceBackedLibraryIcons: {
        ebook: 'BookOpen',
        audiobook: 'Headphones',
        comic: 'PanelsTopLeft',
      },
    })
    expect(mockState.refreshLibraries).toHaveBeenCalledTimes(1)
    expect(mockState.testWarehouseConnection).not.toHaveBeenCalled()
    expect((wrapper.get('#catalog-source-api-key').element as HTMLInputElement).value).toBe('')
    expect(mockState.toastSuccess).toHaveBeenCalledWith('Book Warehouse settings saved')
  })

  it('keeps test connection disabled until a saved key exists, disables it during save, and re-enables it after save succeeds', async () => {
    const saveRequest = deferred<WarehouseAdminSettingsValue>()
    mockState.updateWarehouseAdminSettings.mockReturnValueOnce(saveRequest.promise)

    const wrapper = await mountComponent()
    const testButtonBeforeSave = findButton(wrapper, 'Test connection')

    expect(testButtonBeforeSave.attributes('disabled')).toBeDefined()

    await wrapper.get('#catalog-source-api-key').setValue('saved-key')
    await findButton(wrapper, 'Save').trigger('click')

    const testButtonDuringSave = findButton(wrapper, 'Test connection')
    expect(testButtonDuringSave.attributes('disabled')).toBeDefined()
    expect(findButton(wrapper, 'Saving...').exists()).toBe(true)

    saveRequest.resolve(
      makeSettings({
        enabled: true,
        apiKeyConfigured: true,
        apiKeyPreview: 'sav...key',
      }),
    )
    await flushPromises()

    const testButtonAfterSave = findButton(wrapper, 'Test connection')
    expect(testButtonAfterSave.attributes('disabled')).toBeUndefined()
  })

  it('disables ebook sync while settings are disabled', async () => {
    const wrapper = await mountComponent()

    expect(findButton(wrapper, 'Sync ebooks').attributes('disabled')).toBeDefined()
  })

  it('disables audiobook sync while settings are disabled', async () => {
    const wrapper = await mountComponent()

    expect(findButton(wrapper, 'Sync audiobooks').attributes('disabled')).toBeDefined()
  })

  it('disables comic sync while settings are disabled', async () => {
    const wrapper = await mountComponent()

    expect(findButton(wrapper, 'Sync comics').attributes('disabled')).toBeDefined()
  })

  it('keeps ebook sync disabled when enable is toggled locally until save persists it', async () => {
    const wrapper = await mountComponent()

    expect(findButton(wrapper, 'Sync ebooks').attributes('disabled')).toBeDefined()

    await wrapper.get('input[type="checkbox"]').setValue(true)
    await flushPromises()

    expect(findButton(wrapper, 'Sync ebooks').attributes('disabled')).toBeDefined()

    await findButton(wrapper, 'Save').trigger('click')
    await flushPromises()

    expect(mockState.updateWarehouseAdminSettings).toHaveBeenCalledWith({
      enabled: true,
      baseUrl: '',
      apiKey: undefined,
      syncCadenceMinutes: 360,
      sourceBackedLibraryIcons: {
        ebook: 'BookOpen',
        audiobook: 'Headphones',
        comic: 'PanelsTopLeft',
      },
    })
    expect(findButton(wrapper, 'Sync ebooks').attributes('disabled')).toBeUndefined()
    expect(findButton(wrapper, 'Sync audiobooks').attributes('disabled')).toBeUndefined()
    expect(findButton(wrapper, 'Sync comics').attributes('disabled')).toBeUndefined()
  })

  it('calls the combined sync api when Sync all is clicked and refreshes the shown state', async () => {
    mockState.fetchWarehouseAdminSettings.mockResolvedValueOnce(
      makeSettings({
        enabled: true,
        apiKeyConfigured: true,
      }),
    )
    mockState.syncWarehouseAll.mockResolvedValueOnce([
      makeSyncSummary({
        mediaType: 'ebook',
        fetchedCount: 11,
        savedCount: 10,
      }),
      makeSyncSummary({
        mediaType: 'audiobook',
        fetchedCount: 7,
        savedCount: 7,
      }),
      makeSyncSummary({
        mediaType: 'comic',
        fetchedCount: 5,
        savedCount: 5,
      }),
    ])
    mockState.fetchWarehouseCatalogSyncState.mockResolvedValueOnce(makeSyncState()).mockResolvedValueOnce(
      makeSyncState({
        lastRuns: {
          ebook: makeSyncSummary({ mediaType: 'ebook', fetchedCount: 11, savedCount: 10 }),
          audiobook: makeSyncSummary({ mediaType: 'audiobook', fetchedCount: 7, savedCount: 7 }),
          comic: makeSyncSummary({ mediaType: 'comic', fetchedCount: 5, savedCount: 5 }),
        },
      }),
    )
    const wrapper = await mountComponent()

    await findButton(wrapper, 'Sync all').trigger('click')
    await flushPromises()

    expect(mockState.syncWarehouseAll).toHaveBeenCalledTimes(1)
    expect(mockState.fetchWarehouseCatalogSyncState).toHaveBeenCalledTimes(2)
    expect(mockState.toastSuccess).toHaveBeenCalledWith('Catalog sync finished')
  })

  it('calls the sync api when Sync ebooks is clicked and refreshes the shown state', async () => {
    mockState.fetchWarehouseAdminSettings.mockResolvedValueOnce(
      makeSettings({
        enabled: true,
        apiKeyConfigured: true,
        apiKeyPreview: 'abc...xyz',
      }),
    )
    mockState.fetchWarehouseCatalogSyncState.mockResolvedValueOnce(makeSyncState({ lastRun: null })).mockResolvedValueOnce(
      makeSyncState({
        lastRun: makeSyncSummary({
          runId: 22,
          fetchedCount: 30,
          savedCount: 29,
          finishedAt: '2026-06-02T12:30:00.000Z',
        }),
      }),
    )
    mockState.syncWarehouseEbooks.mockResolvedValueOnce(
      makeSyncSummary({
        runId: 22,
        fetchedCount: 30,
        savedCount: 29,
        finishedAt: '2026-06-02T12:30:00.000Z',
      }),
    )

    const wrapper = await mountComponent()

    await findButton(wrapper, 'Sync ebooks').trigger('click')
    await flushPromises()

    expect(mockState.syncWarehouseEbooks).toHaveBeenCalledTimes(1)
    expect(mockState.fetchWarehouseCatalogSyncState).toHaveBeenCalledTimes(2)
    expect(mockState.toastSuccess).toHaveBeenCalledWith('Ebook sync finished')
    expect(wrapper.text()).toContain('Synced 30')
    expect(wrapper.text()).toContain('Saved 29')
  })

  it('calls the audiobook sync api when Sync audiobooks is clicked and refreshes the shown state', async () => {
    mockState.fetchWarehouseAdminSettings.mockResolvedValueOnce(
      makeSettings({
        enabled: true,
        apiKeyConfigured: true,
        apiKeyPreview: 'abc...xyz',
      }),
    )
    mockState.fetchWarehouseCatalogSyncState.mockResolvedValueOnce(makeSyncState({ lastRun: null })).mockResolvedValueOnce(
      makeSyncState({
        lastRun: makeSyncSummary({
          mediaType: 'audiobook',
          runId: 23,
          fetchedCount: 35,
          savedCount: 34,
          finishedAt: '2026-06-02T12:35:00.000Z',
        }),
      }),
    )
    mockState.syncWarehouseAudiobooks.mockResolvedValueOnce(
      makeSyncSummary({
        mediaType: 'audiobook',
        runId: 23,
        fetchedCount: 35,
        savedCount: 34,
        finishedAt: '2026-06-02T12:35:00.000Z',
      }),
    )

    const wrapper = await mountComponent()

    await findButton(wrapper, 'Sync audiobooks').trigger('click')
    await flushPromises()

    expect(mockState.syncWarehouseAudiobooks).toHaveBeenCalledTimes(1)
    expect(mockState.fetchWarehouseCatalogSyncState).toHaveBeenCalledTimes(2)
    expect(mockState.toastSuccess).toHaveBeenCalledWith('Audiobook sync finished')
    expect(wrapper.text()).toContain('Synced 35')
    expect(wrapper.text()).toContain('Saved 34')
  })

  it('calls the comic sync api when Sync comics is clicked and refreshes the shown state', async () => {
    mockState.fetchWarehouseAdminSettings.mockResolvedValueOnce(
      makeSettings({
        enabled: true,
        apiKeyConfigured: true,
        apiKeyPreview: 'abc...xyz',
      }),
    )
    mockState.fetchWarehouseCatalogSyncState.mockResolvedValueOnce(makeSyncState({ lastRun: null })).mockResolvedValueOnce(
      makeSyncState({
        lastRun: makeSyncSummary({
          mediaType: 'comic',
          runId: 24,
          fetchedCount: 31,
          savedCount: 30,
          finishedAt: '2026-06-10T12:35:00.000Z',
        }),
      }),
    )
    mockState.syncWarehouseComics.mockResolvedValueOnce(
      makeSyncSummary({
        mediaType: 'comic',
        runId: 24,
        fetchedCount: 31,
        savedCount: 30,
        finishedAt: '2026-06-10T12:35:00.000Z',
      }),
    )

    const wrapper = await mountComponent()

    await findButton(wrapper, 'Sync comics').trigger('click')
    await flushPromises()

    expect(mockState.syncWarehouseComics).toHaveBeenCalledTimes(1)
    expect(mockState.fetchWarehouseCatalogSyncState).toHaveBeenCalledTimes(2)
    expect(mockState.toastSuccess).toHaveBeenCalledWith('Comic sync finished')
    expect(wrapper.text()).toContain('Synced 31')
    expect(wrapper.text()).toContain('Saved 30')
  })

  it('disables ebook sync while a manual sync is in flight', async () => {
    const syncRequest = deferred<WarehouseCatalogSyncSummary>()
    mockState.fetchWarehouseAdminSettings.mockResolvedValueOnce(
      makeSettings({
        enabled: true,
        apiKeyConfigured: true,
        apiKeyPreview: 'abc...xyz',
      }),
    )
    mockState.fetchWarehouseCatalogSyncState.mockResolvedValueOnce(makeSyncState())
    mockState.syncWarehouseEbooks.mockReturnValueOnce(syncRequest.promise)

    const wrapper = await mountComponent()

    expect(findButton(wrapper, 'Sync ebooks').attributes('disabled')).toBeUndefined()

    await findButton(wrapper, 'Sync ebooks').trigger('click')

    expect(findButton(wrapper, 'Syncing...').attributes('disabled')).toBeDefined()

    syncRequest.resolve(makeSyncSummary({ status: 'running', finishedAt: null }))
    await flushPromises()
  })

  it('refreshes ebook sync counts while a manual sync is in flight', async () => {
    vi.useFakeTimers()
    const syncRequest = deferred<WarehouseCatalogSyncSummary>()
    mockState.fetchWarehouseAdminSettings.mockResolvedValueOnce(
      makeSettings({
        enabled: true,
        apiKeyConfigured: true,
        apiKeyPreview: 'abc...xyz',
      }),
    )
    mockState.fetchWarehouseCatalogSyncState.mockResolvedValueOnce(makeSyncState({ lastRun: null })).mockResolvedValueOnce(
      makeSyncState({
        running: true,
        lastRun: makeSyncSummary({
          status: 'running',
          fetchedCount: 100,
          savedCount: 98,
          finishedAt: null,
        }),
      }),
    )
    mockState.syncWarehouseEbooks.mockReturnValueOnce(syncRequest.promise)

    const wrapper = await mountComponent()

    await findButton(wrapper, 'Sync ebooks').trigger('click')
    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()

    expect(mockState.fetchWarehouseCatalogSyncState).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Running')
    expect(wrapper.text()).toContain('Synced 100')
    expect(wrapper.text()).toContain('Saved 98')

    syncRequest.resolve(
      makeSyncSummary({
        fetchedCount: 123,
        savedCount: 121,
      }),
    )
    await flushPromises()
  })

  it('ignores stale manual sync poll results after a sync completes', async () => {
    vi.useFakeTimers()
    const syncRequest = deferred<WarehouseCatalogSyncSummary>()
    const stalePollRequest = deferred<WarehouseCatalogSyncState>()
    mockState.fetchWarehouseAdminSettings.mockResolvedValueOnce(
      makeSettings({
        enabled: true,
        apiKeyConfigured: true,
        apiKeyPreview: 'abc...xyz',
      }),
    )
    mockState.fetchWarehouseCatalogSyncState
      .mockResolvedValueOnce(makeSyncState({ lastRun: null }))
      .mockReturnValueOnce(stalePollRequest.promise)
      .mockResolvedValueOnce(
        makeSyncState({
          lastRun: makeSyncSummary({
            fetchedCount: 123,
            savedCount: 121,
            finishedAt: '2026-06-02T12:30:00.000Z',
          }),
        }),
      )
    mockState.syncWarehouseEbooks.mockReturnValueOnce(syncRequest.promise)

    const wrapper = await mountComponent()

    await findButton(wrapper, 'Sync ebooks').trigger('click')
    await vi.advanceTimersByTimeAsync(1500)
    expect(mockState.fetchWarehouseCatalogSyncState).toHaveBeenCalledTimes(2)

    syncRequest.resolve(
      makeSyncSummary({
        fetchedCount: 123,
        savedCount: 121,
        finishedAt: '2026-06-02T12:30:00.000Z',
      }),
    )
    await flushPromises()

    expect(wrapper.text()).toContain('Completed')
    expect(wrapper.text()).toContain('Synced 123')
    expect(wrapper.text()).toContain('Saved 121')

    stalePollRequest.resolve(
      makeSyncState({
        running: true,
        lastRun: makeSyncSummary({
          status: 'running',
          fetchedCount: 100,
          savedCount: 98,
          finishedAt: null,
        }),
      }),
    )
    await flushPromises()

    expect(wrapper.text()).toContain('Completed')
    expect(wrapper.text()).toContain('Synced 123')
    expect(wrapper.text()).toContain('Saved 121')
    expect(wrapper.text()).not.toContain('Running')
  })

  it('disables audiobook sync while a manual sync is in flight', async () => {
    const syncRequest = deferred<WarehouseCatalogSyncSummary>()
    mockState.fetchWarehouseAdminSettings.mockResolvedValueOnce(
      makeSettings({
        enabled: true,
        apiKeyConfigured: true,
        apiKeyPreview: 'abc...xyz',
      }),
    )
    mockState.fetchWarehouseCatalogSyncState.mockResolvedValueOnce(makeSyncState())
    mockState.syncWarehouseAudiobooks.mockReturnValueOnce(syncRequest.promise)

    const wrapper = await mountComponent()

    expect(findButton(wrapper, 'Sync audiobooks').attributes('disabled')).toBeUndefined()

    await findButton(wrapper, 'Sync audiobooks').trigger('click')

    expect(findButton(wrapper, 'Syncing audiobooks...').attributes('disabled')).toBeDefined()
    expect(findButton(wrapper, 'Sync ebooks').attributes('disabled')).toBeDefined()

    syncRequest.resolve(makeSyncSummary({ mediaType: 'audiobook', status: 'running', finishedAt: null }))
    await flushPromises()
  })

  it('disables comic sync while a manual sync is in flight', async () => {
    const syncRequest = deferred<WarehouseCatalogSyncSummary>()
    mockState.fetchWarehouseAdminSettings.mockResolvedValueOnce(
      makeSettings({
        enabled: true,
        apiKeyConfigured: true,
        apiKeyPreview: 'abc...xyz',
      }),
    )
    mockState.fetchWarehouseCatalogSyncState.mockResolvedValueOnce(makeSyncState())
    mockState.syncWarehouseComics.mockReturnValueOnce(syncRequest.promise)

    const wrapper = await mountComponent()

    expect(findButton(wrapper, 'Sync comics').attributes('disabled')).toBeUndefined()

    await findButton(wrapper, 'Sync comics').trigger('click')

    expect(findButton(wrapper, 'Syncing comics...').attributes('disabled')).toBeDefined()
    expect(findButton(wrapper, 'Sync ebooks').attributes('disabled')).toBeDefined()
    expect(findButton(wrapper, 'Sync audiobooks').attributes('disabled')).toBeDefined()

    syncRequest.resolve(makeSyncSummary({ mediaType: 'comic', status: 'running', finishedAt: null }))
    await flushPromises()
  })

  it('disables audiobook sync when an existing sync is running', async () => {
    mockState.fetchWarehouseAdminSettings.mockResolvedValueOnce(
      makeSettings({
        enabled: true,
        apiKeyConfigured: true,
        apiKeyPreview: 'abc...xyz',
      }),
    )
    mockState.fetchWarehouseCatalogSyncState.mockResolvedValueOnce(makeSyncState({ running: true }))

    const wrapper = await mountComponent()

    expect(findButton(wrapper, 'Sync audiobooks').attributes('disabled')).toBeDefined()
  })

  it('reloads sync state after a failed manual sync and shows the failed status', async () => {
    mockState.fetchWarehouseAdminSettings.mockResolvedValueOnce(
      makeSettings({
        enabled: true,
        apiKeyConfigured: true,
        apiKeyPreview: 'abc...xyz',
      }),
    )
    mockState.fetchWarehouseCatalogSyncState.mockResolvedValueOnce(makeSyncState({ lastRun: null })).mockResolvedValueOnce(
      makeSyncState({
        lastRun: makeSyncSummary({
          runId: 31,
          status: 'failed',
          fetchedCount: 18,
          savedCount: 12,
          errorMessage: 'Catalog source sync failed',
          finishedAt: '2026-06-02T13:10:00.000Z',
        }),
      }),
    )
    mockState.syncWarehouseEbooks.mockRejectedValueOnce(new Error('Sync request failed'))

    const wrapper = await mountComponent()

    await findButton(wrapper, 'Sync ebooks').trigger('click')
    await flushPromises()

    expect(mockState.syncWarehouseEbooks).toHaveBeenCalledTimes(1)
    expect(mockState.fetchWarehouseCatalogSyncState).toHaveBeenCalledTimes(2)
    expect(mockState.toastError).toHaveBeenCalledWith('Sync request failed')
    expect(wrapper.text()).toContain('Failed')
    expect(wrapper.text()).toContain('Synced 18')
    expect(wrapper.text()).toContain('Saved 12')
    expect(wrapper.text()).toContain('Catalog source sync failed')
  })

  it('disables test connection during save when a stored key already exists', async () => {
    const saveRequest = deferred<WarehouseAdminSettingsValue>()
    mockState.fetchWarehouseAdminSettings.mockResolvedValueOnce(
      makeSettings({
        enabled: true,
        apiKeyConfigured: true,
        apiKeyPreview: 'abc...xyz',
      }),
    )
    mockState.updateWarehouseAdminSettings.mockReturnValueOnce(saveRequest.promise)

    const wrapper = await mountComponent()

    expect(findButton(wrapper, 'Test connection').attributes('disabled')).toBeUndefined()

    await wrapper.get('#catalog-source-base-url').setValue('https://catalog-source.example.test/v2')
    await findButton(wrapper, 'Save').trigger('click')

    expect(findButton(wrapper, 'Test connection').attributes('disabled')).toBeDefined()

    saveRequest.resolve(
      makeSettings({
        enabled: true,
        apiKeyConfigured: true,
        apiKeyPreview: 'abc...xyz',
        baseUrl: 'https://catalog-source.example.test/v2',
      }),
    )
    await flushPromises()

    expect(findButton(wrapper, 'Test connection').attributes('disabled')).toBeUndefined()
  })

  it('recovers the save button state after a save error', async () => {
    const saveRequest = deferred<WarehouseAdminSettingsValue>()
    mockState.updateWarehouseAdminSettings.mockReturnValueOnce(saveRequest.promise)

    const wrapper = await mountComponent()

    await wrapper.get('#catalog-source-api-key').setValue('bad-key')
    await findButton(wrapper, 'Save').trigger('click')

    expect(findButton(wrapper, 'Saving...').exists()).toBe(true)

    saveRequest.reject(new Error('Save failed'))
    await flushPromises()

    expect(findButton(wrapper, 'Save').attributes('disabled')).toBeUndefined()
    expect(mockState.toastError).toHaveBeenCalledWith('Save failed')
    expect((wrapper.get('#catalog-source-api-key').element as HTMLInputElement).value).toBe('bad-key')
  })

  it('tests a saved connection without requiring a typed key and recovers button state on success', async () => {
    const testRequest = deferred<WarehouseConnectionTestResult>()
    mockState.fetchWarehouseAdminSettings.mockResolvedValueOnce(
      makeSettings({
        enabled: true,
        apiKeyConfigured: true,
        apiKeyPreview: 'abc...xyz',
      }),
    )
    mockState.testWarehouseConnection.mockReturnValueOnce(testRequest.promise)

    const wrapper = await mountComponent()

    expect((wrapper.get('#catalog-source-api-key').element as HTMLInputElement).value).toBe('')

    await findButton(wrapper, 'Test connection').trigger('click')

    expect(findButton(wrapper, 'Testing...').exists()).toBe(true)

    testRequest.resolve({
      ok: true,
      status: 200,
      message: 'Connection verified',
      checkedAt: '2026-06-02T12:00:00.000Z',
    })
    await flushPromises()

    expect(mockState.testWarehouseConnection).toHaveBeenCalledTimes(1)
    expect(findButton(wrapper, 'Test connection').attributes('disabled')).toBeUndefined()
    expect(mockState.toastSuccess).toHaveBeenCalledWith('Connection verified')
    expect(wrapper.text()).toContain('ok')
  })

  it('recovers the test button state and shows an error when connection testing fails', async () => {
    const testRequest = deferred<WarehouseConnectionTestResult>()
    mockState.fetchWarehouseAdminSettings.mockResolvedValueOnce(
      makeSettings({
        enabled: true,
        apiKeyConfigured: true,
        apiKeyPreview: 'abc...xyz',
      }),
    )
    mockState.testWarehouseConnection.mockReturnValueOnce(testRequest.promise)

    const wrapper = await mountComponent()

    await findButton(wrapper, 'Test connection').trigger('click')

    expect(findButton(wrapper, 'Testing...').exists()).toBe(true)

    testRequest.reject(new Error('Connection failed'))
    await flushPromises()

    expect(mockState.testWarehouseConnection).toHaveBeenCalledTimes(1)
    expect(findButton(wrapper, 'Test connection').attributes('disabled')).toBeUndefined()
    expect(mockState.toastError).toHaveBeenCalledWith('Connection failed')
    expect(wrapper.text()).toContain('Connection failed')
  })
})
