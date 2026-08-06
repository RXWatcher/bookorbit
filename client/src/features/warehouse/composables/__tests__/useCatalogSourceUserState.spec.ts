import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { WarehouseMediaType, WarehouseUserCatalogState, WarehouseUserCatalogStatePatch } from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  fetchCatalogSourceUserState: vi.fn<(mediaType: WarehouseMediaType, remoteId: string) => Promise<WarehouseUserCatalogState>>(),
  patchCatalogSourceUserState:
    vi.fn<(mediaType: WarehouseMediaType, remoteId: string, patch: WarehouseUserCatalogStatePatch) => Promise<WarehouseUserCatalogState>>(),
}))

vi.mock('@/lib/api', () => ({ api: mocks.api }))

function makeState(overrides: Partial<WarehouseUserCatalogState> = {}): WarehouseUserCatalogState {
  return {
    mediaType: 'audiobook',
    remoteId: 'remote 1/with slash',
    inLibrary: false,
    favorite: false,
    rating: null,
    readStatus: null,
    progressPercent: null,
    positionSeconds: null,
    finishedAt: null,
    updatedAt: '2026-06-03T12:00:00.000Z',
    ...overrides,
  }
}

function makeResponse(data?: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => data,
  } as Response
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

describe('catalog-source user state api', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('../../api/catalog-source.api')
    mocks.api.mockReset()
  })

  it('builds encoded state URLs and sends only allowed patch fields', async () => {
    const loaded = {
      ...makeState({ mediaType: 'ebook', remoteId: 'book 1/edition' }),
      apiKey: 'hidden',
      baseUrl: 'hidden',
      raw: { hidden: true },
      rawPayload: { hidden: true },
      upstreamRequestId: 'hidden',
    }
    const patched = makeState({ mediaType: 'ebook', remoteId: 'book 1/edition', favorite: true, rating: 4, updatedAt: '2026-06-03T13:00:00.000Z' })
    mocks.api.mockResolvedValueOnce(makeResponse(loaded)).mockResolvedValueOnce(makeResponse(patched))

    const { fetchCatalogSourceUserState, patchCatalogSourceUserState } = await import('../../api/catalog-source.api')

    await expect(fetchCatalogSourceUserState('ebook', 'book 1/edition')).resolves.toEqual(
      makeState({ mediaType: 'ebook', remoteId: 'book 1/edition' }),
    )
    await expect(
      patchCatalogSourceUserState('ebook', 'book 1/edition', {
        favorite: true,
        rating: 4,
        apiKey: 'hidden',
        baseUrl: 'hidden',
        raw: { hidden: true },
        rawPayload: { hidden: true },
        upstreamRequestId: 'hidden',
      } as WarehouseUserCatalogStatePatch & Record<string, unknown>),
    ).resolves.toEqual(patched)

    expect(mocks.api).toHaveBeenNthCalledWith(1, '/api/v1/catalog/items/ebook/book%201%2Fedition/state')
    expect(mocks.api).toHaveBeenNthCalledWith(2, '/api/v1/catalog/items/ebook/book%201%2Fedition/state', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: true, rating: 4 }),
    })
  })

  it('uses native library item fallback copy for state API failures', async () => {
    mocks.api.mockResolvedValueOnce(makeResponse({ message: '' }, false)).mockResolvedValueOnce(makeResponse({ message: '' }, false))

    const { fetchCatalogSourceUserState, patchCatalogSourceUserState } = await import('../../api/catalog-source.api')

    await expect(fetchCatalogSourceUserState('ebook', 'book 1/edition')).rejects.toThrow('Failed to load library item state')
    await expect(patchCatalogSourceUserState('ebook', 'book 1/edition', { favorite: true })).rejects.toThrow('Failed to save library item state')
  })

  it('builds encoded bookmark URLs and sends only allowed bookmark fields', async () => {
    const bookmark = {
      id: 17,
      mediaType: 'ebook',
      remoteId: 'book 1/edition',
      cfi: 'epubcfi(/6/8)',
      title: 'Chapter 2',
      positionSeconds: null,
      createdAt: '2026-06-03T15:30:00.000Z',
      apiKey: 'hidden',
      baseUrl: 'hidden',
      raw: { hidden: true },
      rawPayload: { hidden: true },
    }
    mocks.api
      .mockResolvedValueOnce(makeResponse([bookmark]))
      .mockResolvedValueOnce(makeResponse(bookmark))
      .mockResolvedValueOnce(makeResponse(undefined, true, 204))

    const { fetchCatalogSourceBookmarks, createCatalogSourceBookmark, deleteCatalogSourceBookmark } = await import('../../api/catalog-source.api')

    await expect(fetchCatalogSourceBookmarks('ebook', 'book 1/edition')).resolves.toEqual([
      {
        id: 17,
        mediaType: 'ebook',
        remoteId: 'book 1/edition',
        cfi: 'epubcfi(/6/8)',
        title: 'Chapter 2',
        positionSeconds: null,
        createdAt: '2026-06-03T15:30:00.000Z',
      },
    ])
    await expect(
      createCatalogSourceBookmark('ebook', 'book 1/edition', {
        cfi: 'epubcfi(/6/8)',
        title: 'Chapter 2',
        positionSeconds: 12,
        apiKey: 'hidden',
        baseUrl: 'hidden',
        rawPayload: { hidden: true },
      } as never),
    ).resolves.toEqual({
      id: 17,
      mediaType: 'ebook',
      remoteId: 'book 1/edition',
      cfi: 'epubcfi(/6/8)',
      title: 'Chapter 2',
      positionSeconds: null,
      createdAt: '2026-06-03T15:30:00.000Z',
    })
    await expect(deleteCatalogSourceBookmark('ebook', 'book 1/edition', 17)).resolves.toBeUndefined()

    expect(mocks.api).toHaveBeenNthCalledWith(1, '/api/v1/catalog/items/ebook/book%201%2Fedition/bookmarks')
    expect(mocks.api).toHaveBeenNthCalledWith(2, '/api/v1/catalog/items/ebook/book%201%2Fedition/bookmarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Chapter 2', cfi: 'epubcfi(/6/8)', positionSeconds: 12 }),
    })
    expect(mocks.api).toHaveBeenNthCalledWith(3, '/api/v1/catalog/items/ebook/book%201%2Fedition/bookmarks/17', { method: 'DELETE' })
  })
})

