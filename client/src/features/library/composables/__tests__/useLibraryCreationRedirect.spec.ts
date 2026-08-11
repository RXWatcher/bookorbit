import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLibraryCreationRedirect } from '../useLibraryCreationRedirect'

const routerPush = vi.fn<() => Promise<void>>()
const refreshLibraries = vi.fn<() => Promise<void>>()

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
}))

vi.mock('../useLibraries', () => ({
  useLibraries: () => ({ refreshLibraries }),
}))

describe('useLibraryCreationRedirect', () => {
  beforeEach(() => {
    routerPush.mockClear()
    refreshLibraries.mockClear()
  })

  it.each([
    [CLOUD_EBOOK_LIBRARY_ID, 'ebooks'],
    [CLOUD_AUDIO_LIBRARY_ID, 'audiobooks'],
    [CLOUD_COMIC_LIBRARY_ID, 'comics'],
  ])('uses friendly source-backed library route params when redirecting library %s', async (libraryId, routeParam) => {
    const { handleLibraryCreated } = useLibraryCreationRedirect()

    await handleLibraryCreated({ id: libraryId })

    expect(refreshLibraries).toHaveBeenCalledOnce()
    expect(routerPush).toHaveBeenCalledWith({ name: 'library', params: { id: routeParam } })
  })
})