describe('useCatalogSourceUserState', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.fetchCatalogSourceUserState.mockReset()
    mocks.patchCatalogSourceUserState.mockReset()
    vi.doMock('../../api/catalog-source.api', () => ({
      fetchCatalogSourceUserState: mocks.fetchCatalogSourceUserState,
      patchCatalogSourceUserState: mocks.patchCatalogSourceUserState,
    }))
  })

  it('loads default state on creation', async () => {
    const loaded = makeState()
    mocks.fetchCatalogSourceUserState.mockResolvedValueOnce(loaded)

    const { useCatalogSourceUserState } = await import('../useCatalogSourceUserState')
    const catalogState = useCatalogSourceUserState('audiobook', 'remote 1/with slash')

    expect(catalogState.loading.value).toBe(true)
    expect(catalogState.state.value).toBeNull()

    await flushPromises()

    expect(mocks.fetchCatalogSourceUserState).toHaveBeenCalledWith('audiobook', 'remote 1/with slash')
    expect(catalogState.state.value).toEqual(loaded)
    expect(catalogState.error.value).toBeNull()
    expect(catalogState.loading.value).toBe(false)
  })

  it('clears stale item state when reactive route params move to another source-backed item that fails to load', async () => {
    const remoteId = ref('remote 1/with slash')
    const loaded = makeState({ remoteId: 'remote 1/with slash', favorite: true, inLibrary: true, rating: 5 })
    mocks.fetchCatalogSourceUserState.mockResolvedValueOnce(loaded).mockRejectedValueOnce(new Error('not available'))

    const { useCatalogSourceUserState } = await import('../useCatalogSourceUserState')
    const catalogState = useCatalogSourceUserState('audiobook', remoteId, { autoLoad: false })

    await catalogState.load()

    expect(catalogState.state.value).toEqual(loaded)

    remoteId.value = 'remote 2'
    await catalogState.load()

    expect(mocks.fetchCatalogSourceUserState).toHaveBeenLastCalledWith('audiobook', 'remote 2')
    expect(catalogState.state.value).toBeNull()
    expect(catalogState.error.value).toBe('Failed to load library item state')
  })

  it('applies an optimistic update and then replaces it with the server response', async () => {
    const initial = makeState()
    const saveDeferred = deferred<WarehouseUserCatalogState>()
    const serverState = makeState({ favorite: true, rating: 5, readStatus: 'reading', progressPercent: 52, positionSeconds: 320, inLibrary: true })
    mocks.fetchCatalogSourceUserState.mockResolvedValueOnce(initial)
    mocks.patchCatalogSourceUserState.mockReturnValueOnce(saveDeferred.promise)

    const { useCatalogSourceUserState } = await import('../useCatalogSourceUserState')
    const catalogState = useCatalogSourceUserState('audiobook', 'remote 1/with slash')

    await flushPromises()
    const savePromise = catalogState.save({
      favorite: true,
      rating: 4,
      readStatus: 'reading',
      progressPercent: 50,
      positionSeconds: 300,
      inLibrary: true,
      rawPayload: { hidden: true },
    } as WarehouseUserCatalogStatePatch & Record<string, unknown>)

    expect(catalogState.saving.value).toBe(true)
    expect(catalogState.state.value).toMatchObject({
      favorite: true,
      rating: 4,
      readStatus: 'reading',
      progressPercent: 50,
      positionSeconds: 300,
      inLibrary: true,
    })
    expect(catalogState.state.value).not.toHaveProperty('rawPayload')

    saveDeferred.resolve(serverState)
    await expect(savePromise).resolves.toEqual(serverState)

    expect(mocks.patchCatalogSourceUserState).toHaveBeenCalledWith('audiobook', 'remote 1/with slash', {
      favorite: true,
      rating: 4,
      readStatus: 'reading',
      progressPercent: 50,
      positionSeconds: 300,
      inLibrary: true,
    })
    expect(catalogState.state.value).toEqual(serverState)
    expect(catalogState.error.value).toBeNull()
    expect(catalogState.saving.value).toBe(false)
  })

  it('rolls back optimistic state on save failure', async () => {
    const initial = makeState({ favorite: false, rating: 2, readStatus: 'reading' })
    const saveDeferred = deferred<WarehouseUserCatalogState>()
    mocks.fetchCatalogSourceUserState.mockResolvedValueOnce(initial)
    mocks.patchCatalogSourceUserState.mockReturnValueOnce(saveDeferred.promise)

    const { useCatalogSourceUserState } = await import('../useCatalogSourceUserState')
    const catalogState = useCatalogSourceUserState('audiobook', 'remote 1/with slash')

    await flushPromises()
    const savePromise = catalogState.save({ favorite: true, rating: 5, readStatus: 'read' })

    expect(catalogState.state.value).toMatchObject({ favorite: true, rating: 5, readStatus: 'read' })

    saveDeferred.reject(new Error('Private failure detail'))
    await expect(savePromise).rejects.toThrow('Failed to save library item state')

    expect(catalogState.state.value).toEqual(initial)
    expect(catalogState.error.value).toBe('Failed to save library item state')
    expect(catalogState.saving.value).toBe(false)
  })

  it('queues saves in request order while keeping the newer optimistic state', async () => {
    const initial = makeState({ favorite: false, rating: null })
    const olderSave = deferred<WarehouseUserCatalogState>()
    const newerSave = deferred<WarehouseUserCatalogState>()
    const olderServerState = makeState({ favorite: true, rating: 2, updatedAt: '2026-06-03T13:00:00.000Z' })
    const newerServerState = makeState({ favorite: true, rating: 5, updatedAt: '2026-06-03T14:00:00.000Z' })
    mocks.fetchCatalogSourceUserState.mockResolvedValueOnce(initial)
    mocks.patchCatalogSourceUserState.mockReturnValueOnce(olderSave.promise).mockReturnValueOnce(newerSave.promise)

    const { useCatalogSourceUserState } = await import('../useCatalogSourceUserState')
    const catalogState = useCatalogSourceUserState('audiobook', 'remote 1/with slash')

    await flushPromises()
    const olderPromise = catalogState.save({ favorite: true, rating: 2 })
    const newerPromise = catalogState.save({ rating: 5 })

    expect(catalogState.state.value).toMatchObject({ favorite: true, rating: 5 })
    await flushPromises()
    expect(mocks.patchCatalogSourceUserState).toHaveBeenCalledTimes(1)
    expect(mocks.patchCatalogSourceUserState).toHaveBeenNthCalledWith(1, 'audiobook', 'remote 1/with slash', { favorite: true, rating: 2 })

    olderSave.resolve(olderServerState)
    await expect(olderPromise).resolves.toEqual(olderServerState)

    expect(mocks.patchCatalogSourceUserState).toHaveBeenCalledTimes(2)
    expect(mocks.patchCatalogSourceUserState).toHaveBeenNthCalledWith(2, 'audiobook', 'remote 1/with slash', { rating: 5 })
    expect(catalogState.state.value).toMatchObject({ favorite: true, rating: 5 })
    expect(catalogState.saving.value).toBe(true)

    newerSave.resolve(newerServerState)
    await expect(newerPromise).resolves.toEqual(newerServerState)

    expect(catalogState.state.value).toEqual(newerServerState)
    expect(catalogState.saving.value).toBe(false)
  })

  it('does not roll back newer optimistic state when an older save fails first', async () => {
    const initial = makeState({ favorite: false, rating: null })
    const olderSave = deferred<WarehouseUserCatalogState>()
    const newerSave = deferred<WarehouseUserCatalogState>()
    const newerServerState = makeState({ favorite: false, rating: 5, updatedAt: '2026-06-03T14:00:00.000Z' })
    mocks.fetchCatalogSourceUserState.mockResolvedValueOnce(initial)
    mocks.patchCatalogSourceUserState.mockReturnValueOnce(olderSave.promise).mockReturnValueOnce(newerSave.promise)

    const { useCatalogSourceUserState } = await import('../useCatalogSourceUserState')
    const catalogState = useCatalogSourceUserState('audiobook', 'remote 1/with slash')

    await flushPromises()
    const olderPromise = catalogState.save({ favorite: true, rating: 2 })
    const newerPromise = catalogState.save({ rating: 5 })

    olderSave.reject(new Error('Private failure detail'))
    await expect(olderPromise).rejects.toThrow('Failed to save library item state')
    await flushPromises()

    expect(mocks.patchCatalogSourceUserState).toHaveBeenCalledTimes(2)
    expect(catalogState.state.value).toMatchObject({ favorite: false, rating: 5 })
    expect(catalogState.error.value).toBeNull()

    newerSave.resolve(newerServerState)
    await expect(newerPromise).resolves.toEqual(newerServerState)

    expect(catalogState.state.value).toEqual(newerServerState)
    expect(catalogState.error.value).toBeNull()
    expect(catalogState.saving.value).toBe(false)
  })

  it('removes only the older optimistic patch when an older save fails while a newer save is pending', async () => {
    const initial = makeState({ favorite: false, rating: null })
    const olderSave = deferred<WarehouseUserCatalogState>()
    const newerSave = deferred<WarehouseUserCatalogState>()
    const newerServerState = makeState({ favorite: false, rating: 5, updatedAt: '2026-06-03T14:00:00.000Z' })
    mocks.fetchCatalogSourceUserState.mockResolvedValueOnce(initial)
    mocks.patchCatalogSourceUserState.mockReturnValueOnce(olderSave.promise).mockReturnValueOnce(newerSave.promise)

    const { useCatalogSourceUserState } = await import('../useCatalogSourceUserState')
    const catalogState = useCatalogSourceUserState('audiobook', 'remote 1/with slash')

    await flushPromises()
    const olderPromise = catalogState.save({ favorite: true })
    const newerPromise = catalogState.save({ rating: 5 })

    await flushPromises()
    expect(mocks.patchCatalogSourceUserState).toHaveBeenCalledTimes(1)
    expect(catalogState.state.value).toMatchObject({ favorite: true, rating: 5 })

    olderSave.reject(new Error('Private failure detail'))
    await expect(olderPromise).rejects.toThrow('Failed to save library item state')

    expect(mocks.patchCatalogSourceUserState).toHaveBeenCalledTimes(2)
    expect(catalogState.state.value).toMatchObject({ favorite: false, rating: 5 })
    expect(catalogState.error.value).toBeNull()
    expect(catalogState.saving.value).toBe(true)

    newerSave.resolve(newerServerState)
    await expect(newerPromise).resolves.toEqual(newerServerState)

    expect(catalogState.state.value).toEqual(newerServerState)
    expect(catalogState.saving.value).toBe(false)
  })

  it('returns to the last confirmed state when overlapping saves both fail', async () => {
    const initial = makeState({ favorite: false, rating: null })
    const olderSave = deferred<WarehouseUserCatalogState>()
    const newerSave = deferred<WarehouseUserCatalogState>()
    mocks.fetchCatalogSourceUserState.mockResolvedValueOnce(initial)
    mocks.patchCatalogSourceUserState.mockReturnValueOnce(olderSave.promise).mockReturnValueOnce(newerSave.promise)

    const { useCatalogSourceUserState } = await import('../useCatalogSourceUserState')
    const catalogState = useCatalogSourceUserState('audiobook', 'remote 1/with slash')

    await flushPromises()
    const olderPromise = catalogState.save({ favorite: true })
    const newerPromise = catalogState.save({ rating: 5 })

    await flushPromises()
    expect(mocks.patchCatalogSourceUserState).toHaveBeenCalledTimes(1)
    expect(catalogState.state.value).toMatchObject({ favorite: true, rating: 5 })

    olderSave.reject(new Error('Private failure detail'))
    await expect(olderPromise).rejects.toThrow('Failed to save library item state')

    expect(mocks.patchCatalogSourceUserState).toHaveBeenCalledTimes(2)
    expect(catalogState.state.value).toMatchObject({ favorite: false, rating: 5 })
    expect(catalogState.saving.value).toBe(true)

    newerSave.reject(new Error('Private failure detail'))
    await expect(newerPromise).rejects.toThrow('Failed to save library item state')

    expect(catalogState.state.value).toEqual(initial)
    expect(catalogState.error.value).toBe('Failed to save library item state')
    expect(catalogState.saving.value).toBe(false)
  })

  it('keeps saving true while any overlapping save remains in flight', async () => {
    const initial = makeState()
    const olderSave = deferred<WarehouseUserCatalogState>()
    const newerSave = deferred<WarehouseUserCatalogState>()
    mocks.fetchCatalogSourceUserState.mockResolvedValueOnce(initial)
    mocks.patchCatalogSourceUserState.mockReturnValueOnce(olderSave.promise).mockReturnValueOnce(newerSave.promise)

    const { useCatalogSourceUserState } = await import('../useCatalogSourceUserState')
    const catalogState = useCatalogSourceUserState('audiobook', 'remote 1/with slash')

    await flushPromises()
    const olderPromise = catalogState.save({ favorite: true })
    const newerPromise = catalogState.save({ rating: 4 })

    await flushPromises()
    expect(mocks.patchCatalogSourceUserState).toHaveBeenCalledTimes(1)

    olderSave.resolve(makeState({ favorite: true }))
    await expect(olderPromise).resolves.toEqual(makeState({ favorite: true }))

    expect(catalogState.saving.value).toBe(true)
    expect(mocks.patchCatalogSourceUserState).toHaveBeenCalledTimes(2)

    newerSave.resolve(makeState({ favorite: true, rating: 4 }))
    await expect(newerPromise).resolves.toEqual(makeState({ favorite: true, rating: 4 }))

    expect(catalogState.saving.value).toBe(false)
  })
})

describe('library item state visible copy', () => {
  it('does not introduce forbidden provider wording in user-facing strings', () => {
    const files = [resolve(__dirname, '../../api/catalog-source.api.ts'), resolve(__dirname, '../useCatalogSourceUserState.ts')]
    const forbidden = /\b(book warehouse|warehouse|upstream|provider|source|third-party)\b/i

    const userFacingStrings = files.flatMap((file) => {
      const content = readFileSync(file, 'utf8')
      return [...content.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)]
        .map((match) => match[2] ?? '')
        .filter((value) => value.includes('Failed') || /\s/.test(value))
    })

    expect(userFacingStrings.filter((value) => forbidden.test(value))).toEqual([])
  })
})
